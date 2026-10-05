"use client"

import { useEffect, useRef, useState } from "react"
import {
  BellOffIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GlassesIcon,
  FlipHorizontalIcon,
  HandIcon,
  Maximize2Icon,
  Minimize2Icon,
  ScanEyeIcon,
  XIcon,
} from "lucide-react"

import { CoreCipher } from "@/components/hud/core-cipher"
import { TryOnLayer } from "@/components/spatial/try-on-layer"
import { useTryOn } from "@/lib/ar/store"
import { attachVideo } from "@/lib/camera"
import { subscribeHands } from "@/lib/hand-tracking"
import type { WatchLevel } from "@/lib/jarvis-client"
import { useSpatial } from "@/lib/spatial-store"
import { useJarvis } from "@/lib/store"
import { useProject } from "@/lib/workshop/project/store"

// Pairs of landmark indices that make up the hand skeleton.
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

const WATCH_LEVELS: { level: WatchLevel; label: string; title: string }[] = [
  { level: "quiet", label: "QUIET", title: "Only clear mistakes" },
  { level: "normal", label: "NORMAL", title: "Mistakes and useful nudges" },
  { level: "coach", label: "COACH", title: "Plus a hint when you seem stuck" },
]

const HANDS_LABEL = { off: "HANDS", loading: "LOADING", tracking: "HANDS ON", error: "HANDS ERR" }

// Top bar 48px, bottom bar 56px: the window lives between them.
const TOP = 48
const BOTTOM = 56
const GUTTER = 12
const MIN_WIDTH = 240
const DEFAULT_WIDTH = 400
// The core joins the video once there is room for it beside the picture.
const CORE_MIN_WIDTH = 320
const CAPTION_MS = 10_000

const LAYOUT_KEY = "jarvis_camera_window"

// In the workshop the window docks into the corner under the library (which
// leaves room for it) at the library's width, without the core or captions,
// so the stage stays clear. It can fold down to its header there.
const DOCK_WIDTH = 244
const DOCK_GUTTER = 12
const DOCK_FOLDED_KEY = "jarvis_camera_docked_folded"

const MODE_LABEL = { hands: "HANDS", degraded: "HANDS LOST", pointer: "MOUSE" }

interface Layout {
  x: number
  y: number
  width: number
  /** Raw (unmirrored) picture: a whiteboard's writing reads the right way round. */
  flipped: boolean
}

function loadLayout(): Partial<Layout> {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as Partial<Layout>
  } catch {
    return {}
  }
}

function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // Storage blocked: the window simply starts in the corner next time.
  }
}

/** Kept inside the space between the bars, whatever the window size. */
function clamp(layout: Layout, height: number): Layout {
  const width = Math.min(Math.max(MIN_WIDTH, layout.width), window.innerWidth - GUTTER * 2)
  const maxY = window.innerHeight - BOTTOM - GUTTER - height
  return {
    ...layout,
    width,
    x: Math.min(Math.max(GUTTER, layout.x), window.innerWidth - width - GUTTER),
    y: Math.max(TOP + GUTTER, Math.min(layout.y, maxY)),
  }
}

function initialLayout(): Layout {
  const saved = loadLayout()
  const width = saved.width ?? DEFAULT_WIDTH
  const estimate = (width * 9) / 16 + 80
  return clamp(
    {
      x: saved.x ?? GUTTER,
      y: saved.y ?? window.innerHeight - BOTTOM - GUTTER - estimate,
      width,
      flipped: saved.flipped ?? false,
    },
    estimate
  )
}

interface CameraPreviewProps {
  onToggleHands: () => void
  onSetWatch: (level: WatchLevel | null) => void
  onSnooze: () => void
  onClose: () => void
  /** Talk to Jarvis (or cut him off), from the core in the corner. */
  onCoreToggle: () => void
  /** His latest reply, captioned over the picture while it is fresh. */
  caption: { id: string; text: string } | null
}

