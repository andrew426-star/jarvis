"use client"

import { useSyncExternalStore } from "react"

import { applyMode, getMode, getServerMode, subscribeMode } from "@/lib/mode"

// Normal / Serious. The whole palette is two CSS custom properties
// (globals.css), so this flips an attribute on <html> and the entire
// interface sweeps cyan to amber - including the reactor, the gauges and
// the EQ, none of which know this component exists.
//
// useSyncExternalStore rather than useState + useEffect because the
// <html> attribute really is the source of truth here: layout.tsx sets
// it before first paint to avoid a flash, so copying it into React state
// on mount would be a second, lagging copy of something already correct.
export function ModeToggle() {
  const mode = useSyncExternalStore(subscribeMode, getMode, getServerMode)
  const serious = mode === "serious"

  return (
    <button
      type="button"
      onClick={() => applyMode(serious ? "normal" : "serious")}
      aria-pressed={serious}
      aria-label={`Switch to ${serious ? "normal" : "serious"} mode`}
      className="bracket-frame flex items-center gap-2 px-3 py-1.5 transition-colors duration-300 hover:bg-[hsl(var(--hue)_var(--sat)_55%_/_0.08)]"
      style={{ ["--tick" as string]: "6px" }}
    >
      <span
        className="size-1.5 transition-all duration-500"
        style={{
          background: "var(--hud)",
          boxShadow: serious ? "0 0 10px var(--hud)" : "none",
        }}
      />
      <span className="label-hud" style={{ color: "var(--hud)" }}>
        {serious ? "Serious" : "Normal"}
      </span>
    </button>
  )
}
