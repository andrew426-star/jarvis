"use client"

import type { FaceLandmarker, HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision"
import * as THREE from "three"

import type { Anchor } from "@/lib/workshop/project/types"

// Where on Andrew a project is worn, frame by frame, from the webcam: a
// pose in the camera's own metric space (centimetres, camera at the
// origin looking down -z, y up - three.js's convention), for the try-on to
// put the model at. MediaPipe gives the landmarks; real size comes from
// lengths a body reliably has:
//
//  - face: the head's rotation from MediaPipe's facial transformation
//    matrix; its distance from the gap between the irises (about 63 mm).
//  - wrist / hand / forearm: the hand's rotation from its 3D world
//    landmarks; its distance from the palm's length, which those
//    landmarks give in metres, against its length in the picture.
//
// Both assume the camera sees about 63 degrees top to bottom, MediaPipe's
// own assumption for the face; the render uses the same, so the model
// lands on the right pixels even where the true figure differs.

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

let face: FaceLandmarker | null = null
let hands: HandLandmarker | null = null
let faceLoading: Promise<void> | null = null
let handsLoading: Promise<void> | null = null
let lastStamp = 0

async function fileset() {
  const vision = await import("@mediapipe/tasks-vision")
  return { vision, files: await vision.FilesetResolver.forVisionTasks(WASM_BASE) }
}

/** Load the model an anchor needs (once), the first time it is used. */
export function loadTracker(anchor: Anchor): Promise<void> {
  if (anchor === "desk") return Promise.resolve()
  if (anchor === "face") {
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

function focalPx(height: number) {
  return height / 2 / Math.tan(THREE.MathUtils.degToRad(VERTICAL_FOV) / 2)
}

/** A point in the picture (0-1) at a depth (cm), in camera space. */
function unproject(u: number, v: number, depth: number, width: number, height: number) {
  const f = focalPx(height)
  return new THREE.Vector3(((u * width - width / 2) / f) * depth, (-(v * height - height / 2) / f) * depth, -depth)
}

/** The design frame's z-up / front-is-minus-y, turned into a body's
 *  y-up / front-is-plus-z frame. */
const DESIGN_TO_BODY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)

function trackFace(video: HTMLVideoElement): AnchorPose | null {
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
  return {
    position: unproject((a.x + b.x) / 2, (a.y + b.y) / 2, depth, W, H),
    quaternion: rotation.multiply(DESIGN_TO_BODY),
  }
}

let lastHandDepth = 50

function trackHand(video: HTMLVideoElement, anchor: Anchor, flip: boolean): AnchorPose | null {
  if (!hands) return null
  const result = hands.detectForVideo(video, stamp())
  if (!result.landmarks?.length) return null
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
  // World landmarks: metres, x right, y down, z away; into y up, z toward us.
  const P = (i: number) => new THREE.Vector3(world[i].x, -world[i].y, -world[i].z)

  const along = P(9).sub(P(0)).normalize()
  const acrossKnuckles = P(5).sub(P(17)).normalize()
  let back = new THREE.Vector3().crossVectors(along, acrossKnuckles).normalize()
  // MediaPipe names hands as if the picture were mirrored; this stream is
  // not, so its "Left" is his right hand.
  const right = (result.handedness?.[best]?.[0]?.categoryName ?? "Left") === "Left"
  if (right === flip) back = back.negate()
  const side = new THREE.Vector3().crossVectors(back, along).normalize()
  const basis = new THREE.Matrix4().makeBasis(along, side, back)
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis)

  const lengthM = P(9).distanceTo(P(0))
  const facing = Math.hypot(along.x, along.y)
  // Pointed straight at the camera the palm's length says nothing about
  // distance; keep the last good figure.
  if (facing > 0.3) lastHandDepth = (focalPx(H) * lengthM * 100 * facing) / Math.max(span(image), 1)
  const depth = lastHandDepth
  const at = (i: number) => unproject(image[i].x, image[i].y, depth, W, H)

  let position: THREE.Vector3
  if (anchor === "hand") {
    position = [0, 5, 9, 13, 17].map(at).reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(5)
  } else {
    // The wrist landmark is the joint; the arm's axis runs back from it.
    position = at(0).addScaledVector(along, anchor === "forearm" ? -10 : -1.5)
  }
  return { position, quaternion }
}

/** This frame's pose for an anchor, or null when it is not in view. */
export function track(video: HTMLVideoElement, anchor: Anchor, flip = false): AnchorPose | null {
  if (!video.videoWidth) return null
  if (anchor === "face") return trackFace(video)
  if (anchor === "desk") return null
  return trackHand(video, anchor, flip)
}
