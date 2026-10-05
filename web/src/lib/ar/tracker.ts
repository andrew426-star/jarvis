"use client"

import type { FaceLandmarker, HandLandmarker, NormalizedLandmark, PoseLandmarker } from "@mediapipe/tasks-vision"
import * as THREE from "three"

import { BODY_ANCHORS, type Anchor, type Cue } from "@/lib/workshop/project/types"

// Where on Andrew a project is worn, frame by frame, from the webcam: a
// pose in the camera's own metric space (centimetres, camera at the
// origin looking down -z, y up - three.js's convention), for the try-on to
// put the model at. Three MediaPipe models are the sensors, each loaded
// the first time something needs it and run only while it is needed:
//
//  - face: the head's rotation from MediaPipe's facial transformation
//    matrix; its distance from the gap between the irises (about 63 mm);
//    the jaw's opening from its blendshapes.
//  - hand: a full pose fit of the hand's 21 points in metres (MediaPipe's
//    world landmarks) to the same 21 in the picture, which gives its
//    distance and tilt together; which fingers are out.
//  - pose: the same fit for the body's 33 points (those in view), for the
//    chest, a shoulder or an upper arm - and the elbow, so a forearm runs
//    along the real forearm rather than the line of the hand.
//
// All assume the camera sees about 63 degrees top to bottom, MediaPipe's
// own assumption for the face; the render uses the same, so the model
// lands on the right pixels even where the true figure differs. Each also
// reports a point whose true distance it knows, which scales the depth
// model's map (depth.ts).

export const VERTICAL_FOV = 63
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
const IPD_CM = 6.3
const OUTER_EYES_CM = 9.0
/** Below this, a body landmark is guessed rather than seen. */
const SEEN = 0.5

export type Sensor = "face" | "hand" | "pose"

export interface AnchorPose {
  /** The anchor's origin, cm, camera space. */
  position: THREE.Vector3
  /** Rotation from the design frame (mm, z up; see WEAR_GUIDE) to camera space. */
  quaternion: THREE.Quaternion
}

/** A tracked pose, and a point of it whose true distance is known. */
export interface Tracked {
  pose: AnchorPose
  reference: { u: number; v: number; cm: number }
}

/** The sensors an anchor needs to be found at all, and those that only
 *  improve it (loaded alongside, never waited for). */
export function sensorsFor(anchor: Anchor): { need: Sensor[]; extra: Sensor[] } {
  if (anchor === "face") return { need: ["face"], extra: [] }
  if (anchor === "desk") return { need: [], extra: [] }
  if (BODY_ANCHORS.includes(anchor)) return { need: ["pose"], extra: [] }
  return { need: ["hand"], extra: anchor === "hand" ? [] : ["pose"] }
}

/** The sensor a gesture cue is read from. */
export function sensorForCue(cue: Cue): Sensor | null {
  if (cue === "palm" || cue === "fist" || cue === "point" || cue === "thwip") return "hand"
  if (cue === "jaw") return "face"
  if (cue === "raise") return "pose"
  return null
}

let face: FaceLandmarker | null = null
let hands: HandLandmarker | null = null
let pose: PoseLandmarker | null = null
const loading = new Map<Sensor, Promise<void>>()
let lastStamp = 0

async function fileset() {
  const vision = await import("@mediapipe/tasks-vision")
  return { vision, files: await vision.FilesetResolver.forVisionTasks(WASM_BASE) }
}

async function create(sensor: Sensor) {
  const { vision, files } = await fileset()
  const base = (path: string, delegate: "GPU" | "CPU") => ({ modelAssetPath: path, delegate })
  if (sensor === "face") {
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: base(FACE_MODEL, delegate),
      runningMode: "VIDEO" as const,
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: true,
    })
    face = await vision.FaceLandmarker.createFromOptions(files, options("GPU")).catch(() =>
      vision.FaceLandmarker.createFromOptions(files, options("CPU"))
    )
  } else if (sensor === "hand") {
    hands = await vision.HandLandmarker.createFromOptions(files, {
      baseOptions: base(HAND_MODEL, "GPU"),
      runningMode: "VIDEO",
      numHands: 2,
    })
  } else {
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: base(POSE_MODEL, delegate),
      runningMode: "VIDEO" as const,
      numPoses: 1,
    })
    pose = await vision.PoseLandmarker.createFromOptions(files, options("GPU")).catch(() =>
      vision.PoseLandmarker.createFromOptions(files, options("CPU"))
    )
  }
}

