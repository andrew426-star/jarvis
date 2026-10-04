"use client"

import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { CheckIcon, CircleIcon, Loader2Icon, RotateCcwIcon, ScanFaceIcon, XIcon } from "lucide-react"

import { GlobalEffects } from "@/components/hud/global-effects"
import { HolographicGrid } from "@/components/hud/holographic-grid"
import {
  FACE_OVAL,
  LEFT_EYE,
  RIGHT_EYE,
  captureDescriptor,
  loadFaceScanner,
  readFrame,
  type FaceFrame,
} from "@/lib/face-scan"
import {
  JarvisApiError,
  JarvisAuthError,
  JarvisNetworkError,
  enrollFace,
  getLockStatus,
  unlockWithFace,
} from "@/lib/jarvis-client"
import { useLock } from "@/lib/lock-state"

// The desktop's lock: a face scan. The camera stays on this machine; what
// goes to the server is a few face descriptors and whether the liveness
// steps were done, and the server decides (app/services/lock.py). Liveness
// is a blink and a head turn, in a random order and direction each time,
// so a still photo or a replayed clip does not pass the steps on screen.
// The first scan enrols the face, and enrolling takes the PIN.

type StepId = "detect" | "align" | "blink" | "turn" | "match"
type StepState = "pending" | "active" | "done" | "failed"
type Phase = "loading" | "pin" | "scanning" | "verifying" | "granted" | "denied" | "locked" | "error"
type Mode = "unlock" | "enroll"

const STEP_LABEL: Record<StepId, string> = {
  detect: "Face detected",
  align: "Aligned",
  blink: "Liveness · blink",
  turn: "Liveness · turn",
  match: "Biometric match",
}

const UNLOCK_SAMPLES = 3
const ENROLL_SAMPLES = 6
const RING = 380

type Direction = "left" | "right"

interface Run {
  order: StepId[]
  direction: Direction
  done: Set<StepId>
  alignedSince: number | null
  eyesOpen: boolean
  turnedOut: boolean
  samples: number[][]
  capturing: boolean
  blinked: boolean
  turned: boolean
}

function newRun(mode: Mode): Run {
  const liveness: StepId[] = Math.random() < 0.5 ? ["blink", "turn"] : ["turn", "blink"]
  return {
    order: mode === "unlock" ? ["detect", "align", ...liveness, "match"] : ["detect", "align", "match"],
    direction: Math.random() < 0.5 ? "left" : "right",
    done: new Set(),
    alignedSince: null,
    eyesOpen: false,
    turnedOut: false,
    samples: [],
    capturing: false,
    blinked: false,
    turned: false,
  }
}

function errorText(err: unknown): string {
  return err instanceof JarvisApiError || err instanceof JarvisNetworkError ? err.message : "Something went wrong."
}

