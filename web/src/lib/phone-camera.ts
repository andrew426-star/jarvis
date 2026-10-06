"use client"

import { apiOrigin, closeCameraLink, getCameraIce, getCameraSdp, openCameraLink, postCameraSdp } from "@/lib/jarvis-client"

// Andrew's iPhone as the console's camera. Windows has no Continuity
// Camera, so the phone runs the Jarvis web app as a camera: it captures
// (rear or front, up to 1080p60) and sends it to the desktop.
//
// Two ways across, tried in order:
//  - direct, over WebRTC: device to device, full quality, no lag. The
//    backend only carries the two session descriptions under a four-digit
//    code (app/api/routes/camera_link.py), plus TURN servers if any are set
//    up. Campus and guest Wi-Fi often stop devices reaching each other, and
//    a phone on cellular is behind its carrier, so this can fail;
//  - the relay: if the direct link is not up within a few seconds, the
//    phone sends JPEG frames over a WebSocket and the backend passes them to
//    the desktop, which paints them into a canvas stream. It works on any
//    network, at a lower frame rate.
// The desktop listens on both and takes whichever brings video first.

const FALLBACK_ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
const POLL_MS = 1000
/** How long the direct link gets before the phone switches to the relay. */
const DIRECT_WAIT_MS = 9000
/** Plenty for 1080p60 on a home network, and the phone can back off. */
const MAX_BITRATE = 8_000_000
/** Relay frames: big enough for tracking, small enough to keep moving. */
const RELAY_EDGE = 1280
const RELAY_QUALITY = 0.72
const RELAY_FPS = 20

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type LinkState = "waiting" | "connecting" | "live" | "lost" | "error"

async function iceServers(token: string): Promise<RTCIceServer[]> {
  try {
    return (await getCameraIce(token)).iceServers
  } catch {
    return FALLBACK_ICE
  }
}

/** Resolve once the candidates are gathered (or after a few seconds - a
 *  slow STUN server should not hold up a LAN link). */
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

/** True once the peer connection is up; false if it fails or times out. */
function connected(pc: RTCPeerConnection, timeoutMs: number): Promise<boolean> {
  const up = () => pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed"
  const down = () => pc.connectionState === "failed" || pc.iceConnectionState === "failed" || pc.connectionState === "closed"
  if (up()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const check = () => {
      if (up()) finish(true)
      else if (down()) finish(false)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      pc.removeEventListener("connectionstatechange", check)
      pc.removeEventListener("iceconnectionstatechange", check)
      resolve(ok)
    }
    pc.addEventListener("connectionstatechange", check)
    pc.addEventListener("iceconnectionstatechange", check)
  })
}

/** The relay's WebSocket, authenticated in its first message. */
function openRelay(code: string, token: string, role: "phone" | "desk"): WebSocket {
  const base = (apiOrigin() || window.location.origin).replace(/^http/, "ws")
  const ws = new WebSocket(`${base}/camera-link/${encodeURIComponent(code)}/relay`)
  ws.binaryType = "arraybuffer"
  ws.addEventListener("open", () => ws.send(JSON.stringify({ role, token })))
  return ws
}

// --- the desktop: take the phone's camera ------------------------------------------

export interface PhoneReceiver {
  code: string
  /** The phone's video, once it is live. */
  stream: Promise<MediaStream>
  cancel: () => void
}

/** Paint relayed JPEG frames into a canvas, and stream the canvas. */
function relayStream(ws: WebSocket): { stream: Promise<MediaStream> } {
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")!
  let painting = false
  const stream = new Promise<MediaStream>((resolve) => {
    let started = false
    ws.addEventListener("message", (e) => {
      if (typeof e.data === "string" || painting) return
      painting = true
      void createImageBitmap(new Blob([e.data as ArrayBuffer], { type: "image/jpeg" }))
        .then((bitmap) => {
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width
            canvas.height = bitmap.height
          }
          ctx.drawImage(bitmap, 0, 0)
          bitmap.close()
          if (!started) {
            started = true
            resolve(canvas.captureStream(30))
          }
        })
        .catch(() => {})
        .finally(() => (painting = false))
    })
  })
  return { stream }
}

