"use client"

import { useSyncExternalStore } from "react"

// A one-second clock, as an external store rather than useState +
// useEffect.
//
// The wall clock genuinely is external state, and modelling it that way
// removes the setState-in-effect that a state-based clock always needs
// for its first tick. It also gives a correct server snapshot for free:
// the static export has no idea what time it is on the viewer's machine,
// and rendering a build-time clock would be a hydration mismatch on
// every single load.

let now = 0
let timer: number | null = null
const listeners = new Set<() => void>()

function tick() {
  now = Date.now()
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === null) {
    tick()
    timer = window.setInterval(tick, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }
}

// Must return a cached value, not a fresh object, or React re-renders
// forever comparing two different Dates.
function getSnapshot(): number {
  return now
}

function getServerSnapshot(): number {
  return 0
}

/** Epoch milliseconds, or 0 before the first client tick. */
export function useClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