/** Load a sensor's model (once), the first time it is used. */
export function loadSensor(sensor: Sensor): Promise<void> {
  let job = loading.get(sensor)
  if (!job) {
    job = create(sensor).catch((err) => {
      loading.delete(sensor)
      throw err
    })
    loading.set(sensor, job)
  }
  return job
}

export function sensorReady(sensor: Sensor) {
  return sensor === "face" ? !!face : sensor === "hand" ? !!hands : !!pose
}

function stamp() {
  lastStamp = Math.max(performance.now(), lastStamp + 1)
  return lastStamp
}

export function focalPx(height: number) {
  return height / 2 / Math.tan(THREE.MathUtils.degToRad(VERTICAL_FOV) / 2)
}

/** A point in the picture (0-1) at a depth, in camera space (same units). */
export function unproject(u: number, v: number, depth: number, width: number, height: number) {
  const f = focalPx(height)
  return new THREE.Vector3(((u * width - width / 2) / f) * depth, (-(v * height - height / 2) / f) * depth, -depth)
}

/** The design frame's z-up / front-is-minus-y, turned into a body's
 *  y-up / front-is-plus-z frame. */
const DESIGN_TO_BODY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)

// --- face --------------------------------------------------------------------------

interface FaceSense {
  tracked: Tracked
  jawOpen: number
}

function senseFace(video: HTMLVideoElement): FaceSense | null {
  if (!face) return null
  const result = face.detectForVideo(video, stamp())
  const points = result.faceLandmarks?.[0]
  const matrix = result.facialTransformationMatrixes?.[0]?.data
  if (!points || !matrix) return null
  // The matrix comes column-major or row-major depending on the build:
  // the head is in front of the camera, so the z translation is the
  // clearly negative one.
  const m = Array.from(matrix)
  const columnMajor = m[14] < -5 && m[14] > -400
  const head = new THREE.Matrix4().fromArray(m)
  if (!columnMajor) head.transpose()
  const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(head))

  const W = video.videoWidth
  const H = video.videoHeight
  const iris = points.length > 473
  const a: NormalizedLandmark = iris ? points[468] : points[33]
  const b: NormalizedLandmark = iris ? points[473] : points[263]
  const pixels = Math.hypot((a.x - b.x) * W, (a.y - b.y) * H)
  const across = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation)
  const facing = Math.max(0.3, Math.hypot(across.x, across.y))
  const depth = (focalPx(H) * (iris ? IPD_CM : OUTER_EYES_CM) * facing) / Math.max(pixels, 1)
  const u = (a.x + b.x) / 2
  const v = (a.y + b.y) / 2
  const jaw = result.faceBlendshapes?.[0]?.categories.find((c) => c.categoryName === "jawOpen")?.score ?? 0
  return {
    tracked: {
      pose: { position: unproject(u, v, depth, W, H), quaternion: rotation.multiply(DESIGN_TO_BODY) },
      reference: { u, v, cm: depth },
    },
    jawOpen: jaw,
  }
}

// --- a rigid fit of 3D landmarks to the picture --------------------------------------
//
// MediaPipe gives hands and bodies twice: points in the picture, and the
// same points in metres in 3D (the shape itself, centred on it). The pose
// is the rotation and position that lay the 3D shape exactly over the
// picture's points (a perspective-n-point fit, by Levenberg-Marquardt):
// true distance and tilt from the whole shape, not a guess from one
// length. The fit runs with the 3D points' depth axis both ways and keeps
// the better one, which settles the one convention the docs leave open.

