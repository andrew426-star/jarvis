"use client"

import type { CSSProperties, ReactNode } from "react"

interface OrbitalPanelProps {
  angle: number
  prominence: "touched" | "dormant"
  receded: boolean
  focused: boolean
  onClick: () => void
  children: ReactNode
}

// Pure angle -> CSS-var function, not a hook — three fixed slot angles,
// nothing to measure at runtime. --slot-cos/--slot-sin feed
// .orbital-slot's transform in globals.css, which does the actual
// positioning relative to the shared parent's center (the core sits at
// that same center) — no ResizeObserver, no JS-measured position.
function orbitVars(angleDeg: number): CSSProperties {
  const rad = (angleDeg * Math.PI) / 180
  return { "--slot-cos": Math.cos(rad), "--slot-sin": Math.sin(rad) } as CSSProperties
}

// The chip stays in its orbit slot even while focused — the full panel
// content lives in a separate reading-pane region (jarvis-stage.tsx), not
// here. Clicking a focused chip again defocuses it.
export function OrbitalPanel({ angle, prominence, receded, focused, onClick, children }: OrbitalPanelProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`orbital-slot text-left ${focused ? "rounded-xl ring-1 ring-primary/50" : ""}`}
      data-prominence={prominence}
      data-state={receded ? "receded" : undefined}
      style={orbitVars(angle)}
    >
      {children}
    </button>
  )
}
