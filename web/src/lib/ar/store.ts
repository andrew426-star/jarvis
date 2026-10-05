"use client"

import { create } from "zustand"

import { DEFAULT_DESK, type DeskPlacement, type TryOnStatus } from "@/lib/ar/tryon-scene"
import type { Anchor } from "@/lib/workshop/project/types"

// The camera try-on: the open project worn on Andrew, live in his camera
// window. Started from the window's TRY ON button or by Jarvis (his
// project tool's try_on), stopped from either; its actions fired by
// gesture, by their buttons, or by Jarvis (try_on with fire).

interface TryOnState {
  active: boolean
  /** Null: the project's own wear anchor (or the face). */
  anchor: Anchor | null
  mode: "holo" | "solid"
  /** On top of the project's own wear scale, for fitting by eye. */
  scale: number
  /** The other side of the body: the other hand's back, the other shoulder or arm. */
  flip: boolean
  desk: DeskPlacement
  /** Scene depth from the depth model: occlusion and surface placement. */
  depth: boolean
  depthText: string | null
  depthReady: boolean
  status: TryOnStatus
  detail: string | null
  /** The worn project's actions, and whether gestures set them off. */
  actions: { name: string; cue: string }[]
  gestures: boolean
  /** A request to fire: bumped `seq`, so the same action can fire twice. */
  fire: { name: string | null; seq: number; at: number }
  lastFired: { name: string; at: number } | null
  /** The action that just fired, for its button to light a moment. */
  flash: string | null
  start: (anchor?: Anchor | null) => void
  stop: () => void
  set: (patch: Partial<Pick<TryOnState, "anchor" | "mode" | "scale" | "flip" | "desk" | "depth" | "gestures">>) => void
  setDepthStatus: (text: string | null, ready: boolean) => void
  setStatus: (status: TryOnStatus, detail?: string | null) => void
  setActions: (actions: TryOnState["actions"]) => void
  press: (name?: string | null) => void
  fired: (name: string) => void
}

export const useTryOn = create<TryOnState>((set) => ({
  active: false,
  anchor: null,
  mode: "solid",
  scale: 1,
  flip: false,
  desk: { ...DEFAULT_DESK },
  depth: false,
  depthText: null,
  depthReady: false,
  status: "loading",
  detail: null,
  actions: [],
  gestures: true,
  fire: { name: null, seq: 0, at: 0 },
  lastFired: null,
  flash: null,
  start: (anchor = null) => set({ active: true, anchor, scale: 1, flip: false, status: "loading", detail: null, lastFired: null }),
  stop: () => set({ active: false, actions: [] }),
  set: (patch) => set(patch),
  setStatus: (status, detail = null) => set({ status, detail }),
  setDepthStatus: (depthText, depthReady) => set({ depthText, depthReady }),
  setActions: (actions) => set({ actions }),
  press: (name = null) => set((s) => ({ fire: { name, seq: s.fire.seq + 1, at: Date.now() } })),
  fired: (name) => {
    const at = Date.now()
    set({ lastFired: { name, at }, flash: name })
    setTimeout(() => set((s) => (s.lastFired?.at === at ? { flash: null } : {})), 600)
  },
}))
