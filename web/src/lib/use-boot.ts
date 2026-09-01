"use client"

import { useEffect, useState } from "react"

// The power-on sequence, on the spec's schedule.
//
// Exposed as a flat set of booleans plus a ring counter rather than a
// single enum: several steps overlap in the timeline, and encoding that
// as ordered stages would force components to compare against numbers
// that no longer mean anything once a step is inserted.
export interface BootState {
  /** The single line that draws across the centre first. */
  line: boolean
  grid: boolean
  /** 0-3, how many reactor rings have appeared, inner to outer. */
  rings: number
  statusRing: boolean
  chrome: boolean
  streams: boolean
  chat: boolean
  visualizer: boolean
  done: boolean
}

const INITIAL: BootState = {
  line: false,
  grid: false,
  rings: -1,
  statusRing: false,
  chrome: false,
  streams: false,
  chat: false,
  visualizer: false,
  done: false,
}

const READY: BootState = {
  line: true,
  grid: true,
  rings: 3,
  statusRing: true,
  chrome: true,
  streams: true,
  chat: true,
  visualizer: true,
  done: true,
}

// [delay from mount, patch]. Matches the spec's timings; the four ring
// steps inside the 900-1500ms window are what "rings appear one by one"
// means in practice.
const SCHEDULE: [number, Partial<BootState>][] = [
  [100, { line: true }],
  [400, { grid: true }],
  [900, { rings: 0 }],
  [1050, { rings: 1 }],
  [1200, { rings: 2 }],
  [1350, { rings: 3 }],
  [1500, { statusRing: true }],
  [1900, { chrome: true }],
  [2200, { streams: true }],
  [2500, { chat: true }],
  [3500, { visualizer: true, done: true }],
]

export function useBoot(): BootState {
  const [state, setState] = useState<BootState>(INITIAL)

  useEffect(() => {
    const timers = SCHEDULE.map(([at, patch]) =>
      window.setTimeout(() => setState((prev) => ({ ...prev, ...patch })), at)
    )

    // Any deliberate keypress cuts to the end. A boot animation is a
    // delight exactly once; someone reloading for the fourth time while
    // debugging should not have to sit through it again.
    const skip = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== " ") return
      timers.forEach(window.clearTimeout)
      setState(READY)
    }
    window.addEventListener("keydown", skip)

    return () => {
      timers.forEach(window.clearTimeout)
      window.removeEventListener("keydown", skip)
    }
  }, [])

  return state
}