type Vec6 = [number, number, number, number, number, number]

function rotationOf(p: Vec6) {
  const w = new THREE.Vector3(p[0], p[1], p[2])
  const angle = w.length()
  return angle < 1e-9 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(w.divideScalar(angle), angle)
}

function residuals(p: Vec6, model: THREE.Vector3[], image: number[][], f: number, cx: number, cy: number): number[] {
  const q = rotationOf(p)
  const out: number[] = []
  for (let i = 0; i < model.length; i += 1) {
    const c = model[i].clone().applyQuaternion(q)
    const z = Math.max(1e-3, -(c.z + p[5]))
    out.push(cx + (f * (c.x + p[3])) / z - image[i][0], cy - (f * (c.y + p[4])) / z - image[i][1])
  }
  return out
}

/** Solve a 6x6 linear system by elimination; null if singular. */
function solve6(a: number[][], b: number[]): number[] | null {
  const n = 6
  const m = a.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c += 1) {
    let pivot = c
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r
    ;[m[c], m[pivot]] = [m[pivot], m[c]]
    if (Math.abs(m[c][c]) < 1e-12) return null
    for (let r = c + 1; r < n; r += 1) {
      const k = m[r][c] / m[c][c]
      for (let j = c; j <= n; j += 1) m[r][j] -= k * m[c][j]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = m[r][n]
    for (let j = r + 1; j < n; j += 1) sum -= m[r][j] * x[j]
    x[r] = sum / m[r][r]
  }
  return x
}

export function fitPose(model: THREE.Vector3[], image: number[][], f: number, cx: number, cy: number, start: Vec6) {
  let p = [...start] as Vec6
  const cost = (r: number[]) => r.reduce((s, v) => s + v * v, 0)
  let r = residuals(p, model, image, f, cx, cy)
  let err = cost(r)
  let damping = 1e-2
  for (let iter = 0; iter < 15; iter += 1) {
    // Jacobian by finite differences: 6 parameters, two residuals a point.
    const J: number[][] = []
    for (let k = 0; k < 6; k += 1) {
      const step = k < 3 ? 1e-4 : 1e-5
      const q = [...p] as Vec6
      q[k] += step
      J.push(residuals(q, model, image, f, cx, cy).map((v, i) => (v - r[i]) / step))
    }
    const A = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => J[i].reduce((s, v, n) => s + v * J[j][n], 0)))
    const g = Array.from({ length: 6 }, (_, i) => -J[i].reduce((s, v, n) => s + v * r[n], 0))
    for (let i = 0; i < 6; i += 1) A[i][i] *= 1 + damping
    const delta = solve6(A, g)
    if (!delta) break
    const next = p.map((v, i) => v + delta[i]) as Vec6
    const nr = residuals(next, model, image, f, cx, cy)
    const ne = cost(nr)
    if (ne < err) {
      const gain = err - ne
      p = next
      r = nr
      err = ne
      damping = Math.max(1e-6, damping / 3)
      if (gain < 1e-3) break
    } else {
      damping *= 4
    }
  }
  return { p, rms: Math.sqrt(err / model.length) }
}

interface FitState {
  sign: number
  last: Vec6 | null
}

const fitState: Record<"hand" | "pose", FitState> = { hand: { sign: -1, last: null }, pose: { sign: -1, last: null } }

/**
 * Fit a shape's world landmarks (metres) to its picture landmarks, using
 * the points `use`; `span` is a pair of points whose picture distance
 * gives the first frame's distance guess. Every point comes back in
 * camera space, in centimetres - null when the fit is not believable.
 */
