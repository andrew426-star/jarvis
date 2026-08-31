"use client"

import { useEffect, useRef, useState } from "react"

// Progressive text reveal for the terminal.
//
// Driven by requestAnimationFrame against elapsed time rather than a
// per-character setInterval: a timer per character means hundreds of
// timers for a long reply, and it drifts. This reveals however many
// characters the clock says should be visible, so it stays correct even
// when a frame is dropped.

const CHARS_PER_SECOND = 90

// Long replies would otherwise take a comically long time to appear.
// Past this the reveal speeds up to finish within the cap instead.
const MAX_DURATION_MS = 2600

export function useTypewriter(
  text: string,
  enabled: boolean
): { shown: string; done: boolean } {
  const [count, setCount] = useState(0)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    // Nothing to animate. Deliberately no setState here - the disabled
    // case is derived below instead, so this effect never fires a
    // synchronous render pass just to jump the counter to the end.
    if (!enabled) return

    const startedAt = performance.now()
    const naturalMs = (text.length / CHARS_PER_SECOND) * 1000
    const durationMs = Math.min(naturalMs, MAX_DURATION_MS)

    const tick = (now: number) => {
      const progress = durationMs === 0 ? 1 : (now - startedAt) / durationMs
      if (progress >= 1) {
        setCount(text.length)
        return
      }
      setCount(Math.floor(progress * text.length))
      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [text, enabled])

  if (!enabled) return { shown: text, done: true }
  return { shown: text.slice(0, count), done: count >= text.length }
}
