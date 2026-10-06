"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import {
  AppWindowIcon,
  Axis3dIcon,
  BoxIcon,
  Grid3x3Icon,
  MinimizeIcon,
  SlidersHorizontalIcon,
  ScissorsIcon,
  ScanSearchIcon,
  Volume2Icon,
  VolumeXIcon,
  Move3dIcon,
  BoxesIcon,
  DownloadIcon,
  FlaskConicalIcon,
  HandIcon,
  ImageIcon,
  LayersIcon,
  Loader2Icon,
  MagnetIcon,
  RotateCcwIcon,
  GlassesIcon,
  VideoIcon,
  VideoOffIcon,
  SmartphoneIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { cameraSource, startCamera, stopCamera, subscribeCamera } from "@/lib/camera"
import { registerWorkshop, reportScadResult } from "@/lib/console-commands"
import { PhoneCameraDialog } from "@/components/spatial/phone-camera-dialog"
import { usePopOut } from "@/components/ui/pop-out"
import { registerWindow } from "@/lib/window-control"
import { setSpatialHandler, startHands, stopHands, subscribeHands } from "@/lib/hand-tracking"
import { sfx } from "@/lib/sfx"
import { useSpatial } from "@/lib/spatial-store"
import { renderView } from "@/lib/jarvis-client"
import type { ItemMode, SectionState, WorkshopScene } from "@/lib/workshop/scene"
import { buildGenerated, type ItemSpec } from "@/lib/workshop/models"
import { getGestures, KEYS, useGestures, type TapAction } from "@/lib/workshop/gestures"
import { GestureSettings } from "@/components/workshop/gesture-settings"
import { FxSettings } from "@/components/workshop/fx-settings"
import { FitPanel, SectionPanel, type FitResult } from "@/components/workshop/section-fit"
import { useVisuals } from "@/lib/workshop/visuals"
import { LibraryDock, type StageItem } from "@/components/workshop/library-dock"
import { PANEL_WIDTH, ProjectPanel } from "@/components/workshop/project-panel"
import { MaterialLab } from "@/components/workshop/material-lab"
import { ProjectGallery } from "@/components/workshop/project-gallery"
import { buildAssembly, releaseAssembly } from "@/lib/workshop/project/assembly"
import { rigOf, type Rig } from "@/lib/workshop/project/rig"
import { editableRig, editSegment, saveRig } from "@/lib/workshop/project/rig-edit"
import type { Project } from "@/lib/workshop/project/types"
import { useLab } from "@/lib/workshop/lab/store"
import { useProject } from "@/lib/workshop/project/store"
import { useTryOn } from "@/lib/ar/store"
import { stopSim } from "@/lib/workshop/sim/controller"
import { ScadError, compileScad, scadItem } from "@/lib/workshop/openscad"
import { useJarvis } from "@/lib/store"

type Focus = (ItemSpec & { id: string; mode: ItemMode }) | null

/** A small JPEG of an image, for the hologram (holograms persist in
 *  localStorage, which a full-size render would fill). */
function thumbnail(url: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const scale = 360 / Math.max(image.width, image.height)
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(image.width * scale)
      canvas.height = Math.round(image.height * scale)
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL("image/jpeg", 0.75))
    }
    image.onerror = () => resolve(url)
    image.src = url
  })
}

