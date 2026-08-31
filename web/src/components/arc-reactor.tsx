"use client"

import { useEffect, useRef } from "react"

import { audioAmplitude } from "@/lib/audio-amplitude"
import { BootStage } from "@/lib/use-boot"

export type CoreState = "idle" | "thinking" | "speaking" | "listening"

// Rotation period in seconds per state - lower is faster. Idle turns
// slowly enough to read as alive rather than busy; thinking is the only
// state that should look like effort.
const SPIN_SECONDS: Record<CoreState, number> = {
  idle: 26,
  listening: 18,
  thinking: 7,
  speaking: 14,
}

// Breathing period. Speaking and listening barely breathe on their own
// because real audio amplitude is driving them instead.
const BREATHE_SECONDS: Record<CoreState, number> = {
  idle: 4.5,
  listening: 2.4,
  thinking: 1.5,
  speaking: 2,
}

const CENTER = 100

interface Ring {
  r: number
  width: number
  /** Dash pattern. A single value gives even ticks; a pair gives arcs. */
  dash: string
  /** Negative spins counter-clockwise. */
  direction: 1 | -1
  /** Multiplier on the state's base spin period. */
  speed: number
  opacity: number
}

// Outermost first, which is also the order they draw in during boot.
// Alternating direction is what makes concentric rings read as
// machinery rather than as one rotating disc.
const RINGS: Ring[] = [
  { r: 92, width: 1, dash: "2 6", direction: 1, speed: 1, opacity: 0.55 },
  { r: 82, width: 2.5, dash: "58 20", direction: -1, speed: 0.75, opacity: 0.9 },
  { r: 70, width: 1, dash: "1 4", direction: 1, speed: 1.6, opacity: 0.45 },
  { r: 58, width: 3, dash: "26 14", direction: -1, speed: 0.55, opacity: 0.95 },
  { r: 45, width: 1.5, dash: "10 6", direction: 1, speed: 0.9, opacity: 0.7 },
]

const RING_DRAW_MS = 260
const RING_STAGGER_MS = 170

// The eight coil spokes bridging the inner rings - the detail that reads
// specifically as an arc reactor rather than a generic radar sweep.
const SPOKES = Array.from({ length: 8 }, (_, i) => (i * 360) / 8)

interface ArcReactorProps {
  state: CoreState
  bootStage: BootStage
  onActivate: () => void
  isListening: boolean
  disabled?: boolean
}