function fitShape(
  world: { x: number; y: number; z: number }[],
  image: NormalizedLandmark[],
  use: number[],
  span: [number, number],
  W: number,
  H: number,
  state: FitState,
  maxDepthM: number
): THREE.Vector3[] | null {
  const f = focalPx(H)
  const spanPx = Math.hypot((image[span[0]].x - image[span[1]].x) * W, (image[span[0]].y - image[span[1]].y) * H)
  const a = world[span[0]]
  const b = world[span[1]]
  const spanM = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  const guessM = Math.min(maxDepthM, Math.max(0.15, (f * spanM) / Math.max(spanPx, 1)))
  const mean = use.reduce((s, i) => [s[0] + image[i].x / use.length, s[1] + image[i].y / use.length], [0, 0])
  const centre = unproject(mean[0], mean[1], guessM, W, H)
  const start: Vec6 = state.last ?? [0, 0, 0, centre.x, centre.y, centre.z]
  const pixels = use.map((i) => [image[i].x * W, image[i].y * H])

  // World landmarks: x right, y down; z is the open question, so fit both.
  const modelFor = (sign: number, idx: number[]) => idx.map((i) => new THREE.Vector3(world[i].x, -world[i].y, sign * world[i].z))
  const fits = [-1, 1].map((sign) => ({ sign, ...fitPose(modelFor(sign, use), pixels, f, W / 2, H / 2, start) }))
  const current = fits.find((x) => x.sign === state.sign)!
  const other = fits.find((x) => x.sign !== state.sign)!
  // Switch conventions only on a clearly better fit, so it never flickers.
  const chosen = other.rms < current.rms * 0.7 ? other : current
  state.sign = chosen.sign
  if (chosen.rms > Math.max(6, spanPx * 0.15) || -chosen.p[5] < 0.1 || -chosen.p[5] > maxDepthM) {
    state.last = null
    return null
  }
  state.last = chosen.p
  const q = rotationOf(chosen.p)
  const t = new THREE.Vector3(chosen.p[3], chosen.p[4], chosen.p[5])
  return modelFor(chosen.sign, world.map((_, i) => i)).map((m) => m.applyQuaternion(q).add(t).multiplyScalar(100))
}

// --- hand ----------------------------------------------------------------------------

interface HandSense {
  /** The 21 points, cm, camera space. */
  P: THREE.Vector3[]
  image: NormalizedLandmark[]
  /** Unit vectors: wrist toward the middle knuckle, and out of the back of the hand. */
  along: THREE.Vector3
  back: THREE.Vector3
  /** Which fingers (index, middle, ring, pinky) are out straight, and which curled in. */
  out: boolean[]
  curled: boolean[]
}

const FINGERS: [number, number][] = [[6, 8], [10, 12], [14, 16], [18, 20]]

function senseHand(video: HTMLVideoElement, flip: boolean): HandSense | null {
  if (!hands) return null
  const result = hands.detectForVideo(video, stamp())
  if (!result.landmarks?.length) {
    fitState.hand.last = null
    return null
  }
  const W = video.videoWidth
  const H = video.videoHeight
  // The biggest hand in the picture is the one held up to the camera.
  const span = (lm: NormalizedLandmark[]) => Math.hypot((lm[0].x - lm[9].x) * W, (lm[0].y - lm[9].y) * H)
  let best = 0
  result.landmarks.forEach((lm, i) => {
    if (span(lm) > span(result.landmarks[best])) best = i
  })
  const image = result.landmarks[best]
  const world = result.worldLandmarks?.[best]
  if (!world) return null
  const P = fitShape(world, image, world.map((_, i) => i), [0, 9], W, H, fitState.hand, 1.5)
  if (!P) return null

  const along = P[9].clone().sub(P[0]).normalize()
  const knuckles = P[5].clone().sub(P[17]).normalize()
  const back = new THREE.Vector3().crossVectors(along, knuckles).normalize()
  // MediaPipe names hands as if the picture were mirrored; this stream is
  // not, so its "Left" is his right hand.
  const right = (result.handedness?.[best]?.[0]?.categoryName ?? "Left") === "Left"
  if (right === flip) back.negate()

  const reach = (i: number) => P[i].distanceTo(P[0])
  return {
    P,
    image,
    along,
    back,
    out: FINGERS.map(([pip, tip]) => reach(tip) > reach(pip) * 1.15),
    curled: FINGERS.map(([pip, tip]) => reach(tip) < reach(pip) * 1.02),
  }
}

