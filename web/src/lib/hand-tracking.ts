"use client"

import type { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision"

import { getVideo } from "@/lib/camera"
import { fromMediaPipe, pinchRatio, type HandPose, type TrackedHand } from "@/lib/hand-model"
import { sfx } from "@/lib/sfx"
import { useSpatial, type InputMode } from "@/lib/spatial-store"

// Hand tracking runs entirely in the browser (MediaPipe's hand landmarker
// on WebAssembly/WebGL): camera frames for it never leave the machine.
// Only a look (lib/camera.ts captureFrame) sends a frame anywhere.
//
// Each frame: landmarks -> an XR-shaped TrackedHand (lib/hand-model.ts) ->
// smoothing (One Euro, then a deadzone leash) -> a confidence check that
// decides who is driving (hands, or the mouse while they are lost) ->
// gestures. The mouse works throughout; the hands only act while trusted.
//
// Pinned to the installed package version so the WASM runtime and the JS
// that drives it can never drift apart.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

// Pinch distance is measured relative to the hand's own size (wrist to
// middle knuckle), so it works the same close to the camera and far from
// it. Two thresholds, not one: a pinch held right at a single threshold
// would flicker between grabbed and dropped every frame.
const PINCH_ON = 0.3
const PINCH_OFF = 0.45

// Fist and peace sign, by finger curl (0 straight, 1 curled), each with
// its own way in and a looser way out for the same reason.
const FIST_INDEX_ON = 0.75
const FIST_REST_ON = 0.7
const FIST_OFF = 0.5
const PEACE_STRAIGHT = 0.35
const PEACE_CURLED = 0.6
/** A peace sign held this long, and still, is one gesture. */
const PEACE_HOLD_MS = 500

// The camera's edges are hard to reach with a hand that is also in
// frame, so the middle 70% of the image maps onto the whole screen.
const ACTIVE_MARGIN = 0.15

// An air tap is a quick pinch that barely moves; anything longer or
// further is a grab, a drag or a miss.
const TAP_MAX_MS = 450
const TAP_MAX_TRAVEL = 36

// Closing the fingers shifts the tracked point a little; for this long
// after a pinch starts, hand motion does not move what was grabbed.
const PINCH_SETTLE_MS = 120

// --- deadzone (the leash) -------------------------------------------------
// After the One Euro filter the cursor still shimmers a few pixels when the
// hand is held still, which is exactly when a CAD placement needs it to sit
// dead. So a still cursor is on a leash: it only moves when the hand pulls
// further than LEASH_PX from it, and then follows at that distance - no
// jump, and anything smaller is ignored. Once the hand is really moving
// (faster than MOVE_ON) the leash shortens to nothing so there is no lag;
// it comes back once the hand has been slower than MOVE_OFF for STILL_MS.
const LEASH_PX = 8
const MOVE_ON = 160
const MOVE_OFF = 60
const STILL_MS = 140
/** How fast the leash length follows its target, per second. */
const LEASH_RATE = 14

// --- confidence and the fallback ------------------------------------------
// A hand below CONF_LOW stops acting at once (frozen, not dropped). If none
// comes back above it within GRACE_MS, the mouse takes over: whatever the
// hands held is set down where it was. Hands take back over only once one
// has been above CONF_HIGH for RECOVER_MS - a gap between the two
// thresholds, so a hand hovering at the edge of confidence cannot flap
// the mode back and forth.
const CONF_LOW = 0.45
const CONF_HIGH = 0.7
const GRACE_MS = 450
const RECOVER_MS = 350
/** One frame's jump this big (share of the screen) is a tracking glitch. */
const GLITCH_JUMP = 0.25

export interface HandPointer {
  id: string
  /** Viewport pixels, smoothed. */
  x: number
  y: number
  pinching: boolean
  /** 0 when open, 1 at a full pinch - drives the cursor's fill. */
  pinchAmount: number
  /** Raw landmarks in video coordinates, for the preview's skeleton. */
  landmarks: NormalizedLandmark[]
  /** Apparent hand size in the image (wrist to middle knuckle, smoothed).
   *  Grows as the hand nears the webcam, so it stands in for depth. */
  size: number
  /** Smoothed 0-1. Below the threshold the hand is shown but does nothing. */
  confidence: number
  /** It acts right now: confident, and the hands are driving. */
  active: boolean
  pose: HandPose
  /** The XR-shaped hand, for anything that wants joints by name. */
  hand: TrackedHand
}

/** A gesture beyond pinching, for the workshop to map to an action. */
export type HandGesture =
  | { type: "peace"; id: string; x: number; y: number }
  | { type: "fist"; phase: "start" | "move" | "end"; id: string; x: number; y: number }

type Listener = (pointers: HandPointer[]) => void

/** A 3D space (the workshop) that takes pinches the DOM does not claim.
 *  Coordinates are viewport pixels; `id` is stable per hand. */
export interface SpatialHandler {
  down: (id: string, x: number, y: number, size?: number) => boolean
  move: (id: string, x: number, y: number, size?: number) => void
  up: (id: string, x: number, y: number, tap: boolean) => void
  hover: (x: number | null, y: number | null) => void
  /** Fist and peace sign. A fist "start" returning false is not followed up. */
  gesture?: (gesture: HandGesture) => boolean | void
}

let spatialHandler: SpatialHandler | null = null

export function setSpatialHandler(handler: SpatialHandler | null) {
  spatialHandler = handler
}

// --- smoothing -----------------------------------------------------------
// One Euro filter: heavy smoothing when the hand is nearly still (kills
// jitter while aiming), light smoothing when it moves fast (kills lag
// while dragging). Plain averaging can only trade one for the other.
class OneEuro {
  private prev: number | null = null
  private prevDeriv = 0
  private lastTime = 0

  constructor(
    private minCutoff = 1.2,
    private beta = 0.02,
    private dCutoff = 1
  ) {}

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(value: number, time: number): number {
    if (this.prev === null) {
      this.prev = value
      this.lastTime = time
      return value
    }
    const dt = Math.max((time - this.lastTime) / 1000, 1 / 120)
    this.lastTime = time
    const deriv = (value - this.prev) / dt
    const aD = this.alpha(this.dCutoff, dt)
    this.prevDeriv = aD * deriv + (1 - aD) * this.prevDeriv
    const cutoff = this.minCutoff + this.beta * Math.abs(this.prevDeriv)
    const a = this.alpha(cutoff, dt)
    this.prev = a * value + (1 - a) * this.prev
    return this.prev
  }
}

/** The spatial and temporal deadzone described at LEASH_PX. */
class Leash {
  private x: number | null = null
  private y = 0
  private lastX = 0
  private lastY = 0
  private lastTime = 0
  private length = LEASH_PX
  private moving = false
  private slowSince = 0

  filter(px: number, py: number, time: number): { x: number; y: number; speed: number } {
    if (this.x === null) {
      this.x = this.lastX = px
      this.y = this.lastY = py
      this.lastTime = time
      return { x: px, y: py, speed: 0 }
    }
    const dt = Math.max((time - this.lastTime) / 1000, 1 / 120)
    const speed = Math.hypot(px - this.lastX, py - this.lastY) / dt
    this.lastX = px
    this.lastY = py
    this.lastTime = time

    if (speed > MOVE_ON) {
      this.moving = true
      this.slowSince = 0
    } else if (this.moving && speed < MOVE_OFF) {
      this.slowSince ||= time
      if (time - this.slowSince > STILL_MS) this.moving = false
    } else {
      this.slowSince = 0
    }
    const target = this.moving ? 0 : LEASH_PX
    this.length += (target - this.length) * Math.min(1, dt * LEASH_RATE)

    const dx = px - this.x
    const dy = py - this.y
    const gap = Math.hypot(dx, dy)
    if (gap > this.length) {
      const pull = (gap - this.length) / gap
      this.x += dx * pull
      this.y += dy * pull
    }
    return { x: this.x, y: this.y, speed }
  }
}

// --- per-hand gesture state ----------------------------------------------
interface HandState {
  fx: OneEuro
  fy: OneEuro
  fs: OneEuro
  leash: Leash
  size: number
  confidence: number
  pinching: boolean
  fist: boolean
  /** The workshop took this fist (a rotate or orbit is under way). */
  fistClaimed: boolean
  peaceSince: number
  /** Fired for this peace sign; re-armed when the pose changes. */
  peaceFired: boolean
  /** Hologram this hand is holding, if any. */
  holding: string | null
  /** This pinch belongs to the spatial handler (the workshop). */
  spatial: boolean
  id: string
  lastX: number
  lastY: number
  /** Unsmoothed aim point last frame, to spot tracking glitches. */
  rawX: number
  rawY: number
  /** Where and when the current pinch started, for air-tap detection. */
  downX: number
  downY: number
  downAt: number
  /** The held cursor: where a grabbed thing is being steered. It moves by
   *  the hand's motion scaled to its size at the grab, so the same
   *  physical movement travels the same distance near the camera or far. */
  heldX: number
  heldY: number
  downSize: number
  downTarget: HTMLElement | null
  seenAt: number
  /** Last time this hand was confident enough to act. */
  trustedAt: number
}

// Two hands on one hologram: scale follows the distance between them.
interface TwoHandScale {
  id: string
  startDistance: number
  startScale: number
}

let landmarker: HandLandmarker | null = null
let running = false
let raf = 0
let lastVideoTime = -1
const hands = new Map<string, HandState>()
let twoHand: TwoHandScale | null = null
let pointers: HandPointer[] = []
const listeners = new Set<Listener>()

let mode: InputMode = "pointer"
let degradedSince = 0
let recoverSince = 0
let hoverSent = false

export function subscribeHands(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function toViewport(landmark: { x: number; y: number }) {
  const span = 1 - ACTIVE_MARGIN * 2
  const nx = Math.min(1, Math.max(0, (landmark.x - ACTIVE_MARGIN) / span))
  const ny = Math.min(1, Math.max(0, (landmark.y - ACTIVE_MARGIN) / span))
  // x is flipped because the camera sees Andrew's right hand on the
  // image's left; unflipped, the cursor would move opposite the hand.
  return { x: (1 - nx) * window.innerWidth, y: ny * window.innerHeight }
}

// What is under a hand cursor. The cursor canvas and other overlays are
// pointer-events: none, so this finds the real control or hologram.
function hitTest(x: number, y: number) {
  const element = document.elementFromPoint(x, y) as HTMLElement | null
  const control = element?.closest<HTMLElement>("button, a[href], [role='button'], input, [data-holo-tap]")
  const holo = element?.closest<HTMLElement>("[data-holo-id]")
  return { control: control ?? null, holoId: holo?.dataset.holoId ?? null }
}

function pinchStart(hand: HandState, x: number, y: number, now: number) {
  hand.downX = x
  hand.downY = y
  hand.downAt = now
  hand.heldX = x
  hand.heldY = y
  hand.downSize = hand.size
  const { control, holoId } = hitTest(x, y)
  // A control inside a hologram (its close button) is a tap target, not
  // a handle, so it wins over grabbing the hologram around it.
  hand.downTarget = control
  if (!control && !holoId && spatialHandler?.down(hand.id, x, y, hand.size)) {
    hand.spatial = true
    return
  }
  if (holoId && !control) {
    hand.holding = holoId
    const spatial = useSpatial.getState()
    spatial.grab(holoId)
    sfx.click()

    // Is the other hand already holding the same one? Then this is a
    // two-handed resize.
    for (const [, other] of hands) {
      if (other !== hand && other.holding === holoId) {
        const hologram = spatial.holograms.find((h) => h.id === holoId)
        twoHand = {
          id: holoId,
          startDistance: Math.max(1, Math.hypot(x - other.lastX, y - other.lastY)),
          startScale: hologram?.scale ?? 1,
        }
      }
    }
  }
}

/** `dropped`: the hand was lost, so this is a set-down, never a tap. */
function pinchEnd(hand: HandState, x: number, y: number, now: number, dropped = false) {
  hand.pinching = false
  const spatial = useSpatial.getState()
  if (hand.spatial) {
    hand.spatial = false
    const travel = Math.hypot(x - hand.downX, y - hand.downY)
    spatialHandler?.up(hand.id, x, y, !dropped && now - hand.downAt < TAP_MAX_MS && travel < TAP_MAX_TRAVEL)
    return
  }
  if (hand.holding) {
    const stillHeld = [...hands.values()].some((h) => h !== hand && h.holding === hand.holding)
    if (!stillHeld) spatial.release(hand.holding)
    if (twoHand?.id === hand.holding) twoHand = null
    hand.holding = null
    return
  }
  const travel = Math.hypot(x - hand.downX, y - hand.downY)
  if (!dropped && hand.downTarget && now - hand.downAt < TAP_MAX_MS && travel < TAP_MAX_TRAVEL) {
    // click() alone does not focus a text field, so the command bar
    // would ignore a tap without this.
    if (hand.downTarget instanceof HTMLInputElement) hand.downTarget.focus()
    hand.downTarget.click()
    sfx.click()
  }
  hand.downTarget = null
}

function fistEnd(hand: HandState, dropped = false) {
  if (hand.fistClaimed) spatialHandler?.gesture?.({ type: "fist", phase: "end", id: hand.id, x: hand.lastX, y: hand.lastY })
  hand.fistClaimed = false
  if (dropped) hand.fist = false
}

/** Let go of everything a hand is doing, where it is: it was lost. */
function drop(hand: HandState, now: number) {
  if (hand.pinching) pinchEnd(hand, hand.lastX, hand.lastY, now, true)
  fistEnd(hand, true)
}

function newHand(id: string, now: number): HandState {
  return {
    fx: new OneEuro(),
    fy: new OneEuro(),
    // Size jitters more than position and matters less instantly, so
    // it is smoothed harder.
    fs: new OneEuro(0.6, 0.5),
    leash: new Leash(),
    size: 0,
    confidence: 0,
    pinching: false,
    fist: false,
    fistClaimed: false,
    peaceSince: 0,
    peaceFired: false,
    holding: null,
    spatial: false,
    id,
    lastX: 0,
    lastY: 0,
    rawX: Number.NaN,
    rawY: 0,
    downX: 0,
    downY: 0,
    downAt: 0,
    heldX: 0,
    heldY: 0,
    downSize: 0,
    downTarget: null,
    seenAt: now,
    trustedAt: 0,
  }
}

/** The fallback state machine (see CONF_LOW). Returns the mode now. */
function updateMode(best: number, now: number): InputMode {
  const before = mode
  if (mode === "hands") {
    if (best < CONF_LOW) {
      mode = "degraded"
      degradedSince = now
    }
  } else if (mode === "degraded") {
    if (best >= CONF_LOW) mode = "hands"
    else if (now - degradedSince > GRACE_MS) mode = "pointer"
  } else if (best >= CONF_HIGH) {
    recoverSince ||= now
    if (now - recoverSince > RECOVER_MS) mode = "hands"
  } else {
    recoverSince = 0
  }
  if (mode !== "pointer") recoverSince = 0
  if (before !== "pointer" && mode === "pointer") {
    // The mouse has it now: set down whatever the hands held, and stop
    // steering hover so the mouse's own hover shows.
    for (const hand of hands.values()) drop(hand, now)
    twoHand = null
  }
  return mode
}

function process(result: { landmarks: NormalizedLandmark[][]; handedness: { categoryName: string; score: number }[][] }) {
  const now = performance.now()
  const spatial = useSpatial.getState()
  const next: HandPointer[] = []
  const seen = new Set<string>()

  // Pass 1: smoothing and confidence for every hand in the frame.
  const frame = result.landmarks.map((landmarks, index) => {
    // Handedness is a stable enough key for two hands. Two hands labelled
    // the same (it happens) fall back to their index.
    const label = result.handedness[index]?.[0]?.categoryName ?? "Hand"
    const id = seen.has(label) ? `${label}-${index}` : label
    seen.add(id)

    const hand = hands.get(id) ?? newHand(id, now)
    hands.set(id, hand)
    hand.seenAt = now

    const tracked = fromMediaPipe(landmarks, result.handedness[index]?.[0])
    const thumb = tracked.joints["thumb-tip"]
    const indexTip = tracked.joints["index-finger-tip"]
    const handSize = Math.max(1e-4, Math.hypot(
      tracked.joints.wrist.x - tracked.joints["middle-finger-phalanx-proximal"].x,
      tracked.joints.wrist.y - tracked.joints["middle-finger-phalanx-proximal"].y
    ))
    hand.size = hand.fs.filter(handSize, now)

    // Aim from the point between thumb and index tips: it barely moves
    // as the fingers close, so pinching does not knock the cursor off
    // the thing being pinched.
    const raw = toViewport({ x: (thumb.x + indexTip.x) / 2, y: (thumb.y + indexTip.y) / 2 })
    let confidence = tracked.confidence
    if (!Number.isNaN(hand.rawX) && Math.hypot(raw.x - hand.rawX, raw.y - hand.rawY) > GLITCH_JUMP * window.innerWidth) {
      confidence *= 0.3
    }
    hand.rawX = raw.x
    hand.rawY = raw.y
    // Smoothed so a single bad frame dips it without crossing a threshold.
    hand.confidence = hand.confidence ? hand.confidence * 0.6 + confidence * 0.4 : confidence

    const smooth = hand.leash.filter(hand.fx.filter(raw.x, now), hand.fy.filter(raw.y, now), now)
    return { hand, tracked, landmarks, x: smooth.x, y: smooth.y, speed: smooth.speed }
  })

  const best = frame.reduce((max, f) => Math.max(max, f.hand.confidence), 0)
  updateMode(best, now)

  // Pass 2: gestures, for hands that are trusted while the hands drive.
  for (const { hand, tracked, landmarks, x, y, speed } of frame) {
    const id = hand.id
    const active = mode === "hands" && hand.confidence >= CONF_LOW
    if (active) hand.trustedAt = now
    const ratio = pinchRatio(tracked)
    const [indexCurl, middleCurl, ringCurl, pinkyCurl] = tracked.curl
    const restCurl = (middleCurl + ringCurl + pinkyCurl) / 3

    if (active) {
      // Fist first: a closed hand brings the thumb near the index, which
      // must not read as a pinch.
      const wasFist = hand.fist
      hand.fist = wasFist
        ? tracked.grabStrength > FIST_OFF
        : !hand.pinching && indexCurl > FIST_INDEX_ON && restCurl > FIST_REST_ON

      const wasPinching = hand.pinching
      hand.pinching = !hand.fist && (wasPinching ? ratio < PINCH_OFF : ratio < PINCH_ON)

      // Steer the held cursor: size-normalised, and still while the pinch
      // settles.
      if (hand.pinching && wasPinching && now - hand.downAt > PINCH_SETTLE_MS) {
        const scale = hand.downSize > 0 && hand.size > 0 ? hand.downSize / hand.size : 1
        hand.heldX += (x - hand.lastX) * scale
        hand.heldY += (y - hand.lastY) * scale
      }

      if (hand.pinching && !wasPinching) pinchStart(hand, x, y, now)
      else if (!hand.pinching && wasPinching) pinchEnd(hand, x, y, now)
      else if (hand.pinching && hand.spatial) spatialHandler?.move(id, hand.heldX, hand.heldY, hand.size)
      else if (hand.pinching && hand.holding) {
        if (twoHand?.id === hand.holding) {
          const other = [...hands.values()].find((h) => h !== hand && h.holding === hand.holding)
          if (other) {
            const spread = Math.hypot(x - other.lastX, y - other.lastY)
            spatial.scaleHologram(hand.holding, twoHand.startScale * (spread / twoHand.startDistance))
          }
        } else if (now - hand.downAt > PINCH_SETTLE_MS) {
          const scale = hand.downSize > 0 && hand.size > 0 ? hand.downSize / hand.size : 1
          spatial.moveHologram(hand.holding, (x - hand.lastX) * scale, (y - hand.lastY) * scale)
        }
      }

      // Fist drag: rotate or orbit, as the workshop maps it.
      if (hand.fist && !wasFist) {
        hand.fistClaimed = spatialHandler?.gesture?.({ type: "fist", phase: "start", id, x, y }) === true
      } else if (hand.fist && hand.fistClaimed) {
        spatialHandler?.gesture?.({ type: "fist", phase: "move", id, x, y })
      } else if (!hand.fist && wasFist) {
        fistEnd(hand)
      }

      // Peace sign held still: one discrete gesture.
      const peace =
        !hand.pinching &&
        !hand.fist &&
        indexCurl < PEACE_STRAIGHT &&
        middleCurl < PEACE_STRAIGHT &&
        ringCurl > PEACE_CURLED &&
        pinkyCurl > PEACE_CURLED &&
        ratio > PINCH_OFF
      if (!peace) {
        hand.peaceSince = 0
        hand.peaceFired = false
      } else if (speed > MOVE_ON) {
        hand.peaceSince = now
      } else {
        hand.peaceSince ||= now
        if (!hand.peaceFired && now - hand.peaceSince > PEACE_HOLD_MS) {
          hand.peaceFired = true
          spatialHandler?.gesture?.({ type: "peace", id, x, y })
        }
      }
    } else if (now - hand.trustedAt > GRACE_MS && (hand.pinching || hand.fist)) {
      // Untrusted for too long: let go. Until then a grip stays frozen
      // where it was, so a flicker of bad tracking costs nothing.
      drop(hand, now)
    }

    hand.lastX = x
    hand.lastY = y
    next.push({
      id,
      x,
      y,
      pinching: hand.pinching,
      pinchAmount: Math.min(1, Math.max(0, (PINCH_OFF + 0.25 - ratio) / (PINCH_OFF + 0.25 - PINCH_ON))),
      landmarks,
      size: hand.size,
      confidence: hand.confidence,
      active,
      pose: hand.fist ? "fist" : hand.pinching ? "pinch" : hand.peaceSince ? "peace" : tracked.grabStrength < 0.25 ? "open" : "none",
      hand: tracked,
    })
  }

  // A hand that left the frame lets go once the grace period is up.
  for (const [id, hand] of hands) {
    if (now - hand.seenAt > GRACE_MS) {
      drop(hand, now)
      hands.delete(id)
    }
  }

  // Hover belongs to the hands only while they drive; otherwise it is the
  // mouse's, and a stream of hover(null) here would wipe it every frame.
  const hover = mode === "hands" ? next.find((p) => p.active && !p.pinching) : undefined
  if (hover) {
    spatial.setHovered(hitTest(hover.x, hover.y).holoId)
    spatialHandler?.hover(hover.x, hover.y)
    hoverSent = true
  } else if (hoverSent) {
    spatial.setHovered(null)
    spatialHandler?.hover(null, null)
    hoverSent = false
  }

  spatial.setTracking(mode, Math.round(best * 20) / 20)
  pointers = next
  listeners.forEach((listener) => listener(pointers))
}

function loop() {
  if (!running) return
  const video = getVideo()
  // Only run the model on a new camera frame. The display refreshes at 60
  // to 144Hz and the camera at ~30, so this halves the work or better.
  if (landmarker && video && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime
    process(landmarker.detectForVideo(video, performance.now()))
  }
  raf = requestAnimationFrame(loop)
}

export async function startHands(): Promise<void> {
  if (running) return
  const spatial = useSpatial.getState()
  spatial.setHandsStatus("loading")
  try {
    if (!landmarker) {
      // Loaded on first use, not with the page: the model and runtime are
      // a few megabytes most sessions never need.
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision")
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE)
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
      })
    }
    running = true
    // The mouse drives until a hand shows up steady (see updateMode).
    mode = "pointer"
    spatial.setHandsStatus("tracking")
    raf = requestAnimationFrame(loop)
  } catch (error) {
    spatial.setHandsStatus("error")
    throw error
  }
}

export function stopHands() {
  running = false
  cancelAnimationFrame(raf)
  const now = performance.now()
  for (const hand of hands.values()) drop(hand, now)
  hands.clear()
  twoHand = null
  pointers = []
  mode = "pointer"
  hoverSent = false
  listeners.forEach((listener) => listener(pointers))
  useSpatial.getState().setHovered(null)
  useSpatial.getState().setTracking("pointer", 0)
  useSpatial.getState().setHandsStatus("off")
}
