import type { NormalizedLandmark } from "@mediapipe/tasks-vision"

// The hand as everything above the tracker sees it, shaped like WebXR's
// XRHand (the browser face of OpenXR's XR_EXT_hand_tracking): the same 25
// named joints, plus pinch and grab strength and a confidence. Today it is
// filled from MediaPipe's 21 webcam landmarks (fromMediaPipe, below); a
// headset source would fill it from XRFrame.getJointPose instead, and
// gestures, smoothing and the fallback logic would not change.

export const XR_JOINTS = [
  "wrist",
  "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
  "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip",
  "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip",
  "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip",
  "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip",
] as const

export type XRJointName = (typeof XR_JOINTS)[number]

/** Image-space joint: x, y across the camera frame (0-1, may run past the
 *  edges when the hand does), z relative depth (negative = nearer). */
export interface Joint {
  x: number
  y: number
  z: number
}

export type HandPose = "none" | "open" | "pinch" | "fist" | "peace"

export interface TrackedHand {
  handedness: "left" | "right" | "none"
  joints: Record<XRJointName, Joint>
  /** 0 = thumb and index apart, 1 = touching. */
  pinchStrength: number
  /** 0 = fingers straight, 1 = a closed fist (index to pinky curl). */
  grabStrength: number
  /** Per-finger curl, index to pinky, 0 straight to 1 curled. */
  curl: [number, number, number, number]
  /** 0-1: how sure the tracker is AND how much of the hand is in frame. */
  confidence: number
  /** Share of the joints inside the camera frame. */
  inView: number
}

// MediaPipe landmark index -> XR joint. MediaPipe has no finger metacarpal
// joints (only their knuckle ends), so those sit a quarter of the way from
// the wrist to the knuckle, which is where XR puts them.
const FINGER_BASES: [XRJointName, number][] = [
  ["index-finger-metacarpal", 5],
  ["middle-finger-metacarpal", 9],
  ["ring-finger-metacarpal", 13],
  ["pinky-finger-metacarpal", 17],
]
const DIRECT: [XRJointName, number][] = [
  ["wrist", 0],
  ["thumb-metacarpal", 1], ["thumb-phalanx-proximal", 2], ["thumb-phalanx-distal", 3], ["thumb-tip", 4],
  ["index-finger-phalanx-proximal", 5], ["index-finger-phalanx-intermediate", 6], ["index-finger-phalanx-distal", 7], ["index-finger-tip", 8],
  ["middle-finger-phalanx-proximal", 9], ["middle-finger-phalanx-intermediate", 10], ["middle-finger-phalanx-distal", 11], ["middle-finger-tip", 12],
  ["ring-finger-phalanx-proximal", 13], ["ring-finger-phalanx-intermediate", 14], ["ring-finger-phalanx-distal", 15], ["ring-finger-tip", 16],
  ["pinky-finger-phalanx-proximal", 17], ["pinky-finger-phalanx-intermediate", 18], ["pinky-finger-phalanx-distal", 19], ["pinky-finger-tip", 20],
]

const dist = (a: Joint, b: Joint) => Math.hypot(a.x - b.x, a.y - b.y)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Hand size in the image: wrist to middle knuckle. Everything gesture-
 *  related is measured against it, so it reads the same near or far. */
export function handScale(hand: TrackedHand): number {
  return Math.max(1e-4, dist(hand.joints.wrist, hand.joints["middle-finger-phalanx-proximal"]))
}

/** Pinch distance (thumb tip to index tip) over hand size. */
export function pinchRatio(hand: TrackedHand): number {
  return dist(hand.joints["thumb-tip"], hand.joints["index-finger-tip"]) / handScale(hand)
}

// A straight finger's tip is about twice as far from the wrist as its
// knuckle; curled into the palm, about the same distance.
const STRAIGHT = 1.85
const CURLED = 1.05

export function fromMediaPipe(
  landmarks: NormalizedLandmark[],
  handedness: { categoryName: string; score: number } | undefined
): TrackedHand {
  const joints = {} as Record<XRJointName, Joint>
  for (const [name, i] of DIRECT) joints[name] = { x: landmarks[i].x, y: landmarks[i].y, z: landmarks[i].z }
  const wrist = landmarks[0]
  for (const [name, i] of FINGER_BASES) {
    const knuckle = landmarks[i]
    joints[name] = {
      x: wrist.x + (knuckle.x - wrist.x) * 0.25,
      y: wrist.y + (knuckle.y - wrist.y) * 0.25,
      z: wrist.z + (knuckle.z - wrist.z) * 0.25,
    }
  }

  const size = Math.max(1e-4, dist(joints.wrist, joints["middle-finger-phalanx-proximal"]))
  const curlOf = (finger: "index" | "middle" | "ring" | "pinky") => {
    const ratio =
      dist(joints[`${finger}-finger-tip`], joints.wrist) / Math.max(1e-4, dist(joints[`${finger}-finger-phalanx-proximal`], joints.wrist))
    return clamp01((STRAIGHT - ratio) / (STRAIGHT - CURLED))
  }
  const curl: [number, number, number, number] = [curlOf("index"), curlOf("middle"), curlOf("ring"), curlOf("pinky")]

  const inside = landmarks.filter((l) => l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1).length / landmarks.length
  const score = handedness?.score ?? 0.5
  const label = handedness?.categoryName?.toLowerCase()

  return {
    // MediaPipe labels assume a mirrored image; the webcam's is not.
    handedness: label === "left" ? "right" : label === "right" ? "left" : "none",
    joints,
    pinchStrength: clamp01(1 - (dist(joints["thumb-tip"], joints["index-finger-tip"]) / size - 0.25) / 0.6),
    grabStrength: (curl[0] + curl[1] + curl[2] + curl[3]) / 4,
    curl,
    // A hand half out of frame tracks badly even when the model is sure.
    confidence: score * inside * inside,
    inView: inside,
  }
}
