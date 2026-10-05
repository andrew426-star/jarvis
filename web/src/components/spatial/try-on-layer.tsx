"use client"

import { useEffect, useRef } from "react"
import { FlipHorizontal2Icon, MinusIcon, PlusIcon, XIcon } from "lucide-react"

import { useTryOn } from "@/lib/ar/store"
import type { TryOnScene } from "@/lib/ar/tryon-scene"
import { getVideo } from "@/lib/camera"
import { useJarvis } from "@/lib/store"
import { compileScadCached } from "@/lib/workshop/openscad"
import { buildDesign } from "@/lib/workshop/project/assembly"
import { useProject } from "@/lib/workshop/project/store"
import { ANCHORS, type Anchor } from "@/lib/workshop/project/types"

// The try-on, inside the camera window: a canvas over the video, fitted
// and mirrored exactly like it, with the open project worn on Andrew, and
// a strip of controls - where to wear it, hologram or solid, size, and
// for the desk, drag to move and the wheel to turn it.

const ANCHOR_LABEL: Record<Anchor, string> = { face: "FACE", wrist: "WRIST", hand: "HAND", forearm: "FOREARM", desk: "DESK" }
const HINT: Record<Anchor, string> = {
  face: "FACE THE CAMERA",
  wrist: "HOLD YOUR WRIST UP, BACK OF THE HAND TO THE CAMERA",
  hand: "HOLD YOUR HAND UP",
  forearm: "HOLD YOUR FOREARM IN VIEW, HAND OPEN",
  desk: "DRAG TO MOVE · WHEEL TO TURN",
}

