"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { DeleteIcon, Loader2Icon, LockIcon, UnlockIcon } from "lucide-react"

import { GlobalEffects } from "@/components/hud/global-effects"
import { HolographicGrid } from "@/components/hud/holographic-grid"
import {
  JarvisApiError,
  JarvisAuthError,
  JarvisNetworkError,
  getLockStatus,
  unlockWithPin,
} from "@/lib/jarvis-client"
import { useLock } from "@/lib/lock-state"

// The phone's lock: a four-digit PIN, checked by the server (the PIN is not
// in this page; only its hash is, on the server). Right, and the server
// returns the unlock token the rest of the console runs on; wrong too many
// times, and the server locks the PIN for a while, longer each time.

const LENGTH = 4
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const

type Phase = "idle" | "checking" | "wrong" | "granted" | "locked"

function remaining(until: string): string {
  const ms = new Date(until).getTime() - Date.now()
  if (ms <= 0) return "now"
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`
}

export function PinGate({ sessionToken, onSignOut }: { sessionToken: string; onSignOut: () => void }) {
  const [digits, setDigits] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [message, setMessage] = useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = useState<string | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    getLockStatus(sessionToken)
      .then((status) => {
        if (!status.pin_set) setMessage("No PIN is set on the server yet.")
        if (status.pin_locked_until) {
          setLockedUntil(status.pin_locked_until)
          setPhase("locked")
        }
      })
      .catch((err) => {
        if (err instanceof JarvisAuthError) onSignOut()
      })
  }, [sessionToken, onSignOut])

  // The lockout counts down on screen, and lifts itself.
  useEffect(() => {
    if (phase !== "locked" || !lockedUntil) return
    const id = setInterval(() => {
      if (new Date(lockedUntil).getTime() <= Date.now()) {
        setPhase("idle")
        setLockedUntil(null)
        setMessage(null)
      }
      setTick((t) => t + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [phase, lockedUntil])

  async function submit(pin: string) {
    setPhase("checking")
    setMessage(null)
    try {
      const unlock = await unlockWithPin(pin, sessionToken)
      setPhase("granted")
      navigator.vibrate?.(30)
      setTimeout(() => useLock.getState().setUnlock(unlock), 650)
    } catch (err) {
      setDigits("")
      if (err instanceof JarvisAuthError) {
        onSignOut()
        return
      }
      navigator.vibrate?.([60, 40, 60])
      const text = err instanceof JarvisApiError || err instanceof JarvisNetworkError ? err.message : "Could not check the PIN."
      if (/locked until/i.test(text)) {
        // The server knows when the lockout ends; ask it rather than parse.
        const status = await getLockStatus(sessionToken).catch(() => null)
        setLockedUntil(status?.pin_locked_until ?? null)
        setPhase("locked")
        setMessage("Too many wrong PINs.")
        return
      }
      setPhase("wrong")
      setMessage(text)
    }
  }

  function press(key: (typeof KEYS)[number]) {
    if (phase === "checking" || phase === "granted" || phase === "locked") return
    if (key === "del") {
      setDigits((d) => d.slice(0, -1))
      return
    }
    if (!key) return
    navigator.vibrate?.(8)
    const next = (digits + key).slice(0, LENGTH)
    setDigits(next)
    if (phase === "wrong") setPhase("idle")
    if (next.length === LENGTH) void submit(next)
  }

  const tone =
    phase === "granted" ? "var(--success)" : phase === "wrong" || phase === "locked" ? "var(--error)" : "var(--accent)"

  return (
    <main
      className="relative flex flex-col items-center justify-center px-6"
      style={{ height: "100dvh", gap: 28, paddingBottom: "max(16px, env(safe-area-inset-bottom))", paddingTop: "env(safe-area-inset-top)" }}
    >
      <HolographicGrid serious={false} visible />
      <GlobalEffects />

      <div className="relative flex flex-col items-center" style={{ gap: 10 }}>
        <motion.div
          className="flex items-center justify-center rounded-full"
          style={{ width: 74, height: 74, border: `1px solid ${tone}`, boxShadow: `0 0 24px ${tone}`, color: tone }}
          animate={phase === "checking" ? { rotate: 360 } : { rotate: 0 }}
          transition={phase === "checking" ? { repeat: Infinity, duration: 1.4, ease: "linear" } : { duration: 0.3 }}
        >
          {phase === "granted" ? <UnlockIcon size={28} /> : phase === "checking" ? <Loader2Icon size={28} /> : <LockIcon size={28} />}
        </motion.div>
        <h1 className="t-header text-glow" style={{ fontSize: 18, color: "var(--accent)" }}>
          J.A.R.V.I.S.
        </h1>
        <p className="t-label" style={{ color: phase === "granted" ? "var(--success)" : "var(--text-secondary)" }}>
          {phase === "granted"
            ? "ACCESS GRANTED"
            : phase === "locked"
              ? `LOCKED · ${lockedUntil ? remaining(lockedUntil) : ""}`
              : "ENTER ACCESS CODE"}
        </p>
      </div>

      <motion.div
        className="relative flex"
        style={{ gap: 18 }}
        animate={phase === "wrong" ? { x: [0, -12, 12, -8, 8, -4, 0] } : { x: 0 }}
        transition={{ duration: 0.45 }}
        aria-label={`${digits.length} of ${LENGTH} digits entered`}
      >
        {Array.from({ length: LENGTH }, (_, i) => {
          const filled = i < digits.length || phase === "granted"
          return (
            <span
              key={i}
              className="rounded-full"
              style={{
                width: 16,
                height: 16,
                border: `1.5px solid ${tone}`,
                background: filled ? tone : "transparent",
                boxShadow: filled ? `0 0 12px ${tone}` : "none",
                transition: "background 120ms, box-shadow 120ms",
              }}
            />
          )
        })}
      </motion.div>

      <p className="relative t-label text-center" style={{ minHeight: 16, color: "var(--error)", textTransform: "none", letterSpacing: 0 }}>
        {message}
      </p>

      <div className="relative grid grid-cols-3" style={{ gap: 14 }}>
        {KEYS.map((key, i) =>
          key === "" ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              className="btn btn-circle"
              style={{ width: 72, height: 72, fontSize: key === "del" ? 14 : 24, fontFamily: "var(--font-jetbrains)" }}
              disabled={phase === "checking" || phase === "granted" || phase === "locked"}
              onClick={() => press(key)}
              aria-label={key === "del" ? "Delete" : key}
            >
              {key === "del" ? <DeleteIcon size={20} /> : key}
            </button>
          )
        )}
      </div>

      <button type="button" className="relative t-label" style={{ color: "var(--text-secondary)" }} onClick={onSignOut}>
        SIGN OUT
      </button>
    </main>
  )
}
