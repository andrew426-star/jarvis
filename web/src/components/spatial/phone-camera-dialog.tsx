"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2Icon, SmartphoneIcon, XIcon } from "lucide-react"

import { adoptStream, cameraDevice, cameraSource, listCameras, setCameraDevice, startCamera } from "@/lib/camera"
import { startHands } from "@/lib/hand-tracking"
import { receivePhoneCamera, type LinkState, type PhoneReceiver } from "@/lib/phone-camera"
import { useSpatial } from "@/lib/spatial-store"
import { useJarvis } from "@/lib/store"

// Choosing the console's camera: his iPhone over the phone link (a code
// to type into Jarvis on the phone), or any camera this computer has -
// including a phone running as a USB webcam. Whichever it is becomes the
// one camera everything reads: the preview, hand tracking, the workshop's
// try-on and depth, and Jarvis's looks.

const STATE_TEXT: Record<LinkState, string> = {
  waiting: "WAITING FOR THE PHONE",
  connecting: "CONNECTING",
  live: "LIVE",
  lost: "LINK LOST",
  error: "FAILED",
}

export function PhoneCameraDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null)
  const [state, setState] = useState<LinkState>("waiting")
  const [detail, setDetail] = useState<string | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [picked, setPicked] = useState<string>(() => cameraDevice() ?? "")
  const link = useRef<PhoneReceiver | null>(null)

  useEffect(() => {
    void listCameras().then(setCameras).catch(() => {})
  }, [])

  // A fresh code each time the dialog opens; adopted the moment it is live.
  useEffect(() => {
    let alive = true
    void receivePhoneCamera(token, (s, d) => {
      if (!alive && s !== "lost") return
      setState(s)
      setDetail(d ?? null)
      if (s === "lost" && cameraSource() === "phone") {
        useJarvis.getState().notify("warning", "iPhone camera", d ?? "The phone's stream dropped.")
      }
    })
      .then((receiver) => {
        if (!alive) {
          receiver.cancel()
          return
        }
        link.current = receiver
        setCode(receiver.code)
        return receiver.stream.then((stream) => {
          if (!alive) return
          adoptStream(stream, receiver.cancel)
          link.current = null
          useSpatial.getState().setCameraOn(true)
          if (useSpatial.getState().handsStatus !== "tracking") void startHands().catch(() => {})
          useJarvis.getState().notify("info", "iPhone camera", "The phone is now the console's camera.")
          onClose()
        })
      })
      .catch((err) => {
        if (!alive) return
        setState("error")
        setDetail(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
      // Still waiting when closed: drop the link. Once adopted, the camera owns it.
      link.current?.cancel()
    }
  }, [token, onClose])

  async function pickLocal(deviceId: string) {
    setPicked(deviceId)
    await setCameraDevice(deviceId || null)
    if (!useSpatial.getState().cameraOn) {
      await startCamera()
      useSpatial.getState().setCameraOn(true)
    }
  }

  const pill = { background: "rgba(2, 3, 6, 0.92)", border: "1px solid rgba(var(--accent-rgb), 0.35)", borderRadius: "var(--radius)" }
  const origin = typeof window !== "undefined" ? window.location.origin : ""

  return (
    <div className="absolute flex flex-col" style={{ top: 56, right: 16, width: 340, padding: 16, gap: 12, zIndex: 20, ...pill }} role="dialog" aria-label="Camera source">
      <div className="flex items-center justify-between">
        <span className="t-header flex items-center" style={{ gap: 8, color: "var(--accent)" }}>
          <SmartphoneIcon size={14} /> IPHONE CAMERA
        </span>
        <button type="button" className="btn" style={{ width: 24, height: 24, padding: 0 }} onClick={onClose} aria-label="Close">
          <XIcon size={12} className="mx-auto" />
        </button>
      </div>

      <div className="flex flex-col items-center" style={{ gap: 6 }}>
        <span className="t-label">ON THE IPHONE: JARVIS · MENU · USE AS CAMERA · ENTER</span>
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 40, letterSpacing: 12, color: "var(--accent)" }}>{code ?? "····"}</span>
        <span className="t-label flex items-center" style={{ gap: 6, color: state === "error" || state === "lost" ? "var(--warning)" : "var(--accent)" }}>
          {(state === "waiting" || state === "connecting") && <Loader2Icon size={10} className="animate-spin" />}
          {STATE_TEXT[state]}
        </span>
        {detail && <span className="t-time" style={{ textAlign: "center" }}>{detail}</span>}
        {code && (
          <span className="t-time" style={{ textAlign: "center", wordBreak: "break-all" }}>
            Or open {origin}/?view=mobile&amp;camera={code} on the phone.
          </span>
        )}
        <span className="t-time" style={{ textAlign: "center" }}>
          Prop the phone up facing you; the back camera is the sharp one. Both devices on the same Wi-Fi works best.
        </span>
      </div>

      <label className="flex flex-col" style={{ gap: 4 }}>
        <span className="t-label">OR A CAMERA ON THIS COMPUTER</span>
        <select
          className="btn"
          style={{ padding: "4px 8px", textAlign: "left" }}
          value={picked}
          onChange={(e) => void pickLocal(e.target.value)}
          title="A phone running as a USB webcam (Camo, Iriun) shows up here too"
        >
          <option value="">Default camera</option>
          {cameras.map((c, i) => (
            <option key={c.deviceId || i} value={c.deviceId}>
              {c.label || `Camera ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
