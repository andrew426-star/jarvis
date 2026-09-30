"use client"

import { useEffect, useRef } from "react"
import { EyeIcon, HandIcon, XIcon } from "lucide-react"

import { attachVideo } from "@/lib/camera"
import { subscribeHands } from "@/lib/hand-tracking"
import { useSpatial } from "@/lib/spatial-store"

// Pairs of landmark indices that make up the hand skeleton.
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

const HANDS_LABEL = { off: "HANDS", loading: "LOADING", tracking: "HANDS ON", error: "HANDS ERR" }

interface CameraPreviewProps {
  lookDisabled: boolean
  onLook: () => void
  onToggleHands: () => void
  onClose: () => void
}

// The camera's own window, bottom-left above the command bar. It is also
// the privacy indicator: whenever the camera is on, this is on screen
// with a live dot, and closing it turns the camera off.
export function CameraPreview({ lookDisabled, onLook, onToggleHands, onClose }: CameraPreviewProps) {
  const cameraOn = useSpatial((state) => state.cameraOn)
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
          CAM LIVE
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
      </div>
    </section>
  )
}