export async function receivePhoneCamera(
  token: string,
  onState: (state: LinkState, detail?: string) => void,
  /** The relay took over after the direct link dropped: use this stream now. */
  onReplace?: (stream: MediaStream) => void
): Promise<PhoneReceiver> {
  const { code, expires_in } = await openCameraLink(token)
  const ice = await iceServers(token)
  let cancelled = false
  let pc: RTCPeerConnection | null = null
  let won: "direct" | "relay" | null = null
  // The relay listens from the start, in case the phone ends up using it.
  const relay = openRelay(code, token, "desk")
  const relayed = relayStream(relay)

  const direct = (async () => {
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
    onState("connecting", "Linking directly to the phone...")
    const peer = new RTCPeerConnection({ iceServers: ice })
    pc = peer
    const track = new Promise<MediaStream>((resolve) => {
      peer.ontrack = (e) => resolve(e.streams[0] ?? new MediaStream([e.track]))
    })
    await peer.setRemoteDescription({ type: "offer", sdp: offer })
    await peer.setLocalDescription(await peer.createAnswer())
    await gathered(peer)
    await postCameraSdp(code, "answer", peer.localDescription!.sdp, token)
    // Never resolves if the direct link does not come up: the relay may win instead.
    if (!(await connected(peer, 60_000))) return new Promise<MediaStream>(() => {})
    return track
  })()
  direct.catch((err) => !cancelled && onState("error", err instanceof Error ? err.message : String(err)))

  const stream = Promise.race([
    direct.then((s) => {
      won ??= "direct"
      return s
    }),
    relayed.stream.then((s) => {
      won ??= "relay"
      return s
    }),
  ]).then((s) => {
    // The relay stays open even when the direct link wins: if that drops,
    // the phone carries on through the relay and this picks it up.
    if (won === "relay") pc?.close()
    onState("live", won === "direct" ? "Direct link" : "Through the Jarvis server (relay)")
    if (won === "direct") {
      pc!.addEventListener("connectionstatechange", () => {
        if (pc!.connectionState !== "failed" || cancelled) return
        onState("connecting", "The direct link dropped; waiting for the relay...")
        void relayed.stream.then((r) => {
          onState("live", "Through the Jarvis server (relay)")
          onReplace?.(r)
        })
      })
    }
    relay.addEventListener("close", () => !cancelled && won === "relay" && onState("lost", "The phone's stream dropped."))
    return s
  })

  return {
    code,
    stream,
    cancel: () => {
      cancelled = true
      pc?.close()
      relay.close()
      void closeCameraLink(code, token).catch(() => {})
    },
  }
}

// --- the phone: send its camera -----------------------------------------------------

export type Facing = "environment" | "user"

export interface PhoneSender {
  /** The local preview. */
  stream: MediaStream
  /** How it reaches the desktop. */
  mode: "direct" | "relay"
  setFacing: (facing: Facing) => Promise<void>
  stop: () => void
}

async function capture(facing: Facing): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
    audio: false,
  })
}

/** Send frames of `getStream()` over the relay until stopped. */
function runRelay(ws: WebSocket, getStream: () => MediaStream, onState: (state: LinkState, detail?: string) => void): () => void {
  const video = document.createElement("video")
  video.muted = true
  video.playsInline = true
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")!
  let source: MediaStream | null = null
  let stopped = false
  let timer = 0
  const tick = () => {
    if (stopped) return
    timer = window.setTimeout(tick, 1000 / RELAY_FPS)
    const stream = getStream()
    if (stream !== source) {
      source = stream
      video.srcObject = stream
      void video.play().catch(() => {})
    }
    // Skip a frame rather than queue one behind a slow network.
    if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 150_000 || video.readyState < 2) return
    const scale = Math.min(1, RELAY_EDGE / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => blob && ws.readyState === WebSocket.OPEN && ws.send(blob), "image/jpeg", RELAY_QUALITY)
  }
  ws.addEventListener("message", (e) => {
    if (typeof e.data !== "string") return
    const msg = JSON.parse(e.data) as { type: string; peer?: boolean; error?: string }
    if (msg.type === "ready" || msg.type === "peer") onState("live", msg.peer === false ? "Through the Jarvis server - waiting for the desktop" : "Through the Jarvis server (relay)")
    if (msg.type === "peer-left") onState("lost", "The desktop closed the link.")
    if (msg.type === "error") onState("error", msg.error)
  })
  ws.addEventListener("close", () => !stopped && onState("lost", "The link to the desktop dropped."))
  tick()
  return () => {
    stopped = true
    clearTimeout(timer)
    ws.close()
    video.srcObject = null
  }
}

