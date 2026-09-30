"use client"

import type { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision"

import { getVideo } from "@/lib/camera"
import { sfx } from "@/lib/sfx"
import { useSpatial } from "@/lib/spatial-store"

// Hand tracking runs entirely in the browser (MediaPipe's hand landmarker
// on WebAssembly/WebGL): camera frames for it never leave the machine.
// Only a look (lib/camera.ts captureFrame) sends a frame anywhere.
//
// Pinned to the installed package version so the WASM runtime and the JS
// that drives it can never drift apart.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

// Landmark indices, from MediaPipe's hand model.
const WRIST = 0
const THUMB_TIP = 4
const INDEX_TIP = 8
const MIDDLE_MCP = 9

// Pinch distance is measured relative to the hand's own size (wrist to
// middle knuckle), so it works the same close to the camera and far from
// it. Two thresholds, not one: a pinch held right at a single threshold
// would flicker between grabbed and dropped every frame.
const PINCH_ON = 0.3
const PINCH_OFF = 0.45

// The camera's edges are hard to reach with a hand that is also in
// frame, so the middle 70% of the image maps onto the whole screen.
const ACTIVE_MARGIN = 0.15

// An air tap is a quick pinch that barely moves; anything longer or
// further is a grab, a drag or a miss.
const TAP_MAX_MS = 450
const TAP_MAX_TRAVEL = 36

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
}

type Listener = (pointers: HandPointer[]) => void

/** A 3D space (the workshop) that takes pinches the DOM does not claim.
 *  Coordinates are viewport pixels; `id` is stable per hand. */
