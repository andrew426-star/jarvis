"use client"

// Perspective grid floor. One of the three budgeted infinite
// animations, and it is a pure transform so it stays on the compositor.
// Opacity is driven by mode: 4% normal, 18% serious. Wider apart than
// the spec's 5/10 so the two modes cannot be mistaken for each other.
export function HolographicGrid({ serious, visible }: { serious: boolean; visible: boolean }) {
  if (!visible) return null

  return (
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex: 0 }}
      aria-hidden
    >
      <div
        className="holo-grid"
        style={{ opacity: serious ? 0.18 : 0.04, transition: "opacity 500ms ease" }}
      />
    </div>
  )
}
