"use client"

import { create } from "zustand"

import { sfx } from "@/lib/sfx"
import { useJarvis } from "@/lib/store"

// Andrew's timers: countdowns ("ten minutes for the print to cool") and
// stopwatches, set from the timer window or by Jarvis (console tool,
// timer_start / timer_stop), shown in the timer window - in the console or
// out in a window of its own. They keep running across a reload (saved in
// this browser) and a finished countdown chimes until it is dismissed.

export interface Timer {
  id: string
  label: string
  kind: "countdown" | "stopwatch"
  /** countdown: its length, ms. */
  duration: number
  /** Time run before the current stretch, ms. */
  base: number
  /** When the current stretch started (epoch ms); null while paused. */
  startedAt: number | null
  /** A countdown that has reached zero and not been dismissed. */
  done: boolean
}

const KEY = "jarvis_timers"
const MAX_TIMERS = 12
/** A finished countdown chimes this often, for at most a minute. */
const CHIME_EVERY_MS = 4000
const CHIME_FOR_MS = 60_000

export function elapsed(t: Timer, now = Date.now()): number {
  return t.base + (t.startedAt === null ? 0 : now - t.startedAt)
}

export function remaining(t: Timer, now = Date.now()): number {
  return Math.max(0, t.duration - elapsed(t, now))
}

/** 1:05:09, 4:07, 0:09 - and tenths under ten seconds on a stopwatch. */
export function clock(ms: number, tenths = false): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const base = h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`
  return tenths && !h && m < 1 ? `${base}.${Math.floor((ms % 1000) / 100)}` : base
}

/** "90", "1:30", "1h 30m", "25m", "45s" -> seconds; null if unreadable. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60) // a bare number is minutes
  const parts = t.split(":").map(Number)
  if (parts.length > 1 && parts.every((n) => Number.isFinite(n))) return parts.reduce((s, n) => s * 60 + n, 0)
  let seconds = 0
  let matched = false
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)/g)) {
    matched = true
    const n = Number(m[1])
    seconds += m[2].startsWith("h") ? n * 3600 : m[2].startsWith("m") ? n * 60 : n
  }
  return matched ? Math.round(seconds) : null
}

interface TimerState {
  timers: Timer[]
  open: boolean
  setOpen: (open: boolean) => void
  /** Start a countdown of `seconds`. */
  start: (seconds: number, label?: string) => string
  stopwatch: (label?: string) => string
  pause: (id: string) => void
  resume: (id: string) => void
  reset: (id: string) => void
  /** Remove it (a finished one: dismiss it). */
  remove: (id: string) => void
  /** Stop timers by label (or all) - Jarvis's timer_stop. */
  stop: (label?: string) => number
}

function load(): Timer[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Timer[]).slice(0, MAX_TIMERS) : []
  } catch {
    return []
  }
}

const id = () => Math.random().toString(36).slice(2, 10)

export const useTimers = create<TimerState>((set, get) => ({
  timers: typeof window === "undefined" ? [] : load(),
  open: false,
  setOpen: (open) => set({ open }),
  start: (seconds, label) => {
    const timer: Timer = {
      id: id(),
      label: label?.trim() || `${clock(seconds * 1000)} timer`,
      kind: "countdown",
      duration: Math.max(1, Math.round(seconds)) * 1000,
      base: 0,
      startedAt: Date.now(),
      done: false,
    }
    set((s) => ({ timers: [...s.timers, timer].slice(-MAX_TIMERS), open: true }))
    watch()
    return timer.id
  },
  stopwatch: (label) => {
    const timer: Timer = { id: id(), label: label?.trim() || "Stopwatch", kind: "stopwatch", duration: 0, base: 0, startedAt: Date.now(), done: false }
    set((s) => ({ timers: [...s.timers, timer].slice(-MAX_TIMERS), open: true }))
    watch()
    return timer.id
  },
  pause: (tid) =>
    set((s) => ({ timers: s.timers.map((t) => (t.id === tid && t.startedAt !== null ? { ...t, base: elapsed(t), startedAt: null } : t)) })),
  resume: (tid) => {
    set((s) => ({ timers: s.timers.map((t) => (t.id === tid && t.startedAt === null && !t.done ? { ...t, startedAt: Date.now() } : t)) }))
    watch()
  },
  reset: (tid) => set((s) => ({ timers: s.timers.map((t) => (t.id === tid ? { ...t, base: 0, startedAt: null, done: false } : t)) })),
  remove: (tid) => set((s) => ({ timers: s.timers.filter((t) => t.id !== tid) })),
  stop: (label) => {
    const wanted = label?.trim().toLowerCase()
    const before = get().timers.length
    const timers = wanted ? get().timers.filter((t) => !t.label.toLowerCase().includes(wanted)) : []
    set({ timers })
    return before - timers.length
  },
}))

// Saved as they change, so they survive a reload.
if (typeof window !== "undefined") {
  useTimers.subscribe((s) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s.timers))
    } catch {
      // Storage blocked: they last the session.
    }
  })
}

// --- finishing ----------------------------------------------------------------------

let watcher = 0
const chimes = new Map<string, number>()

function notifyDone(t: Timer) {
  useJarvis.getState().notify("info", "Timer done", t.label)
  try {
    if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("J.A.R.V.I.S. timer", { body: `${t.label} is done.` })
  } catch {}
}

/** Check the countdowns twice a second while any are running or ringing. */
function watch() {
  if (watcher || typeof window === "undefined") return
  // Ask once, so a finished timer can reach him while the console is hidden.
  try {
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission()
  } catch {}
  watcher = window.setInterval(() => {
    const now = Date.now()
    const { timers } = useTimers.getState()
    let changed = false
    const next = timers.map((t) => {
      if (t.kind !== "countdown" || t.done || t.startedAt === null || elapsed(t, now) < t.duration) return t
      changed = true
      chimes.set(t.id, now)
      sfx.alarm()
      notifyDone(t)
      return { ...t, base: t.duration, startedAt: null, done: true }
    })
    if (changed) useTimers.setState({ timers: next, open: true })
    // Keep chiming the finished ones until dismissed (for a minute at most).
    for (const t of next) {
      const since = chimes.get(t.id)
      if (!t.done || since === undefined) continue
      if (now - since > CHIME_FOR_MS) chimes.delete(t.id)
      else if ((now - since) % CHIME_EVERY_MS < 500 && now - since > 400) sfx.alarm()
    }
    for (const key of chimes.keys()) if (!next.some((t) => t.id === key && t.done)) chimes.delete(key)
    if (!next.some((t) => t.startedAt !== null || chimes.has(t.id))) {
      clearInterval(watcher)
      watcher = 0
    }
  }, 500)
}

// Timers restored from a reload keep counting.
if (typeof window !== "undefined" && useTimers.getState().timers.some((t) => t.startedAt !== null)) watch()

/** What is running, for Jarvis. */
export function timerState() {
  const now = Date.now()
  return useTimers.getState().timers.map((t) => ({
    label: t.label,
    kind: t.kind,
    state: t.done ? "done" : t.startedAt === null ? "paused" : "running",
    [t.kind === "countdown" ? "remaining" : "elapsed"]: clock(t.kind === "countdown" ? remaining(t, now) : elapsed(t, now)),
  }))
}