export interface SpatialHandler {
  down: (id: string, x: number, y: number, size?: number) => boolean
  move: (id: string, x: number, y: number, size?: number) => void
  up: (id: string, x: number, y: number, tap: boolean) => void
  hover: (x: number | null, y: number | null) => void
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

// --- per-hand gesture state ----------------------------------------------
interface HandState {
  fx: OneEuro
  fy: OneEuro
  fs: OneEuro
  size: number
  pinching: boolean
  /** Hologram this hand is holding, if any. */
  holding: string | null
  /** This pinch belongs to the spatial handler (the workshop). */
  spatial: boolean
  id: string
  lastX: number
  lastY: number
  /** Where and when the current pinch started, for air-tap detection. */
  downX: number
  downY: number
  downAt: number
  downTarget: HTMLElement | null
  seenAt: number
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

export function subscribeHands(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function toViewport(landmark: NormalizedLandmark) {
  const span = 1 - ACTIVE_MARGIN * 2
  const nx = Math.min(1, Math.max(0, (landmark.x - ACTIVE_MARGIN) / span))
  const ny = Math.min(1, Math.max(0, (landmark.y - ACTIVE_MARGIN) / span))
  // x is flipped because the camera sees Andrew's right hand on the
  // image's left; unflipped, the cursor would move opposite the hand.
  return { x: (1 - nx) * window.innerWidth, y: ny * window.innerHeight }
}

function distance(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y)
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

function pinchEnd(hand: HandState, x: number, y: number, now: number) {
  const spatial = useSpatial.getState()
  if (hand.spatial) {
    hand.spatial = false
    const travel = Math.hypot(x - hand.downX, y - hand.downY)
    spatialHandler?.up(hand.id, x, y, now - hand.downAt < TAP_MAX_MS && travel < TAP_MAX_TRAVEL)
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
  if (hand.downTarget && now - hand.downAt < TAP_MAX_MS && travel < TAP_MAX_TRAVEL) {
    // click() alone does not focus a text field, so the command bar
    // would ignore a tap without this.
    if (hand.downTarget instanceof HTMLInputElement) hand.downTarget.focus()
    hand.downTarget.click()
    sfx.click()
  }
  hand.downTarget = null
}

function process(result: { landmarks: NormalizedLandmark[][]; handedness: { categoryName: string }[][] }) {
  const now = performance.now()
  const spatial = useSpatial.getState()
  const next: HandPointer[] = []

  result.landmarks.forEach((landmarks, index) => {
    // Handedness is a stable enough key for two hands. Two hands labelled
    // the same (it happens) fall back to their index.
    const label = result.handedness[index]?.[0]?.categoryName ?? "Hand"
    const id = next.some((p) => p.id === label) ? `${label}-${index}` : label

    let hand = hands.get(id)
    if (!hand) {
      hand = {
        fx: new OneEuro(),
        fy: new OneEuro(),
        // Size jitters more than position and matters less instantly, so
        // it is smoothed harder.
        fs: new OneEuro(0.6, 0.5),
        size: 0,
        pinching: false,
        holding: null,
        spatial: false,
        id,
        lastX: 0,
        lastY: 0,
        downX: 0,
        downY: 0,
        downAt: 0,
        downTarget: null,
        seenAt: now,
      }
      hands.set(id, hand)
    }
    hand.seenAt = now

    const thumb = landmarks[THUMB_TIP]
    const indexTip = landmarks[INDEX_TIP]
    const handSize = Math.max(1e-4, distance(landmarks[WRIST], landmarks[MIDDLE_MCP]))
    hand.size = hand.fs.filter(handSize, now)
    const pinchRatio = distance(thumb, indexTip) / handSize

    // Aim from the point between thumb and index tips: it barely moves
    // as the fingers close, so pinching does not knock the cursor off
    // the thing being pinched.
    const raw = toViewport({ x: (thumb.x + indexTip.x) / 2, y: (thumb.y + indexTip.y) / 2, z: 0, visibility: 0 })
    const x = hand.fx.filter(raw.x, now)
    const y = hand.fy.filter(raw.y, now)

    const wasPinching = hand.pinching
    hand.pinching = wasPinching ? pinchRatio < PINCH_OFF : pinchRatio < PINCH_ON

    if (hand.pinching && !wasPinching) pinchStart(hand, x, y, now)
    else if (!hand.pinching && wasPinching) pinchEnd(hand, x, y, now)
    else if (hand.pinching && hand.spatial) spatialHandler?.move(id, x, y, hand.size)
    else if (hand.pinching && hand.holding) {
      if (twoHand?.id === hand.holding) {
        const other = [...hands.values()].find((h) => h !== hand && h.holding === hand.holding)
        if (other) {
          const spread = Math.hypot(x - other.lastX, y - other.lastY)
          spatial.scaleHologram(hand.holding, twoHand.startScale * (spread / twoHand.startDistance))
        }
      } else {
        spatial.moveHologram(hand.holding, x - hand.lastX, y - hand.lastY)
      }
    }

    hand.lastX = x
    hand.lastY = y
    next.push({
      id,
      x,
      y,
      pinching: hand.pinching,
      pinchAmount: Math.min(1, Math.max(0, (PINCH_OFF + 0.25 - pinchRatio) / (PINCH_OFF + 0.25 - PINCH_ON))),
      landmarks,
      size: hand.size,
    })
  })

  // A hand that left the frame lets go of whatever it held.
  for (const [id, hand] of hands) {
    if (now - hand.seenAt > 300) {
      if (hand.pinching) pinchEnd(hand, hand.lastX, hand.lastY, now)
      hands.delete(id)
    }
  }

  const hover = next.find((p) => !p.pinching)
  spatial.setHovered(hover ? hitTest(hover.x, hover.y).holoId : null)
  spatialHandler?.hover(hover?.x ?? null, hover?.y ?? null)

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
  for (const hand of hands.values()) if (hand.pinching) pinchEnd(hand, hand.lastX, hand.lastY, now)
  hands.clear()
  twoHand = null
  pointers = []
  listeners.forEach((listener) => listener(pointers))
  useSpatial.getState().setHovered(null)
  useSpatial.getState().setHandsStatus("off")
}