export function FaceGate({ sessionToken, onSignOut }: { sessionToken: string; onSignOut: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const runRef = useRef<Run>(newRun("unlock"))
  const modeRef = useRef<Mode>("unlock")
  const pinRef = useRef("")

  const [phase, setPhase] = useState<Phase>("loading")
  const [mode, setMode] = useState<Mode>("unlock")
  const [loadingStep, setLoadingStep] = useState("INITIALISING")
  const [message, setMessage] = useState<string | null>(null)
  const [readout, setReadout] = useState<FaceFrame | null>(null)
  const [steps, setSteps] = useState<StepId[]>([])
  const [active, setActive] = useState<StepId | null>(null)
  const [done, setDone] = useState<StepId[]>([])
  const [samples, setSamples] = useState(0)
  const [distance, setDistance] = useState<number | null>(null)
  const [pin, setPin] = useState("")
  const [prompt, setPrompt] = useState("ALIGN YOUR FACE")
  const [direction, setDirection] = useState<Direction>("left")

  function begin(nextMode: Mode) {
    modeRef.current = nextMode
    setMode(nextMode)
    runRef.current = newRun(nextMode)
    setSteps(runRef.current.order)
    setDirection(runRef.current.direction)
    setDone([])
    setActive("detect")
    setSamples(0)
    setDistance(null)
    setMessage(null)
    setPhase("scanning")
  }

  // Status, models and camera, together.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [status] = await Promise.all([
          getLockStatus(sessionToken),
          loadFaceScanner((step) => !cancelled && setLoadingStep(step)),
        ])
        if (cancelled) return
        setLoadingStep("STARTING CAMERA")
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
        }
        if (status.face_locked_until) {
          setPhase("locked")
          setMessage(`Too many failed scans. Locked until ${new Date(status.face_locked_until).toLocaleTimeString()}.`)
        } else if (!status.face_enrolled) {
          setMode("enroll")
          modeRef.current = "enroll"
          setPhase("pin")
        } else {
          begin("unlock")
        }
      } catch (err) {
        if (cancelled) return
        if (err instanceof JarvisAuthError) {
          onSignOut()
          return
        }
        const denied = err instanceof DOMException && err.name === "NotAllowedError"
        setPhase("error")
        setMessage(
          denied
            ? "Camera access is blocked. Allow the camera for this site, then retry."
            : err instanceof DOMException
              ? "No camera could be opened. Check one is connected and free."
              : `The face scanner could not load. ${errorText(err)}`
        )
      }
    })()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken])

  function complete(step: StepId) {
    const run = runRef.current
    if (run.done.has(step)) return
    run.done.add(step)
    setDone(Array.from(run.done))
    const next = run.order.find((s) => !run.done.has(s)) ?? null
    setActive(next)
  }

  function advance(frame: FaceFrame, now: number) {
    const run = runRef.current
    const current = run.order.find((s) => !run.done.has(s))
    if (frame.faces !== 1) {
      run.alignedSince = null
      setPrompt(frame.faces === 0 ? "NO FACE DETECTED" : "ONE FACE ONLY")
      return
    }
    complete("detect")
    const aligned = Math.abs(frame.cx - 0.5) < 0.12 && Math.abs(frame.cy - 0.5) < 0.16 && frame.size > 0.22 && frame.size < 0.7
    if (current === "align") {
      if (!aligned) {
        run.alignedSince = null
        setPrompt(frame.size <= 0.22 ? "MOVE CLOSER" : frame.size >= 0.7 ? "MOVE BACK" : "CENTRE YOUR FACE")
        return
      }
      run.alignedSince ??= now
      setPrompt("HOLD STILL")
      if (now - run.alignedSince > 600) complete("align")
      return
    }
    if (current === "blink") {
      setPrompt("BLINK")
      if (frame.blink < 0.25) run.eyesOpen = true
      if (run.eyesOpen && frame.blink > 0.55) {
        run.blinked = true
        complete("blink")
      }
      return
    }
    if (current === "turn") {
      const want = run.direction === "left" ? -1 : 1
      if (!run.turnedOut) {
        setPrompt(`TURN YOUR HEAD ${run.direction.toUpperCase()}`)
        if (frame.yaw * want > 0.32) run.turnedOut = true
      } else {
        setPrompt("NOW FACE THE CAMERA")
        if (Math.abs(frame.yaw) < 0.15) {
          run.turned = true
          complete("turn")
        }
      }
      return
    }
    if (current === "match") {
      const steady = aligned && Math.abs(frame.yaw) < 0.18 && frame.blink < 0.35
      setPrompt(modeRef.current === "enroll" ? "HOLD STILL · ENROLLING" : "HOLD STILL · SCANNING")
      if (steady && !run.capturing) void capture()
    }
  }

  async function capture() {
    const run = runRef.current
    const video = videoRef.current
    if (!video) return
    run.capturing = true
    try {
      const descriptor = await captureDescriptor(video)
      if (descriptor && run === runRef.current) {
        run.samples.push(descriptor)
        setSamples(run.samples.length)
        const needed = modeRef.current === "enroll" ? ENROLL_SAMPLES : UNLOCK_SAMPLES
        if (run.samples.length >= needed) {
          void verify(run)
          return
        }
      }
    } finally {
      // A short pause between captures, so the samples are not one frame.
      setTimeout(() => {
        run.capturing = false
      }, 220)
    }
  }

  async function verify(run: Run) {
    setPhase("verifying")
    setPrompt(modeRef.current === "enroll" ? "ENROLLING" : "VERIFYING IDENTITY")
    try {
      if (modeRef.current === "enroll") {
        await enrollFace(pinRef.current, run.samples, sessionToken)
        pinRef.current = ""
        setMessage("Face enrolled. Now verify it: follow the prompts.")
        begin("unlock")
        return
      }
      const unlock = await unlockWithFace(
        run.samples,
        { blinked: run.blinked, turned: run.turned },
        sessionToken
      )
      complete("match")
      setDistance(unlock.distance ?? null)
      setPhase("granted")
      setPrompt("ACCESS GRANTED")
      setTimeout(() => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        useLock.getState().setUnlock({ token: unlock.token, expiresAt: unlock.expiresAt, method: unlock.method })
      }, 1100)
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onSignOut()
        return
      }
      const text = errorText(err)
      setMessage(text)
      setPrompt("ACCESS DENIED")
      setPhase(/locked until/i.test(text) ? "locked" : "denied")
      if (modeRef.current === "enroll" && /pin/i.test(text)) {
        pinRef.current = ""
        setPin("")
        setPhase("pin")
      }
    }
  }

  // The overlay: mesh dots, the face oval and eyes as lines, drawn to match
  // the video's object-fit: cover, both mirrored by CSS.
  function draw(frame: FaceFrame) {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const size = canvas.width
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, size, size)
    if (!frame.points) return
    const w = video.videoWidth || 640
    const h = video.videoHeight || 480
    const scale = Math.max(size / w, size / h)
    const ox = (w * scale - size) / 2
    const oy = (h * scale - size) / 2
    const px = (p: { x: number; y: number }) => [p.x * w * scale - ox, p.y * h * scale - oy] as const
    const color = phaseColorRgb()

    ctx.fillStyle = `rgba(${color}, 0.55)`
    for (let i = 0; i < frame.points.length; i += 2) {
      const [x, y] = px(frame.points[i])
      ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6)
    }
    ctx.lineWidth = 1.5
    ctx.strokeStyle = `rgba(${color}, 0.9)`
    ctx.shadowColor = `rgba(${color}, 0.9)`
    ctx.shadowBlur = 8
    for (const path of [FACE_OVAL, LEFT_EYE, RIGHT_EYE]) {
      ctx.beginPath()
      path.forEach((index, i) => {
        const [x, y] = px(frame.points![index])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
    ctx.shadowBlur = 0
  }

  function phaseColorRgb(): string {
    if (phase === "granted") return "0, 255, 136"
    if (phase === "denied" || phase === "locked") return "255, 51, 51"
    return "0, 212, 255"
  }

  // The scan loop: read the face, draw it, move the steps along.
  useEffect(() => {
    if (phase !== "scanning" && phase !== "verifying" && phase !== "granted") return
    let raf = 0
    let lastReadout = 0
    const tick = (now: number) => {
      const video = videoRef.current
      const frame = video ? readFrame(video) : null
      if (frame) {
        draw(frame)
        if (phase === "scanning") advance(frame, now)
        if (now - lastReadout > 100) {
          setReadout(frame)
          lastReadout = now
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const tone =
    phase === "granted"
      ? "var(--success)"
      : phase === "denied" || phase === "locked" || phase === "error"
        ? "var(--error)"
        : "var(--accent)"
  const progress = steps.length ? done.length / steps.length : 0
  const needed = mode === "enroll" ? ENROLL_SAMPLES : UNLOCK_SAMPLES
  const circumference = Math.PI * (RING - 16)

  return (
    <main className="relative flex items-center justify-center overflow-hidden" style={{ height: "100vh" }}>
      <HolographicGrid serious={false} visible />
      <GlobalEffects />

      <div className="relative flex flex-wrap items-center justify-center" style={{ gap: 56 }}>
        {/* Steps */}
        <section className="flex w-[240px] flex-col" style={{ gap: 14 }}>
          <div>
            <div className="t-label" style={{ color: "var(--text-secondary)" }}>
              J.A.R.V.I.S. · SECURE ACCESS
            </div>
            <h1 className="t-header text-glow" style={{ fontSize: 18, color: "var(--accent)", marginTop: 4 }}>
              {mode === "enroll" ? "FACE ENROLMENT" : "BIOMETRIC AUTHENTICATION"}
            </h1>
          </div>
          <ol className="flex flex-col" style={{ gap: 10 }}>
            {steps.map((step) => {
              const state: StepState = done.includes(step)
                ? "done"
                : phase === "denied" && step === "match"
                  ? "failed"
                  : active === step
                    ? "active"
                    : "pending"
              const color =
                state === "done" ? "var(--success)" : state === "failed" ? "var(--error)" : state === "active" ? "var(--accent)" : "var(--text-secondary)"
              return (
                <li key={step} className="flex items-center t-label" style={{ gap: 10, color }}>
                  <span
                    className="inline-flex items-center justify-center rounded-full"
                    style={{ width: 20, height: 20, border: `1px solid ${color}`, boxShadow: state === "active" ? `0 0 10px ${color}` : "none" }}
                  >
                    {state === "done" ? (
                      <CheckIcon size={12} />
                    ) : state === "failed" ? (
                      <XIcon size={12} />
                    ) : state === "active" ? (
                      <motion.span animate={{ opacity: [1, 0.2, 1] }} transition={{ repeat: Infinity, duration: 1.1 }}>
                        <CircleIcon size={8} fill="currentColor" />
                      </motion.span>
                    ) : null}
                  </span>
                  {step === "turn" ? `${STEP_LABEL.turn} ${direction}` : STEP_LABEL[step]}
                  {step === "match" && (phase === "scanning" || phase === "verifying") && active === "match" && (
                    <span style={{ marginLeft: "auto" }}>
                      {samples}/{needed}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
          {message && (
            <p style={{ color: phase === "denied" || phase === "locked" || phase === "error" ? "var(--error)" : "var(--text-secondary)", fontSize: 13, lineHeight: 1.45 }}>
              {message}
            </p>
          )}
          {(phase === "denied" || phase === "error") && (
            <button
              type="button"
              className="btn self-start"
              style={{ height: 32, padding: "0 14px" }}
              onClick={() => (phase === "error" ? window.location.reload() : begin(modeRef.current))}
            >
              <RotateCcwIcon size={14} /> RETRY
            </button>
          )}
          <button type="button" className="t-label self-start" style={{ color: "var(--text-secondary)" }} onClick={onSignOut}>
            SIGN OUT
          </button>
        </section>

        {/* The scanner */}
        <section className="relative" style={{ width: RING, height: RING }}>
          <svg className="absolute inset-0" width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} aria-hidden>
            <motion.circle
              cx={RING / 2}
              cy={RING / 2}
              r={RING / 2 - 2}
              fill="none"
              stroke={tone}
              strokeOpacity={0.35}
              strokeWidth={1}
              strokeDasharray="3 9"
              style={{ transformOrigin: "center" }}
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: phase === "verifying" ? 3 : 18, ease: "linear" }}
            />
            <circle cx={RING / 2} cy={RING / 2} r={(RING - 16) / 2} fill="none" stroke={tone} strokeOpacity={0.15} strokeWidth={3} />
            <circle
              cx={RING / 2}
              cy={RING / 2}
              r={(RING - 16) / 2}
              fill="none"
              stroke={tone}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={`${circumference * progress} ${circumference}`}
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
              style={{ transition: "stroke-dasharray 400ms ease, stroke 300ms", filter: `drop-shadow(0 0 6px ${tone})` }}
            />
            {Array.from({ length: 60 }, (_, i) => {
              const a = (i / 60) * Math.PI * 2
              const r1 = RING / 2 - 26
              const r2 = r1 - (i % 5 === 0 ? 10 : 5)
              return (
                <line
                  key={i}
                  x1={RING / 2 + Math.cos(a) * r1}
                  y1={RING / 2 + Math.sin(a) * r1}
                  x2={RING / 2 + Math.cos(a) * r2}
                  y2={RING / 2 + Math.sin(a) * r2}
                  stroke={tone}
                  strokeOpacity={i / 60 <= progress ? 0.9 : 0.2}
                  strokeWidth={1}
                />
              )
            })}
          </svg>

          <div
            className="absolute overflow-hidden rounded-full"
            style={{ inset: 44, border: `1px solid ${tone}`, boxShadow: `0 0 30px rgba(0,0,0,0.6), inset 0 0 40px rgba(0, 0, 0, 0.6)` }}
          >
            <video
              ref={videoRef}
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
              style={{ transform: "scaleX(-1)", filter: "saturate(0.4) brightness(0.85) contrast(1.1)" }}
            />
            <div className="absolute inset-0" style={{ background: `radial-gradient(circle, transparent 55%, rgba(5,5,8,0.7) 100%)`, mixBlendMode: "multiply" }} />
            <canvas
              ref={canvasRef}
              width={RING - 88}
              height={RING - 88}
              className="absolute inset-0 h-full w-full"
              style={{ transform: "scaleX(-1)" }}
            />
            {(phase === "scanning" || phase === "verifying") && (
              <motion.div
                className="absolute right-0 left-0"
                style={{
                  height: 2,
                  background: `linear-gradient(90deg, transparent, ${tone}, transparent)`,
                  boxShadow: `0 0 14px ${tone}`,
                }}
                animate={{ top: ["8%", "92%", "8%"] }}
                transition={{ repeat: Infinity, duration: phase === "verifying" ? 1.1 : 2.6, ease: "easeInOut" }}
              />
            )}
            {phase === "granted" && (
              <motion.div
                className="absolute inset-0"
                initial={{ opacity: 0.7 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 1 }}
                style={{ background: "rgba(0, 255, 136, 0.35)" }}
              />
            )}
            {phase === "loading" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ gap: 10, color: "var(--accent)" }}>
                <Loader2Icon className="animate-spin" size={26} />
                <span className="t-label">{loadingStep}</span>
              </div>
            )}
          </div>

          {/* Corner brackets */}
          {[0, 1, 2, 3].map((corner) => (
            <span
              key={corner}
              className="absolute"
              style={{
                width: 26,
                height: 26,
                borderColor: tone,
                borderStyle: "solid",
                borderWidth: `${corner < 2 ? 2 : 0}px ${corner % 2 ? 2 : 0}px ${corner >= 2 ? 2 : 0}px ${corner % 2 ? 0 : 2}px`,
                top: corner < 2 ? 30 : undefined,
                bottom: corner >= 2 ? 30 : undefined,
                left: corner % 2 ? undefined : 30,
                right: corner % 2 ? 30 : undefined,
              }}
            />
          ))}

          <div className="absolute right-0 left-0 text-center" style={{ bottom: -46 }}>
            <motion.span
              key={prompt}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="t-header text-glow"
              style={{ fontSize: 15, color: tone, letterSpacing: "0.2em" }}
            >
              {phase === "pin" ? "ENTER PIN TO ENROL" : phase === "locked" ? "LOCKED" : prompt}
            </motion.span>
          </div>
        </section>

        {/* Readouts, or the PIN for enrolment */}
        <section className="flex w-[220px] flex-col t-label" style={{ gap: 12, color: "var(--text-secondary)" }}>
          {phase === "pin" ? (
            <form
              className="flex flex-col"
              style={{ gap: 10 }}
              onSubmit={(e) => {
                e.preventDefault()
                if (!/^\d{4,8}$/.test(pin)) return
                pinRef.current = pin
                begin("enroll")
              }}
            >
              <span>
                No face is enrolled yet. Your PIN authorises enrolling this face.
              </span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="PIN"
                className="t-value"
                style={{
                  height: 40,
                  padding: "0 12px",
                  fontSize: 18,
                  letterSpacing: "0.5em",
                  background: "rgba(10, 14, 26, 0.7)",
                  border: "1px solid rgba(var(--accent-rgb), 0.35)",
                  color: "var(--text-primary)",
                }}
              />
              <button type="submit" className="btn" style={{ height: 34 }} disabled={pin.length < 4}>
                <ScanFaceIcon size={14} /> START ENROLMENT
              </button>
            </form>
          ) : (
            <>
              <Readout label="FACES" value={readout ? String(readout.faces) : "—"} warn={readout ? readout.faces !== 1 : false} />
              <Readout label="EYE" value={readout ? readout.blink.toFixed(2) : "—"} />
              <Readout label="YAW" value={readout ? `${readout.yaw >= 0 ? "+" : ""}${readout.yaw.toFixed(2)}` : "—"} />
              <Readout label="SCALE" value={readout ? readout.size.toFixed(2) : "—"} />
              <Readout
                label="MATCH"
                value={distance !== null ? `${Math.max(0, Math.round((1 - distance) * 100))}%` : phase === "verifying" ? "…" : "—"}
                good={distance !== null}
              />
              <span style={{ lineHeight: 1.5, textTransform: "none", letterSpacing: 0 }}>
                Images stay on this computer. Only face measurements are sent, and the server decides.
              </span>
            </>
          )}
        </section>
      </div>
    </main>
  )
}

function Readout({ label, value, warn, good }: { label: string; value: string; warn?: boolean; good?: boolean }) {
  return (
    <div className="flex items-baseline justify-between" style={{ borderBottom: "1px solid rgba(var(--accent-rgb), 0.12)", paddingBottom: 6 }}>
      <span>{label}</span>
      <span className="t-value" style={{ fontSize: 14, color: warn ? "var(--warning)" : good ? "var(--success)" : "var(--text-primary)" }}>
        {value}
      </span>
    </div>
  )
}
