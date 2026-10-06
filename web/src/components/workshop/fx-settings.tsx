"use client"

import { XIcon } from "lucide-react"

import { useVisuals, VISUAL_LABELS, type Visuals } from "@/lib/workshop/visuals"

// The workshop's visual features, each one on or off (lib/workshop/
// visuals.ts), so any of them can be judged against the look before it.
// Top right under the header, like the gesture map; kept in this browser.

/** The features that are in so far, in the order they are listed. */
const SHOWN: (keyof Visuals)[] = [
  "realParts",
  "looms",
  "holoShader",
  "hdri",
  "ao",
  "contactShadows",
  "bloom",
  "lens",
  "atmosphere",
  "grid",
  "materialize",
  "callouts",
]

/** `right`: clear of the project panel when it is open. */
export function FxSettings({ onClose, right = 12, top = 12 }: { onClose: () => void; right?: number; top?: number }) {
  const flags = useVisuals()

  return (
    <aside
      data-keepout
      className="holo-card flex flex-col"
      // Inline, not the `absolute` class: .holo-card sets position: relative.
      style={{ position: "absolute", top, right, width: 270, zIndex: 3 }}
      aria-label="Visual features"
    >
      <header className="holo-card-header">
        <span className="t-label">FX</span>
        <button type="button" className="btn" style={{ width: 20, height: 20, padding: 0 }} onClick={onClose} aria-label="Close">
          <XIcon size={11} className="mx-auto" />
        </button>
      </header>
      <div className="holo-card-body flex flex-col" style={{ gap: "var(--sp-2)", maxHeight: "none" }}>
        {SHOWN.map((key) => (
          <button
            key={key}
            type="button"
            className="btn flex items-center justify-between"
            data-active={flags[key]}
            aria-pressed={flags[key]}
            onClick={() => flags.set(key, !flags[key])}
            style={{ height: 30, padding: "0 10px", fontSize: 11 }}
          >
            <span className="truncate-1">{VISUAL_LABELS[key].toUpperCase()}</span>
            <span style={{ color: flags[key] ? "var(--success)" : "var(--text-secondary)" }}>{flags[key] ? "ON" : "OFF"}</span>
          </button>
        ))}
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>
          Switch any of these off to compare with how the workshop looked before it.
        </p>
      </div>
    </aside>
  )
}