/** Hand STL files to the browser as downloads. */
function download(files: { name: string; blob: Blob }[]) {
  for (const file of files) {
    const url = URL.createObjectURL(file.blob)
    const link = document.createElement("a")
    link.href = url
    link.download = file.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
  return files.length
}

// A mouse press counts as a tap (toggle the item) under these limits, the
// same idea as the hand tracker's air tap.
const TAP_MS = 300
const TAP_PX = 6

const HINT: Record<string, string> = {
  toggle_mode: "HOLO/SOLID",
  explode: "EXPLODE",
  snap: "SNAP",
  reset_view: "RESET VIEW",
  rotate_item: "TURN PART",
  orbit: "ORBIT",
}

// The 3D workshop, full-screen over the console. Hands reach it through
// setSpatialHandler (any pinch the DOM does not claim), the mouse through
// the pointer handlers below; both land on the same WorkshopScene calls.
//
// It can also leave the console for a window of its own (a second
// monitor). The stage is rendered into one container that is moved
// between the console and that window rather than re-rendered, so the
// scene, what is on it and the WebGL context all come along intact.
// Closing that window closes the workshop, like the console's others.
export function Workshop({ token }: { token: string }) {
  const open = useSpatial((state) => state.workshopOpen)
  const setOpen = useSpatial((state) => state.setWorkshopOpen)
  const popOut = usePopOut("workshop", useCallback(() => setOpen(false), [setOpen]))
  const popped = !!popOut.root
  const overlayRef = useRef<HTMLDivElement>(null)
  const [stageHost] = useState(() => {
    if (typeof document === "undefined") return null
    const host = document.createElement("div")
    host.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0;width:100%;height:100%;background:#02050a"
    return host
  })
  // Bumped on every move, so the scene restarts its loop in its new window.
  const [hostEpoch, setHostEpoch] = useState(0)

  useEffect(() => {
    if (!open && popped) popOut.close()
  }, [open, popped, popOut])

  useEffect(
    () =>
      registerWindow("workshop", {
        out: () => {
          useJarvis.getState().setActiveTab(null)
          setOpen(true)
          return popOut.open("Workshop", { left: 0, top: 0, width: Math.min(1600, window.innerWidth), height: Math.min(1000, window.innerHeight) } as DOMRect)
        },
        in: popOut.close,
        isOut: () => popped,
      }),
    [popped, popOut, setOpen]
  )

  useLayoutEffect(() => {
    if (!open || !stageHost) return
    const parent = popOut.root ?? overlayRef.current
    if (parent && stageHost.parentNode !== parent) {
      parent.appendChild(stageHost)
      setHostEpoch((n) => n + 1)
    }
  }, [open, popOut.root, stageHost])

  useEffect(() => {
    if (!open || popped) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !useProject.getState().galleryOpen) setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, popped, setOpen])

  return (
    <>
      <AnimatePresence>
        {open && !popped && (
          <motion.div
            key="workshop"
            ref={overlayRef}
            className="fixed inset-0 flex flex-col"
            style={{ zIndex: 35, background: "#02050a" }}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.04 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </AnimatePresence>
      {open &&
        stageHost &&
        createPortal(
          <WorkshopStage
            token={token}
            onClose={() => setOpen(false)}
            popped={popped}
            onPopToggle={() => (popped ? popOut.close() : void popOut.open("Workshop", stageHost.getBoundingClientRect()))}
            hostEpoch={hostEpoch}
            keyWindow={popOut.root?.ownerDocument.defaultView ?? null}
          />,
          stageHost
        )}
    </>
  )
}

function WorkshopStage({
  token,
  onClose,
  popped,
  onPopToggle,
  hostEpoch,
  keyWindow,
}: {
  token: string
  onClose: () => void
  popped: boolean
  onPopToggle: () => void
  hostEpoch: number
  /** The workshop's own window while it is popped out, for its shortcuts. */
  keyWindow: Window | null
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<WorkshopScene | null>(null)
  const pressRef = useRef<{ at: number; x: number; y: number } | null>(null)
  const rotatingRef = useRef(false)
  const [focus, setFocus] = useState<Focus>(null)
  const [ready, setReady] = useState(false)
  const [trackingError, setTrackingError] = useState<string | null>(null)
  const [bin, setBin] = useState<"idle" | "armed" | "discarded">("idle")
  const [compiling, setCompiling] = useState<string | null>(null)
  const [stage, setStage] = useState<StageItem[]>([])
  const [rendering, setRendering] = useState(false)
  const [render, setRender] = useState<{ url: string; prompt: string; model: string } | null>(null)
  const [exploded, setExploded] = useState(false)
  const [snapOn, setSnapOn] = useState(false)
  const [arrowsOn, setArrowsOn] = useState(true)
  // One panel at a time on the right: gestures, FX, section or fit.
  const [panel, setPanel] = useState<"gestures" | "fx" | "section" | "fit" | null>(null)
  const gesturesOpen = panel === "gestures"
  const fxOpen = panel === "fx"
  const togglePanel = (which: NonNullable<typeof panel>) => setPanel((open) => (open === which ? null : which))
  const [section, setSection] = useState<SectionState>({ on: false, axis: 2, offset: 0.5, flip: false })
  const [fit, setFit] = useState<FitResult>({ running: false, checked: false, clashes: [] })
  // The console's mute, here too: a popped-out workshop has no top bar.
  const muted = useSyncExternalStore(sfx.subscribeMuted, sfx.isMuted, () => false)
  // Features the assembly is built with: switching one rebuilds it.
  const realParts = useVisuals((state) => state.realParts)
  const looms = useVisuals((state) => state.looms)
  const inputMode = useSpatial((state) => state.inputMode)
  const gestures = useGestures()
  // Jarvis's render control is registered once, with the
  // scene, but must reach the current functions (and their state), so they
  // go through this ref, refreshed every render.
  const latest = useRef<{
    renderNow: (prompt?: string) => Promise<void>
    runAction: (action: TapAction, itemId?: string) => void
  } | null>(null)
  useEffect(() => {
    latest.current = { renderNow, runAction }
  })
  // Compile OpenSCAD and put the part on the stage, solid (it is a real
  // part); errors go to the log, a notification, and back to Jarvis.
  const buildScad = useRef(async (name: string, code: string, notes: string[] = []) => {
    const { pushLog, notify } = useJarvis.getState()
    setCompiling(name)
    try {
      const started = performance.now()
      const stl = await compileScad(code)
      const scene = sceneRef.current
      if (!scene) return
      scene.spawnBuilt(scadItem(name, code, stl, notes))
      scene.setModeWhere("last", "solid")
      reportScadResult(name, null)
      pushLog("OK", `OpenSCAD: ${name} in ${((performance.now() - started) / 1000).toFixed(1)}s`)
    } catch (err) {
      const message = err instanceof ScadError ? err.message : String(err)
      reportScadResult(name, message)
      pushLog("ERR", `OpenSCAD: ${name} failed`)
      notify("warning", `${name} did not compile`, message.split("\n")[0].slice(0, 160))
    } finally {
      setCompiling(null)
    }
  })
  const binRef = useRef<HTMLDivElement>(null)
  const handsStatus = useSpatial((state) => state.handsStatus)
  const handsOn = handsStatus === "tracking"
  const projectVersion = useProject((state) => state.version)
  const projectShown = useProject((state) => state.panelOpen && !!state.project)
  const galleryOpen = useProject((state) => state.galleryOpen)
  const labOpen = useLab((state) => state.open)
  // The open project's 3D assembly on the stage, by the name it was given.
  const assemblyRef = useRef<string | null>(null)
  // Its rig (segments that move on their own, and the cables between
  // them), and what it was built from: a save that only moves or turns a
  // segment re-poses this one instead of rebuilding (and recompiling).
  const rigRef = useRef<{ rig: Rig; signature: string } | null>(null)
  const [rigBuilt, setRigBuilt] = useState(0)
  const axesOn = useProject((state) => state.axes)
  const rigEdit = useProject((state) => state.rigEdit)

  useEffect(() => {
    useProject.getState().setToken(token)
  }, [token])

  // The cross-section, kept in step both ways: the panel sets it, dragging
  // the plane on the stage moves the panel's slider.
  useEffect(() => {
    if (!ready) return
    sceneRef.current?.setSection(section, (offset) => setSection((s) => (Math.abs(s.offset - offset) < 0.001 ? s : { ...s, offset })))
  }, [ready, section])

  // Callouts price each part from the project's bill of materials.
  useEffect(() => {
    const scene = sceneRef.current
    if (!ready || !scene) return
    const lines = useProject.getState().report?.bom.lines ?? []
    scene.setCalloutCost((id) => {
      const line = lines.find((l) => l.for.includes(id))
      if (!line) return null
      const unit = line.unit === "each" || line.unit === "1 per slot" ? "ea" : line.unit
      return `$${line.price.toFixed(2)} ${unit} · ${line.where}`
    })
  }, [ready, projectVersion])

  // The simulation pauses when the workshop closes.
  useEffect(() => () => stopSim(), [])

  // Rebuild the assembly whenever a new copy of the project arrives: in
  // place of the old one, keeping where he put it and how he turned it.
  useEffect(() => {
    const scene = sceneRef.current
    if (!ready || !scene) return
    const project = useProject.getState().project
    if (!project || (!project.parts.length && !project.printed.length)) {
      if (assemblyRef.current) scene.removeWhere(assemblyRef.current)
      assemblyRef.current = null
      rigRef.current = null
      releaseAssembly()
      return
    }
    const signature = `${buildSignature(project)}|${realParts}|${looms}`
    const built = rigRef.current
    if (built && assemblyRef.current && built.signature === signature) {
      built.rig.apply(rigOf(project))
      useProject.getState().setRuns(built.rig.cabling?.lengths ?? [])
      return
    }
    let cancelled = false
    void Promise.resolve()
      .then(() => {
        if (project.printed.length && !cancelled) setCompiling(`${project.name} printed parts`)
        return buildAssembly(project, compileScad)
      })
      .then(({ item, rig, failures }) => {
        const live = sceneRef.current
        if (cancelled || !live) return
        live.replaceBuilt(assemblyRef.current, item)
        live.setModeWhere(item.spec.name, "solid")
        assemblyRef.current = item.spec.name
        // An edit made while it was building.
        const draft = useProject.getState().rigDraft
        if (draft) rig.apply(draft)
        rigRef.current = { rig, signature }
        setRigBuilt((n) => n + 1)
        useProject.getState().setRuns(rig.cabling?.lengths ?? [])
        for (const failure of failures) {
          reportScadResult(failure.name, failure.error)
          useJarvis.getState().notify("warning", `${failure.name} did not compile`, failure.error.split("\n")[0].slice(0, 160))
        }
        if (!failures.length && project.printed.length) reportScadResult(project.printed[0].name, null)
      })
      .finally(() => !cancelled && setCompiling(null))
    return () => {
      cancelled = true
    }
  }, [ready, projectVersion, realParts, looms])

  // The rig as it is being edited, shown live: the segment where the
  // panel or the gizmo has it and the wires re-routed to it.
  useEffect(
    () =>
      useProject.subscribe((state, before) => {
        const built = rigRef.current
        if (!built || state.rigDraft === before.rigDraft || !state.rigDraft) return
        built.rig.apply(state.rigDraft)
        state.setRuns(built.rig.cabling?.lengths ?? [])
      }),
    []
  )

  // The design axes, as the toolbar has them.
  useEffect(() => {
    if (ready) sceneRef.current?.setAxes(axesOn)
  }, [ready, axesOn, rigBuilt])

  // The move gizmo on the segment the panel is editing: drag an arrow to
  // move it along that design axis (0.5 mm steps; 5 mm with snapping on).
  useEffect(() => {
    const scene = sceneRef.current
    const built = rigRef.current
    const joint = rigEdit ? built?.rig.joints.get(rigEdit) : undefined
    if (!scene || !built || !joint) {
      scene?.setGizmo(null)
      return
    }
    let raw: number[] | null = null
    scene.setGizmo({
      object: joint.joint,
      frame: built.rig.zUp,
      onDrag: (axis, mm) => {
        const name = joint.segment.name
        const current = editableRig().find((s) => s.name === name)
        if (!current) return
        raw ??= [...(current.move ?? [0, 0, 0])]
        raw[axis] += mm
        const step = snapOn ? 5 : 0.5
        const move = raw.map((v) => Math.round(v / step) * step)
        editSegment(name, (s) => ({ ...s, move }))
      },
      onEnd: () => {
        raw = null
        void saveRig()
      },
    })
    return () => scene.setGizmo(null)
  }, [rigEdit, rigBuilt, ready, snapOn])

  // Native tracking: the workshop brings up the camera and hands itself,
  // and on the way out puts back only what it switched on - a camera that
  // was already running for the console stays on.
  useEffect(() => {
    let cancelled = false
    let startedCamera = false
    let startedHands = false
    const spatial = useSpatial.getState()

    async function bringUp() {
      try {
        if (!spatial.cameraOn) {
          await startCamera()
          if (cancelled) return
          startedCamera = true
          useSpatial.getState().setCameraOn(true)
        }
        if (useSpatial.getState().handsStatus !== "tracking") {
          await startHands()
          if (cancelled) return
          startedHands = true
        }
      } catch (err) {
        if (cancelled) return
        const denied = err instanceof DOMException && err.name === "NotAllowedError"
        setTrackingError(
          denied
            ? "Camera blocked. Allow it in the address bar to use your hands here; the mouse still works."
            : "Hand tracking could not start. The mouse still works."
        )
      }
    }
    void bringUp()

    return () => {
      cancelled = true
      if (startedHands) stopHands()
      if (startedCamera) {
        stopCamera()
        useSpatial.getState().setCameraOn(false)
      }
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    const label = labelRef.current
    if (!host || !label) return
    let disposed = false
    import("@/lib/workshop/scene").then(({ WorkshopScene }) => {
      if (disposed) return
      const scene = new WorkshopScene(host, label, {
        onFocus: setFocus,
        onItems: setStage,
        // A mouse click always toggles hologram/solid; a hand's quick pinch
        // does whatever the gesture map says.
        onTap: (itemId, pointer) => {
          if (pointer.startsWith("mouse-")) return false
          const action = getGestures().pinch_tap
          if (action === "toggle_mode") return false
          latest.current?.runAction(action, itemId)
          return true
        },
        // Generous: a hand cannot aim as finely as a mouse.
        binCentre: () => {
          const rect = binRef.current?.getBoundingClientRect()
          return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
        },
        binAt: (x, y) => {
          const rect = binRef.current?.getBoundingClientRect()
          if (!rect) return false
          const pad = 28
          return x > rect.left - pad && x < rect.right + pad && y > rect.top - pad && y < rect.bottom + pad
        },
        onBin: (state) => {
          setBin(state)
          if (state === "armed") sfx.click()
          if (state === "discarded") {
            sfx.alert()
            window.setTimeout(() => setBin("idle"), 650)
          }
        },
      })
      sceneRef.current = scene
      // Jarvis works the stage through this. Registering flushes anything
      // he asked for while the scene was still loading.
      registerWorkshop({
        build: (model) => scene.spawnBuilt(buildGenerated(model)),
        discard: (target) => scene.discardWhere(target),
        setMode: (target, mode) => scene.setModeWhere(target, mode),
        clear: () => scene.clear(),
        items: () => scene.listItems(),
        scad: (name, code, notes) => void buildScad.current(name, code, notes),
        exportStl: (target) => download(scene.exportStl(target)),
        // Through a ref: this registration runs once, and must reach the
        // current render function, not the first one.
        render: (prompt) => void latest.current?.renderNow(prompt),
      })
      setSpatialHandler({
        down: (id, x, y) => scene.down(id, x, y),
        move: (id, x, y) => scene.move(id, x, y),
        up: (id, x, y, tap) => scene.up(id, x, y, tap),
        hover: (x, y) => scene.hover(x, y),
        gesture: (gesture) => {
          if (gesture.type === "peace") {
            latest.current?.runAction(getGestures().peace)
            return true
          }
          if (gesture.type === "spread") {
            latest.current?.runAction(getGestures().spread)
            return true
          }
          if (gesture.phase === "start") {
            const action = getGestures().fist_drag
            if (action === "rotate_item") return scene.beginRotate(gesture.id, gesture.x, gesture.y)
            if (action === "orbit") {
              scene.beginOrbit(gesture.id, gesture.x, gesture.y)
              return true
            }
            return false
          }
          if (gesture.phase === "move") scene.move(gesture.id, gesture.x, gesture.y)
          else scene.up(gesture.id, gesture.x, gesture.y, false)
        },
      })
      setReady(true)
    })
    // The hands themselves, drawn inside the scene at camera rate.
    const unsubscribe = subscribeHands((pointers) => sceneRef.current?.setHands(pointers))
    return () => {
      disposed = true
      unsubscribe()
      registerWorkshop(null)
      setSpatialHandler(null)
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [])

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")

  // A photoreal render of the view, by Gemini's image models: a clean
  // snapshot goes up, the render comes back into the panel and is pinned
  // as a hologram too.
  async function renderNow(prompt?: string) {
    const scene = sceneRef.current
    if (!scene || rendering) return
    const { pushLog, notify } = useJarvis.getState()
    setRendering(true)
    try {
      const shot = scene.snapshot(true)
      const result = await renderView(shot.slice(shot.indexOf(",") + 1), prompt, token)
      const url = `data:${result.mime};base64,${result.image}`
      setRender({ url, prompt: prompt ?? "Default product render", model: result.model })
      pushLog("OK", `Render by ${result.model.replace("gemini-", "")}`)
      useSpatial.getState().addHologram({
        kind: "vision",
        title: `RENDER · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        body: prompt ?? "Photoreal render of the workshop view.",
        image: await thumbnail(url),
      })
    } catch (err) {
      notify("warning", "Render failed", err instanceof Error ? err.message : String(err))
      pushLog("ERR", "Render failed")
    } finally {
      setRendering(false)
    }
  }

  // The camera from inside the workshop, so closing its window never means
  // a trip back to the console for it: on brings hand tracking with it,
  // as opening the workshop does.
  const cameraOn = useSpatial((state) => state.cameraOn)
  const hasProject = useProject((state) => !!state.project)
  const tryingOn = useTryOn((state) => state.active)
  const source = useSyncExternalStore(subscribeCamera, cameraSource, () => "local" as const)
  const [phoneOpen, setPhoneOpen] = useState(false)
  const closePhone = useCallback(() => setPhoneOpen(false), [])

  async function setCamera(on: boolean) {
    const spatial = useSpatial.getState()
    if (!on) {
      useTryOn.getState().stop()
      stopHands()
      stopCamera()
      spatial.setCameraOn(false)
      return true
    }
    if (spatial.cameraOn) return true
    try {
      await startCamera()
      useSpatial.getState().setCameraOn(true)
      setTrackingError(null)
      if (useSpatial.getState().handsStatus !== "tracking") void startHands().catch(() => {})
      return true
    } catch (err) {
      const denied = err instanceof DOMException && err.name === "NotAllowedError"
      useJarvis.getState().notify(
        "warning",
        denied ? "Camera blocked" : "Camera unavailable",
        denied ? "Allow camera access for this site in the address bar, then try again." : "No camera could be opened."
      )
      return false
    }
  }

  async function toggleTryOn() {
    if (useTryOn.getState().active) {
      useTryOn.getState().stop()
      return
    }
    if (await setCamera(true)) useTryOn.getState().start()
  }

  // Gesture actions, from a hand gesture (as mapped), a button or a key.
  function runAction(action: TapAction, itemId?: string) {
    const { notify } = useJarvis.getState()
    const scene = sceneRef.current
    if (!scene || action === "none") return
    if (action === "toggle_mode") {
      const id = itemId ?? focus?.id
      if (id) scene.toggle(id)
    } else if (action === "explode") {
      const result = scene.setExploded()
      setExploded(result.exploded)
      if (result.exploded && !result.explodable) {
        notify("info", "Nothing to explode", "OpenSCAD parts are one solid; built and catalogue models come apart.")
      }
      sfx.click()
    } else if (action === "snap") {
      setSnapOn(scene.setSnap())
      sfx.click()
    } else if (action === "reset_view") {
      scene.resetView()
    }
  }

  // E, G and R for the same actions, unless he is typing somewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.ctrlKey || event.metaKey || event.altKey || target?.closest("input, textarea, select, [contenteditable='true']")) return
      const key = event.key.toUpperCase()
      if (key === KEYS.explode) latest.current?.runAction("explode")
      else if (key === KEYS.snap) latest.current?.runAction("snap")
      else if (key === KEYS.reset_view) latest.current?.runAction("reset_view")
    }
    const target = keyWindow ?? window
    target.addEventListener("keydown", onKey)
    return () => target.removeEventListener("keydown", onKey)
  }, [keyWindow])

  // Moved between the console and its own window: the loop restarts there.
  useEffect(() => {
    if (hostEpoch > 1) sceneRef.current?.rehost()
  }, [hostEpoch])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    const scene = sceneRef.current
    const id = `mouse-${event.pointerId}`
    // Right-drag or shift-drag turns the part under the pointer (or the
    // selected one); over nothing, it orbits.
    if (event.button === 2 || event.shiftKey) {
      pressRef.current = null
      if (scene && !scene.beginRotate(id, event.clientX, event.clientY)) scene.beginOrbit(id, event.clientX, event.clientY)
      rotatingRef.current = true
      return
    }
    pressRef.current = { at: performance.now(), x: event.clientX, y: event.clientY }
    scene?.down(id, event.clientX, event.clientY)
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const scene = sceneRef.current
    if (!scene) return
    if (pressRef.current || rotatingRef.current) scene.move(`mouse-${event.pointerId}`, event.clientX, event.clientY)
    else scene.hover(event.clientX, event.clientY)
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const press = pressRef.current
    pressRef.current = null
    rotatingRef.current = false
    const tap =
      !!press &&
      performance.now() - press.at < TAP_MS &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) < TAP_PX
    sceneRef.current?.up(`mouse-${event.pointerId}`, event.clientX, event.clientY, tap)
  }

  return (
    <>
      <header
        className="relative flex shrink-0 items-center justify-between"
        style={{
          height: 48,
          padding: "0 var(--sp-4)",
          gap: "var(--sp-4)",
          background: "rgba(5, 5, 10, 0.85)",
          borderBottom: "1px solid rgba(var(--accent-rgb), 0.3)",
          zIndex: 2,
        }}
      >
        <div className="bar-sweep" aria-hidden />
        <div className="relative flex min-w-0 shrink-0 items-center" style={{ gap: "var(--sp-3)" }}>
          <span className="t-header shrink-0" style={{ color: "var(--accent)" }}>
            WORKSHOP
          </span>
          {handsOn && (
            <span
              className="t-label shrink-0"
              style={{
                color: inputMode === "hands" ? "var(--accent)" : inputMode === "degraded" ? "var(--warning)" : "var(--text-secondary)",
              }}
              title="Your hands drive while they are in view and tracked well; the mouse takes over the moment they are not"
            >
              {inputMode === "hands" ? "◉ HANDS" : inputMode === "degraded" ? "◌ HANDS LOST" : "◎ MOUSE"}
            </span>
          )}
        </div>
        {/* Grouped by what they act on, with a rule between groups. On a
            narrower screen the labels fold away and the icons (with their
            titles) carry on, so the bar never runs under the title. */}
        <div className="ws-tools relative flex min-w-0 items-center">
          <div className="ws-group">
            <Tool icon={<LayersIcon size={13} />} label="GALLERY" active={galleryOpen} onClick={() => useProject.getState().setGalleryOpen(!galleryOpen)} title="Every project, its finished product as a hologram" />
            <Tool icon={<FlaskConicalIcon size={13} />} label="LAB" active={labOpen} onClick={() => useLab.getState().setOpen(!labOpen)} title="Material lab: tensile, drop, bend and heat tests on rubber, glass, metals and filaments, side by side" />
          </div>
          <div className="ws-group">
            <Tool
              icon={cameraOn ? <VideoIcon size={13} /> : <VideoOffIcon size={13} />}
              label={cameraOn && source === "phone" ? "IPHONE CAM" : "CAMERA"}
              active={cameraOn}
              onClick={() => void setCamera(!cameraOn)}
              title={cameraOn ? "Turn the camera off" : "Turn the camera on (with hand tracking)"}
            />
            <Tool icon={<SmartphoneIcon size={13} />} label="IPHONE" active={phoneOpen || source === "phone"} onClick={() => setPhoneOpen(!phoneOpen)} title="Use your iPhone (or another camera) as the console's camera" />
            <Tool
              icon={<GlassesIcon size={13} />}
              label="TRY ON"
              active={tryingOn}
              disabled={!hasProject && !tryingOn}
              onClick={() => void toggleTryOn()}
              title={hasProject ? "Wear the open project, live in the camera" : "Open a project to try it on"}
            />
            <Tool icon={<HandIcon size={13} />} label="GESTURES" active={gesturesOpen} onClick={() => togglePanel("gestures")} title="Choose what each hand gesture does" />
          </div>
          <div className="ws-group">
            <Tool icon={<BoxesIcon size={13} />} label="EXPLODE" active={exploded} disabled={!ready} onClick={() => runAction("explode")} title={`Exploded view: parts drawn apart (${KEYS.explode})`} />
            <Tool icon={<MagnetIcon size={13} />} label="SNAP" active={snapOn} disabled={!ready} onClick={() => runAction("snap")} title={`Snapping: 25 mm grid, 15° turns, flush to neighbours (${KEYS.snap})`} />
            <Tool
              icon={<Move3dIcon size={13} />}
              label="MOVE"
              active={arrowsOn}
              disabled={!ready}
              onClick={() => {
                const scene = sceneRef.current
                if (scene) setArrowsOn(scene.setItemArrows())
              }}
              title="Move arrows on the selected item: drag X or Y to slide it, Z (blue) to lift it off the floor"
            />
            <Tool icon={<Axis3dIcon size={13} />} label="AXES" active={axesOn} disabled={!ready} onClick={() => useProject.getState().setAxes(!axesOn)} title="The project's X, Y and Z axes: the layout's frame, in mm (z up)" />
            <Tool icon={<Grid3x3Icon size={13} />} label="HOLO" onClick={() => sceneRef.current?.setAllModes("wire")} title="Show everything as a hologram" />
            <Tool icon={<BoxIcon size={13} />} label="SOLID" onClick={() => sceneRef.current?.setAllModes("solid")} title="Show everything in its real materials" />
            <Tool icon={<RotateCcwIcon size={13} />} label="CLEAR" onClick={() => sceneRef.current?.clear()} title="Clear everything off the stage" />
          </div>
          <div className="ws-group">
            <Tool
              icon={<ScissorsIcon size={13} />}
              label="SECTION"
              active={section.on || panel === "section"}
              disabled={!ready}
              onClick={() => {
                if (panel !== "section" && !section.on) setSection((s) => ({ ...s, on: true }))
                togglePanel("section")
              }}
              title="Cross-section: cut the design with a plane you can drag"
            />
            <Tool
              icon={<ScanSearchIcon size={13} />}
              label="FIT"
              active={panel === "fit"}
              disabled={!ready}
              onClick={async () => {
                setPanel("fit")
                setFit({ running: true, checked: false, clashes: [] })
                const result = await sceneRef.current?.checkFit()
                setFit({ running: false, checked: !!result?.checked, clashes: result?.clashes ?? [] })
              }}
              title="Fit check: find parts that run into each other"
            />
            <Tool
              icon={muted ? <VolumeXIcon size={13} /> : <Volume2Icon size={13} />}
              label={muted ? "MUTED" : "SOUND"}
              active={!muted}
              onClick={() => sfx.toggleMuted()}
              title={muted ? "Sound is off: turn it on" : "Turn the console's sound off"}
            />
            <Tool icon={<SlidersHorizontalIcon size={13} />} label="FX" active={fxOpen} onClick={() => togglePanel("fx")} title="Visual features: switch each on or off to compare" />
          </div>
          <div className="ws-group">
            <Tool icon={<DownloadIcon size={13} />} label="STL" disabled={!ready || !focus} onClick={() => sceneRef.current && download(sceneRef.current.exportStl())} title="Download the selected item as STL, in millimetres" />
            <Tool
              icon={rendering ? <Loader2Icon size={13} className="animate-spin" /> : <SparklesIcon size={13} />}
              label="RENDER"
              disabled={!ready || rendering}
              onClick={() => void renderNow()}
              title="Photoreal render of this view (Gemini image model)"
            />
          </div>
          <div className="ws-group">
            <Tool
              icon={popped ? <MinimizeIcon size={13} /> : <AppWindowIcon size={13} />}
              label={popped ? "DOCK" : "WINDOW"}
              onClick={onPopToggle}
              title={popped ? "Back into the console" : "Open the workshop in its own window (another monitor)"}
            />
            <Tool icon={<XIcon size={14} />} label="" onClick={onClose} title={popped ? "Close the workshop" : "Close the workshop (Esc)"} />
          </div>
        </div>
      </header>
      {phoneOpen && <PhoneCameraDialog token={token} onClose={closePhone} />}

      <div className="relative min-h-0 flex-1">
        <LibraryDock
          ready={ready}
          compiling={!!compiling}
          items={stage}
          focusedId={focus?.id ?? null}
          onTemplate={(label, code) => void buildScad.current(label, code)}
          onFocus={(id) => sceneRef.current?.focusId(id)}
          onDiscard={(id) => sceneRef.current?.discardId(id)}
        />
        <div
          ref={hostRef}
          className="absolute inset-0"
          style={{ touchAction: "none", cursor: "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => sceneRef.current?.hover(null, null)}
          onContextMenu={(event) => event.preventDefault()}
          onWheel={(event) => sceneRef.current?.zoom(event.deltaY > 0 ? 1.08 : 1 / 1.08)}
          onDoubleClick={() => focus && sceneRef.current?.toggle(focus.id)}
        />

        {gesturesOpen && <GestureSettings onClose={() => setPanel(null)} right={projectShown ? PANEL_WIDTH + 24 : 12} top={projectShown ? 12 : 56} />}
        {fxOpen && <FxSettings onClose={() => setPanel(null)} right={projectShown ? PANEL_WIDTH + 24 : 12} top={projectShown ? 12 : 56} />}
        {panel === "section" && <SectionPanel state={section} onChange={setSection} onClose={() => setPanel(null)} right={projectShown ? PANEL_WIDTH + 24 : 12} top={projectShown ? 12 : 56} />}
        {panel === "fit" && (
          <FitPanel
            result={fit}
            onClose={() => {
              setPanel(null)
              sceneRef.current?.clearFit()
              setFit({ running: false, checked: false, clashes: [] })
            }}
            right={projectShown ? PANEL_WIDTH + 24 : 12} top={projectShown ? 12 : 56}
          />
        )}

        <ProjectPanel />
        {galleryOpen && <ProjectGallery />}
        {labOpen && <MaterialLab />}

        {/* Spec readout, positioned over the focused item by the scene. */}
        <div
          ref={labelRef}
          data-keepout
          className="pointer-events-none absolute top-0 left-0"
          style={{ opacity: 0, transition: "opacity 150ms ease", willChange: "transform" }}
        >
          {focus && (
            <div className="holo-card" style={{ minWidth: 220, maxWidth: 260 }}>
              <header className="holo-card-header">
                <span className="t-label truncate-1">{focus.name.toUpperCase()}</span>
                <span className="t-time">{focus.mode === "wire" ? "HOLO" : "SOLID"}</span>
              </header>
              <div className="holo-card-body" style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: 11 }}>
                <div style={{ color: "var(--accent)", marginBottom: 4 }}>{focus.designation}</div>
                {focus.lines.map((line) => (
                  <div key={line}>› {line}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* The latest render, top right, until dismissed. */}
        {render && (
          <div data-keepout className="holo-card" style={{ position: "absolute", top: 12, right: projectShown ? PANEL_WIDTH + 24 : 12, width: 360, zIndex: 2 }}>
            <header className="holo-card-header">
              <span className="t-label truncate-1 flex items-center" style={{ gap: 6 }}>
                <ImageIcon size={12} /> RENDER · {render.model.replace("gemini-", "").toUpperCase()}
              </span>
              <span className="flex" style={{ gap: 4 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ width: 20, height: 20, padding: 0 }}
                  onClick={async () =>
                    download([{ name: `render-${stamp()}.png`, blob: await (await fetch(render.url)).blob() }])
                  }
                  aria-label="Download render"
                >
                  <DownloadIcon size={11} className="mx-auto" />
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ width: 20, height: 20, padding: 0 }}
                  onClick={() => setRender(null)}
                  aria-label="Close render"
                >
                  <XIcon size={11} className="mx-auto" />
                </button>
              </span>
            </header>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the render endpoint */}
            <img src={render.url} alt={render.prompt} style={{ display: "block", width: "100%" }} />
            <p className="holo-card-body" style={{ maxHeight: 60 }}>{render.prompt}</p>
          </div>
        )}

        {/* Discard bin. Drop an item on it, by hand or mouse. */}
        <div
          ref={binRef}
          className="workshop-bin pointer-events-none absolute"
          data-state={bin}
          style={{ right: projectShown ? PANEL_WIDTH + 40 : 28, bottom: 44 }}
          aria-hidden
        >
          <Trash2Icon size={26} />
          <span className="t-label">{bin === "armed" ? "RELEASE" : bin === "discarded" ? "DISCARDED" : "DISCARD"}</span>
        </div>

        <p
          className="t-time truncate-1 pointer-events-none absolute bottom-3 px-4 text-center"
          // Between the library dock and the project panel, never under them.
          style={{ color: "var(--text-secondary)", left: 268, right: projectShown ? PANEL_WIDTH + 24 : 0 }}
        >
          {rendering
            ? "RENDERING WITH GEMINI..."
            : compiling
            ? `COMPILING ${compiling.toUpperCase()} IN OPENSCAD...`
            : trackingError
            ? trackingError
            : handsStatus === "loading"
              ? "BRINGING HANDS ONLINE..."
              : handsOn && inputMode === "hands"
                ? [
                    "PINCH ITEM: GRAB",
                    "PINCH SPACE: ORBIT",
                    gestures.pinch_tap !== "none" && `QUICK PINCH: ${HINT[gestures.pinch_tap]}`,
                    gestures.fist_drag !== "none" && `FIST: ${HINT[gestures.fist_drag]}`,
                    gestures.peace !== "none" && `✌ HOLD: ${HINT[gestures.peace]}`,
                    gestures.spread !== "none" && `FIST → OPEN: ${HINT[gestures.spread]}`,
                    "BOTH HANDS: RESIZE",
                    "DROP OR FLICK AT BIN: DISCARD",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "DRAG: MOVE · FLICK AT BIN: DISCARD · RIGHT/SHIFT-DRAG: TURN PART · CLICK: HOLO/SOLID · WHEEL: ZOOM · E EXPLODE · G SNAP · R RESET VIEW"}
        </p>
      </div>
    </>
  )
}

/** One toolbar control: its icon always, its label while there is room. */
function Tool({
  icon,
  label,
  title,
  onClick,
  active,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  title: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="btn ws-tool"
      onClick={onClick}
      data-active={active}
      aria-pressed={active}
      disabled={disabled}
      title={title}
      aria-label={label ? undefined : title}
    >
      {icon}
      {label && <span className="ws-label">{label}</span>}
    </button>
  )
}

/** What the stage's assembly is built from, less what a rig edit changes
 *  (a segment's move, pose, pivot, range or anchor) - those are applied
 *  to the built one. */
function buildSignature(project: Project): string {
  const { parts, wires, printed, layout } = project
  const rig = rigOf(project).map((s) => [s.name, s.members, s.parent ?? null])
  return JSON.stringify({ id: project.id, parts, wires, printed, layout, rig })
}
