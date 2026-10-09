"use client"

import { captureFrame, getVideo } from "@/lib/camera"
import { JarvisApiError, observeBoard, type WatchLevel } from "@/lib/jarvis-client"
import { isUltron } from "@/lib/persona"

// Watch mode: Jarvis following the whiteboard and speaking up on his own.
//
// Sending every frame would burn the free Gemini quota in minutes and
// mostly show him a hand mid-stroke, so the deciding is done here, on tiny
// grayscale thumbnails: a frame goes to /watch/observe only once the
// board has CHANGED since his last look and then HELD STILL for a few
// seconds (Andrew finished a line and stepped back). The server decides
// whether that is worth a word; this decides whether now is a moment he
// can hear it.

export type { WatchLevel }

const TICK_MS = 1500
// Thumbnail size. 64x36 averaged a line of marker writing away to nothing,
// so new work on the board almost never registered and he almost never
// looked; at 128x72 a written line is a few dozen pixels.
const THUMB_W = 128
const THUMB_H = 72
// A pixel "changed" when it moved more than this many grey levels...
const PIXEL_DELTA = 16
// ...and a frame changed when more than this share of pixels did.
const MOTION_SHARE = 0.02 // tick to tick: someone is moving
const CHANGE_SHARE = 0.003 // since the last look: something new (~28 pixels)
const SETTLE_MS = 3000
const MIN_LOOK_GAP_MS = 20_000
// Whatever the thumbnails say, a settled board is looked at this often:
// change detection can miss faint or small writing. Each look is a call on
// the same free daily quota as chat, though: at every 90 seconds (and up
// to 90 an hour) an evening of watching used up the best models, and chat
// fell to the lite ones, which claim to open windows they never open.
const PERIODIC_LOOK_MS = 4 * 60_000
// No more than this many looks an hour, whatever the board does.
const MAX_LOOKS_PER_HOUR = 40
const STUCK_MS = 5 * 60_000
const BACKOFF_MS = 2 * 60_000

// The least time between two remarks, by level.
const COOLDOWN_MS: Record<WatchLevel, number> = {
  quiet: 4 * 60_000,
  normal: 75_000,
  coach: 60_000,
}

export interface WatchHost {
  token: string
  sessionId: string
  /** False while he is talking, Jarvis is talking, or a reply is coming. */
  canSpeak: () => boolean
  onRemark: (message: string) => void
  onError: (message: string) => void
  /** A look is out (true) or back (false, with what he made of it). */
  onLook?: (looking: boolean, result?: { spoke: boolean; notes: string; model?: string }) => void
  /** What is on screen for him (the showcase window), sent with each look. */
  onScreen?: () => string
}

interface Watch {
  host: WatchHost
  level: WatchLevel
  timer: { stop: () => void }
  previous: Float32Array | null
  baseline: Float32Array | null
  lastMotionAt: number
  lastChangeAt: number
  lastLookAt: number
  lastRemarkAt: number
  looks: number[]
  stuckAsked: boolean
  inFlight: boolean
  backoffUntil: number
  snoozedUntil: number
  notes: string
  remarks: string[]
}

let watch: Watch | null = null
const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null

// Background tabs throttle setInterval to once a minute after a while; a
// worker's timer is left alone, so the board is still followed while he
// has a textbook open in another tab.
function workerTimer(ms: number, tick: () => void): { stop: () => void } {
  try {
    const source = `setInterval(() => postMessage(0), ${ms})`
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }))
    const worker = new Worker(url)
    worker.onmessage = tick
    return {
      stop: () => {
        worker.terminate()
        URL.revokeObjectURL(url)
      },
    }
  } catch {
    const id = setInterval(tick, ms)
    return { stop: () => clearInterval(id) }
  }
}

function thumbnail(): Float32Array | null {
  const video = getVideo()
  const context = canvas?.getContext("2d", { willReadFrequently: true })
  if (!video || !canvas || !context || !video.videoWidth) return null
  canvas.width = THUMB_W
  canvas.height = THUMB_H
  context.drawImage(video, 0, 0, THUMB_W, THUMB_H)
  const { data } = context.getImageData(0, 0, THUMB_W, THUMB_H)
  const grey = new Float32Array(THUMB_W * THUMB_H)
  let sum = 0
  for (let i = 0; i < grey.length; i++) {
    const value = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    grey[i] = value
    sum += value
  }
  // Mean removed, so the camera's auto-exposure drifting does not read as
  // the whole board changing.
  const mean = sum / grey.length
  for (let i = 0; i < grey.length; i++) grey[i] -= mean
  return grey
}

