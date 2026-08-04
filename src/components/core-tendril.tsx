"use client"

import type { CSSProperties } from "react"

interface CoreTendrilProps {
  angle: number
  active: boolean
  prominence: "touched" | "dormant"
  receded: boolean
}

// Screen-space animated line from the core out to a touched chip's
// position — reuses the exact same --slot-angle technique as
// orbital-panel.tsx and the shared --orbit-radius tokens in globals.css,
// so a tendril always lands exactly on its chip with zero new state.
export function CoreTendril({ angle, active, prominence, receded }: CoreTendrilProps) {
  return (
    <div
      aria-hidden
      className="core-tendril"
      data-active={active || undefined}
      data-prominence={prominence}
      data-state={receded ? "receded" : undefined}
      style={{ "--slot-angle": `${angle}deg` } as CSSProperties}
    />
  )
}
