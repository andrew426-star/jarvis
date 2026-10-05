"use client"

import type { FaceLandmarker, HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision"
import * as THREE from "three"

import type { Anchor } from "@/lib/workshop/project/types"

// Where on Andrew a project is worn, frame by frame, from the webcam: a
// pose in the camera's own metric space (centimetres, camera at the
// origin looking down -z, y up - three.js's convention), for the try-on to
// put the model at. MediaPipe gives the landmarks; real size comes from
// what a body reliably measures:
//
//  - face: the head's rotation from MediaPipe's facial transformation
//    matrix; its distance from the gap between the irises (about 63 mm).
//  - wrist / hand / forearm: a full pose fit of the hand's 21 points in
//    metres (MediaPipe's world landmarks) to the same 21 in the picture,
//    which gives its distance and tilt together.
//
// Both assume the camera sees about 63 degrees top to bottom, MediaPipe's
// own assumption for the face; the render uses the same, so the model
// lands on the right pixels even where the true figure differs. Each also
// reports a point whose true distance it knows, which scales the depth
// model's map (depth.ts).

export const VERTICAL_FOV = 63
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
const IPD_CM = 6.3
const OUTER_EYES_CM = 9.0

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

let face: FaceLandmarker | null = null
let hands: HandLandmarker | null = null
let faceLoading: Promise<void> | null = null
let handsLoading: Promise<void> | null = null
let lastStamp = 0

async function fileset() {
  const vision = await import("@mediapipe/tasks-vision")
  return { vision, files: await vision.FilesetResolver.forVisionTasks(WASM_BASE) }
}

/** Load the model an anchor needs (once), the first time it is used. The
 *  desk loads the face's, as its depth reference. */
export function loadTracker(anchor: Anchor): Promise<void> {
  if (anchor === "face" || anchor === "desk") {
    faceLoading ??= (async () => {
      const { vision, files } = await fileset()
      const options = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: "VIDEO" as const,
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      })
      face = await vision.FaceLandmarker.createFromOptions(files, options("GPU")).catch(() =>
        vision.FaceLandmarker.createFromOptions(files, options("CPU"))
      )
    })().catch((err) => {
      faceLoading = null
      throw err
    })
    return faceLoading
  }
  handsLoading ??= (async () => {
    const { vision, files } = await fileset()
    hands = await vision.HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    })
  })().catch((err) => {
    handsLoading = null
    throw err
  })
  return handsLoading
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

function trackFace(video: HTMLVideoElement): Tracked | null {
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
  return {
    pose: { position: unproject(u, v, depth, W, H), quaternion: rotation.multiply(DESIGN_TO_BODY) },
    reference: { u, v, cm: depth },
  }
}

// --- hands: a full pose fit --------------------------------------------------------
//
// MediaPipe gives each hand twice: 21 points in the picture, and the same
// 21 in metres in 3D (the hand's own shape, centred on the hand). The pose
// is the rotation and position that lay the 3D hand exactly over the
// picture's points (a perspective-n-point fit, by Levenberg-Marquardt):
// true distance and tilt from the whole hand, not a guess from one length.
// The fit runs with the 3D points' depth axis both ways and keeps the
// better one, which settles the one convention the docs leave open.

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
    // Jacobian by finite differences: 6 parameters, 42 residuals.
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

let depthSign = -1
let lastFit: Vec6 | null = null

function trackHand(video: HTMLVideoElement, anchor: Anchor, flip: boolean): Tracked | null {
  if (!hands) return null
  const result = hands.detectForVideo(video, stamp())
  if (!result.landmarks?.length) {
    lastFit = null
    return null
  }
  const W = video.videoWidth
  const H = video.videoHeight
  const f = focalPx(H)
  // The biggest hand in the picture is the one held up to the camera.
  const span = (lm: NormalizedLandmark[]) => Math.hypot((lm[0].x - lm[9].x) * W, (lm[0].y - lm[9].y) * H)
  let best = 0
  result.landmarks.forEach((lm, i) => {
    if (span(lm) > span(result.landmarks[best])) best = i
  })
  const image = result.landmarks[best]
  const world = result.worldLandmarks?.[best]
  if (!world) return null
  const pixels = image.map((l) => [l.x * W, l.y * H])

  // A starting guess from the palm's length, for the first frame; after
  // that, last frame's fit.
  const palm = Math.hypot(world[9].x - world[0].x, world[9].y - world[0].y, world[9].z - world[0].z)
  const guessM = Math.min(1.5, Math.max(0.15, (f * palm) / Math.max(span(image), 1)))
  const mean = image.reduce((s, l) => [s[0] + l.x / image.length, s[1] + l.y / image.length], [0, 0])
  const centre = unproject(mean[0], mean[1], guessM, W, H)
  const start: Vec6 = lastFit ?? [0, 0, 0, centre.x, centre.y, centre.z]

  // World landmarks: x right, y down; z is the open question, so fit both.
  const modelFor = (sign: number) => world.map((l) => new THREE.Vector3(l.x, -l.y, sign * l.z))
  const fits = [-1, 1].map((sign) => {
    const model = modelFor(sign)
    return { sign, model, ...fitPose(model, pixels, f, W / 2, H / 2, start) }
  })
  const current = fits.find((x) => x.sign === depthSign)!
  const other = fits.find((x) => x.sign !== depthSign)!
  // Switch conventions only on a clearly better fit, so it never flickers.
  const chosen = other.rms < current.rms * 0.7 ? other : current
  depthSign = chosen.sign
  if (chosen.rms > Math.max(6, span(image) * 0.12) || -chosen.p[5] < 0.1 || -chosen.p[5] > 2) {
    lastFit = null
    return null
  }
  lastFit = chosen.p

  // The hand in camera space, in centimetres.
  const q = rotationOf(chosen.p)
  const t = new THREE.Vector3(chosen.p[3], chosen.p[4], chosen.p[5])
  const P = chosen.model.map((m) => m.clone().applyQuaternion(q).add(t).multiplyScalar(100))

  const along = P[9].clone().sub(P[0]).normalize()
  const knuckles = P[5].clone().sub(P[17]).normalize()
  let back = new THREE.Vector3().crossVectors(along, knuckles).normalize()
  // MediaPipe names hands as if the picture were mirrored; this stream is
  // not, so its "Left" is his right hand.
  const right = (result.handedness?.[best]?.[0]?.categoryName ?? "Left") === "Left"
  if (right === flip) back = back.negate()
  const side = new THREE.Vector3().crossVectors(back, along).normalize()
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, side, back))

  let position: THREE.Vector3
  if (anchor === "hand") position = [0, 5, 9, 13, 17].reduce((s, i) => s.add(P[i]), new THREE.Vector3()).divideScalar(5)
  // The wrist landmark is the joint; the arm's axis runs back from it.
  else position = P[0].clone().addScaledVector(along, anchor === "forearm" ? -10 : -1.5)
  return { pose: { position, quaternion }, reference: { u: image[0].x, v: image[0].y, cm: -P[0].z } }
}

/** This frame's pose for an anchor, or null when it is not in view. */
export function track(video: HTMLVideoElement, anchor: Anchor, flip = false): Tracked | null {
  if (!video.videoWidth) return null
  if (anchor === "face") return trackFace(video)
  if (anchor === "desk") return null
  return trackHand(video, anchor, flip)
}

/** Only the depth reference (his face), for when the anchor is the desk
 *  and nothing else in view has a known size. */
export function trackReference(video: HTMLVideoElement): Tracked["reference"] | null {
  if (!video.videoWidth || !face) return null
  return trackFace(video)?.reference ?? null
}
