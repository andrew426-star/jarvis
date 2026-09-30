"use client"

import { useRef, type PointerEvent, type WheelEvent } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { XIcon } from "lucide-react"

import { HOLOGRAM_WIDTH, useSpatial, type Hologram } from "@/lib/spatial-store"

// Floating cards in a shallow 3D space over the console. Hands move them
// through lib/hand-tracking.ts; the mouse gets the same actions here, so
// every hologram works with the camera off too.
//
// 2.5D, not 3D: the layer has perspective and each card lifts toward the
// viewer (translateZ) and tilts while held, which reads as depth without
// a 3D engine or a second render loop.
export function HologramLayer() {
  const holograms = useSpatial((state) => state.holograms)

  return (
    <div
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: 25, perspective: "1400px", perspectiveOrigin: "50% 40%" }}
    >
      <AnimatePresence>
        {holograms.map((hologram) => (
          <HologramCard key={hologram.id} hologram={hologram} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function HologramCard({ hologram }: { hologram: Hologram }) {
  const held = useSpatial((state) => state.grabbed.includes(hologram.id))
  const hovered = useSpatial((state) => state.hovered === hologram.id)
  const { grab, release, moveHologram, scaleHologram, removeHologram } = useSpatial.getState()
  const drag = useRef<{ x: number; y: number } | null>(null)

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    // Buttons inside the card (close) keep their own click.
    if ((event.target as HTMLElement).closest("button")) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY }
    grab(hologram.id)
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!drag.current) return
    moveHologram(hologram.id, event.clientX - drag.current.x, event.clientY - drag.current.y)
    drag.current = { x: event.clientX, y: event.clientY }
  }

  function onPointerUp() {
    if (!drag.current) return
    drag.current = null
    release(hologram.id)
  }

  // The mouse stand-in for a two-handed stretch.
  function onWheel(event: WheelEvent<HTMLElement>) {
    scaleHologram(hologram.id, hologram.scale * (event.deltaY < 0 ? 1.08 : 1 / 1.08))
  }

  const lit = held || hovered

  return (
    // Outer element owns position and depth; the motion element inside
    // owns the entrance and exit, so the two transforms never fight.
    <div
      data-holo-id={hologram.id}
      className="pointer-events-auto absolute top-0 left-0"
      style={{
        width: HOLOGRAM_WIDTH,
        zIndex: hologram.z,
        transform: `translate3d(${hologram.x}px, ${hologram.y}px, ${held ? 60 : 0}px) scale(${hologram.scale}) rotateX(${held ? 6 : 0}deg)`,
        transformOrigin: "top left",
        transformStyle: "preserve-3d",
        // Position is driven directly while held; only the lift eases.
        transition: held ? "none" : "transform 220ms ease-out",
        touchAction: "none",
        cursor: held ? "grabbing" : "grab",
        willChange: "transform",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <motion.article
        className="holo-card"
        data-lit={lit}
        initial={{ opacity: 0, scale: 0.6, rotateX: -25 }}
        animate={{ opacity: 1, scale: 1, rotateX: 0 }}
        exit={{ opacity: 0, scale: 0.7, rotateX: 20 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <header className="holo-card-header">
          <span className="t-label truncate-1">{hologram.title}</span>
          <button
            type="button"
            className="btn"
            onClick={() => removeHologram(hologram.id)}
            aria-label="Dismiss hologram"
            style={{ width: 20, height: 20, padding: 0 }}
          >
            <XIcon size={11} />
          </button>
        </header>
        {hologram.image && (
          // eslint-disable-next-line @next/next/no-img-element -- a local data URL; next/image cannot optimise it and the static export has no image server
          <img src={hologram.image} alt="Camera frame Jarvis looked at" className="holo-card-image" draggable={false} />
        )}
        <p className="holo-card-body">{hologram.body}</p>
      </motion.article>
    </div>
  )
}
