"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { AppWindowIcon, MinimizeIcon, PauseIcon, PlayIcon, RotateCcwIcon, TimerIcon, WatchIcon, XIcon } from "lucide-react"

import { PopOutPortal, usePopOut } from "@/components/ui/pop-out"
import { clock, elapsed, parseDuration, remaining, useTimers, type Timer } from "@/lib/timer-store"

// The timer window: his countdowns and stopwatches, big enough to read
// across the bench. Presets, a custom length ("25", "1:30", "1h 15m"),
// pause, reset; a finished countdown flashes until dismissed. Like the
// other windows it can leave the console for a window of its own - a
// timer on the second monitor while he works.

const PRESETS = [1, 5, 10, 25]

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [active])
  return now
}

function Row({ t, now }: { t: Timer; now: number }) {
  const { pause, resume, reset, remove } = useTimers.getState()
  const running = t.startedAt !== null
  const shown = t.kind === "countdown" ? remaining(t, now) : elapsed(t, now)
  const fraction = t.kind === "countdown" ? 1 - shown / t.duration : 0
  const btn = { width: 28, height: 28, padding: 0 }
  return (
    <div
      className="flex flex-col"
      style={{
        gap: 6,
        padding: "var(--sp-2) var(--sp-3)",
        border: `1px solid ${t.done ? "var(--warning)" : "rgba(var(--accent-rgb), 0.25)"}`,
        borderRadius: "var(--radius)",
        background: t.done ? "rgba(255, 170, 40, 0.08)" : "rgba(0, 0, 0, 0.3)",
        animation: t.done ? "dot-pulse 1s ease-in-out infinite" : undefined,
      }}
    >
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <span className="t-label truncate-1" style={{ color: t.done ? "var(--warning)" : "var(--accent)" }}>
          {t.kind === "stopwatch" ? "STOPWATCH · " : ""}
          {t.label.toUpperCase()}
        </span>
        <span className="flex shrink-0" style={{ gap: 4 }}>
          {!t.done && (
            <button type="button" className="btn" style={btn} onClick={() => (running ? pause(t.id) : resume(t.id))} aria-label={running ? "Pause" : "Resume"}>
              {running ? <PauseIcon size={13} className="mx-auto" /> : <PlayIcon size={13} className="mx-auto" />}
            </button>
          )}
          <button type="button" className="btn" style={btn} onClick={() => reset(t.id)} aria-label="Reset">
            <RotateCcwIcon size={13} className="mx-auto" />
          </button>
          <button type="button" className="btn" style={btn} onClick={() => remove(t.id)} aria-label={t.done ? "Dismiss" : "Remove"}>
            <XIcon size={13} className="mx-auto" />
          </button>
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          fontSize: 40,
          lineHeight: 1,
          letterSpacing: 2,
          color: t.done ? "var(--warning)" : running ? "var(--text-primary)" : "var(--text-secondary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {t.done ? "DONE" : clock(shown, t.kind === "stopwatch")}
      </span>
      {t.kind === "countdown" && (
        <div style={{ height: 3, background: "rgba(var(--accent-rgb), 0.15)" }}>
          <div style={{ height: "100%", width: `${Math.min(100, fraction * 100)}%`, background: t.done ? "var(--warning)" : "var(--accent)", transition: "width 100ms linear" }} />
        </div>
      )}
    </div>
  )
}

