"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2Icon, RefreshCwIcon, XIcon } from "lucide-react"

import { sendPhoneCamera, type Facing, type LinkState, type PhoneSender } from "@/lib/phone-camera"

// The phone as the desktop console's camera (lib/phone-camera.ts): type
// the code the desktop shows, and this streams the back camera (or the
// front) to it while the screen stays on. Prop the phone up facing you.

const STATE_TEXT: Record<LinkState, string> = {
  waiting: "ENTER THE CODE FROM THE DESKTOP",
  connecting: "CONNECTING",
  live: "LIVE TO THE DESKTOP",
  lost: "LINK LOST",
  error: "FAILED",
}

export function PhoneCameraSender({ token, initialCode, onClose }: { token: string; initialCode?: string | null; onClose: () => void }) {
  const [code, setCode] = useState(initialCode ?? "")
  const [state, setState] = useState<LinkState>("waiting")
  const [detail, setDetail] = useState<string | null>(null)
  const [facing, setFacing] = useState<Facing>("environment")
  const [busy, setBusy] = useState(false)
  // A network that lets the direct link through but stutters: go via the server.
  const [viaServer, setViaServer] = useState(() => new URLSearchParams(window.location.search).get("via") === "server")
  const sender = useRef<PhoneSender | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const started = useRef(false)

  async function connect(withCode = code) {
    if (busy || withCode.length !== 4) return
    setBusy(true)
    setDetail(null)
    try {
      sender.current?.stop()
      const link = await sendPhoneCamera(
        withCode,
        token,
        facing,
        (s, d) => {
          setState(s)
          setDetail(d ?? null)
        },
        viaServer
      )
      sender.current = link
      if (videoRef.current) videoRef.current.srcObject = link.stream
    } catch (err) {
      setState("error")
      setDetail(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Opened from a link with the code in it: connect straight away.
  useEffect(() => {
    if (initialCode?.length === 4 && !started.current) {
      started.current = true
      void connect(initialCode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode])

  // Keep the screen on while streaming; release it and the camera on the way out.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    if (state === "live" && "wakeLock" in navigator) {
      void navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {})
    }
    return () => void lock?.release().catch(() => {})
  }, [state])
  useEffect(() => () => sender.current?.stop(), [])

  async function flip() {
    const next: Facing = facing === "environment" ? "user" : "environment"
    setFacing(next)
    if (sender.current) {
      await sender.current.setFacing(next).catch(() => {})
      if (videoRef.current) videoRef.current.srcObject = sender.current.stream
    }
  }

  const live = state === "live" || state === "connecting"

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "#020306" }}>
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" style={{ opacity: live ? 1 : 0.25, transform: facing === "user" ? "scaleX(-1)" : undefined }} />
      <div className="relative flex items-center justify-between" style={{ padding: "calc(env(safe-area-inset-top) + 12px) 16px 12px" }}>
        <span className="t-header" style={{ color: "var(--accent)" }}>CAMERA LINK</span>
        <button type="button" className="btn" style={{ width: 36, height: 36, padding: 0 }} onClick={() => { sender.current?.stop(); onClose() }} aria-label="Stop and close">
          <XIcon size={16} className="mx-auto" />
        </button>
      </div>

      <div className="relative mt-auto flex flex-col items-center" style={{ gap: 12, padding: "16px 16px calc(env(safe-area-inset-bottom) + 20px)", background: "linear-gradient(transparent, rgba(2,3,6,0.9) 30%)" }}>
        <span className="t-label flex items-center" style={{ gap: 6, color: state === "error" || state === "lost" ? "var(--warning)" : "var(--accent)" }}>
          {(busy || state === "connecting") && <Loader2Icon size={12} className="animate-spin" />}
          {STATE_TEXT[state]}
        </span>
        {detail && <span className="t-time" style={{ textAlign: "center" }}>{detail}</span>}
        {state !== "live" && (
          <div className="flex w-full" style={{ gap: 8 }}>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="0000"
              aria-label="Code from the desktop"
              className="flex-1"
              style={{ height: 48, fontSize: 28, letterSpacing: 10, textAlign: "center", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(var(--accent-rgb),0.4)", color: "var(--text-primary)", borderRadius: "var(--radius)" }}
            />
            <button type="button" className="btn" style={{ height: 48, padding: "0 18px" }} disabled={busy || code.length !== 4} onClick={() => void connect()}>
              CONNECT
            </button>
          </div>
        )}
        {state !== "live" && (
          <label className="t-label flex items-center" style={{ gap: 8 }}>
            <input type="checkbox" checked={viaServer} onChange={(e) => setViaServer(e.target.checked)} />
            SEND VIA THE JARVIS SERVER (FOR CAMPUS OR GUEST WI-FI)
          </label>
        )}
        <button type="button" className="btn flex items-center" style={{ gap: 8, height: 40, padding: "0 16px" }} onClick={() => void flip()}>
          <RefreshCwIcon size={14} /> {facing === "environment" ? "BACK CAMERA" : "FRONT CAMERA"}
        </button>
      </div>
    </div>
  )
}
