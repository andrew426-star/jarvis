"use client"

import type { FaceLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision"

// The desktop lock's face scan. Two models, both in the browser:
//
//  - MediaPipe's face landmarker: a 478-point mesh every frame, for the
//    scan's visuals (the mesh drawn over the face), for framing, and for
//    the liveness checks (a blink from its blendshapes, a head turn from
//    where the nose sits between the cheeks).
//  - face-api (@vladmandic/face-api): the 128-number face descriptor the
//    server compares against the enrolled face (app/services/lock.py).
//
// No image leaves the machine; only descriptors do. Both load once, from
// pinned CDN copies, the first time the lock screen opens.

const MP_VERSION = "0.10.35"
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
const LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
const FACE_API_MODELS = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model"

type FaceApi = typeof import("@vladmandic/face-api")

let landmarker: FaceLandmarker | null = null
let faceapi: FaceApi | null = null
let loading: Promise<void> | null = null

export function loadFaceScanner(onStep?: (step: string) => void): Promise<void> {
  loading ??= (async () => {
    onStep?.("LOADING FACE MESH")
    const vision = await import("@mediapipe/tasks-vision")
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE)
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: LANDMARKER_MODEL, delegate },
      runningMode: "VIDEO" as const,
      numFaces: 2,
      outputFaceBlendshapes: true,
    })
    // GPU where it works; some machines (no WebGL2, blocked drivers) need the CPU.
    landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options("GPU")).catch(() =>
      vision.FaceLandmarker.createFromOptions(fileset, options("CPU"))
    )
    onStep?.("LOADING RECOGNITION MODEL")
    // face-api picks its WebGL backend itself.
    const api = await import("@vladmandic/face-api")
    await Promise.all([
      api.nets.tinyFaceDetector.loadFromUri(FACE_API_MODELS),
      api.nets.faceLandmark68Net.loadFromUri(FACE_API_MODELS),
      api.nets.faceRecognitionNet.loadFromUri(FACE_API_MODELS),
    ])
    faceapi = api
  })().catch((err) => {
    loading = null
    throw err
  })
  return loading
}

export interface FaceFrame {
  /** Faces in frame. The scan wants exactly one. */
  faces: number
  points: NormalizedLandmark[] | null
  /** 0 open to 1 shut, both eyes averaged. */
  blink: number
  /** Head turn, -1 (their left) to 1 (their right); 0 facing the camera. */
  yaw: number
  /** Face centre, 0-1 in the (unmirrored) image. */
  cx: number
  cy: number
  /** Face width as a share of the frame. */
  size: number
}

let lastStamp = 0

export function readFrame(video: HTMLVideoElement): FaceFrame | null {
  if (!landmarker || video.readyState < 2) return null
  // detectForVideo needs strictly increasing timestamps.
  const stamp = Math.max(performance.now(), lastStamp + 1)
  lastStamp = stamp
  const result = landmarker.detectForVideo(video, stamp)
  const faces = result.faceLandmarks.length
  if (faces === 0) return { faces, points: null, blink: 0, yaw: 0, cx: 0.5, cy: 0.5, size: 0 }
  const points = result.faceLandmarks[0]
  const shapes = result.faceBlendshapes?.[0]?.categories ?? []
  const score = (name: string) => shapes.find((c) => c.categoryName === name)?.score ?? 0
  // Landmarks: 1 nose tip, 234 and 454 the cheek edges, 10 and 152 brow
  // top and chin.
  const left = points[234]
  const right = points[454]
  const nose = points[1]
  const width = Math.abs(right.x - left.x)
  const yaw = width > 0 ? ((nose.x - (left.x + right.x) / 2) / (width / 2)) * -1 : 0
  return {
    faces,
    points,
    blink: (score("eyeBlinkLeft") + score("eyeBlinkRight")) / 2,
    yaw: Math.max(-1, Math.min(1, yaw)),
    cx: (left.x + right.x) / 2,
    cy: (points[10].y + points[152].y) / 2,
    size: width,
  }
}

/** One face descriptor from the current frame, or null if no single clear face. */
export async function captureDescriptor(video: HTMLVideoElement): Promise<number[] | null> {
  if (!faceapi) return null
  const result = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.6 }))
    .withFaceLandmarks()
    .withFaceDescriptor()
  return result ? Array.from(result.descriptor) : null
}

// Mesh outlines worth drawing as lines rather than dots: the face oval and
// the eyes, which read as "scanning" at a glance.
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10,
]
export const LEFT_EYE = [33, 160, 158, 133, 153, 144, 33]
export const RIGHT_EYE = [362, 385, 387, 263, 373, 380, 362]
