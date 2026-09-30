"use client"

import { useEffect, useRef } from "react"

import { subscribeHands } from "@/lib/hand-tracking"
import { useSpatial } from "@/lib/spatial-store"

// One reticle per tracked hand, over the whole console. Canvas rather than
// DOM so moving two cursors at camera rate costs no layout or React work.
// pointer-events: none keeps it out of the hit tests the gestures rely on.
export function HandCursors() {
  const tracking = useSpatial((state) => state.handsStatus === "tracking")
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!tracking) return
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener("resize", resize)

    const unsubscribe = subscribeHands((pointers) => {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight)
      // Read per frame so the cursors follow a mode switch mid-gesture.
      const rgb = getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").trim()
      for (const { x, y, pinching, pinchAmount } of pointers) {
        const radius = 18 - pinchAmount * 8

        context.shadowColor = `rgba(${rgb}, 0.9)`
        context.shadowBlur = pinching ? 18 : 10
        context.strokeStyle = `rgba(${rgb}, 0.95)`
        context.lineWidth = 1.5

        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.stroke()

        // Tick marks at the four compass points, like a targeting reticle.
        for (let i = 0; i < 4; i++) {
          const angle = (Math.PI / 2) * i
          context.beginPath()
          context.moveTo(x + Math.cos(angle) * (radius + 3), y + Math.sin(angle) * (radius + 3))
          context.lineTo(x + Math.cos(angle) * (radius + 8), y + Math.sin(angle) * (radius + 8))
          context.stroke()
        }

        // The centre fills as the fingers close, so a pinch is visible
        // before it registers.
        context.fillStyle = `rgba(${rgb}, ${0.15 + pinchAmount * 0.6})`
        context.beginPath()
        context.arc(x, y, Math.max(2, radius * pinchAmount * 0.7), 0, Math.PI * 2)
        context.fill()
      }
      context.shadowBlur = 0
    })

    return () => {
      unsubscribe()
      window.removeEventListener("resize", resize)
      context.clearRect(0, 0, window.innerWidth, window.innerHeight)
    }
  }, [tracking])

  if (!tracking) return null
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0"
      style={{ width: "100vw", height: "100vh", zIndex: 60 }}
      aria-hidden
    />
  )
}
