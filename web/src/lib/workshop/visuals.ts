"use client"

import { create } from "zustand"

// The workshop's visual features, each one switchable so a change can be
// judged against what was there before (the FX menu in the workshop's
// toolbar). Kept in this browser.

export interface Visuals {
  /** Real component models from KiCad's library (else the primitives). */
  realParts: boolean
  /** Wires gathered into looms with zip ties, routed around the parts. */
  looms: boolean
  /** The studio HDRI as the light (else the generated room). */
  hdri: boolean
  /** Ambient occlusion in the contact creases. */
  ao: boolean
  /** Soft contact shadows on the floor under solid parts. */
  contactShadows: boolean
  /** Bloom on the lit things: LEDs, holo edges. */
  bloom: boolean
  /** Lens touches: chromatic fringe, film grain, vignette. */
  lens: boolean
  /** The fresnel / scanline hologram shader (else the plain wireframe). */
  holoShader: boolean
  /** Floating dust and the projector cone. */
  atmosphere: boolean
  /** The floor grid (a faint, radially fading one). */
  grid: boolean
  /** The scanline materialize when a design arrives. */
  materialize: boolean
  /** Leader-line labels on parts. */
  callouts: boolean
}

export const VISUAL_LABELS: Record<keyof Visuals, string> = {
  realParts: "Real parts",
  looms: "Wire looms",
  hdri: "Studio HDRI light",
  ao: "Ambient occlusion",
  contactShadows: "Contact shadows",
  bloom: "Bloom",
  lens: "Lens (fringe, grain, vignette)",
  holoShader: "Hologram shader",
  atmosphere: "Dust and projector",
  grid: "Floor grid",
  materialize: "Materialize",
  callouts: "Callouts",
}

const DEFAULTS: Visuals = {
  realParts: true,
  looms: true,
  hdri: true,
  ao: true,
  contactShadows: true,
  bloom: true,
  lens: true,
  holoShader: true,
  atmosphere: true,
  grid: false,
  materialize: true,
  callouts: true,
}

const KEY = "jarvis_workshop_visuals"

function load(): Visuals {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Visuals>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

interface VisualStore extends Visuals {
  set: (key: keyof Visuals, on: boolean) => void
}

export const useVisuals = create<VisualStore>((set, get) => ({
  ...load(),
  set: (key, on) => {
    set({ [key]: on } as Partial<Visuals>)
    try {
      const state = get()
      const flags = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, state[k as keyof Visuals]]))
      window.localStorage.setItem(KEY, JSON.stringify(flags))
    } catch {}
  },
}))

/** The current flags, outside React. */
export const visuals = (): Visuals => useVisuals.getState()
