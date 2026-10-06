"use client"

import { XIcon } from "lucide-react"

import type { SectionState } from "@/lib/workshop/scene"

// The workshop's analysis panels, top right under the header like the FX
// and gesture panels: the cross-section's controls, and what the fit check
// found. Both are buttons and a range, so a hand can work them too.

const AXES: { value: SectionState["axis"]; label: string; title: string }[] = [
  { value: 0, label: "X", title: "Cut across the design's X axis" },
  { value: 1, label: "Y", title: "Cut across the design's Y axis" },
  { value: 2, label: "Z", title: "Cut level: across the design's Z (up) axis" },
]

export function SectionPanel({
  state,
  onChange,
  onClose,
  right = 12,
  top = 12,
}: {
  state: SectionState
  onChange: (state: SectionState) => void
  onClose: () => void
  right?: number
  top?: number
}) {
  return (
    <aside
      data-keepout
      className="holo-card flex flex-col"
      // Inline, not the `absolute` class: .holo-card sets position: relative.
      style={{ position: "absolute", top, right, width: 270, zIndex: 3 }}
      aria-label="Cross-section"
    >
      <header className="holo-card-header">
        <span className="t-label">SECTION</span>
        <button type="button" className="btn" style={{ width: 20, height: 20, padding: 0 }} onClick={onClose} aria-label="Close">
          <XIcon size={11} className="mx-auto" />
        </button>
      </header>
      <div className="holo-card-body flex flex-col" style={{ gap: "var(--sp-3)", maxHeight: "none" }}>
        <button
          type="button"
          className="btn flex items-center justify-between"
          data-active={state.on}
          aria-pressed={state.on}
          onClick={() => onChange({ ...state, on: !state.on })}
          style={{ height: 30, padding: "0 10px", fontSize: 11 }}
        >
          <span>CUT THE DESIGN</span>
          <span style={{ color: state.on ? "var(--success)" : "var(--text-secondary)" }}>{state.on ? "ON" : "OFF"}</span>
        </button>
        <div className="flex flex-col" style={{ gap: 4 }} role="group" aria-label="Cut across">
          <span className="t-label" style={{ color: "var(--text-secondary)" }}>
            Across
          </span>
          <div className="flex" style={{ gap: 4 }}>
            {AXES.map((axis) => (
              <button
                key={axis.value}
                type="button"
                className="btn flex-1"
                data-active={state.axis === axis.value}
                aria-pressed={state.axis === axis.value}
                onClick={() => onChange({ ...state, on: true, axis: axis.value })}
                title={axis.title}
                style={{ height: 28, fontSize: 11 }}
              >
                {axis.label}
              </button>
            ))}
            <button
              type="button"
              className="btn flex-1"
              data-active={state.flip}
              aria-pressed={state.flip}
              onClick={() => onChange({ ...state, on: true, flip: !state.flip })}
              title="Keep the other side of the cut"
              style={{ height: 28, fontSize: 11 }}
            >
              FLIP
            </button>
          </div>
        </div>
        <label className="flex flex-col" style={{ gap: 4 }}>
          <span className="t-label flex justify-between" style={{ color: "var(--text-secondary)" }}>
            <span>Through</span>
            <span>{Math.round(state.offset * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(state.offset * 100)}
            onChange={(event) => onChange({ ...state, on: true, offset: Number(event.target.value) / 100 })}
            style={{ accentColor: "var(--accent)" }}
          />
        </label>
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>
          Drag the plane on the stage to move it. Cut faces show in orange.
        </p>
      </div>
    </aside>
  )
}

export interface FitResult {
  running: boolean
  checked: boolean
  clashes: { a: string; b: string; depth: number; count: number }[]
}

export function FitPanel({ result, onClose, right = 12, top = 12 }: { result: FitResult; onClose: () => void; right?: number; top?: number }) {
  const clear = result.checked && !result.clashes.length
  return (
    <aside
      data-keepout
      className="holo-card flex flex-col"
      style={{ position: "absolute", top, right, width: 300, zIndex: 3, maxHeight: "calc(100% - 24px)" }}
      aria-label="Fit check"
      aria-live="polite"
    >
      <header className="holo-card-header">
        <span className="t-label">FIT CHECK</span>
        <button type="button" className="btn" style={{ width: 20, height: 20, padding: 0 }} onClick={onClose} aria-label="Close and clear">
          <XIcon size={11} className="mx-auto" />
        </button>
      </header>
      <div className="holo-card-body flex flex-col" style={{ gap: "var(--sp-2)", maxHeight: "none", overflowY: "auto" }}>
        {result.running ? (
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>Checking every pair of parts…</p>
        ) : !result.checked ? (
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>Open a project on the stage to check how its parts fit.</p>
        ) : clear ? (
          <p style={{ margin: 0, color: "var(--success)" }}>No parts run into each other.</p>
        ) : (
          <>
            <p style={{ margin: 0, color: "var(--warning)" }}>
              {(() => {
                const total = result.clashes.reduce((sum, c) => sum + c.count, 0)
                return `${total} clash${total > 1 ? "es" : ""}, lit red on the stage:`
              })()}
            </p>
            {result.clashes.map((clash, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between"
                style={{ gap: 8, padding: "4px 0", borderTop: "1px solid rgba(var(--accent-rgb), 0.15)" }}
              >
                <span className="wrap-words" style={{ minWidth: 0 }}>
                  {clash.a} <span style={{ color: "var(--text-secondary)" }}>into</span> {clash.b}
                  {clash.count > 1 && <span style={{ color: "var(--text-secondary)" }}> ×{clash.count}</span>}
                </span>
                <span className="shrink-0" style={{ color: "var(--error)", fontFamily: "var(--font-jetbrains), monospace" }}>
                  {clash.count > 1 ? "≤ " : ""}
                  {clash.depth.toFixed(1)} mm
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  )
}