// --- body ----------------------------------------------------------------------------

interface PoseSense {
  /** The 33 points, cm, camera space (those out of view are the model's guess). */
  P: THREE.Vector3[]
  image: NormalizedLandmark[]
  seen: boolean[]
}

// MediaPipe's body points: "left" is his left.
const L_SHOULDER = 11
const R_SHOULDER = 12
const L_ELBOW = 13
const R_ELBOW = 14
const L_WRIST = 15
const R_WRIST = 16
const L_HIP = 23
const R_HIP = 24

function sensePose(video: HTMLVideoElement): PoseSense | null {
  if (!pose) return null
  const result = pose.detectForVideo(video, stamp())
  const image = result.landmarks?.[0]
  const world = result.worldLandmarks?.[0]
  if (!image || !world) {
    fitState.pose.last = null
    return null
  }
  const seen = image.map((l) => (l.visibility ?? 0) > SEEN && l.x > -0.02 && l.x < 1.02 && l.y > -0.02 && l.y < 1.02)
  if (!seen[L_SHOULDER] || !seen[R_SHOULDER]) return null
  const use = seen.flatMap((s, i) => (s ? [i] : []))
  if (use.length < 6) return null
  const P = fitShape(world, image, use, [L_SHOULDER, R_SHOULDER], video.videoWidth, video.videoHeight, fitState.pose, 4)
  return P ? { P, image, seen } : null
}

/** His torso's frame: x to his left, y up, z out of his chest. */
function torso(p: PoseSense) {
  const shoulders = p.P[L_SHOULDER].clone().add(p.P[R_SHOULDER]).multiplyScalar(0.5)
  const hips = p.P[L_HIP].clone().add(p.P[R_HIP]).multiplyScalar(0.5)
  const across = p.P[L_SHOULDER].clone().sub(p.P[R_SHOULDER])
  const width = across.length()
  across.normalize()
  const up = shoulders.clone().sub(hips)
  up.addScaledVector(across, -up.dot(across)).normalize()
  const forward = new THREE.Vector3().crossVectors(across, up).normalize()
  return { shoulders, hips, across, up, forward, width }
}

function bodyAnchor(p: PoseSense, anchor: Anchor, flip: boolean): Tracked | null {
  const t = torso(p)
  const basis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(t.across, t.up, t.forward))
  const upright = basis.clone().multiply(DESIGN_TO_BODY)
  // The right side unless flipped.
  const shoulderI = flip ? L_SHOULDER : R_SHOULDER
  const elbowI = flip ? L_ELBOW : R_ELBOW
  let position: THREE.Vector3
  let quaternion = upright
  if (anchor === "chest") {
    // The joints are the skeleton's; the sternum is a quarter of the
    // shoulder width in front of them, a fifth of the way to the hips.
    position = t.shoulders.clone().lerp(t.hips, 0.2).addScaledVector(t.forward, t.width * 0.25)
  } else if (anchor === "shoulder") {
    position = p.P[shoulderI].clone().addScaledVector(t.up, 5)
  } else {
    if (!p.seen[elbowI]) return null
    const along = p.P[elbowI].clone().sub(p.P[shoulderI])
    const length = along.length()
    along.normalize()
    const outward = t.across.clone().multiplyScalar(flip ? 1 : -1)
    outward.addScaledVector(along, -outward.dot(along)).normalize()
    const side = new THREE.Vector3().crossVectors(outward, along)
    quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, side, outward))
    position = p.P[shoulderI].clone().addScaledVector(along, length / 2)
  }
  const u = (p.image[L_SHOULDER].x + p.image[R_SHOULDER].x) / 2
  const v = (p.image[L_SHOULDER].y + p.image[R_SHOULDER].y) / 2
  return { pose: { position, quaternion }, reference: { u, v, cm: -t.shoulders.z } }
}

