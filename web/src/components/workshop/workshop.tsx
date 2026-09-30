"use client"

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { BoxIcon, RotateCcwIcon, ScanEyeIcon, Trash2Icon, XIcon } from "lucide-react"

import { getVideo, startCamera, stopCamera } from "@/lib/camera"
import { setSpatialHandler, startHands, stopHands, subscribeHands } from "@/lib/hand-tracking"
import { sfx } from "@/lib/sfx"
import { useSpatial } from "@/lib/spatial-store"
import type { ItemMode, WorkshopScene } from "@/lib/workshop/scene"
import { CATALOGUE, type ItemSpec } from "@/lib/workshop/models"

type Focus = (ItemSpec & { id: string; mode: ItemMode }) | null

// A mouse press counts as a tap (toggle the item) under these limits, the
// same idea as the hand tracker's air tap.
const TAP_MS = 300
const TAP_PX = 6

// The 3D workshop, full-screen over the console. Hands reach it through
// setSpatialHandler (any pinch the DOM does not claim), the mouse through
// the pointer handlers below; both land on the same WorkshopScene calls.
export function Workshop() {
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
          <WorkshopStage onClose={() => setOpen(false)} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function WorkshopStage({ onClose }: { onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<WorkshopScene | null>(null)
  const pressRef = useRef<{ at: number; x: number; y: number } | null>(null)
  const [focus, setFocus] = useState<Focus>(null)
  const [ready, setReady] = useState(false)
  const [passthrough, setPassthrough] = useState(false)
  const [trackingError, setTrackingError] = useState<string | null>(null)
  const [bin, setBin] = useState<"idle" | "armed" | "discarded">("idle")
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
      // Something to hold on arrival: the reactor as a hologram.
      scene.spawn("reactor")
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
      setSpatialHandler(null)
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [])

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
          {trackingError
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