export async function sendPhoneCamera(
  code: string,
  token: string,
  facing: Facing,
  onState: (state: LinkState, detail?: string) => void,
  /** Skip the direct link and go through the server from the start. */
  viaServer = false
): Promise<PhoneSender> {
  let stream = await capture(facing)
  if (viaServer) {
    // Straight through the server: no direct link to race it.
    onState("connecting", "Sending through the Jarvis server, as asked...")
    const stopRelay = runRelay(openRelay(code, token, "phone"), () => stream, onState)
    return {
      get stream() {
        return stream
      },
      mode: "relay",
      setFacing: async (next) => {
        const fresh = await capture(next)
        stream.getTracks().forEach((t) => t.stop())
        stream = fresh
      },
      stop: () => {
        stopRelay()
        stream.getTracks().forEach((t) => t.stop())
      },
    }
  }
  const ice = await iceServers(token)
  const pc = new RTCPeerConnection({ iceServers: ice })
  const sender = pc.addTrack(stream.getVideoTracks()[0], stream)
  try {
    const track = stream.getVideoTracks()[0]
    if ("contentHint" in track) track.contentHint = "detail"
  } catch {}

  onState("connecting", "Handing the desktop the link...")
  await pc.setLocalDescription(await pc.createOffer())
  await gathered(pc)
  await postCameraSdp(code, "offer", pc.localDescription!.sdp, token)
  let answer: string | null = null
  for (let i = 0; i < 30 && !answer; i += 1) {
    answer = await getCameraSdp(code, "answer", token).catch(() => null)
    if (!answer) await sleep(POLL_MS)
  }
  if (!answer) {
    pc.close()
    stream.getTracks().forEach((t) => t.stop())
    throw new Error("The desktop did not answer. Is its code still showing?")
  }
  onState("connecting", "Linking directly to the desktop...")
  await pc.setRemoteDescription({ type: "answer", sdp: answer })
  // Tracking wants detail more than every frame: hold the resolution.
  const params = sender.getParameters()
  if (params.encodings?.length) {
    params.encodings[0].maxBitrate = MAX_BITRATE
    params.degradationPreference = "maintain-resolution"
    await sender.setParameters(params).catch(() => {})
  }

  let mode: "direct" | "relay" = "direct"
  let stopRelay: (() => void) | null = null
  const switchToRelay = (why: string) => {
    if (stopRelay) return
    mode = "relay"
    pc.close()
    onState("connecting", `${why} Switching to the relay...`)
    stopRelay = runRelay(openRelay(code, token, "phone"), () => stream, onState)
  }

  if (await connected(pc, DIRECT_WAIT_MS)) {
    onState("live", "Direct link")
    // If the direct link dies later, carry on through the relay.
    pc.addEventListener("connectionstatechange", () => pc.connectionState === "failed" && switchToRelay("The direct link dropped."))
  } else {
    switchToRelay("This network will not let the phone and desktop talk directly.")
  }

  return {
    get stream() {
      return stream
    },
    get mode() {
      return mode
    },
    // The other camera, without a new handshake.
    setFacing: async (next) => {
      const fresh = await capture(next)
      if (mode === "direct") await sender.replaceTrack(fresh.getVideoTracks()[0]).catch(() => {})
      stream.getTracks().forEach((t) => t.stop())
      stream = fresh
    },
    stop: () => {
      stopRelay?.()
      pc.close()
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}
