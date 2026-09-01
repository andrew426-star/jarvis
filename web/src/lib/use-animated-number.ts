"use client"

import { useEffect, useRef, useState } from "react"

// Counts a displayed number toward its target instead of snapping.
//
// Driven by requestAnimationFrame against elapsed time rather than a
// per-step interval: an interval drifts, and it keeps firing after the
// value has settled. This stops on its own when it arrives.
export function useAnimatedNumber(target: number, durationMs = 600): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const from = fromRef.current
    if (from === target) return

    const startedAt = performance.now()

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs)
      // easeOutCubic - fast start, gentle settle, so a jump to a new
      // reading reads as an instrument moving rather than a value swap.
      const eased = 1 - Math.pow(1 - progress, 3)
      const next = from + (target - from) * eased
      setValue(next)
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      fromRef.current = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs])

  return value
}
