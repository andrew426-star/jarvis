"use client"

import { XIcon } from "lucide-react"

import {
  DRAG_ACTIONS,
  GESTURE_LABELS,
  TAP_ACTIONS,
  resetGestures,
  setGesture,
  useGestures,
  type GestureMap,
} from "@/lib/workshop/gestures"

// The workshop's gesture map (lib/workshop/gestures.ts), top right under
// the header. Choices are buttons rather than dropdowns so a hand can set
// them with an air tap too (a script cannot open a native select); they
// are kept in this browser.
/** `right`: clear of the project panel when it is open. */
export function GestureSettings({ onClose, right = 12 }: { onClose: () => void; right?: number }) {
  const gestures = useGestures()

  function row<K extends keyof GestureMap>(gesture: K, options: { value: GestureMap[K]; label: string }[]) {
    return (
      <div className="flex flex-col" style={{ gap: 4 }} role="group" aria-label={GESTURE_LABELS[gesture]}>
        <span className="t-label" style={{ color: "var(--text-secondary)" }}>
          {GESTURE_LABELS[gesture]}
        </span>
        <div className="flex flex-wrap" style={{ gap: 4 }}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="btn"
              data-active={gestures[gesture] === option.value}
              aria-pressed={gestures[gesture] === option.value}
              onClick={() => setGesture(gesture, option.value)}
              style={{ padding: "2px 8px", fontSize: 11 }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <aside
      className="holo-card flex flex-col"
      // Inline, not the `absolute` class: .holo-card sets position: relative.
      style={{ position: "absolute", top: 12, right, width: 290, zIndex: 3 }}
      aria-label="Gesture mapping"
    >
      <header className="holo-card-header">
        <span className="t-label">GESTURES</span>
        <button type="button" className="btn" style={{ width: 20, height: 20, padding: 0 }} onClick={onClose} aria-label="Close">
          <XIcon size={11} className="mx-auto" />
        </button>
      </header>
      <div className="holo-card-body flex flex-col" style={{ gap: "var(--sp-3)", maxHeight: "none" }}>
        {row("pinch_tap", TAP_ACTIONS)}
        {row("peace", TAP_ACTIONS)}
        {row("fist_drag", DRAG_ACTIONS)}
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>
          Pinching always grabs and slides, pinching empty space orbits, and two hands resize. The mouse does
          everything too: right- or shift-drag turns a part, E explodes, G snaps, R resets the view.
        </p>
        <button type="button" className="btn" style={{ padding: "4px 10px" }} onClick={resetGestures}>
          RESET TO DEFAULTS
        </button>
      </div>
    </aside>
  )
}
