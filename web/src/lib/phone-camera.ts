"use client"

import { closeCameraLink, getCameraSdp, openCameraLink, postCameraSdp } from "@/lib/jarvis-client"

// Andrew's iPhone as the console's camera. Windows has no Continuity
// Camera, so the phone runs the Jarvis web app as a camera: it captures
// (rear or front, up to 1080p60) and streams to the desktop over WebRTC -
// device to device on the home network, with STUN for when it is not.
// The backend only carries the two session descriptions, under a
// four-digit code the desktop shows (app/api/routes/camera_link.py).
// Candidates are gathered before each description is sent, so one offer
// and one answer are the whole handshake.

const ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
const POLL_MS = 1000
/** Plenty for 1080p60 on a home network, and the phone can back off. */
const MAX_BITRATE = 8_000_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Resolve once the connection's candidates are all gathered (or after a
 *  few seconds - a slow STUN server should not hold up a LAN link). */
function gathered(pc: RTCPeerConnection, timeoutMs = 3000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check)
      resolve()
    }
    const check = () => pc.iceGatheringState === "complete" && done()
    pc.addEventListener("icegatheringstatechange", check)
    setTimeout(done, timeoutMs)
  })
}

export type LinkState = "waiting" | "connecting" | "live" | "lost" | "error"

// --- the desktop: take the phone's camera ------------------------------------------

export interface PhoneReceiver {
  code: string
  /** The phone's video, once it is live. */
  stream: Promise<MediaStream>
  cancel: () => void
}

export async function receivePhoneCamera(token: string, onState: (state: LinkState, detail?: string) => void): Promise<PhoneReceiver> {
  const { code, expires_in } = await openCameraLink(token)
  let cancelled = false
  let pc: RTCPeerConnection | null = null

  const stream = (async () => {
    onState("waiting")
    const deadline = Date.now() + expires_in * 1000
    let offer: string | null = null
    while (!cancelled && Date.now() < deadline) {
      offer = await getCameraSdp(code, "offer", token).catch(() => null)
      if (offer) break
      await sleep(POLL_MS)
    }
    if (cancelled) throw new Error("Cancelled.")
    if (!offer) throw new Error("The code expired before the phone connected.")
    onState("connecting")
    const peer = new RTCPeerConnection({ iceServers: ICE })
    pc = peer
    const track = new Promise<MediaStream>((resolve) => {
      peer.ontrack = (e) => resolve(e.streams[0] ?? new MediaStream([e.track]))
    })
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") onState("live")
      else if (peer.connectionState === "failed" || peer.connectionState === "disconnected") onState("lost", "The phone's stream dropped.")
    }
    await peer.setRemoteDescription({ type: "offer", sdp: offer })
    await peer.setLocalDescription(await peer.createAnswer())
    await gathered(peer)
    await postCameraSdp(code, "answer", peer.localDescription!.sdp, token)
    const timeout = sleep(20_000).then(() => {
      throw new Error("Connected to the phone, but no video arrived. Are both on the same network?")
    })
    return Promise.race([track, timeout])
  })()
  stream.catch((err) => !cancelled && onState("error", err instanceof Error ? err.message : String(err)))

  return {
    code,
    stream,
    cancel: () => {
      cancelled = true
      pc?.close()
      void closeCameraLink(code, token).catch(() => {})
    },
  }
}

// --- the phone: send its camera -----------------------------------------------------

export type Facing = "environment" | "user"

export interface PhoneSender {
  /** The local preview. */
  stream: MediaStream
  setFacing: (facing: Facing) => Promise<void>
  stop: () => void
}

async function capture(facing: Facing): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
    audio: false,
  })
}

export async function sendPhoneCamera(
  code: string,
  token: string,
  facing: Facing,
  onState: (state: LinkState, detail?: string) => void
): Promise<PhoneSender> {
  let stream = await capture(facing)
  const pc = new RTCPeerConnection({ iceServers: ICE })
  const sender = pc.addTrack(stream.getVideoTracks()[0], stream)
  // Tracking wants detail more than every frame: hold the resolution and
  // let the frame rate give when the network does.
  const params = sender.getParameters()
  params.encodings = [{ ...(params.encodings?.[0] ?? {}), maxBitrate: MAX_BITRATE }]
  params.degradationPreference = "maintain-resolution"
  await sender.setParameters(params).catch(() => {})
  try {
    const track = stream.getVideoTracks()[0]
    if ("contentHint" in track) track.contentHint = "detail"
  } catch {}

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") onState("live")
    else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") onState("lost", "The link to the desktop dropped.")
  }

  onState("connecting")
  await pc.setLocalDescription(await pc.createOffer())
  await gathered(pc)
  await postCameraSdp(code, "offer", pc.localDescription!.sdp, token)
  let answer: string | null = null
  for (let i = 0; i < 60 && !answer; i += 1) {
    answer = await getCameraSdp(code, "answer", token).catch(() => null)
    if (!answer) await sleep(POLL_MS)
  }
  if (!answer) {
    pc.close()
    stream.getTracks().forEach((t) => t.stop())
    throw new Error("The desktop did not answer. Is its code still showing?")
  }
  await pc.setRemoteDescription({ type: "answer", sdp: answer })

  return {
    get stream() {
      return stream
    },
    // The other camera, without a new handshake: the sender just swaps tracks.
    setFacing: async (next) => {
      const fresh = await capture(next)
      await sender.replaceTrack(fresh.getVideoTracks()[0])
      stream.getTracks().forEach((t) => t.stop())
      stream = fresh
    },
    stop: () => {
      pc.close()
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}