function changedShare(a: Float32Array, b: Float32Array): number {
  let changed = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > PIXEL_DELTA) changed++
  return changed / a.length
}

async function look(current: Watch, sample: Float32Array, now: number) {
  const frame = captureFrame()
  if (!frame) return
  current.inFlight = true
  current.lastLookAt = now
  current.looks.push(now)
  current.host.onLook?.(true)
  let outcome: { spoke: boolean; notes: string; model?: string } | undefined
  try {
    const result = await observeBoard(current.host.token, {
      session_id: current.host.sessionId,
      image: frame.base64,
      level: current.level,
      notes: current.notes,
      recent_remarks: current.remarks,
      still_seconds: Math.round((now - current.lastChangeAt) / 1000),
      on_screen: current.host.onScreen?.() ?? "",
      persona: isUltron() ? "ultron" : "jarvis",
    })
    if (watch !== current) return
    current.baseline = sample
    current.notes = result.notes
    outcome = { spoke: false, notes: result.notes, model: result.model }
    if (!result.speak || !result.message) return
    const at = Date.now()
    // Checked again on the way out: he may have started talking, or
    // snoozed, while the look was out.
    if (at < current.snoozedUntil || at - current.lastRemarkAt < COOLDOWN_MS[current.level]) return
    if (!current.host.canSpeak()) return
    current.lastRemarkAt = at
    current.remarks = [...current.remarks, result.message].slice(-5)
    outcome.spoke = true
    current.host.onRemark(result.message)
  } catch (err) {
    if (watch !== current) return
    current.backoffUntil = Date.now() + BACKOFF_MS
    current.host.onError(err instanceof JarvisApiError ? err.message : "The watch look failed.")
  } finally {
    current.inFlight = false
    if (watch === current) current.host.onLook?.(false, outcome)
  }
}

function tick() {
  const current = watch
  if (!current) return
  const sample = thumbnail()
  if (!sample) return
  const now = Date.now()

  if (current.previous && changedShare(sample, current.previous) > MOTION_SHARE) current.lastMotionAt = now
  current.previous = sample

  const settled = now - current.lastMotionAt >= SETTLE_MS
  const changed = !current.baseline || changedShare(sample, current.baseline) > CHANGE_SHARE
  if (changed && settled) {
    current.lastChangeAt = now
    current.stuckAsked = false
  }

  if (current.inFlight || !settled) return
  if (now < current.backoffUntil || now < current.snoozedUntil) return
  if (now - current.lastLookAt < MIN_LOOK_GAP_MS) return
  current.looks = current.looks.filter((t) => now - t < 3600_000)
  if (current.looks.length >= MAX_LOOKS_PER_HOUR) return
  // Not while he is mid-conversation with Jarvis: the frame would be
  // judged without what was just said, and nothing could be voiced anyway.
  if (!current.host.canSpeak()) return

  // Coach only: the same unfinished board for minutes is worth one look
  // for a hint, once per stall.
  const stuck =
    current.level === "coach" && !changed && !current.stuckAsked && now - current.lastChangeAt >= STUCK_MS
  if (stuck) current.stuckAsked = true
  const due = now - current.lastLookAt >= PERIODIC_LOOK_MS
  if (changed || stuck || due) void look(current, sample, now)
}

export function startWatch(host: WatchHost, level: WatchLevel) {
  if (watch) {
    watch.host = host
    watch.level = level
    return
  }
  const now = Date.now()
  watch = {
    host,
    level,
    timer: workerTimer(TICK_MS, tick),
    previous: null,
    baseline: null,
    // Treated as just-moved, so the first look waits for the board to
    // settle rather than firing as the camera warms up.
    lastMotionAt: now,
    lastChangeAt: now,
    lastLookAt: 0,
    lastRemarkAt: 0,
    looks: [],
    stuckAsked: false,
    inFlight: false,
    backoffUntil: 0,
    snoozedUntil: 0,
    notes: "",
    remarks: [],
  }
}

export function stopWatch() {
  watch?.timer.stop()
  watch = null
}

/** "Not now": no looks and no remarks for a while. */
export function snoozeWatch(ms: number) {
  if (watch) watch.snoozedUntil = Date.now() + ms
}

export function isWatchSnoozed(): boolean {
  return Boolean(watch && Date.now() < watch.snoozedUntil)
}
