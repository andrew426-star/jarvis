"use client"

// One camera stream for the whole console. The preview shows it, hand
// tracking reads it, and a look captures from it, so all three share the
// <video> element the preview registers rather than opening the camera
// three times.

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null

export async function startCamera(): Promise<MediaStream> {
  if (stream) return stream
  // The browser shows its permission prompt here the first time.
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  })
  if (video) video.srcObject = stream
  return stream
}

export function stopCamera() {
  // Stopping every track is what turns the camera's light off; dropping
  // the reference alone would leave it recording.
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  if (video) video.srcObject = null
}

export function attachVideo(element: HTMLVideoElement | null) {
  video = element
  if (video && stream) video.srcObject = stream
}

export function getVideo(): HTMLVideoElement | null {
  return video && video.readyState >= 2 ? video : null
}

export interface Frame {
  /** Base64 JPEG without the data: prefix, as /invoke takes it. */
  base64: string
  /** A small data URL of the same frame, for the vision hologram. */
  thumbnail: string
}

function drawScaled(source: HTMLVideoElement, maxEdge: number): HTMLCanvasElement {
  const ratio = Math.min(1, maxEdge / Math.max(source.videoWidth, source.videoHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(source.videoWidth * ratio)
  canvas.height = Math.round(source.videoHeight * ratio)
  // Deliberately NOT mirrored like the preview. A page held up to a
  // webcam reads correctly in the raw frame and backwards in a mirror,
  // and reading labels and pages is half of what a look is for.
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

// 1280px on the long edge keeps labels and page text legible to the
// vision model while holding a frame to roughly 100-250KB.
export function captureFrame(): Frame | null {
  const source = getVideo()
  if (!source || !source.videoWidth) return null
  const full = drawScaled(source, 1280).toDataURL("image/jpeg", 0.85)
  const thumbnail = drawScaled(source, 320).toDataURL("image/jpeg", 0.7)
  return { base64: full.slice(full.indexOf(",") + 1), thumbnail }
}
