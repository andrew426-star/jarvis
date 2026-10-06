"use client"

import { create } from "zustand"

// Jarvis moving the console's windows into windows of their own, and back
// (the console tool's pop_out / pop_in). Each window that can leave the
// console registers how to do it here while it is mounted
// (components/ui/pop-out.tsx does the moving).
//
// A browser only opens a window on a click, unless the site has been
// allowed pop-ups. His action arrives with the reply, not a click, so
// when the browser says no the request is parked in `useWindowRequest` and
// the console shows a one-click prompt (components/ui/pop-out-prompt.tsx);
// allowing pop-ups for the site makes every later one immediate.

export type WindowTarget = "workshop" | "panel" | "showcase" | "timers"

export const WINDOW_TITLES: Record<WindowTarget, string> = {
  workshop: "Workshop",
  panel: "Data window",
  showcase: "Showcase",
  timers: "Timers",
}

export interface WindowController {
  /** Into a window of its own. False if the browser blocked it. */
  out: () => boolean
  /** Back into the console. */
  in: () => void
  isOut: () => boolean
}

const controllers = new Map<WindowTarget, WindowController>()

export function registerWindow(target: WindowTarget, controller: WindowController) {
  controllers.set(target, controller)
  return () => {
    if (controllers.get(target) === controller) controllers.delete(target)
  }
}

interface WindowRequest {
  /** A pop-out the browser blocked, waiting on his click. */
  waiting: WindowTarget | null
  setWaiting: (target: WindowTarget | null) => void
}

export const useWindowRequest = create<WindowRequest>((set) => ({
  waiting: null,
  setWaiting: (waiting) => set({ waiting }),
}))

/** Pop a window out. Called from a click it always opens; from Jarvis it
 *  may come back "blocked" and wait on the prompt. */
export function popOutWindow(target: WindowTarget): "opened" | "blocked" | "unavailable" {
  const controller = controllers.get(target)
  if (!controller) return "unavailable"
  if (controller.isOut() || controller.out()) {
    if (useWindowRequest.getState().waiting === target) useWindowRequest.getState().setWaiting(null)
    return "opened"
  }
  useWindowRequest.getState().setWaiting(target)
  return "blocked"
}

export function popInWindow(target: WindowTarget) {
  if (useWindowRequest.getState().waiting === target) useWindowRequest.getState().setWaiting(null)
  const controller = controllers.get(target)
  if (controller?.isOut()) controller.in()
}

/** Which windows are out, for CONSOLE_STATE. */
export function poppedOutWindows(): WindowTarget[] {
  return [...controllers.entries()].filter(([, c]) => c.isOut()).map(([target]) => target)
}
