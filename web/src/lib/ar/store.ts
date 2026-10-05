"use client"

import { create } from "zustand"

import { DEFAULT_DESK, type DeskPlacement, type TryOnStatus } from "@/lib/ar/tryon-scene"
import type { Anchor } from "@/lib/workshop/project/types"

// The camera try-on: the open project worn on Andrew, live in his camera
// window. Started from the window's TRY ON button or by Jarvis (his
// project tool's try_on), stopped from either.

interface TryOnState {
  active: boolean
  /** Null: the project's own wear anchor (or the face). */
  anchor: Anchor | null
  mode: "holo" | "solid"
  /** On top of the project's own wear scale, for fitting by eye. */
  scale: number
  /** The other side of the hand, if the tracker picked the wrong one. */
  flip: boolean
  desk: DeskPlacement
  status: TryOnStatus
  detail: string | null
  start: (anchor?: Anchor | null) => void
  stop: () => void
  set: (patch: Partial<Pick<TryOnState, "anchor" | "mode" | "scale" | "flip" | "desk">>) => void
  setStatus: (status: TryOnStatus, detail?: string | null) => void
}

export const useTryOn = create<TryOnState>((set) => ({
  active: false,
  anchor: null,
  mode: "holo",
  scale: 1,
  flip: false,
  desk: { ...DEFAULT_DESK },
  status: "loading",
  detail: null,
  start: (anchor = null) => set({ active: true, anchor, scale: 1, flip: false, status: "loading", detail: null }),
  stop: () => set({ active: false }),
  set: (patch) => set(patch),
  setStatus: (status, detail = null) => set({ status, detail }),
}))
