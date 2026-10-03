"use client"

import { useEffect, useRef } from "react"
import { BellOffIcon, EyeIcon, HandIcon, ScanEyeIcon, XIcon } from "lucide-react"

import { attachVideo } from "@/lib/camera"
import { subscribeHands } from "@/lib/hand-tracking"
import type { WatchLevel } from "@/lib/jarvis-client"
import { useSpatial } from "@/lib/spatial-store"

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

interface CameraPreviewProps {
  lookDisabled: boolean
  onLook: () => void
  onToggleHands: () => void
  onSetWatch: (level: WatchLevel | null) => void
  onSnooze: () => void
  onClose: () => void
}

// The camera's own window, bottom-left above the command bar. It is also
// the privacy indicator: whenever the camera is on, this is on screen
// with a live dot, and closing it turns the camera off.
export function CameraPreview({
  lookDisabled,
  onLook,
  onToggleHands,
  onSetWatch,
  onSnooze,
  onClose,
}: CameraPreviewProps) {
  const cameraOn = useSpatial((state) => state.cameraOn)
  const watching = useSpatial((state) => state.watching)
  const handsStatus = useSpatial((state) => state.handsStatus)
  const canvasRef = useRef<HTMLCanvasElement>(null)

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
      for (const pointer of pointers) {
        // Mirrored to line up with the mirrored video underneath.
        const at = (i: number) => [(1 - pointer.landmarks[i].x) * width, pointer.landmarks[i].y * height]
        context.globalAlpha = 0.85
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

  if (!cameraOn) return null

  return (
    <section
      className="card glow-std fixed flex flex-col overflow-hidden"
      aria-label="Camera"
      style={{
        left: 12,
        bottom: 56 + 12,
        width: 248,
        // Above the workshop (35), so hands can be switched on from inside it.
        zIndex: 40,
        background: "rgba(5, 7, 14, 0.9)",
        borderColor: "rgba(var(--accent-rgb), 0.45)",
      }}
    >
      <header
        className="flex items-center justify-between"
        style={{ padding: "4px var(--sp-2)", borderBottom: "1px solid rgba(var(--accent-rgb), 0.2)" }}
      >
        <span className="t-label flex items-center" style={{ gap: 6, color: "var(--text-primary)" }}>
          <span className="live-dot" aria-hidden />
          {watching ? "WATCHING" : "CAM LIVE"}
        </span>
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
      </header>

      <div className="relative" style={{ aspectRatio: "16 / 9", background: "#000" }}>
        <video
          ref={attachVideo}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
          // A selfie view: moving your hand right moves it right on screen.
          style={{ transform: "scaleX(-1)" }}
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>

      <div className="flex items-center" style={{ gap: "var(--sp-2)", padding: "var(--sp-2)" }}>
        <button
          type="button"
          className="btn flex flex-1 items-center justify-center"
          onClick={onLook}
          disabled={lookDisabled}
          style={{ gap: 6, padding: "4px 8px" }}
          title="Ask Jarvis what he sees"
        >
          <EyeIcon size={13} /> LOOK
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

      {watching && (
        <div
          className="flex items-center"
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
    </section>
  )
}
