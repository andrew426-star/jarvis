"use client"

import { flushSync } from "react-dom"
import { create } from "zustand"

import type { ConnectionInfo } from "@/lib/jarvis-client"
import { centralTime } from "@/lib/time"

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

// Every gauge on this HUD reads something real.
//
// The v2 spec asked for CPU/MEM/TEMP/PWR/SHLD, but a browser cannot see
// its host's processor, temperature or power draw, and a gauge that
// invents its own number is decoration wearing an instrument's clothes.
// These six are what this app genuinely observes about itself and its
// backend.

/** Backend reachability, inferred from real traffic rather than polled.
 *  Polling /health would keep a free Render instance awake around the
 *  clock and burn the monthly instance-hour quota for a green dot. */
export type LinkState = "up" | "down" | "idle"

export interface Signals {
  link: LinkState
  /** Round trip of the last API call, ms. Null until one runs. */
  latencyMs: number | null
  /** Recent latencies, oldest first, for the sparkline. */
  latencyHistory: number[]
  /** Assistant turns held in the backend's rolling context window. */
  turns: number
  /** Distinct tools the agent has invoked this session. */
  toolsUsed: string[]
  /** Rendering health, sampled from real frame times. */
  fps: number
  /** Live mic / narration level, 0-1. */
  voice: number
}

// Mirrors REDIS_SESSION_WINDOW_TURNS in app/core/config.py. If that is
// raised, follow it here - the gauge would otherwise sit pinned at full
// and quietly stop meaning anything.
export const CONTEXT_WINDOW_TURNS = 10

const LATENCY_HISTORY = 24

interface JarvisState {
  mode: Mode
  status: AgentStatus
  listening: boolean
  settingsOpen: boolean
  gridVisible: boolean
  // null = the comms terminal is showing. A tab selects a data panel
  // into the same region, and clicking the active tab returns to chat.
  activeTab: TabKey | null
  signals: Signals
  logs: LogEntry[]
  notifications: Notification[]
  /** null until GET /status has answered once. */
  connections: ConnectionInfo[] | null

  setMode: (mode: Mode) => void
  /** `origin` is where the mode wipe starts, usually the button clicked. */
  toggleMode: (origin?: { x: number; y: number }) => void
  setStatus: (status: AgentStatus) => void
  setListening: (listening: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setGridVisible: (visible: boolean) => void
  setActiveTab: (tab: TabKey | null) => void
  setLatency: (ms: number) => void
  setLinkDown: () => void
  setTurns: (turns: number) => void
  addToolsUsed: (names: string[]) => void
  setFps: (fps: number) => void
  setVoice: (level: number) => void
  setConnections: (connections: ConnectionInfo[]) => void
  pushLog: (level: LogLevel, message: string) => void
  notify: (kind: Notification["kind"], title: string, description: string) => void
  dismissNotification: (id: string) => void
}

const MAX_LOGS = 15
const MAX_NOTIFICATIONS = 4

export function clockTime(date = new Date()): string {
  return centralTime(date)
}

// Mode switch as one wipe instead of a 500ms colour fade. The fade could
// only move colours: the background gradients, scanlines, vignette and
// corner radius cannot be transitioned, so they snapped while the rest
// faded. A view transition snapshots the old console and reveals the new
// one through a circle growing from `origin`, so everything changes in
// the same motion. Browsers without the API, and reduced motion, get the
// plain switch.
const WIPE_MS = 750

function playModeWipe(apply: () => void, origin?: { x: number; y: number }) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  if (typeof document === "undefined" || !document.startViewTransition || reduced) {
    apply()
    return
  }

  const root = document.documentElement
  const x = origin?.x ?? window.innerWidth / 2
  const y = origin?.y ?? 0
  // Far enough to clear the farthest corner from the origin.
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))

  // Per-element colour transitions would still be mid-fade when the new
  // snapshot is taken, so they are paused for the length of the wipe.
  root.classList.add("mode-switching")
  const transition = document.startViewTransition(() => {
    // Flushed so mode-driven React state (grid and stream opacity) is
    // already in the new snapshot rather than changing after it.
    flushSync(apply)
  })
  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: WIPE_MS,
          easing: "cubic-bezier(0.65, 0, 0.35, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      )
    })
    .catch(() => {
      // Transition skipped (tab hidden, another one started); the mode
      // itself has still been applied by the update callback.
    })
  transition.finished.finally(() => root.classList.remove("mode-switching"))
}

export const useJarvis = create<JarvisState>((set, get) => ({
  mode: "normal",
  status: "idle",
  listening: false,
  settingsOpen: false,
  // Read once at startup rather than defaulting blind, so the choice
  // survives a reload like the mode does.
  gridVisible: typeof window === "undefined" || localStorage.getItem("jarvis_grid") !== "off",
  activeTab: null,
  signals: {
    link: "idle",
    latencyMs: null,
    latencyHistory: [],
    turns: 0,
    toolsUsed: [],
    fps: 60,
    voice: 0,
  },

  // Both start empty and fill from real events. Seeding them with
  // invented entries ("Backup Complete", "Firmware update v2.4.1") would
  // make the panel look busy while telling you nothing about Jarvis.
  logs: [],
  notifications: [],
  connections: null,

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
  toggleMode: (origin) => {
    const next = get().mode === "normal" ? "serious" : "normal"
    playModeWipe(() => get().setMode(next), origin)
  },

  setStatus: (status) => set({ status }),
  setListening: (listening) => set({ listening }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  setGridVisible: (gridVisible) => {
    try {
      localStorage.setItem("jarvis_grid", gridVisible ? "on" : "off")
    } catch {
      // Preference cannot be persisted; it still applies this session.
    }
    set({ gridVisible })
  },
  setActiveTab: (activeTab) => set({ activeTab }),

  setLatency: (ms) =>
    set((state) => {
      const rounded = Math.round(ms)
      return {
        signals: {
          ...state.signals,
          link: "up",
          latencyMs: rounded,
          latencyHistory: [...state.signals.latencyHistory, rounded].slice(-LATENCY_HISTORY),
        },
      }
    }),

  setLinkDown: () => set((state) => ({ signals: { ...state.signals, link: "down" } })),

  setTurns: (turns) => set((state) => ({ signals: { ...state.signals, turns } })),

  addToolsUsed: (names) =>
    set((state) => ({
      signals: {
        ...state.signals,
        toolsUsed: Array.from(new Set([...state.signals.toolsUsed, ...names])),
      },
    })),

  setFps: (fps) => set((state) => ({ signals: { ...state.signals, fps } })),

  setVoice: (voice) => set((state) => ({ signals: { ...state.signals, voice } })),

  setConnections: (connections) => set({ connections }),

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

  notify: (kind, title, description) =>
    set((state) => ({
      notifications: [
        {
          id: crypto.randomUUID(),
          time: centralTime(new Date(), false),
          title,
          description,
          kind,
        },
        ...state.notifications,
      ].slice(0, MAX_NOTIFICATIONS),
    })),

  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id).slice(0, MAX_NOTIFICATIONS),
    })),
}))
