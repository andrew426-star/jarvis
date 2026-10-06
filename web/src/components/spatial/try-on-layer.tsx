"use client"

import { useEffect, useRef } from "react"
import { FlipHorizontal2Icon, HandIcon, Layers3Icon, MinusIcon, PlusIcon, XIcon, ZapIcon } from "lucide-react"

import { resolveActions, resolveCue } from "@/lib/ar/actions"
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
// a strip of controls - where to wear it, hologram or real materials,
// size, and for the desk, drag to move and the wheel to turn it - and the
// project's actions: a button each (Space fires the first), and whether
// his gestures fire them.

const ANCHOR_LABEL: Record<Anchor, string> = {
  face: "FACE",
  chest: "CHEST",
  shoulder: "SHOULDER",
  upper_arm: "ARM",
  forearm: "FOREARM",
  wrist: "WRIST",
  hand: "HAND",
  desk: "DESK",
}
const HINT: Record<Anchor, string> = {
  face: "FACE THE CAMERA",
  chest: "STEP BACK SO YOUR SHOULDERS ARE IN VIEW",
  shoulder: "STEP BACK SO YOUR SHOULDERS ARE IN VIEW",
  upper_arm: "STEP BACK SO YOUR SHOULDER AND ELBOW ARE IN VIEW",
  wrist: "HOLD YOUR WRIST UP, BACK OF THE HAND TO THE CAMERA",
  hand: "HOLD YOUR HAND UP",
  forearm: "HOLD YOUR FOREARM IN VIEW, HAND OPEN",
  desk: "DRAG TO MOVE · WHEEL TO TURN · DEPTH ON: CLICK A SURFACE TO SET IT THERE",
}
/** What to do to fire, by cue. */
const CUE_HINT: Record<string, string> = {
  palm: "OPEN PALM TO THE CAMERA",
  fist: "MAKE A FIST",
  point: "POINT",
  thwip: "INDEX + PINKY OUT, MIDDLE FINGERS IN",
  jaw: "OPEN YOUR MOUTH",
  raise: "RAISE A HAND ABOVE YOUR SHOULDER",
  button: "BUTTON / SPACE",
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
  const depth = useTryOn((s) => s.depth)
  const depthText = useTryOn((s) => s.depthText)
  const depthReady = useTryOn((s) => s.depthReady)
  const detail = useTryOn((s) => s.detail)
  const actions = useTryOn((s) => s.actions)
  const gestures = useTryOn((s) => s.gestures)
  const fire = useTryOn((s) => s.fire)
  const hot = useTryOn((s) => s.flash)
  const project = useProject((s) => s.project)
  const version = useProject((s) => s.version)
  const anchor: Anchor = chosen ?? project?.wear?.anchor ?? "face"
  /** The last fire request the scene has had. */
  const handled = useRef(0)
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
      scene = new TryOnScene(
        canvas,
        getVideo,
        (s, d) => useTryOn.getState().setStatus(s, d ?? null),
        (text, ready) => useTryOn.getState().setDepthStatus(text, ready),
        (name) => useTryOn.getState().fired(name)
      )
      sceneRef.current = scene
      const group = project.wear?.group
      const shown = group
        ? { ...project, parts: project.parts.filter((p) => p.group === group), printed: project.printed.filter((p) => p.group === group) }
        : project
      const { zUp, rig, failures } = await buildDesign(shown, compileScadCached, { placedOnly: true })
      if (disposed) return
      if (failures.length) useJarvis.getState().notify("warning", "Try-on", `${failures.length} printed part(s) did not compile.`)
      if (!zUp.children.length) {
        useTryOn.getState().setStatus("error", "Nothing to show: give the parts layout positions, or add printed parts.")
        return
      }
      scene.setModel(zUp, useTryOn.getState().mode)
      // Segments that follow a body point of their own (the hand plate on
      // the hand, the controller on the arm), wires stretching between.
      scene.setRig(rig)
      const wear = project.wear
      scene.setWear({ offset: wear?.offset ?? [0, 0, 0], rot: wear?.rot ?? [0, 0, 0], scale: (wear?.scale ?? 1) * useTryOn.getState().scale })
      scene.setFlip(useTryOn.getState().flip)
      scene.setDesk(useTryOn.getState().desk)
      await scene.setAnchor(anchor)
      scene.setDepth(useTryOn.getState().depth)
      const worn = resolveActions(project, anchor)
      scene.setGestures(useTryOn.getState().gestures)
      scene.setActions(worn)
      useTryOn.getState().setActions(worn.map((a) => ({ name: a.name, cue: resolveCue(a.cue, anchor) })))
      // A fire asked for while it was starting up (Jarvis: try it on and fire).
      const asked = useTryOn.getState().fire
      if (asked.seq > handled.current && Date.now() - asked.at < 10_000) scene.press(asked.name ?? undefined)
      handled.current = asked.seq
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
  useEffect(() => sceneRef.current?.setDepth(depth), [depth])
  useEffect(() => sceneRef.current?.setGestures(gestures), [gestures])
  useEffect(() => {
    if (!fire.seq || !sceneRef.current) return
    sceneRef.current.press(fire.name ?? undefined)
    handled.current = fire.seq
  }, [fire])
  // Space fires the first action (not while typing).
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.code !== "Space" || e.repeat || el?.closest("input, textarea, [contenteditable=true]")) return
      if (!useTryOn.getState().actions.length) return
      e.preventDefault()
      useTryOn.getState().press(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active])

  /** A pointer position as a point of the (unmirrored) picture, 0-1,
   *  through the canvas's own fit and mirroring. */
  function pictureAt(event: React.PointerEvent<HTMLCanvasElement>) {
    const el = event.currentTarget
    const rect = el.getBoundingClientRect()
    const W = el.width || 1
    const H = el.height || 1
    const scale = fit === "cover" ? Math.max(rect.width / W, rect.height / H) : Math.min(rect.width / W, rect.height / H)
    const left = rect.left + (rect.width - W * scale) / 2
    const top = rect.top + (rect.height - H * scale) / 2
    let u = (event.clientX - left) / (W * scale)
    const v = (event.clientY - top) / (H * scale)
    if (mirrored) u = 1 - u
    return { u, v }
  }

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
        onPointerUp={(e) => {
          const start = drag.current
          drag.current = null
          // A click (no drag) with depth on: set it on the surface there.
          if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return
          const { u, v } = pictureAt(e)
          const spot = sceneRef.current?.surfaceAt(u, v)
          if (spot) set({ desk: spot })
        }}
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
          <button type="button" className="btn" data-active={mode === "holo"} style={{ padding: "2px 6px", fontSize: 10 }} onClick={() => set({ mode: mode === "holo" ? "solid" : "holo" })} title="Hologram, or real materials lit by your room">
            {mode === "holo" ? "HOLO" : "REAL"}
          </button>
          <button type="button" className="btn" style={{ width: 20, height: 20, padding: 0 }} onClick={() => set({ scale: Math.max(0.5, +(scale - 0.05).toFixed(2)) })} aria-label="Smaller">
            <MinusIcon size={11} className="mx-auto" />
          </button>
          <span className="t-time" style={{ minWidth: 34, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
          <button type="button" className="btn" style={{ width: 20, height: 20, padding: 0 }} onClick={() => set({ scale: Math.min(2, +(scale + 0.05).toFixed(2)) })} aria-label="Bigger">
            <PlusIcon size={11} className="mx-auto" />
          </button>
          <button
            type="button"
            className="btn flex items-center"
            data-active={depth}
            style={{ gap: 3, padding: "2px 6px", fontSize: 10 }}
            onClick={() => set({ depth: !depth })}
            title="Scene depth (Depth Anything V2, in your browser): real things in front hide the hologram, and desk items sit on real surfaces. First use downloads the model (~50 MB)."
          >
            <Layers3Icon size={10} /> DEPTH
          </button>
          {anchor !== "face" && anchor !== "desk" && anchor !== "chest" && (
            <button type="button" className="btn" data-active={flip} style={{ width: 20, height: 20, padding: 0 }} onClick={() => set({ flip: !flip })} title={anchor === "shoulder" || anchor === "upper_arm" ? "Wear it on the other side" : "On the wrong side of the hand? Flip it"} aria-label="Flip to the other side">
              <FlipHorizontal2Icon size={11} className="mx-auto" />
            </button>
          )}
          <button type="button" className="btn" style={{ width: 20, height: 20, padding: 0 }} onClick={() => useTryOn.getState().stop()} aria-label="End the try-on">
            <XIcon size={11} className="mx-auto" />
          </button>
        </div>
      </div>

      {actions.length > 0 && (
        <div className="absolute flex flex-col items-end" style={{ right: 6, bottom: 6, gap: 4 }}>
          <div className="flex items-center" style={{ gap: 3, padding: 3, ...pill }}>
            <button
              type="button"
              className="btn flex items-center"
              data-active={gestures}
              style={{ gap: 3, padding: "2px 6px", fontSize: 10 }}
              onClick={() => set({ gestures: !gestures })}
              title="Fire the actions with gestures (the buttons and Space always work)"
            >
              <HandIcon size={10} /> GESTURES
            </button>
            {actions.map((a, i) => {
              return (
                <button
                  key={a.name}
                  type="button"
                  className="btn flex items-center"
                  data-active={hot === a.name}
                  style={{ gap: 3, padding: "2px 6px", fontSize: 10 }}
                  onClick={() => useTryOn.getState().press(a.name)}
                  title={`${a.name}: ${gestures ? CUE_HINT[a.cue] ?? "BUTTON" : "BUTTON"}${i === 0 ? " · SPACE" : ""}`}
                >
                  <ZapIcon size={10} /> {a.name.toUpperCase()}
                </button>
              )
            })}
          </div>
          {gestures && status === "tracking" && (
            <span className="t-label pointer-events-none" style={{ padding: "2px 8px", color: "var(--accent)", ...pill }}>
              {actions.map((a) => `${a.name.toUpperCase()}: ${CUE_HINT[a.cue] ?? "BUTTON"}`).join(" · ")}
            </span>
          )}
        </div>
      )}

      {depth && depthText && (
        <span className="t-label pointer-events-none absolute" style={{ left: 6, bottom: 6, padding: "2px 8px", color: depthReady ? "var(--accent)" : "var(--warning)", ...pill }}>
          {depthText}
        </span>
      )}

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