function Body() {
  const timers = useTimers((s) => s.timers)
  const { start, stopwatch } = useTimers.getState()
  const now = useNow(timers.some((t) => t.startedAt !== null || t.done))
  const [text, setText] = useState("")
  const [label, setLabel] = useState("")
  const seconds = parseDuration(text)
  const input = { background: "rgba(0,0,0,0.45)", border: "1px solid rgba(var(--accent-rgb), 0.35)", color: "var(--text-primary)", padding: "4px 8px", borderRadius: "var(--radius)", userSelect: "text" as const }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" style={{ padding: "var(--sp-3)", gap: "var(--sp-2)" }}>
      {timers.length === 0 && <p className="t-time" style={{ margin: "var(--sp-2) 0" }}>No timers. Start one below, or ask Jarvis.</p>}
      {timers.map((t) => (
        <Row key={t.id} t={t} now={now} />
      ))}
      <div className="flex flex-wrap" style={{ gap: 4, marginTop: "var(--sp-1)" }}>
        {PRESETS.map((m) => (
          <button key={m} type="button" className="btn" style={{ padding: "3px 10px" }} onClick={() => start(m * 60, label || undefined)}>
            {m} MIN
          </button>
        ))}
        <button type="button" className="btn flex items-center" style={{ gap: 4, padding: "3px 10px" }} onClick={() => stopwatch(label || undefined)}>
          <WatchIcon size={12} /> STOPWATCH
        </button>
      </div>
      <form
        className="flex"
        style={{ gap: 4 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (!seconds) return
          start(seconds, label || undefined)
          setText("")
          setLabel("")
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="25 · 1:30 · 1h 15m" aria-label="Timer length" style={{ ...input, width: 120 }} />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" aria-label="Timer label" style={{ ...input, flex: 1, minWidth: 0 }} />
        <button type="submit" className="btn" style={{ padding: "3px 10px" }} disabled={!seconds}>
          START
        </button>
      </form>
    </div>
  )
}

export function TimerWindow() {
  const open = useTimers((s) => s.open)
  const setOpen = useTimers((s) => s.setOpen)
  const sectionRef = useRef<HTMLElement>(null)
  const popOut = usePopOut("timers", useCallback(() => setOpen(false), [setOpen]))
  const popped = !!popOut.root

  useEffect(() => {
    if (!open && popped) popOut.close()
  }, [open, popped, popOut])

  const header = (
    <header
      className="relative flex shrink-0 items-center justify-between overflow-hidden"
      style={{ padding: "var(--sp-2) var(--sp-3)", gap: "var(--sp-2)", borderBottom: "1px solid rgba(var(--accent-rgb), 0.2)" }}
    >
      <div className="bar-sweep" />
      <span className="t-header flex items-center" style={{ gap: 8, color: "var(--accent)" }}>
        <TimerIcon size={14} /> TIMERS
      </span>
      <span className="flex shrink-0" style={{ gap: 4 }}>
        <button
          type="button"
          className="btn"
          style={{ width: 26, height: 26, padding: 0 }}
          onClick={() => (popped ? popOut.close() : popOut.open("Timers", sectionRef.current?.getBoundingClientRect()))}
          aria-label={popped ? "Back into the console" : "Open in its own window"}
          title={popped ? "Back into the console" : "Open in its own window (another monitor)"}
        >
          {popped ? <MinimizeIcon size={13} className="mx-auto" /> : <AppWindowIcon size={13} className="mx-auto" />}
        </button>
        <button type="button" className="btn" style={{ width: 26, height: 26, padding: 0 }} onClick={() => setOpen(false)} aria-label="Close timers" title="Close (timers keep running)">
          <XIcon size={14} className="mx-auto" />
        </button>
      </span>
    </header>
  )

  if (open && popOut.root) {
    return (
      <PopOutPortal root={popOut.root}>
        {header}
        <Body />
      </PopOutPortal>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.section
          key="timers"
          ref={sectionRef}
          role="dialog"
          aria-label="Timers"
          className="card glow-std fixed flex flex-col"
          style={{ top: 72, right: 16, width: 340, maxHeight: "calc(100vh - 48px - 56px - 48px)", zIndex: 44, background: "rgba(5, 7, 14, 0.95)", borderColor: "rgba(var(--accent-rgb), 0.5)" }}
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {header}
          <Body />
        </motion.section>
      )}
    </AnimatePresence>
  )
}
