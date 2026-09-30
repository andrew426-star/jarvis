"use client"

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { BoxIcon, CameraIcon, DownloadIcon, ImageIcon, Loader2Icon, RotateCcwIcon, ScanEyeIcon, SparklesIcon, Trash2Icon, WrenchIcon, XIcon } from "lucide-react"

import { getVideo, startCamera, stopCamera } from "@/lib/camera"
import { registerWorkshop, reportScadResult } from "@/lib/console-commands"
import { setSpatialHandler, startHands, stopHands, subscribeHands } from "@/lib/hand-tracking"
import { sfx } from "@/lib/sfx"
import { useSpatial } from "@/lib/spatial-store"
import { renderView } from "@/lib/jarvis-client"
import type { ItemMode, WorkshopScene } from "@/lib/workshop/scene"
import { CATALOGUE, buildGenerated, type ItemSpec } from "@/lib/workshop/models"
import { SCAD_TEMPLATES, ScadError, compileScad, scadItem } from "@/lib/workshop/openscad"
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

// The 3D workshop, full-screen over the console. Hands reach it through
// setSpatialHandler (any pinch the DOM does not claim), the mouse through
// the pointer handlers below; both land on the same WorkshopScene calls.
export function Workshop({ token }: { token: string }) {
  const open = useSpatial((state) => state.workshopOpen)
  const setOpen = useSpatial((state) => state.setWorkshopOpen)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, setOpen])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="workshop"
          className="fixed inset-0 flex flex-col"
          style={{ zIndex: 35, background: "#02050a" }}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <WorkshopStage token={token} onClose={() => setOpen(false)} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function WorkshopStage({ token, onClose }: { token: string; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<WorkshopScene | null>(null)
  const pressRef = useRef<{ at: number; x: number; y: number } | null>(null)
  const [focus, setFocus] = useState<Focus>(null)
  const [ready, setReady] = useState(false)
  const [passthrough, setPassthrough] = useState(false)
  const [trackingError, setTrackingError] = useState<string | null>(null)
  const [bin, setBin] = useState<"idle" | "armed" | "discarded">("idle")
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [compiling, setCompiling] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [render, setRender] = useState<{ url: string; prompt: string; model: string } | null>(null)
  // Jarvis's render and snapshot controls are registered once, with the
  // scene, but must reach the current functions (and their state), so they
  // go through this ref, refreshed every render.
  const latest = useRef<{ takeSnapshot: () => Promise<void>; renderNow: (prompt?: string) => Promise<void> } | null>(null)
  useEffect(() => {
    latest.current = { takeSnapshot, renderNow }
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
        // Generous: a hand cannot aim as finely as a mouse.
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
      // he asked for while the scene was still loading, so when he has a
      // job queued the stage opens straight onto it instead of the default.
      let queued = false
      registerWorkshop({
        spawn: (key) => {
          queued = true
          scene.spawn(key)
        },
        build: (model) => {
          queued = true
          scene.spawnBuilt(buildGenerated(model))
        },
        discard: (target) => scene.discardWhere(target),
        setMode: (target, mode) => scene.setModeWhere(target, mode),
        clear: () => scene.clear(),
        items: () => scene.listItems(),
        scad: (name, code, notes) => {
          queued = true
          void buildScad.current(name, code, notes)
        },
        exportStl: (target) => download(scene.exportStl(target)),
        // Through a ref: this registration runs once, and must reach the
        // current render and snapshot functions, not the first ones.
        snapshot: () => void latest.current?.takeSnapshot(),
        render: (prompt) => void latest.current?.renderNow(prompt),
      })
      // Something to hold on arrival: the reactor as a hologram.
      if (!queued) scene.spawn("reactor")
      setSpatialHandler({
        down: (id, x, y, size) => scene.down(id, x, y, size),
        move: (id, x, y, size) => scene.move(id, x, y, size),
        up: (id, x, y, tap) => scene.up(id, x, y, tap),
        hover: (x, y) => scene.hover(x, y),
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

  async function takeSnapshot() {
    const url = sceneRef.current?.snapshot()
    if (!url) return
    // Named for what it is for: an image to upload to Veras's web app.
    download([{ name: `workshop-${stamp()}-veras.png`, blob: await (await fetch(url)).blob() }])
  }

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

  function togglePassthrough() {
    const next = !passthrough
    sceneRef.current?.setPassthrough(next ? getVideo() : null)
    setPassthrough(next)
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    pressRef.current = { at: performance.now(), x: event.clientX, y: event.clientY }
    sceneRef.current?.down(`mouse-${event.pointerId}`, event.clientX, event.clientY)
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const scene = sceneRef.current
    if (!scene) return
    if (pressRef.current) scene.move(`mouse-${event.pointerId}`, event.clientX, event.clientY)
    else scene.hover(event.clientX, event.clientY)
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const press = pressRef.current
    pressRef.current = null
    const tap =
      !!press &&
      performance.now() - press.at < TAP_MS &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) < TAP_PX
    sceneRef.current?.up(`mouse-${event.pointerId}`, event.clientX, event.clientY, tap)
  }

  return (
    <>
      <header
        className="relative flex shrink-0 items-center justify-between overflow-hidden"
        style={{
          height: 48,
          padding: "0 var(--sp-4)",
          gap: "var(--sp-3)",
          background: "rgba(5, 5, 10, 0.85)",
          borderBottom: "1px solid rgba(var(--accent-rgb), 0.3)",
          zIndex: 2,
        }}
      >
        <div className="bar-sweep" aria-hidden />
        <div className="relative flex min-w-0 items-center" style={{ gap: "var(--sp-3)" }}>
          <span className="t-header shrink-0" style={{ color: "var(--accent)" }}>
            WORKSHOP
          </span>
          <nav className="flex min-w-0 items-center overflow-x-auto" style={{ gap: "var(--sp-2)" }}>
            {CATALOGUE.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="btn flex shrink-0 items-center"
                style={{ gap: 6, padding: "4px 10px" }}
                onClick={() => sceneRef.current?.spawn(entry.key)}
                disabled={!ready}
                title={`Project ${entry.label}`}
              >
                <BoxIcon size={12} />
                {entry.label.toUpperCase()}
              </button>
            ))}
          </nav>
        </div>
        <div className="relative flex shrink-0 items-center" style={{ gap: "var(--sp-2)" }}>
          <div className="relative">
            <button
              type="button"
              className="btn flex items-center"
              style={{ gap: 6, padding: "4px 10px" }}
              onClick={() => setTemplatesOpen((open) => !open)}
              data-active={templatesOpen}
              disabled={!ready}
              title="Printable part templates"
            >
              <WrenchIcon size={12} /> TEMPLATES
            </button>
            {templatesOpen && (
              <div
                className="card absolute right-0 flex flex-col"
                style={{ top: 34, zIndex: 3, padding: 4, gap: 4, background: "rgba(5, 7, 14, 0.96)", minWidth: 160 }}
              >
                {SCAD_TEMPLATES.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    className="btn"
                    style={{ padding: "4px 10px", textAlign: "left" }}
                    disabled={!!compiling}
                    onClick={() => {
                      setTemplatesOpen(false)
                      void buildScad.current(template.label, template.code)
                    }}
                  >
                    {template.label.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn flex items-center"
            style={{ gap: 6, padding: "4px 10px" }}
            onClick={() => sceneRef.current && download(sceneRef.current.exportStl())}
            disabled={!ready || !focus}
            title="Download the selected item as STL, in millimetres"
          >
            <DownloadIcon size={12} /> STL
          </button>
          <button
            type="button"
            className="btn flex items-center"
            style={{ gap: 6, padding: "4px 10px" }}
            onClick={() => void renderNow()}
            disabled={!ready || rendering}
            title="Photoreal render of this view (Gemini image model)"
          >
            {rendering ? <Loader2Icon size={12} className="animate-spin" /> : <SparklesIcon size={12} />} RENDER
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 28, height: 28, padding: 0 }}
            onClick={() => void takeSnapshot()}
            disabled={!ready}
            aria-label="Save this view as a PNG"
            title="Save this view as a PNG (for Veras or anywhere else)"
          >
            <CameraIcon className="mx-auto size-4" />
          </button>
          <button
            type="button"
            className="btn flex items-center"
            style={{ gap: 6, padding: "4px 10px" }}
            onClick={togglePassthrough}
            data-active={passthrough}
            aria-pressed={passthrough}
            disabled={!ready || !handsOn}
            title="Show the camera behind the workshop"
          >
            <ScanEyeIcon size={12} /> PASSTHROUGH
          </button>
          <button type="button" className="btn" style={{ padding: "4px 10px" }} onClick={() => sceneRef.current?.setAllModes("wire")}>
            HOLOGRAM
          </button>
          <button type="button" className="btn" style={{ padding: "4px 10px" }} onClick={() => sceneRef.current?.setAllModes("solid")}>
            MATERIALS
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 28, height: 28, padding: 0 }}
            onClick={() => sceneRef.current?.clear()}
            aria-label="Clear the workshop"
            title="Clear everything"
          >
            <RotateCcwIcon className="mx-auto size-4" />
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 28, height: 28, padding: 0 }}
            onClick={onClose}
            aria-label="Close the workshop"
            title="Close (Esc)"
          >
            <XIcon className="mx-auto size-4" />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={hostRef}
          className="absolute inset-0"
          style={{ touchAction: "none", cursor: "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => sceneRef.current?.hover(null, null)}
          onWheel={(event) => sceneRef.current?.zoom(event.deltaY > 0 ? 1.08 : 1 / 1.08)}
          onDoubleClick={() => focus && sceneRef.current?.toggle(focus.id)}
        />

        {/* Spec readout, positioned over the focused item by the scene. */}
        <div
          ref={labelRef}
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
          <div className="holo-card absolute" style={{ top: 12, right: 12, width: 360, zIndex: 2 }}>
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
          style={{ right: 28, bottom: 44 }}
          aria-hidden
        >
          <Trash2Icon size={26} />
          <span className="t-label">{bin === "armed" ? "RELEASE" : bin === "discarded" ? "DISCARDED" : "DISCARD"}</span>
        </div>

        <p
          className="t-time pointer-events-none absolute right-0 bottom-3 left-0 text-center"
          style={{ color: "var(--text-secondary)" }}
        >
          {rendering
            ? "RENDERING WITH GEMINI..."
            : compiling
            ? `COMPILING ${compiling.toUpperCase()} IN OPENSCAD...`
            : trackingError
            ? trackingError
            : handsStatus === "loading"
              ? "BRINGING HANDS ONLINE..."
              : handsOn
                ? "PINCH ITEM: GRAB · TOWARD/AWAY FROM CAMERA: DEPTH · FLICK: SPIN · QUICK PINCH: HOLO/SOLID · BOTH HANDS: RESIZE · DROP ON BIN: DISCARD"
                : "DRAG ITEM: MOVE · FLICK: SPIN · CLICK: HOLO/SOLID · DRAG SPACE: ORBIT · WHEEL: ZOOM · DROP ON BIN: DISCARD"}
        </p>
      </div>
    </>
  )
}
