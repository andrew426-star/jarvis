"use client"

import type { WatchLevel } from "@/lib/jarvis-client"
import { sfx } from "@/lib/sfx"
import { showcaseState, useShowcase } from "@/lib/showcase-store"
import { useSpatial } from "@/lib/spatial-store"
import { useJarvis, type TabKey } from "@/lib/store"
import type { GeneratedModel } from "@/lib/workshop/models"
import type { ItemMode } from "@/lib/workshop/scene"
import { useTryOn } from "@/lib/ar/store"
import { timerState, useTimers } from "@/lib/timer-store"
import { findMaterial } from "@/lib/workshop/lab/catalog"
import { labState, useLab } from "@/lib/workshop/lab/store"
import { TESTS, type LabTest } from "@/lib/workshop/lab/tests"
import { startCamera } from "@/lib/camera"
import { projectState, useProject } from "@/lib/workshop/project/store"
import type { Anchor, Project, Report } from "@/lib/workshop/project/types"
import { applyInputs, setSimSpeed, startSim, stopSim } from "@/lib/workshop/sim/controller"
import { popInWindow, popOutWindow, poppedOutWindows, type WindowTarget } from "@/lib/window-control"

const PANEL_TABS = new Set(["markets", "intel", "assets", "notes", "inbox"])

// Jarvis operating the console. His `console` and `workshop` tools return a
// list of actions (app/tools/console_control.py); this carries them out,
// in order, as his reply arrives. It is also where the console reports its
// state back to him with every message, so he knows what is open before he
// acts.

export type ConsoleAction = { action: string; target?: string; seconds?: number; label?: string }
export type WorkshopAction = {
  action: string
  target?: string
  mode?: "holo" | "solid"
  model?: GeneratedModel
  name?: string
  code?: string
  notes?: string[]
  prompt?: string
  /** project_load: the project and the server's report on it. */
  project?: Project
  report?: Report
  /** sim: start or stop, inputs to set, speed (0.1-1). */
  run?: boolean
  inputs?: Record<string, unknown>
  speed?: number
  /** try_on: where to wear it. */
  anchor?: Anchor
  /** try_on: an action to set off (its name), once it is on. */
  fire?: string
  /** material_test: materials (ids or names), the test, its settings. */
  materials?: string[]
  test?: string
  height?: number
  max_temp?: number
}

/** What the Workshop registers while its scene is up. */
export interface WorkshopController {
  build: (model: GeneratedModel) => void
  discard: (target: string) => void
  setMode: (target: string, mode: ItemMode) => void
  clear: () => void
  items: () => { name: string; mode: ItemMode }[]
  scad: (name: string, code: string, notes: string[]) => void
  exportStl: (target?: string) => void
  render: (prompt?: string) => void
}

// The last OpenSCAD compile error, reported back to Jarvis with the next
// message (consoleState) so "fix it" has something to go on.
let lastScadError: { name: string; error: string } | null = null

export function reportScadResult(name: string, error: string | null) {
  lastScadError = error ? { name, error: error.slice(0, 1500) } : null
}

/** What only the console shell can do (camera, hands, standby). */
export interface ConsoleHost {
  setCamera: (on: boolean) => Promise<void>
  setHands: (on: boolean) => Promise<void>
  setWatch: (level: WatchLevel | null) => Promise<void>
  snoozeWatch: () => void
  closeConsole: () => void
}

let workshop: WorkshopController | null = null
// Workshop actions that arrived before its scene was ready (he opened it
// and filled it in the same breath); played once it registers.
let pending: WorkshopAction[] = []

export function registerWorkshop(controller: WorkshopController | null) {
  workshop = controller
  if (controller && pending.length) {
    const queued = pending
    pending = []
    queued.forEach(runWorkshopAction)
  }
}

function runWorkshopAction(step: WorkshopAction) {
  // Projects live in their own store, not the scene, so they need not wait
  // for it; the scene picks the project up when it registers.
  if (step.action === "project_load" && step.project) {
    useProject.getState().load(step.project, step.report ?? null)
    return
  }
  if (step.action === "try_on") {
    // The try-on is worn in the camera window: bring the camera up first.
    void startCamera()
      .then(() => {
        useSpatial.getState().setCameraOn(true)
        const tryOn = useTryOn.getState()
        // Already on: keep it as it is and just fire.
        if (!tryOn.active || !step.fire) tryOn.start((step.target as Anchor | undefined) ?? step.anchor ?? null)
        if (step.fire) useTryOn.getState().press(step.fire)
      })
      .catch(() => useJarvis.getState().notify("warning", "Try-on", "The camera could not start."))
    return
  }
  if (step.action === "material_test") {
    // The lab is an overlay with its own scene: it needs no stage.
    const lab = useLab.getState()
    const ids = (step.materials ?? []).map((name) => findMaterial(name)?.id).filter((id): id is string => !!id)
    if (ids.length) lab.setMaterials(ids)
    if (step.test && (TESTS as readonly string[]).includes(step.test)) lab.setTest(step.test as LabTest)
    if (step.height) lab.setParams({ dropHeight: Math.min(3, Math.max(0.1, step.height)) })
    if (step.max_temp) lab.setParams({ maxTemp: Math.min(1200, Math.max(100, step.max_temp)) })
    lab.setOpen(true)
    useLab.getState().start()
    return
  }
  if (step.action === "gallery") {
    useProject.getState().setGalleryOpen(true)
    return
  }
  if (step.action === "project_close") {
    stopSim()
    useProject.getState().close()
    return
  }
  if (step.action === "sim") {
    if (step.speed) setSimSpeed(step.speed)
    if (step.inputs) applyInputs(step.inputs)
    if (step.run === false) stopSim()
    else {
      useProject.getState().setTab("sim")
      startSim()
    }
    return
  }
  if (!workshop) {
    pending.push(step)
    return
  }
  switch (step.action) {
    case "build":
      if (step.model) workshop.build(step.model)
      break
    case "discard":
      workshop.discard(step.target ?? "last")
      break
    case "set_mode":
      workshop.setMode(step.target ?? "all", step.mode === "solid" ? "solid" : "wire")
      break
    case "clear":
      workshop.clear()
      break
    case "scad":
      if (step.code) workshop.scad(step.name ?? "Part", step.code, step.notes ?? [])
      break
    case "export_stl":
      workshop.exportStl(step.target)
      break
    case "render":
      workshop.render(step.prompt)
      break
  }
}

