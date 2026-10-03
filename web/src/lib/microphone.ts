"use client"

// Which microphone Jarvis listens through, and how it is opened.
//
// The device matters more than anything downstream. Bluetooth earbuds
// (AirPods especially, and on Windows most of all) drop into the
// hands-free profile the moment any app opens their mic: 8 or 16 kHz
// narrowband, the quality of a phone call, and Whisper mishears it. A
// laptop or USB mic for input, with the earbuds still playing Jarvis's
// voice, is far clearer - so the choice is offered in Settings > Voice and
// remembered per browser.

const DEVICE_KEY = "jarvis_mic_device"

export function getMicDevice(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY)
  } catch {
    return null
  }
}

export function setMicDevice(deviceId: string | null) {
  try {
    if (deviceId) localStorage.setItem(DEVICE_KEY, deviceId)
    else localStorage.removeItem(DEVICE_KEY)
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

// Speech, mono. The browser's echo cancelling stays on (it is what keeps
// Jarvis's own voice out of the recording on speakers), as do noise
// suppression and gain control, which Whisper copes with far better than
// it does a quiet or hissy clip.
const VOICE: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

/** The mic as Jarvis should hear it: the chosen device, else the default. */
export async function openMic(): Promise<MediaStream> {
  const deviceId = getMicDevice()
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...VOICE, deviceId: { exact: deviceId } } })
    } catch (err) {
      // Unplugged or renamed since it was chosen: fall back to the default
      // rather than leave him with a dead mic. A refused permission is
      // still refused, so that one goes up.
      if (err instanceof DOMException && err.name === "NotAllowedError") throw err
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: VOICE })
}

export interface MicOption {
  deviceId: string
  label: string
}

/** Every audio input. Labels are blank until the mic has been allowed once. */
export async function listMics(): Promise<MicOption[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === "audioinput" && device.deviceId !== "default" && device.deviceId !== "communications")
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Microphone ${index + 1}` }))
}

/** Bluetooth hands-free audio, by name or by its tell-tale sample rate. */
export function looksLikeHeadset(label: string, sampleRate?: number): boolean {
  return /airpods|hands-free|headset|bluetooth|buds/i.test(label) || (sampleRate !== undefined && sampleRate <= 16000)
}
