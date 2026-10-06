"use client"

import { useSyncExternalStore } from "react"

// Which hand gesture does what in the workshop. Pinching is fixed (grab,
// slide, two-handed resize, empty space to orbit) because everything else
// is built on it; the rest is his to assign, and the choice is kept in
// this browser. Mouse and keyboard reach every action directly (see
// KEYS), so nothing here is hands-only.

export type TapAction = "toggle_mode" | "explode" | "snap" | "reset_view" | "none"
export type DragAction = "rotate_item" | "orbit" | "none"

export interface GestureMap {
  /** A quick pinch on an item. */
  pinch_tap: TapAction
  /** Index and middle finger up, held still for half a second. */
  peace: TapAction
  /** A closed fist, moved. */
  fist_drag: DragAction
  /** A fist thrown open, fingers spread. */
  spread: TapAction
}

export const DEFAULT_GESTURES: GestureMap = {
  pinch_tap: "toggle_mode",
  peace: "explode",
  fist_drag: "rotate_item",
  spread: "explode",
}

export const GESTURE_LABELS: Record<keyof GestureMap, string> = {
  pinch_tap: "Quick pinch on a part",
  peace: "Peace sign, held",
  fist_drag: "Fist, moved",
  spread: "Fist thrown open",
}

export const TAP_ACTIONS: { value: TapAction; label: string }[] = [
  { value: "toggle_mode", label: "Hologram / solid" },
  { value: "explode", label: "Exploded view" },
  { value: "snap", label: "Snapping on / off" },
  { value: "reset_view", label: "Reset the view" },
  { value: "none", label: "Nothing" },
]

export const DRAG_ACTIONS: { value: DragAction; label: string }[] = [
  { value: "rotate_item", label: "Rotate the part" },
  { value: "orbit", label: "Orbit the camera" },
  { value: "none", label: "Nothing" },
]

/** The same actions from the keyboard (the workshop's own key handler). */
export const KEYS = { explode: "E", snap: "G", reset_view: "R" } as const

const STORAGE_KEY = "jarvis_workshop_gestures"
const listeners = new Set<() => void>()
let current: GestureMap = DEFAULT_GESTURES
let loaded = false

function load(): GestureMap {
  if (!loaded && typeof window !== "undefined") {
    loaded = true
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<GestureMap>
      const tap = (v: unknown): v is TapAction => TAP_ACTIONS.some((a) => a.value === v)
      const drag = (v: unknown): v is DragAction => DRAG_ACTIONS.some((a) => a.value === v)
      current = {
        pinch_tap: tap(saved.pinch_tap) ? saved.pinch_tap : DEFAULT_GESTURES.pinch_tap,
        peace: tap(saved.peace) ? saved.peace : DEFAULT_GESTURES.peace,
        fist_drag: drag(saved.fist_drag) ? saved.fist_drag : DEFAULT_GESTURES.fist_drag,
        spread: tap(saved.spread) ? saved.spread : DEFAULT_GESTURES.spread,
      }
    } catch {
      // Unreadable or blocked: the defaults.
    }
  }
  return current
}

export function getGestures(): GestureMap {
  return load()
}

export function setGesture<K extends keyof GestureMap>(gesture: K, action: GestureMap[K]) {
  current = { ...load(), [gesture]: action }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Kept for this session only.
  }
  listeners.forEach((listener) => listener())
}

export function resetGestures() {
  current = DEFAULT_GESTURES
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing saved to remove.
  }
  listeners.forEach((listener) => listener())
}

export function useGestures(): GestureMap {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getGestures,
    () => DEFAULT_GESTURES
  )
}
