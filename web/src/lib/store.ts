"use client"

import { create } from "zustand"

export type Mode = "normal" | "serious"
export type AgentStatus = "idle" | "listening" | "speaking" | "thinking"
export type TabKey = "markets" | "intel" | "assets"
export type LogLevel = "OK" | "WARN" | "ERR" | "NONE"

export interface LogEntry {
  id: string
  time: string
  level: LogLevel
  /** Kept short on purpose - the right panel is 220px wide. */
  message: string
}

export interface Notification {
  id: string
  time: string
  title: string
  description: string
  kind: "info" | "success" | "warning"
}

// Ranges straight from the spec. Four of these six cannot be measured
// from a browser - a page cannot see its host's CPU, temperature, power
// draw or a shield that does not exist - so they are simulated within
// these bounds. LATENCY is the exception: it is a real measurement of
// this app's own API calls, fed in from jarvis-client.
const RANGES = {
  cpu: [18, 32],
  mem: [48, 62],
  net: [65, 95],
  temp: [42, 52],
  pwr: [85, 98],
  procCount: [142, 178],
  disk: [45, 70],
  fps: [58, 60],
} as const

function between([lo, hi]: readonly [number, number]): number {
  return Math.round(lo + Math.random() * (hi - lo))
}

export interface Metrics {
  cpu: number
  mem: number
  net: number
  temp: number
  pwr: number
  shld: number
  procCount: number
  disk: number
  fps: number
  /** Real round trip of the last API call, in ms. Null until one runs. */
  latencyMs: number | null
}

function rollMetrics(): Omit<Metrics, "latencyMs"> {
  return {
    cpu: between(RANGES.cpu),
    mem: between(RANGES.mem),
    net: between(RANGES.net),
    temp: between(RANGES.temp),
    pwr: between(RANGES.pwr),
    shld: 100,
    procCount: between(RANGES.procCount),
    disk: between(RANGES.disk),
    fps: between(RANGES.fps),
  }
}

interface JarvisState {
  mode: Mode
  status: AgentStatus
  listening: boolean
  settingsOpen: boolean
  // null = the comms terminal is showing. A tab selects a data panel
  // into the same region, and clicking the active tab returns to chat.
  activeTab: TabKey | null
  metrics: Metrics
  logs: LogEntry[]
  notifications: Notification[]

  setMode: (mode: Mode) => void
  toggleMode: () => void
  setStatus: (status: AgentStatus) => void
  setListening: (listening: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setActiveTab: (tab: TabKey | null) => void
  rerollMetrics: () => void
  setLatency: (ms: number) => void
  pushLog: (level: LogLevel, message: string) => void
  dismissNotification: (id: string) => void
}

const MAX_LOGS = 15
const MAX_NOTIFICATIONS = 4

export function clockTime(date = new Date()): string {
  return date.toLocaleTimeString("en-GB", { hour12: false })
}

export const useJarvis = create<JarvisState>((set, get) => ({
  mode: "normal",
  status: "idle",
  listening: false,
  settingsOpen: false,
  activeTab: null,
  metrics: { ...rollMetrics(), latencyMs: null },

  // Seeded so the panel is never empty on first paint. Every message is
  // under 38 characters, which is what fits a 220px panel at 11px mono
  // with 12px padding - the constraint that produced "SSION 0/10" when
  // it was not respected.
  logs: [
    { id: "s1", time: "00:00:04", level: "OK", message: "Render pipeline active" },
    { id: "s2", time: "00:00:03", level: "OK", message: "Voice module ready" },
    { id: "s3", time: "00:00:02", level: "OK", message: "Telemetry online" },
    { id: "s4", time: "00:00:01", level: "OK", message: "Interface initialised" },
  ],

  notifications: [
    {
      id: "n1",
      time: "12:00",
      title: "Morning Briefing",
      description: "3 meetings, 12 emails, 2 tasks due today",
      kind: "info",
    },
    {
      id: "n2",
      time: "11:45",
      title: "Backup Complete",
      description: "System backup saved to local storage",
      kind: "success",
    },
    {
      id: "n3",
      time: "10:30",
      title: "Update Available",
      description: "Firmware update v2.4.1 ready to install",
      kind: "warning",
    },
  ],

  setMode: (mode) => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("serious", mode === "serious")
      try {
        localStorage.setItem("jarvis_mode", mode)
      } catch {
        // Preference cannot be persisted; it still applies this session.
      }
    }
    set({ mode })
  },

  // Delegates to setMode so the DOM class, localStorage and React
  // state can never drift apart - there is one place that writes them.
  toggleMode: () => {
    get().setMode(get().mode === "normal" ? "serious" : "normal")
  },

  setStatus: (status) => set({ status }),
  setListening: (listening) => set({ listening }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setActiveTab: (activeTab) => set({ activeTab }),

  rerollMetrics: () =>
    set((state) => ({ metrics: { ...rollMetrics(), latencyMs: state.metrics.latencyMs } })),

  setLatency: (ms) =>
    set((state) => ({ metrics: { ...state.metrics, latencyMs: Math.round(ms) } })),

  pushLog: (level, message) =>
    set((state) => ({
      logs: [
        {
          id: crypto.randomUUID(),
          time: clockTime(),
          level,
          // Hard cap rather than trusting callers. The panel truncates
          // with CSS too, but a log line should read as a log line, not
          // as a sentence that ran out of room.
          message: message.length > 38 ? `${message.slice(0, 37)}…` : message,
        },
        ...state.logs,
      ].slice(0, MAX_LOGS),
    })),

  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id).slice(0, MAX_NOTIFICATIONS),
    })),
}))
