"use client"

import { useEffect, useRef } from "react"

import { BAND_COUNT, audioBands } from "@/lib/audio-amplitude"
import { BootStage } from "@/lib/use-boot"

// Symmetric EQ. The band array runs low to high frequency, and it is
// mirrored about the centre line so bass sits in the middle and treble
// runs out to both edges - the classic spectrum-analyser read, and the
// reason the shape stays legible even at a glance.
//
// Bars grow up and down from a centre axis rather than off a baseline,
// which is what makes it symmetric on both axes.

const BAR_COUNT = BAND_COUNT * 2
const MIN_SCALE = 0.04

interface FrequencyBarsProps {
  /** True while narration or the mic is actually feeding the analyser. */
  active: boolean
  bootStage: BootStage
  className?: string
}

export function FrequencyBars({ active, bootStage, className }: FrequencyBarsProps) {
  const barsRef = useRef<(HTMLDivElement | null)[]>([])
  const frameRef = useRef<number | null>(null)
  const smoothedRef = useRef<Float32Array>(new Float32Array(BAR_COUNT))
  const activeRef = useRef(active)

  // Mirrored into a ref so the animation loop can read the latest value
  // without being torn down and rebuilt on every idle/active flip.
  // Written in an effect, not during render: a ref write during render
  // is not safe under concurrent rendering, where React may render a
  // component it then throws away.
  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    const smoothed = smoothedRef.current

    const tick = (now: number) => {
      const bands = audioBands.current
      const isActive = activeRef.current

      for (let i = 0; i < BAR_COUNT; i++) {
        // Mirror: the centre two bars are band 0, the outer edges are
        // the highest band.
        const distanceFromCentre = Math.abs(i - (BAR_COUNT - 1) / 2)
        const band = Math.min(BAND_COUNT - 1, Math.floor(distanceFromCentre))

        let target: number
        if (isActive) {
          target = bands[band]
        } else {
          // Idle motion is openly decorative - there is no audio to
          // show, and a row of dead bars reads as broken rather than
          // quiet. Two detuned sines per bar so the pattern does not
          // visibly repeat.
          const phase = now / 1000
          target =
            0.05 +
            0.035 * Math.sin(phase * 1.3 + band * 0.55) +
            0.025 * Math.sin(phase * 2.1 - band * 0.31)
        }

        // Fast attack, slow release - the asymmetry is what makes an EQ
        // feel responsive instead of soupy.
        const rate = target > smoothed[i] ? 0.45 : 0.12
        smoothed[i] += (target - smoothed[i]) * rate

        const element = barsRef.current[i]
        if (element) {
          element.style.transform = `scaleY(${Math.max(MIN_SCALE, smoothed[i]).toFixed(3)})`
        }
      }

      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  const visible = bootStage >= BootStage.Panels

  return (
    <div
      className={`flex h-full w-full items-center justify-center gap-[2px] ${className ?? ""}`}
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 700ms ease-in-out",
      }}
      aria-hidden
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          ref={(element) => {
            barsRef.current[i] = element
          }}
          className="h-full w-full origin-center"
          style={{
            transform: `scaleY(${MIN_SCALE})`,
            background: `linear-gradient(to bottom,
              transparent 0%,
              hsl(var(--hue) var(--sat) 60% / 0.85) 22%,
              var(--hud-bright) 50%,
              hsl(var(--hue) var(--sat) 60% / 0.85) 78%,
              transparent 100%)`,
            willChange: "transform",
          }}
        />
      ))}
    </div>
  )
}
