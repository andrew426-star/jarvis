"use client"

import { CONTEXT_WINDOW_TURNS, useJarvis } from "@/lib/store"
import { useAnimatedNumber } from "@/lib/use-animated-number"

// Six gauge segments around the reactor, all reading something real.
//
// Labels are HTML positioned over the SVG, not <text> inside it. SVG
// text has no text-overflow, so a label that outgrows its slot clips
// mid-glyph - which is how "SESSION" became "SSION" and "HEAP" became
// "HEAF". Every label here is <= 5 characters besides.

const RADIUS = 118
const SEG_SPAN = 48
const SEG_GAP = 12
const LABEL_RADIUS = RADIUS + 26
const VIEW = 320
const C = VIEW / 2

// Past this the backend is almost certainly cold-starting rather than
// merely slow, which is a different problem and worth showing as one.
const LATENCY_CEILING_MS = 1500

function polar(cx: number, cy: number, radius: number, degrees: number) {
  const radians = ((degrees - 90) * Math.PI) / 180
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) }
}

function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polar(cx, cy, radius, endAngle)
  const end = polar(cx, cy, radius, startAngle)
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1"
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`
}

type Severity = "normal" | "warning" | "critical" | "dim"

const SEVERITY_COLOR: Record<Severity, string> = {
  normal: "var(--success)",
  warning: "var(--warning)",
  critical: "var(--error)",
  dim: "var(--text-secondary)",
}

interface Segment {
  label: string
  readout: string
  fraction: number
  severity: Severity
}

export function StatusRing({ visible }: { visible: boolean }) {
  const signals = useJarvis((state) => state.signals)

  const latency = useAnimatedNumber(signals.latencyMs ?? 0)
  const turns = useAnimatedNumber(signals.turns)
  const tools = useAnimatedNumber(signals.toolsUsed.length)
  const fps = useAnimatedNumber(signals.fps)

  const latencySeverity: Severity =
    signals.latencyMs === null
      ? "dim"
      : signals.latencyMs > 1000
        ? "critical"
        : signals.latencyMs > 300
          ? "warning"
          : "normal"

  const segments: Segment[] = [
    {
      label: "LINK",
      readout: signals.link === "up" ? "UP" : signals.link === "down" ? "DOWN" : "IDLE",
      fraction: signals.link === "up" ? 1 : signals.link === "down" ? 0.08 : 0.4,
      severity: signals.link === "up" ? "normal" : signals.link === "down" ? "critical" : "dim",
    },
    {
      label: "LAT",
      readout: signals.latencyMs === null ? "--" : `${Math.round(latency)}ms`,
      // Inverted: a full arc means fast, which is what an instrument
      // showing health rather than magnitude should do.
      fraction:
        signals.latencyMs === null ? 0 : 1 - Math.min(1, signals.latencyMs / LATENCY_CEILING_MS),
      severity: latencySeverity,
    },
    {
      label: "CTX",
      readout: `${Math.round(turns)}/${CONTEXT_WINDOW_TURNS}`,
      fraction: Math.min(1, signals.turns / CONTEXT_WINDOW_TURNS),
      // Filling the window is normal operation, not a fault - it only
      // means the oldest turns are about to roll out of memory.
      severity: signals.turns >= CONTEXT_WINDOW_TURNS ? "warning" : "normal",
    },
    {
      label: "TOOLS",
      readout: `${Math.round(tools)}`,
      fraction: Math.min(1, signals.toolsUsed.length / 8),
      severity: signals.toolsUsed.length > 0 ? "normal" : "dim",
    },
    {
      label: "VOICE",
      readout: `${Math.round(signals.voice * 100)}%`,
      fraction: signals.voice,
      severity: signals.voice > 0.02 ? "normal" : "dim",
    },
    {
      label: "FPS",
      readout: `${Math.round(fps)}`,
      fraction: Math.min(1, signals.fps / 60),
      severity: signals.fps >= 50 ? "normal" : signals.fps >= 30 ? "warning" : "critical",
    },
  ]

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 600ms ease" }}
      role="img"
      aria-label="System status"
    >
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="h-full w-full">
        {segments.map((segment, index) => {
          const start = index * (SEG_SPAN + SEG_GAP)
          const end = start + SEG_SPAN
          const filledEnd = start + SEG_SPAN * segment.fraction
          return (
            <g key={segment.label}>
              <path
                d={describeArc(C, C, RADIUS, start, end)}
                fill="none"
                stroke="var(--accent)"
                strokeOpacity={0.15}
                strokeWidth={5}
              />
              {segment.fraction > 0.01 && (
                <path
                  d={describeArc(C, C, RADIUS, start, filledEnd)}
                  fill="none"
                  stroke={SEVERITY_COLOR[segment.severity]}
                  strokeWidth={5}
                />
              )}
            </g>
          )
        })}
      </svg>

      {segments.map((segment, index) => {
        const mid = index * (SEG_SPAN + SEG_GAP) + SEG_SPAN / 2
        const point = polar(50, 50, (LABEL_RADIUS / VIEW) * 100, mid)
        return (
          <div
            key={segment.label}
            className="absolute flex flex-col items-center"
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              transform: "translate(-50%, -50%)",
              width: "60px",
            }}
          >
            <span
              className="t-label truncate-1 w-full text-center"
              style={{ color: "var(--text-secondary)" }}
            >
              {segment.label}
            </span>
            <span
              className="truncate-1 w-full text-center"
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "12px",
                color: SEVERITY_COLOR[segment.severity],
              }}
            >
              {segment.readout}
            </span>
          </div>
        )
      })}
    </div>
  )
}