export function ArcReactor({
  state,
  bootStage,
  onActivate,
  isListening,
  disabled,
}: ArcReactorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const frameRef = useRef<number | null>(null)
  const smoothedRef = useRef(0)

  // Amplitude is published at animation-frame rate by audio-amplitude.ts.
  // It is written to a CSS custom property rather than React state on
  // purpose: this changes 60 times a second, and re-rendering the
  // console that often to nudge a scale value would be indefensible.
  useEffect(() => {
    const reactive = state === "speaking" || state === "listening"

    const tick = () => {
      const target = reactive ? audioAmplitude.current : 0
      // Exponential smoothing, so a single loud frame does not make the
      // core jump - the same damping the old 3D core used.
      smoothedRef.current += (target - smoothedRef.current) * 0.18
      svgRef.current?.style.setProperty("--amp", smoothedRef.current.toFixed(3))
      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [state])

  const spin = SPIN_SECONDS[state]
  const breathe = BREATHE_SECONDS[state]
  const ringsVisible = bootStage >= BootStage.Rings
  const booted = bootStage >= BootStage.Panels

  return (
    <div className="relative aspect-square w-full">
      <svg
        ref={svgRef}
        viewBox="0 0 200 200"
        className="h-full w-full overflow-visible"
        style={{ ["--amp" as string]: 0 }}
        aria-hidden
      >
        <defs>
          <radialGradient id="reactor-core-fill">
            <stop offset="0%" stopColor="var(--hud-bright)" stopOpacity="1" />
            <stop offset="55%" stopColor="var(--hud)" stopOpacity="0.75" />
            <stop offset="100%" stopColor="var(--hud)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="reactor-halo">
            <stop offset="0%" stopColor="var(--hud)" stopOpacity="0.30" />
            <stop offset="70%" stopColor="var(--hud)" stopOpacity="0.06" />
            <stop offset="100%" stopColor="var(--hud)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ambient halo. Sits behind everything and carries the breathing,
            so the glow reads as light spilling off the core rather than
            the core itself changing size. */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={96}
          fill="url(#reactor-halo)"
          className="reactor-ring"
          style={{
            animation: ringsVisible
              ? `reactor-breathe ${breathe}s ease-in-out infinite`
              : "none",
            opacity: ringsVisible ? undefined : 0,
            transform: "scale(calc(1 + var(--amp) * 0.22))",
          }}
        />

        {RINGS.map((ring, index) => {
          const circumference = 2 * Math.PI * ring.r
          return (
            <circle
              key={ring.r}
              cx={CENTER}
              cy={CENTER}
              r={ring.r}
              fill="none"
              stroke="var(--hud)"
              strokeWidth={ring.width}
              strokeDasharray={ring.dash}
              className="reactor-ring"
              style={{
                opacity: ringsVisible ? ring.opacity : 0,
                // Two animations on one element: the boot draw runs once
                // and the spin runs forever. Before boot reaches Rings,
                // neither is applied and the ring is simply invisible.
                animation: ringsVisible
                  ? [
                      `boot-ring-draw ${RING_DRAW_MS}ms ease-in-out ${index * RING_STAGGER_MS}ms both`,
                      `reactor-spin${ring.direction === -1 ? "-rev" : ""} ${spin * ring.speed}s linear infinite`,
                    ].join(", ")
                  : "none",
                // Consumed by the boot-ring-draw keyframes. Set per ring
                // because each circumference differs.
                ["--ring-len" as string]: circumference,
                strokeDasharray: ring.dash,
                transition: "opacity 300ms ease-in-out",
              }}
            />
          )
        })}

        {/* Coil spokes, drawn as a group so one rotation covers all eight. */}
        <g
          className="reactor-ring"
          style={{
            opacity: booted ? 0.5 : 0,
            animation: booted ? `reactor-spin-rev ${spin * 2.2}s linear infinite` : "none",
            transition: "opacity 500ms ease-in-out",
          }}
        >
          {SPOKES.map((angle) => (
            <line
              key={angle}
              x1={CENTER}
              y1={CENTER - 30}
              x2={CENTER}
              y2={CENTER - 43}
              stroke="var(--hud)"
              strokeWidth={2.5}
              transform={`rotate(${angle} ${CENTER} ${CENTER})`}
            />
          ))}
        </g>

        {/* Inner containment ring - static, the one fixed reference the
            moving rings are read against. */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={30}
          fill="none"
          stroke="var(--hud)"
          strokeWidth={1.5}
          opacity={ringsVisible ? 0.8 : 0}
          style={{ transition: "opacity 400ms ease-in-out" }}
        />

        {/* The core itself. Scales with live audio amplitude. */}
        <g
          className="reactor-ring"
          style={{ transform: "scale(calc(1 + var(--amp) * 0.18))" }}
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r={27}
            fill="url(#reactor-core-fill)"
            style={{
              opacity: ringsVisible ? 1 : 0,
              animation: ringsVisible
                ? `reactor-breathe ${breathe}s ease-in-out infinite`
                : "none",
              transition: "opacity 500ms ease-in-out",
            }}
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={11}
            fill="var(--hud-bright)"
            opacity={ringsVisible ? 0.95 : 0}
            style={{ transition: "opacity 500ms ease-in-out" }}
          />
        </g>
      </svg>

      {/* Click target. A circular button over the SVG rather than hit
          testing the artwork: the rings are 1-3px strokes, so pointer
          events on them would be a coin flip, and a button is focusable
          and announceable where a <circle> is not. */}
      <button
        type="button"
        onClick={onActivate}
        disabled={disabled}
        aria-label={isListening ? "Stop listening" : "Talk to J.A.R.V.I.S."}
        aria-pressed={isListening}
        className="absolute inset-[22%] cursor-pointer rounded-full transition-colors duration-200 hover:bg-[hsl(var(--hue)_var(--sat)_60%_/_0.07)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hud)] disabled:cursor-default disabled:hover:bg-transparent"
      />
    </div>
  )
}
