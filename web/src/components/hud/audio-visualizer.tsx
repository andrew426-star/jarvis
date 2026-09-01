"use client"

import { useEffect, useRef } from "react"

import { BAND_COUNT, audioBands } from "@/lib/audio-amplitude"
import type { AgentStatus } from "@/lib/store"

// 48 bars at 60fps is ~2900 draws a second. Canvas rather than 48 DOM
// nodes with animated transforms: one paint per frame instead of 48
// composited layers, and no style recalculation at all.
//
// Bars mirror about the centre, so low frequencies sit in the middle and
// highs run out to both edges - the classic spectrum read.

const BAR_COUNT = 48
const BAR_WIDTH = 3
const BAR_GAP = 2
const MIN_H = 4
const MAX_H = 60
const CANVAS_H = 64

interface AudioVisualizerProps {
  status: AgentStatus
  visible: boolean
}

export function AudioVisualizer({ status, visible }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<number | null>(null)
  const heightsRef = useRef<Float32Array>(new Float32Array(BAR_COUNT).fill(MIN_H))
  const statusRef = useRef(status)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext("2d")
    if (!context) return

    let width = 0
    let height = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = CANVAS_H
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.floor(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const accent = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#00d4ff"

    let accentColor = accent()
    let accentCheckedAt = 0

    const draw = (now: number) => {
      const current = statusRef.current
      const live = current === "speaking" || current === "listening"
      const heights = heightsRef.current

      // The accent changes only on a mode toggle; re-reading a computed
      // style every frame would be a needless layout read.
      if (now - accentCheckedAt > 500) {
        accentColor = accent()
        accentCheckedAt = now
      }

      const bands = audioBands.current

      for (let i = 0; i < BAR_COUNT; i++) {
        const distance = Math.abs(i - (BAR_COUNT - 1) / 2)
        const band = Math.min(BAND_COUNT - 1, Math.floor(distance * (BAND_COUNT / (BAR_COUNT / 2))))

        let target: number
        if (live) {
          const energy = bands[band]
          target = MIN_H + energy * (MAX_H - MIN_H) * (current === "speaking" ? 1 : 0.85)
        } else {
          // Idle: 2-8px of drift. Openly decorative - there is no audio
          // to show, and a row of dead bars reads as broken, not quiet.
          const phase = now / 1000
          target =
            MIN_H +
            2 * Math.sin(phase * 1.1 + band * 0.5) +
            1.5 * Math.sin(phase * 1.9 - band * 0.3)
        }

        // Linear interpolation, asymmetric: fast attack, slow release.
        // That asymmetry is what makes an EQ feel responsive rather than
        // soupy.
        const rate = target > heights[i] ? 0.4 : 0.12
        heights[i] += (target - heights[i]) * rate
      }

      context.clearRect(0, 0, width, height)

      const totalWidth = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP
      const startX = (width - totalWidth) / 2
      const midY = height / 2

      context.save()
      context.fillStyle = accentColor
      context.globalAlpha = live ? 1 : 0.3
      context.shadowColor = accentColor
      context.shadowBlur = live ? 8 : 3

      for (let i = 0; i < BAR_COUNT; i++) {
        const barHeight = Math.max(MIN_H, heights[i])
        const x = startX + i * (BAR_WIDTH + BAR_GAP)
        // Grows both ways from the centre line - symmetric on both axes.
        context.fillRect(x, midY - barHeight / 2, BAR_WIDTH, barHeight)
      }
      context.restore()

      frameRef.current = requestAnimationFrame(draw)
    }

    frameRef.current = requestAnimationFrame(draw)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      observer.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{
        height: `${CANVAS_H}px`,
        opacity: visible ? 1 : 0,
        transition: "opacity 500ms ease",
      }}
      aria-hidden
    />
  )
}
