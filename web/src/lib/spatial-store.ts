"use client"

import { create } from "zustand"

// State for the camera, hand tracking and the holograms they act on. Kept
// out of lib/store.ts: that store drives the HUD's instruments, and none
// of this should re-render them when a hologram moves at 30fps.

export type HandsStatus = "off" | "loading" | "tracking" | "error"

export interface Hologram {
  id: string
  /** "note" is a pinned reply, "vision" is what Jarvis saw through the camera. */
  kind: "note" | "vision"
  title: string
  body: string
  /** Small JPEG data URL of the frame, vision holograms only. */
  image?: string
  /** Top-left corner in viewport pixels. */
  x: number
  y: number
  scale: number
  /** Stacking order; the last one touched sits on top. */
  z: number
}

interface SpatialState {
  cameraOn: boolean
  handsStatus: HandsStatus
  holograms: Hologram[]
  /** Ids held by a hand or the mouse right now. */
  grabbed: string[]
  /** Id under a hand cursor, for the hover glow. */
  hovered: string | null

  setCameraOn: (on: boolean) => void
  setHandsStatus: (status: HandsStatus) => void
  addHologram: (input: Pick<Hologram, "kind" | "title" | "body" | "image">) => void
  moveHologram: (id: string, dx: number, dy: number) => void
  scaleHologram: (id: string, scale: number) => void
  removeHologram: (id: string) => void
  grab: (id: string) => void
  release: (id: string) => void
  setHovered: (id: string | null) => void
}

const STORAGE_KEY = "jarvis_holograms"
// Vision holograms carry a thumbnail, so the cap is what keeps the saved
// set comfortably inside localStorage's few megabytes.
const MAX_HOLOGRAMS = 12
export const HOLOGRAM_WIDTH = 280
export const MIN_SCALE = 0.5
export const MAX_SCALE = 2.5

function load(): Hologram[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Hologram[]) : []
  } catch {
    return []
  }
}

function save(holograms: Hologram[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holograms))
  } catch {
    // Storage full or blocked: the holograms still live for this session.
  }
}

function topZ(holograms: Hologram[]): number {
  return holograms.reduce((max, h) => Math.max(max, h.z), 0) + 1
}

export const useSpatial = create<SpatialState>((set, get) => ({
  cameraOn: false,
  handsStatus: "off",
  holograms: load(),
  grabbed: [],
  hovered: null,

  setCameraOn: (cameraOn) => set({ cameraOn }),
  setHandsStatus: (handsStatus) => set({ handsStatus }),

  addHologram: (input) => {
    const existing = get().holograms
    // New ones cascade from the upper middle so a burst of them fans out
    // instead of stacking exactly on top of each other.
    const offset = (existing.length % 6) * 28
    const hologram: Hologram = {
      ...input,
      id: crypto.randomUUID(),
      x: Math.max(16, window.innerWidth / 2 - HOLOGRAM_WIDTH / 2 + offset),
      y: 96 + offset,
      scale: 1,
      z: topZ(existing),
    }
    const holograms = [...existing, hologram].slice(-MAX_HOLOGRAMS)
    set({ holograms })
    save(holograms)
  },

  moveHologram: (id, dx, dy) => {
    set({
      holograms: get().holograms.map((h) => (h.id === id ? { ...h, x: h.x + dx, y: h.y + dy } : h)),
    })
  },

  scaleHologram: (id, scale) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
    set({ holograms: get().holograms.map((h) => (h.id === id ? { ...h, scale: clamped } : h)) })
  },

  removeHologram: (id) => {
    const holograms = get().holograms.filter((h) => h.id !== id)
    set({
      holograms,
      grabbed: get().grabbed.filter((g) => g !== id),
      hovered: get().hovered === id ? null : get().hovered,
    })
    save(holograms)
  },

  grab: (id) => {
    const { holograms, grabbed } = get()
    const z = topZ(holograms)
    set({
      grabbed: grabbed.includes(id) ? grabbed : [...grabbed, id],
      holograms: holograms.map((h) => (h.id === id ? { ...h, z } : h)),
    })
  },

  // Positions are saved on release rather than on every move, which
  // would write localStorage at frame rate for the length of a drag.
  release: (id) => {
    set({ grabbed: get().grabbed.filter((g) => g !== id) })
    save(get().holograms)
  },

  setHovered: (hovered) => {
    if (get().hovered !== hovered) set({ hovered })
  },
}))
