"use client"

// Moments the 3D core reacts to. A tiny event bus rather than store state:
// these are instants (a pulse, a flash), not values anything re-renders on,
// and the core consumes them inside its own render loop.

export type CoreEvent =
  | { kind: "send" }
  | { kind: "reply" }
  | { kind: "tool"; name: string }
  | { kind: "error" }
  | { kind: "click"; x: number; y: number }

type Listener = (event: CoreEvent) => void

const listeners = new Set<Listener>()

export function emitCore(event: CoreEvent) {
  listeners.forEach((listener) => listener(event))
}

export function onCore(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The console's accent colour as a hex number, for three.js materials.
 *  Read live so mode switches recolour 3D scenes without a remount. */
export function accentHex(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
  const parsed = Number.parseInt(raw.replace("#", ""), 16)
  return Number.isNaN(parsed) ? 0x00d4ff : parsed
}

export function cssHex(variable: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  const parsed = Number.parseInt(raw.replace("#", ""), 16)
  return Number.isNaN(parsed) ? fallback : parsed
}
