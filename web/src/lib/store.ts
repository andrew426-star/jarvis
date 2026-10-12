"use client"

import { create } from "zustand"

import type { ConnectionInfo } from "@/lib/jarvis-client"
import { playModeTransition } from "@/lib/mode-fx"
import { useSpatial } from "@/lib/spatial-store"
import { centralTime } from "@/lib/time"

export type Mode = "normal" | "serious"
export type AgentStatus = "idle" | "listening" | "speaking" | "thinking"
/** One console, two AIs, each with his own apps. Jarvis: everything about
 *  Andrew and Kivaro AI. Ultron (serious mode): the engineering side - his
 *  directive, the fleet of builds, the bench, and the workshop. Neither
 *  shows the other's; asking for one hands the console over. */
export type JarvisTab = "markets" | "intel" | "assets" | "notes" | "inbox"
export type UltronTab = "directive" | "legion" | "bench"
export type TabKey = JarvisTab | UltronTab

export const JARVIS_TABS: { key: JarvisTab; label: string }[] = [
  { key: "markets", label: "Markets" },
  { key: "intel", label: "Intel" },
  { key: "assets", label: "Assets" },
  { key: "notes", label: "Notes" },
  { key: "inbox", label: "Inbox" },
]
export const ULTRON_TABS: { key: UltronTab; label: string; code: string }[] = [
  { key: "directive", label: "Directive", code: "U-01" },
  { key: "legion", label: "Legion", code: "U-02" },
  { key: "bench", label: "Bench", code: "U-03" },
]

export function tabsFor(mode: Mode): { key: TabKey; label: string; code?: string }[] {
  return mode === "serious" ? ULTRON_TABS : JARVIS_TABS
}

/** Whose app a tab is. */
export function ownerOf(tab: TabKey): Mode {
  return ULTRON_TABS.some((t) => t.key === tab) ? "serious" : "normal"
}
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
  /** Exchanges held in the backend's rolling context window, as the
   *  backend reports them (not counted from the chat on screen). */
  turns: number
  /** Size of that window, also from the backend. */
  contextWindow: number
  /** Distinct tools the agent has invoked this session. */
  toolsUsed: string[]
  /** Rendering health, sampled from real frame times. */
  fps: number
  /** Live mic / narration level, 0-1. */
  voice: number
}

// REDIS_SESSION_WINDOW_TURNS's default in app/core/config.py. Only a
// placeholder until the backend's first answer, which carries the real
// window size, so raising it there no longer needs a change here.
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
  /** An app asked for while the console was the other AI's: it opens once
   *  the hand-over finishes. */
  pendingTab: TabKey | null
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
  setContext: (turns: number, contextWindow: number) => void
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

function readStoredMode(): Mode {
  if (typeof window === "undefined") return "normal"
  try {
    return localStorage.getItem("jarvis_mode") === "serious" ? "serious" : "normal"
  } catch {
    return "normal"
  }
}

export const useJarvis = create<JarvisState>((set, get) => ({
  // Read at startup like gridVisible below. layout.tsx already puts the
  // serious class on <html> before first paint; defaulting to "normal"
  // here left the store disagreeing with the screen after every reload
  // in serious mode (wrong toggle label, normal grid, normal ambience).
  mode: readStoredMode(),
  status: "idle",
  listening: false,
  settingsOpen: false,
  // Read once at startup rather than defaulting blind, so the choice
  // survives a reload like the mode does.
  gridVisible: typeof window === "undefined" || localStorage.getItem("jarvis_grid") !== "off",
  activeTab: null,
  pendingTab: null,
  signals: {
    link: "idle",
    latencyMs: null,
    latencyHistory: [],
    turns: 0,
    contextWindow: CONTEXT_WINDOW_TURNS,
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
    // Each AI's apps are his alone: the other's close as the console
    // changes hands, and the workshop is Ultron's.
    const { activeTab, pendingTab } = get()
    const keep = activeTab && ownerOf(activeTab) === mode ? activeTab : null
    const next = pendingTab && ownerOf(pendingTab) === mode ? pendingTab : keep
    if (mode === "normal") {
      useSpatial.getState().setWorkshopOpen(false)
      void import("@/lib/ar/store").then(({ useTryOn }) => useTryOn.getState().active && useTryOn.getState().stop())
    }
    set({ mode, activeTab: next, pendingTab: null })
  },

  // Delegates to setMode so the DOM class, localStorage and React
  // state can never drift apart - there is one place that writes them.
  toggleMode: (origin) => {
    const next = get().mode === "normal" ? "serious" : "normal"
    void playModeTransition(next, () => get().setMode(next), origin)
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
  setActiveTab: (activeTab) => {
    // The other AI's app: hand the console over, then open it.
    if (activeTab && ownerOf(activeTab) !== get().mode) {
      set({ pendingTab: activeTab })
      get().toggleMode()
      return
    }
    set({ activeTab })
  },

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

  setContext: (turns, contextWindow) =>
    set((state) => ({ signals: { ...state.signals, turns, contextWindow } })),

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