function handAnchor(h: HandSense, anchor: Anchor, body: PoseSense | null): Tracked {
  let along = h.along.clone()
  if (anchor !== "hand" && body) {
    // The body's forearm on the side whose wrist is under this hand's.
    const near = [
      [L_WRIST, L_ELBOW],
      [R_WRIST, R_ELBOW],
    ].find(([w, e]) => body.seen[w] && body.seen[e] && Math.hypot(body.image[w].x - h.image[0].x, body.image[w].y - h.image[0].y) < 0.08)
    if (near) {
      const forearm = body.P[near[0]].clone().sub(body.P[near[1]]).normalize()
      // Trust it unless it disagrees wildly with the hand (a bad fit).
      if (forearm.dot(along) > 0.3) along = forearm
    }
  }
  const back = h.back.clone().addScaledVector(along, -h.back.dot(along)).normalize()
  const side = new THREE.Vector3().crossVectors(back, along).normalize()
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, side, back))
  const P = h.P
  let position: THREE.Vector3
  if (anchor === "hand") position = [0, 5, 9, 13, 17].reduce((s, i) => s.add(P[i]), new THREE.Vector3()).divideScalar(5)
  // The wrist landmark is the joint; the arm's axis runs back from it.
  else position = P[0].clone().addScaledVector(along, anchor === "forearm" ? -10 : -1.5)
  return { pose: { position, quaternion }, reference: { u: h.image[0].x, v: h.image[0].y, cm: -P[0].z } }
}

// --- a frame -------------------------------------------------------------------------

export interface Senses {
  face?: FaceSense | null
  hand?: HandSense | null
  pose?: PoseSense | null
}

/** Run the loaded sensors among `sensors` on this frame. */
export function sense(video: HTMLVideoElement, sensors: Iterable<Sensor>, flip: boolean): Senses {
  const out: Senses = {}
  if (!video.videoWidth) return out
  for (const s of new Set(sensors)) {
    if (s === "face") out.face = senseFace(video)
    else if (s === "hand") out.hand = senseHand(video, flip)
    else out.pose = sensePose(video)
  }
  return out
}

/** Where the anchor is this frame, or null when it is not in view. */
export function anchorPose(senses: Senses, anchor: Anchor, flip: boolean): Tracked | null {
  if (anchor === "desk") return null
  if (anchor === "face") return senses.face?.tracked ?? null
  if (BODY_ANCHORS.includes(anchor)) return senses.pose ? bodyAnchor(senses.pose, anchor, flip) : null
  return senses.hand ? handAnchor(senses.hand, anchor, senses.pose ?? null) : null
}

/** A point of known distance, for the depth map, from whatever was seen. */
export function referenceOf(senses: Senses, anchored: Tracked | null): Tracked["reference"] | null {
  return anchored?.reference ?? senses.face?.tracked.reference ?? null
}

/** The gestures he is making this frame. */
export function readCues(senses: Senses): Set<Cue> {
  const cues = new Set<Cue>()
  const h = senses.hand
  if (h) {
    const [index, middle, ring, pinky] = [0, 1, 2, 3]
    const centre = [0, 5, 9, 13, 17].reduce((s, i) => s.add(h.P[i]), new THREE.Vector3()).divideScalar(5)
    const toCamera = centre.clone().negate().normalize()
    const palmOut = h.back.clone().negate().dot(toCamera) > 0.45
    if (h.out.every(Boolean) && palmOut) cues.add("palm")
    if (h.curled.every(Boolean)) cues.add("fist")
    if (h.out[index] && h.curled[middle] && h.curled[ring] && h.curled[pinky]) cues.add("point")
    if (h.out[index] && h.out[pinky] && h.curled[middle] && h.curled[ring]) cues.add("thwip")
  }
  if ((senses.face?.jawOpen ?? 0) > 0.45) cues.add("jaw")
  const p = senses.pose
  if (p) {
    for (const [w, s] of [[L_WRIST, L_SHOULDER], [R_WRIST, R_SHOULDER]]) {
      if (p.seen[w] && p.seen[s] && p.image[w].y < p.image[s].y - 0.05) cues.add("raise")
    }
  }
  return cues
}
