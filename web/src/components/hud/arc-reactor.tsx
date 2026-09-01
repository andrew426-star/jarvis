"use client"

import { useEffect, useRef } from "react"

import { audioAmplitude } from "@/lib/audio-amplitude"
import type { AgentStatus } from "@/lib/store"

// Rotation periods in seconds. The spec's baseline is 8s for the middle
// ring and 12s counter-rotating for the outer; the other states scale
// those. Rotation is a CSS transform on the group, never SVG animation,
// so it stays on the compositor.
const SPEED: Record<AgentStatus, number> = {
  idle: 1,
  listening: 0.45,
  thinking: 0.3,
  speaking: 0.7,
}

const CENTER = 110
const TICKS = 60

interface ArcReactorProps {
  status: AgentStatus
  onToggle: () => void
  /** Rings appear one at a time during boot; -1 means none yet. */
  ringsRevealed: number
}

export function ArcReactor({ status, onToggle, ringsRevealed }: ArcReactorProps) {
  const coreRef = useRef<SVGGElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const smoothedRef = useRef(0)
  const statusRef = useRef(status)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  // Amplitude is published at animation-frame rate by audio-amplitude.ts
  // and written straight to style, not React state - this changes 60
  // times a second and re-rendering the console that often to nudge a
  // scale value would be indefensible.
  useEffect(() => {
    const tick = () => {
      const live = statusRef.current === "speaking" || statusRef.current === "listening"
      const target = live ? audioAmplitude.current : 0
      smoothedRef.current += (target - smoothedRef.current) * 0.18
      const amp = smoothedRef.current

      if (coreRef.current) {
        coreRef.current.style.transform = `scale(${(1 + amp * 0.22).toFixed(3)})`
      }
      if (glowRef.current) {
        glowRef.current.style.opacity = String(0.45 + amp * 0.45)
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  const speed = SPEED[status]
  const intense = status === "listening" || status === "speaking"

  return (
    <div className="relative aspect-square w-full max-w-[440px]">
      {/* Radial glow behind the reactor. A blurred div rather than an SVG
          filter: filters on an SVG this size repaint the whole subtree
          every frame and visibly cost frames. */}
      <div
        ref={glowRef}
        className="pointer-events-none absolute inset-[12%] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(var(--accent-rgb), 0.35) 0%, rgba(var(--accent-rgb), 0.08) 45%, transparent 70%)",
          filter: "blur(40px)",
          opacity: 0.45,
        }}
        aria-hidden
      />

      <svg viewBox="0 0 220 220" className="relative h-full w-full" aria-hidden>
        <defs>
          <radialGradient id="ar-core">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="35%" stopColor="var(--accent)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ring 3 - outer, tick marks, counter-rotation 12s */}
        <g
          style={{
            transformOrigin: "50% 50%",
            animation: `spin ${12 * speed}s linear infinite reverse`,
            opacity: ringsRevealed >= 3 ? 0.55 : 0,
            transition: "opacity 400ms ease",
          }}
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r={102}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1}
            opacity={0.4}
          />
          {Array.from({ length: TICKS }, (_, i) => {
            const long = i % 5 === 0
            return (
              <line
                key={i}
                x1={CENTER}
                y1={CENTER - 102}
                x2={CENTER}
                y2={CENTER - (long ? 92 : 96)}
                stroke="var(--accent)"
                strokeWidth={long ? 1.5 : 0.75}
                transform={`rotate(${(i * 360) / TICKS} ${CENTER} ${CENTER})`}
              />
            )
          })}
        </g>

        {/* Ring 2 - segmented arcs with gaps, 8s */}
        <g
          style={{
            transformOrigin: "50% 50%",
            animation: `spin ${8 * speed}s linear infinite`,
            opacity: ringsRevealed >= 2 ? 1 : 0,
            transition: "opacity 400ms ease",
          }}
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r={82}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={4}
            strokeDasharray="64 22"
            opacity={intense ? 0.95 : 0.7}
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={70}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1}
            strokeDasharray="3 7"
            opacity={0.45}
          />
        </g>

        {/* Thinking sweep - a bright arc chasing the ring, which is what
            "segments light up sequentially" looks like once it is
            continuous rather than stepped. Only mounted while thinking,
            so it never counts against the animation budget at rest. */}
        {status === "thinking" && ringsRevealed >= 2 && (
          <g style={{ transformOrigin: "50% 50%", animation: "spin 1.1s linear infinite" }}>
            <circle
              cx={CENTER}
              cy={CENTER}
              r={82}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={4}
              strokeDasharray="40 476"
              strokeLinecap="round"
              opacity={1}
              style={{ filter: "drop-shadow(0 0 6px rgba(var(--accent-rgb), 0.8))" }}
            />
          </g>
        )}

        {/* Ring 1 - inner, counter-rotating coil housing */}
        <g
          style={{
            transformOrigin: "50% 50%",
            animation: `spin ${5 * speed}s linear infinite reverse`,
            opacity: ringsRevealed >= 1 ? 0.85 : 0,
            transition: "opacity 400ms ease",
          }}
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r={52}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeDasharray="26 12"
          />
          {Array.from({ length: 8 }, (_, i) => (
            <line
              key={i}
              x1={CENTER}
              y1={CENTER - 34}
              x2={CENTER}
              y2={CENTER - 46}
              stroke="var(--accent)"
              strokeWidth={2.5}
              opacity={0.8}
              transform={`rotate(${i * 45} ${CENTER} ${CENTER})`}
            />
          ))}
        </g>

        {/* Static containment ring - the fixed reference the moving rings
            are read against. */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={32}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          opacity={ringsRevealed >= 0 ? 0.75 : 0}
          style={{ transition: "opacity 400ms ease" }}
        />

        {/* Core - breathing, and scaled by live audio amplitude */}
        <g ref={coreRef} style={{ transformOrigin: "50% 50%" }}>
          <circle
            cx={CENTER}
            cy={CENTER}
            r={28}
            fill="url(#ar-core)"
            className="anim-breathe"
            style={{
              transformOrigin: "50% 50%",
              opacity: ringsRevealed >= 0 ? 1 : 0,
              transition: "opacity 500ms ease",
            }}
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={11}
            fill="#ffffff"
            opacity={ringsRevealed >= 0 ? 0.9 : 0}
            style={{ transition: "opacity 500ms ease" }}
          />
        </g>
      </svg>

      {/* Click target. A circular button over the artwork rather than
          hit-testing 1-4px strokes, which would be a coin flip - and a
          button is focusable and announceable where a <circle> is not. */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={status === "listening" ? "Stop listening" : "Talk to J.A.R.V.I.S."}
        aria-pressed={status === "listening"}
        className="absolute inset-[28%] cursor-pointer rounded-full transition-colors duration-200 hover:bg-[rgba(var(--accent-rgb),0.06)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
      />

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