export function TryOnLayer({ mirrored, fit }: { mirrored: boolean; fit: "cover" | "contain" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<TryOnScene | null>(null)
  const active = useTryOn((s) => s.active)
  const chosen = useTryOn((s) => s.anchor)
  const mode = useTryOn((s) => s.mode)
  const scale = useTryOn((s) => s.scale)
  const flip = useTryOn((s) => s.flip)
  const desk = useTryOn((s) => s.desk)
  const status = useTryOn((s) => s.status)
  const detail = useTryOn((s) => s.detail)
  const project = useProject((s) => s.project)
  const version = useProject((s) => s.version)
  const anchor: Anchor = chosen ?? project?.wear?.anchor ?? "face"
  const drag = useRef<{ x: number; y: number; desk: typeof desk } | null>(null)

  // The scene lives while the try-on is on, and gets a fresh model when
  // the project or the way it is shown changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!active || !canvas || !project) return
    let disposed = false
    let scene: TryOnScene | null = null
    import("@/lib/ar/tryon-scene").then(async ({ TryOnScene }) => {
      if (disposed) return
      scene = new TryOnScene(canvas, getVideo, (s, d) => useTryOn.getState().setStatus(s, d ?? null))
      sceneRef.current = scene
      const group = project.wear?.group
      const shown = group
        ? { ...project, parts: project.parts.filter((p) => p.group === group), printed: project.printed.filter((p) => p.group === group) }
        : project
      const { zUp, failures } = await buildDesign(shown, compileScadCached, { placedOnly: true })
      if (disposed) return
      if (failures.length) useJarvis.getState().notify("warning", "Try-on", `${failures.length} printed part(s) did not compile.`)
      if (!zUp.children.length) {
        useTryOn.getState().setStatus("error", "Nothing to show: give the parts layout positions, or add printed parts.")
        return
      }
      scene.setModel(zUp, useTryOn.getState().mode)
      const wear = project.wear
      scene.setWear({ offset: wear?.offset ?? [0, 0, 0], rot: wear?.rot ?? [0, 0, 0], scale: (wear?.scale ?? 1) * useTryOn.getState().scale })
      scene.setFlip(useTryOn.getState().flip)
      scene.setDesk(useTryOn.getState().desk)
      await scene.setAnchor(anchor)
    })
    return () => {
      disposed = true
      scene?.dispose()
      sceneRef.current = null
    }
    // Scale, flip and desk are applied live below; these rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, version, mode, anchor])

  useEffect(() => {
    const wear = project?.wear
    sceneRef.current?.setWear({ offset: wear?.offset ?? [0, 0, 0], rot: wear?.rot ?? [0, 0, 0], scale: (wear?.scale ?? 1) * scale })
  }, [scale, project?.wear])
  useEffect(() => sceneRef.current?.setFlip(flip), [flip])
  useEffect(() => sceneRef.current?.setDesk(desk), [desk])

  if (!active) return null
  const set = useTryOn.getState().set
  const pill = { background: "rgba(2, 3, 6, 0.78)", borderRadius: "var(--radius)" }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
        style={{ transform: mirrored ? "scaleX(-1)" : undefined, pointerEvents: anchor === "desk" ? "auto" : "none", cursor: anchor === "desk" ? "move" : undefined, touchAction: "none" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, desk }
        }}
        onPointerMove={(e) => {
          const start = drag.current
          if (!start) return
          const rect = e.currentTarget.getBoundingClientRect()
          // Across the picture is about the desk's width at that distance.
          const perPx = (start.desk.distance * 1.2) / rect.width
          const dx = (e.clientX - start.x) * perPx * (mirrored ? -1 : 1)
          const dy = (e.clientY - start.y) * perPx
          set({ desk: { ...start.desk, x: start.desk.x + dx, distance: Math.max(20, Math.min(150, start.desk.distance + dy * 2)) } })
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => set({ desk: { ...desk, spin: desk.spin + (e.deltaY > 0 ? 10 : -10) } })}
      />

      <div className="absolute flex flex-col items-start" style={{ top: 6, right: 6, gap: 4 }}>
        <div className="flex" style={{ gap: 3, padding: 3, ...pill }} role="radiogroup" aria-label="Where to wear it">
          {ANCHORS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={anchor === a}
              className="btn"
              data-active={anchor === a}
              style={{ padding: "2px 6px", fontSize: 10 }}
              onClick={() => set({ anchor: a })}
            >
              {ANCHOR_LABEL[a]}
            </button>
          ))}
        </div>
        <div className="flex items-center" style={{ gap: 3, padding: 3, ...pill }}>
          <button type="button" className="btn" data-active={mode === "holo"} style={{ padding: "2px 6px", fontSize: 10 }} onClick={() => set({ mode: mode === "holo" ? "solid" : "holo" })} title="Hologram or real materials">
            {mode === "holo" ? "HOLO" : "SOLID"}
          </button>
          <button type="button" className="btn" style={{ width: 20, height: 20, padding: 0 }} onClick={() => set({ scale: Math.max(0.5, +(scale - 0.05).toFixed(2)) })} aria-label="Smaller">
            <MinusIcon size={11} className="mx-auto" />
          </button>
          <span className="t-time" style={{ minWidth: 34, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
          <button type="button" className="btn" style={{ width: 20, height: 20, padding: 0 }} onClick={() => set({ scale: Math.min(2, +(scale + 0.05).toFixed(2)) })} aria-label="Bigger">
            <PlusIcon size={11} className="mx-auto" />
          </button>
          {anchor !== "face" && anchor !== "desk" && (
            <button type="button" className="btn" data-active={flip} style={{ width: 20, height: 20, padding: 0 }} onClick={() => set({ flip: !flip })} title="On the wrong side of the hand? Flip it" aria-label="Flip to the other side">
              <FlipHorizontal2Icon size={11} className="mx-auto" />
            </button>
          )}
          <button type="button" className="btn" style={{ width: 20, height: 20, padding: 0 }} onClick={() => useTryOn.getState().stop()} aria-label="End the try-on">
            <XIcon size={11} className="mx-auto" />
          </button>
        </div>
      </div>

      {status !== "tracking" || anchor === "desk" ? (
        <span className="t-label pointer-events-none absolute" style={{ left: "50%", top: 8, transform: "translateX(-50%)", padding: "2px 8px", color: status === "error" ? "var(--warning)" : "var(--accent)", ...pill }}>
          {status === "loading"
            ? "LOADING TRACKING..."
            : status === "error"
              ? (detail ?? "TRACKING FAILED").toUpperCase()
              : `${project?.name.toUpperCase() ?? ""} · ${HINT[anchor]}`}
        </span>
      ) : null}
    </>
  )
}
