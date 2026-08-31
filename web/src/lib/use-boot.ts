"use client"

import { useEffect, useState } from "react"

// The power-on sequence: black, then the grid, then the reactor rings
// drawing one at a time, then the panels sliding in.
//
// Numeric so components can ask `stage >= BootStage.Rings` rather than
// matching a set of string literals - adding a stage later then means
// inserting a number, not auditing every comparison in the tree.
export const BootStage = {
  Black: 0,
  Grid: 1,
  Rings: 2,
  Panels: 3,
  Ready: 4,
} as const

export type BootStage = (typeof BootStage)[keyof typeof BootStage]

// Cumulative milliseconds from mount. Rings gets the longest slice
// because five of them draw in sequence inside it (see arc-reactor.tsx,
// which staggers its own children within this window).
const SCHEDULE: ReadonlyArray<readonly [BootStage, number]> = [
  [BootStage.Grid, 260],
  [BootStage.Rings, 1150],
  [BootStage.Panels, 2600],
  [BootStage.Ready, 3200],
]

export function useBoot(): { stage: BootStage; skip: () => void } {
  const [stage, setStage] = useState<BootStage>(BootStage.Black)

  useEffect(() => {
    const timers = SCHEDULE.map(([next, at]) =>
      window.setTimeout(() => setStage(next), at)
    )

    // Any deliberate input cuts straight to the end. A boot animation is
    // a delight exactly once; someone who has just reloaded for the
    // fourth time debugging something should not have to sit through it.
    const skipNow = () => {
      timers.forEach(window.clearTimeout)
      setStage(BootStage.Ready)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === " ") skipNow()
    }
    window.addEventListener("keydown", onKey)

    return () => {
      timers.forEach(window.clearTimeout)
      window.removeEventListener("keydown", onKey)
    }
  }, [])

  return {
    stage,
    skip: () => setStage(BootStage.Ready),
  }
}
