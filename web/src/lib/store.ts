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

  setMode: (mode: Mode) => void
  toggleMode: () => void
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
  pushLog: (level: LogLevel, message: string) => void
  notify: (kind: Notification["kind"], title: string, description: string) => void
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
          time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
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
