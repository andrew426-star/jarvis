"use client"

// One camera stream for the whole console. The preview shows it, hand
// tracking reads it, and a look captures from it, so all three share the
// <video> element the preview registers rather than opening the camera
// three times.
//
// The stream is the computer's own camera - whichever one he picked, which
// may be a phone running as a USB webcam (Camo, Iriun) - or his iPhone's
// camera arriving over the phone link (lib/phone-camera.ts), adopted here
// so everything that reads the camera reads the phone's instead.

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let source: "local" | "phone" = "local"
let closeSource: (() => void) | null = null
const listeners = new Set<() => void>()
const DEVICE_KEY = "jarvis_camera_device"

function changed() {
  listeners.forEach((fn) => fn())
}

/** Where the camera comes from right now, for the UI to say. */
export function cameraSource(): "local" | "phone" {
  return source
}

export function subscribeCamera(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The camera he picked on this computer (null: the default). */
export function cameraDevice(): string | null {
  try {
    return window.localStorage.getItem(DEVICE_KEY)
  } catch {
    return null
  }
}

/** Every camera this computer can open, by label once permission is given. */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === "videoinput")
}

/** Pick a camera; a running local stream switches to it straight away. */
export async function setCameraDevice(deviceId: string | null) {
  try {
    if (deviceId) window.localStorage.setItem(DEVICE_KEY, deviceId)
    else window.localStorage.removeItem(DEVICE_KEY)
  } catch {}
  if (stream && source === "local") {
    stopCamera()
    await startCamera()
  }
}

async function openLocal(): Promise<MediaStream> {
  const deviceId = cameraDevice()
  // A phone-as-webcam can do better than 720p: ask for 1080p and take what comes.
  const size = deviceId ? { width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { ...size, facingMode: "user" },
      audio: false,
    })
  } catch (err) {
    // The picked camera is unplugged: fall back to the default.
    if (deviceId && err instanceof DOMException && (err.name === "OverconstrainedError" || err.name === "NotFoundError")) {
      return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false })
    }
    throw err
  }
}

export async function startCamera(): Promise<MediaStream> {
  if (stream) return stream
  // The browser shows its permission prompt here the first time.
  stream = await openLocal()
  source = "local"
  if (video) video.srcObject = stream
  changed()
  return stream
}

/** Use a stream from elsewhere (the phone link) as the camera; `close`
 *  ends that link when the camera is turned off. */
export function adoptStream(external: MediaStream, close: () => void) {
  stream?.getTracks().forEach((track) => track.stop())
  closeSource?.()
  stream = external
  source = "phone"
  closeSource = close
  if (video) video.srcObject = stream
  changed()
}

export function stopCamera() {
  // Stopping every track is what turns the camera's light off; dropping
  // the reference alone would leave it recording.
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  const close = closeSource
  closeSource = null
  source = "local"
  close?.()
  if (video) video.srcObject = null
  changed()
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