export function runWorkshopActions(actions: WorkshopAction[]) {
  // The workshop opens itself for any of these; its scene loads
  // asynchronously, so actions wait in `pending` until it registers.
  if (!useSpatial.getState().workshopOpen) {
    useJarvis.getState().setActiveTab(null)
    useSpatial.getState().setWorkshopOpen(true)
  }
  actions.forEach(runWorkshopAction)
}

export async function runConsoleActions(actions: ConsoleAction[], host: ConsoleHost) {
  const jarvis = useJarvis.getState()
  const spatial = useSpatial.getState()
  for (const { action, target, seconds, label } of actions) {
    switch (action) {
      case "timer_start":
        if (target === "stopwatch") useTimers.getState().stopwatch(label)
        else if (seconds) useTimers.getState().start(seconds, label)
        break
      case "timer_stop":
        useTimers.getState().stop(target || undefined)
        break
      case "open_timers":
        useTimers.getState().setOpen(true)
        break
      case "close_timers":
        useTimers.getState().setOpen(false)
        break
      case "open_panel":
        spatial.setWorkshopOpen(false)
        jarvis.setActiveTab((target as TabKey) ?? null)
        break
      case "close_panel":
        jarvis.setActiveTab(null)
        break
      case "open_workshop":
        jarvis.setActiveTab(null)
        spatial.setWorkshopOpen(true)
        break
      case "close_workshop":
        spatial.setWorkshopOpen(false)
        break
      case "camera_on":
        await host.setCamera(true)
        break
      case "camera_off":
        await host.setCamera(false)
        break
      case "hands_on":
        await host.setHands(true)
        break
      case "hands_off":
        await host.setHands(false)
        break
      case "watch_on":
        await host.setWatch(target === "quiet" || target === "coach" ? target : "normal")
        break
      case "watch_off":
        await host.setWatch(null)
        break
      case "close_showcase":
        useShowcase.getState().close()
        break
      case "watch_snooze":
        host.snoozeWatch()
        break
      case "set_mode":
        // Through the toggle, so his switch gets the same glitch and sound
        // as a click.
        if ((target === "serious" || target === "normal") && useJarvis.getState().mode !== target) {
          useJarvis.getState().toggleMode()
        }
        break
      case "mute":
        sfx.setMuted(true)
        break
      case "unmute":
        sfx.setMuted(false)
        break
      case "open_settings":
        jarvis.setSettingsOpen(true)
        break
      case "close_settings":
        jarvis.setSettingsOpen(false)
        break
      case "clear_holograms":
        spatial.clearHolograms()
        break
      case "close_console":
        host.closeConsole()
        break
      case "pop_out": {
        // A panel opens in the data window first; the others open
        // themselves (lib/window-control.ts).
        let windowTarget = target as WindowTarget
        if (target && PANEL_TABS.has(target)) {
          spatial.setWorkshopOpen(false)
          jarvis.setActiveTab(target as TabKey)
          windowTarget = "panel"
        }
        // One tick, so a window opened just now has registered - or, for
        // the workshop before its chunk has loaded, until it has.
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (windowTarget === "workshop") spatial.setWorkshopOpen(true)
        let outcome = popOutWindow(windowTarget)
        for (let wait = 0; outcome === "unavailable" && wait < 40; wait += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          outcome = popOutWindow(windowTarget)
        }
        if (outcome === "blocked") jarvis.pushLog("WARN", "Pop-up held by the browser; waiting on a click")
        break
      }
      case "pop_in":
        popInWindow(target && PANEL_TABS.has(target) ? "panel" : (target as WindowTarget))
        break
    }
  }
}

/** The console as Jarvis sees it, sent with every message. */
export function consoleState() {
  const jarvis = useJarvis.getState()
  const spatial = useSpatial.getState()
  return {
    mode: jarvis.mode,
    active_panel: jarvis.activeTab,
    workshop_open: spatial.workshopOpen,
    workshop_items: spatial.workshopOpen && workshop ? workshop.items() : [],
    camera_on: spatial.cameraOn,
    camera_fills_screen: spatial.cameraFocused,
    hands_on: spatial.handsStatus === "tracking",
    watching: spatial.watching,
    showcase: showcaseState(),
    muted: sfx.isMuted(),
    windows_out: poppedOutWindows().map((w) => (w === "panel" ? jarvis.activeTab ?? "panel" : w)),
    last_scad_error: lastScadError,
    material_lab: labState(),
    timers: timerState(),
    project: projectState() && {
      ...projectState(),
      try_on: useTryOn.getState().active
        ? {
            active: true,
            anchor: useTryOn.getState().anchor ?? useProject.getState().project?.wear?.anchor ?? "face",
            tracking: useTryOn.getState().status,
            actions: useTryOn.getState().actions,
            last_fired: useTryOn.getState().lastFired?.name ?? null,
          }
        : null,
    },
  }
}