// The camera's own window. It is also the privacy indicator: whenever the
// camera is on, this is on screen with a live dot, and closing it turns
// the camera off.
//
// It is built to be worked through, not glanced at: drag it by its
// header, resize it from the corner, or FOCUS it to fill the console
// between the bars. Jarvis's core sits in the picture's corner, live, so
// his state (listening, thinking, speaking) is in view without looking
// away, and his replies run as captions along the bottom.
export function CameraPreview({
  onToggleHands,
  onSetWatch,
  onSnooze,
  onClose,
  onCoreToggle,
  caption,
}: CameraPreviewProps) {
  const cameraOn = useSpatial((state) => state.cameraOn)
  const watching = useSpatial((state) => state.watching)
  const watchLooking = useSpatial((state) => state.watchLooking)
  const handsStatus = useSpatial((state) => state.handsStatus)
  const inputMode = useSpatial((state) => state.inputMode)
  const handConfidence = useSpatial((state) => state.handConfidence)
  const workshopOpen = useSpatial((state) => state.workshopOpen)
  const status = useJarvis((state) => state.status)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const tryingOn = useTryOn((state) => state.active)
  const hasProject = useProject((state) => !!state.project)
  // The camera going off ends the try-on; it does not wait to resume.
  useEffect(() => {
    if (!cameraOn) useTryOn.getState().stop()
  }, [cameraOn])

  // Where it was left, else bottom-left above the command bar, where it
  // has always been. The console only renders in the browser, but the
  // guard keeps a prerender from touching window.
  const [layout, setLayout] = useState<Layout | null>(() => (typeof window === "undefined" ? null : initialLayout()))
  const [focused, setFocused] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [folded, setFolded] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(DOCK_FOLDED_KEY) === "1"
    } catch {
      return false
    }
  })
  // A try-on wants room: it fills the console while it runs.
  const [wasTrying, setWasTrying] = useState(false)
  if (tryingOn !== wasTrying) {
    setWasTrying(tryingOn)
    if (tryingOn) setFocused(true)
  }
  const docked = workshopOpen && !focused
  // Jarvis is told when the camera covers the chat, so he puts what is
  // longer than a sentence in a window instead (lib/console-commands.ts).
  const covering = cameraOn && focused
  useEffect(() => {
    useSpatial.getState().setCameraFocused(covering)
    return () => useSpatial.getState().setCameraFocused(false)
  }, [covering])
  const flippedRef = useRef(false)
  useEffect(() => {
    flippedRef.current = layout?.flipped ?? false
  }, [layout?.flipped])

  // A smaller browser window must not strand it off screen.
  useEffect(() => {
    if (!cameraOn) return
    const onResize = () =>
      setLayout((current) => (current ? clamp(current, sectionRef.current?.offsetHeight ?? 0) : current))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [cameraOn])

  // Skeleton overlay, drawn straight from tracking results rather than
  // through React state, which would re-render this at camera rate.
  useEffect(() => {
    if (!cameraOn) return
    return subscribeHands((pointers) => {
      const canvas = canvasRef.current
      const context = canvas?.getContext("2d")
      if (!canvas || !context) return
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      context.clearRect(0, 0, width, height)
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
      context.strokeStyle = accent
      context.fillStyle = accent
      context.lineWidth = 1.5
      const mirrored = !flippedRef.current
      for (const pointer of pointers) {
        // A hand the tracker does not trust is drawn faint: seen, not acting.
        const strength = pointer.active ? 1 : 0.35
        // Lined up with the video underneath, mirrored or not.
        const at = (i: number) => {
          const x = pointer.landmarks[i].x
          return [(mirrored ? 1 - x : x) * width, pointer.landmarks[i].y * height]
        }
        context.globalAlpha = 0.85 * strength
        for (const [a, b] of BONES) {
          const [ax, ay] = at(a)
          const [bx, by] = at(b)
          context.beginPath()
          context.moveTo(ax, ay)
          context.lineTo(bx, by)
          context.stroke()
        }
        for (const tip of [4, 8]) {
          const [x, y] = at(tip)
          context.beginPath()
          context.arc(x, y, pointer.pinching ? 4 : 2.5, 0, Math.PI * 2)
          context.fill()
        }
      }
    })
  }, [cameraOn])

  // A caption shows while the reply is fresh, and goes once it has been
  // still for a while.
  // Keyed on the text too, so a reply still streaming in stays up.
  const captionText = caption?.text ?? ""
  const captionKey = `${caption?.id ?? ""}:${captionText.length}`
  const [expiredCaption, setExpiredCaption] = useState<string | null>(null)
  const captionShown = Boolean(captionText) && expiredCaption !== captionKey
  useEffect(() => {
    if (!captionText) return
    const timer = setTimeout(() => setExpiredCaption(captionKey), CAPTION_MS)
    return () => clearTimeout(timer)
  }, [captionKey, captionText])

  if (!cameraOn || !layout) return null

  function update(next: Layout) {
    const fitted = clamp(next, sectionRef.current?.offsetHeight ?? 0)
    setLayout(fitted)
    return fitted
  }

  // Pointer capture keeps the drag going when the pointer outruns the
  // header, and the final position is saved once, on release.
  function startDrag(event: React.PointerEvent) {
    if (focused || docked || (event.target as HTMLElement).closest("button")) return
    const start = { x: event.clientX, y: event.clientY, layout: layout! }
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    setDragging(true)
    let last = start.layout
    const move = (e: PointerEvent) => {
      last = update({ ...start.layout, x: start.layout.x + e.clientX - start.x, y: start.layout.y + e.clientY - start.y })
    }
    const end = () => {
      target.removeEventListener("pointermove", move)
      target.removeEventListener("pointerup", end)
      target.removeEventListener("pointercancel", end)
      setDragging(false)
      saveLayout(last)
    }
    target.addEventListener("pointermove", move)
    target.addEventListener("pointerup", end)
    target.addEventListener("pointercancel", end)
  }

  function startResize(event: React.PointerEvent) {
    event.stopPropagation()
    const start = { x: event.clientX, layout: layout! }
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    setDragging(true)
    let last = start.layout
    const move = (e: PointerEvent) => {
      last = update({ ...start.layout, width: start.layout.width + e.clientX - start.x })
    }
    const end = () => {
      target.removeEventListener("pointermove", move)
      target.removeEventListener("pointerup", end)
      target.removeEventListener("pointercancel", end)
      setDragging(false)
      saveLayout(last)
    }
    target.addEventListener("pointermove", move)
    target.addEventListener("pointerup", end)
    target.addEventListener("pointercancel", end)
  }

  function flip() {
    saveLayout(update({ ...layout!, flipped: !layout!.flipped }))
  }

  function fold(next: boolean) {
    setFolded(next)
    try {
      localStorage.setItem(DOCK_FOLDED_KEY, next ? "1" : "0")
    } catch {
      // Remembered for this session only.
    }
  }

  const width = focused ? window.innerWidth - GUTTER * 2 : docked ? DOCK_WIDTH : layout.width
  const showCore = !docked && width >= CORE_MIN_WIDTH
  const coreSize = focused ? 150 : Math.round(Math.min(120, Math.max(64, width * 0.2)))
  const showCaption = !docked && captionShown && captionText && width >= CORE_MIN_WIDTH
  const showBody = !(docked && folded)

  return (
    <section
      ref={sectionRef}
      className="card glow-std fixed flex flex-col overflow-hidden"
      aria-label="Camera"
      style={{
        ...(focused
          ? { left: GUTTER, right: GUTTER, top: TOP + GUTTER, bottom: BOTTOM + GUTTER }
          : docked
            ? { left: DOCK_GUTTER, bottom: DOCK_GUTTER, width: DOCK_WIDTH, opacity: 0.92 }
            : { left: layout.x, top: layout.y, width: layout.width }),
        // Above the workshop (35), so hands can be switched on from inside it.
        zIndex: 40,
        background: "rgba(5, 7, 14, 0.92)",
        borderColor: "rgba(var(--accent-rgb), 0.45)",
        transition: dragging ? "none" : "left 200ms ease, top 200ms ease, width 200ms ease",
        userSelect: dragging ? "none" : undefined,
      }}
    >
      <header
        className="flex shrink-0 items-center justify-between"
        onPointerDown={startDrag}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) setFocused((f) => !f)
        }}
        style={{
          padding: "4px var(--sp-2)",
          borderBottom: "1px solid rgba(var(--accent-rgb), 0.2)",
          cursor: focused || docked ? "default" : dragging ? "grabbing" : "grab",
          touchAction: "none",
        }}
        title={focused ? undefined : docked ? "Double-click to focus" : "Drag to move · double-click to focus"}
      >
        <span className="t-label flex items-center" style={{ gap: 6, color: "var(--text-primary)" }}>
          <span className="live-dot" aria-hidden />
          {watching ? (watchLooking ? "READING THE BOARD…" : `WATCHING · ${watching.toUpperCase()}`) : "CAM LIVE"}
        </span>
        <div className="flex items-center" style={{ gap: 4 }}>
          {docked && (
            <button
              type="button"
              className="btn"
              onClick={() => fold(!folded)}
              aria-label={folded ? "Show the picture" : "Fold the camera down"}
              title={folded ? "Show the picture" : "Fold down to this bar"}
              style={{ width: 22, height: 22, padding: 0 }}
            >
              {folded ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={flip}
            data-active={layout.flipped}
            aria-pressed={layout.flipped}
            aria-label="Flip the picture"
            title={layout.flipped ? "Mirror the picture (selfie view)" : "Unmirror the picture (reads writing the right way round)"}
            style={{ width: 22, height: 22, padding: 0 }}
          >
            <FlipHorizontalIcon size={12} />
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setFocused((f) => !f)}
            data-active={focused}
            aria-pressed={focused}
            aria-label={focused ? "Back to a window" : "Focus the camera"}
            title={focused ? "Back to a window" : "Focus: fill the console"}
            style={{ width: 22, height: 22, padding: 0 }}
          >
            {focused ? <Minimize2Icon size={12} /> : <Maximize2Icon size={12} />}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            aria-label="Turn camera off"
            title="Turn camera off"
            style={{ width: 22, height: 22, padding: 0 }}
          >
            <XIcon size={12} />
          </button>
        </div>
      </header>

      <div
        className={`relative ${focused ? "min-h-0 flex-1" : ""}`}
        // Folded, the picture is hidden rather than removed: the video
        // element must stay mounted for tracking and looks to keep working.
        style={{ aspectRatio: focused ? undefined : "16 / 9", background: "#000", display: showBody ? undefined : "none" }}
      >
        <video
          ref={attachVideo}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 h-full w-full ${focused ? "object-contain" : "object-cover"}`}
          // Mirrored by default, a selfie view: moving your hand right moves
          // it right on screen. Flipped, it is the raw picture, which is
          // how a whiteboard's writing reads.
          style={{ transform: layout.flipped ? undefined : "scaleX(-1)" }}
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        <TryOnLayer mirrored={!layout.flipped} fit={focused ? "contain" : "cover"} />

        {handsStatus === "tracking" && (
          <span
            className="t-label pointer-events-none absolute"
            style={{
              top: 6,
              left: 6,
              padding: "2px 6px",
              background: "rgba(2, 3, 6, 0.72)",
              borderRadius: "var(--radius)",
              color: inputMode === "hands" ? "var(--accent)" : inputMode === "degraded" ? "var(--warning)" : "var(--text-secondary)",
            }}
            title="Who is driving: your hands, or the mouse while they are out of view or unsure"
          >
            {MODE_LABEL[inputMode]}
            {inputMode !== "pointer" || handConfidence > 0 ? ` · ${Math.round(handConfidence * 100)}%` : ""}
          </span>
        )}

        {showCaption && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: GUTTER,
              right: showCore ? coreSize + GUTTER : GUTTER,
              bottom: GUTTER,
              display: "flex",
              justifyContent: "center",
            }}
            aria-live="polite"
          >
            <p
              style={{
                margin: 0,
                padding: "6px 12px",
                maxWidth: 760,
                background: "rgba(2, 3, 6, 0.72)",
                borderLeft: "2px solid var(--accent)",
                borderRadius: "var(--radius)",
                color: "var(--text-primary)",
                fontSize: focused ? 15 : 12.5,
                lineHeight: 1.45,
                display: "-webkit-box",
                WebkitLineClamp: focused ? 4 : 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {captionText}
            </p>
          </div>
        )}

        {showCore && (
          <div
            className="absolute"
            style={{ right: 4, bottom: 4, width: coreSize, height: coreSize }}
            title="Talk to Jarvis"
          >
            <CoreCipher status={status} onToggle={onCoreToggle} ringsRevealed={3} />
          </div>
        )}
      </div>

      <div
        className="flex shrink-0 items-center"
        style={{ gap: "var(--sp-2)", padding: "var(--sp-2)", display: showBody ? undefined : "none" }}
      >
        <button
          type="button"
          className="btn flex flex-1 items-center justify-center"
          onClick={() => (tryingOn ? useTryOn.getState().stop() : useTryOn.getState().start())}
          disabled={!hasProject && !tryingOn}
          data-active={tryingOn}
          aria-pressed={tryingOn}
          style={{ gap: 6, padding: "4px 8px" }}
          title={hasProject ? "Wear the open project: a hologram of it on you, live" : "Open a project in the workshop to try it on"}
        >
          <GlassesIcon size={13} /> TRY ON
        </button>
        <button
          type="button"
          className="btn flex flex-1 items-center justify-center"
          onClick={onToggleHands}
          data-active={handsStatus === "tracking"}
          disabled={handsStatus === "loading"}
          aria-pressed={handsStatus === "tracking"}
          style={{ gap: 6, padding: "4px 8px" }}
          title="Control the console with your hands"
        >
          <HandIcon size={13} /> {HANDS_LABEL[handsStatus]}
        </button>
        <button
          type="button"
          className="btn flex flex-1 items-center justify-center"
          onClick={() => onSetWatch(watching ? null : "normal")}
          data-active={Boolean(watching)}
          aria-pressed={Boolean(watching)}
          style={{ gap: 6, padding: "4px 8px" }}
          title="Let Jarvis follow your whiteboard and speak up when it helps"
        >
          <ScanEyeIcon size={13} /> WATCH
        </button>
      </div>

      {watching && !docked && (
        <div
          className="flex shrink-0 items-center"
          style={{ gap: "var(--sp-1)", padding: "0 var(--sp-2) var(--sp-2)" }}
          role="group"
          aria-label="How readily Jarvis speaks up"
        >
          {WATCH_LEVELS.map(({ level, label, title }) => (
            <button
              key={level}
              type="button"
              className="btn flex-1"
              onClick={() => onSetWatch(level)}
              data-active={watching === level}
              aria-pressed={watching === level}
              style={{ padding: "2px 4px", fontSize: 10 }}
              title={title}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="btn flex items-center justify-center"
            onClick={onSnooze}
            aria-label="Quiet for 15 minutes"
            title="Quiet for 15 minutes"
            style={{ width: 24, height: 22, padding: 0 }}
          >
            <BellOffIcon size={12} />
          </button>
        </div>
      )}

      {!focused && !docked && (
        <div
          onPointerDown={startResize}
          className="absolute"
          style={{
            right: 0,
            bottom: 0,
            width: 16,
            height: 16,
            cursor: "nwse-resize",
            touchAction: "none",
            background:
              "linear-gradient(135deg, transparent 50%, rgba(var(--accent-rgb), 0.6) 50%, rgba(var(--accent-rgb), 0.6) 60%, transparent 60%, transparent 70%, rgba(var(--accent-rgb), 0.6) 70%, rgba(var(--accent-rgb), 0.6) 80%, transparent 80%)",
          }}
          aria-label="Resize the camera window"
          title="Drag to resize"
        />
      )}
    </section>
  )
}
