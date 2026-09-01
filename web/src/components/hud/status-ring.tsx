"use client"

import { useJarvis } from "@/lib/store"
import { useAnimatedNumber } from "@/lib/use-animated-number"

// Six gauge segments around the reactor.
//
// Labels are HTML positioned over the SVG, not <text> inside it. SVG
// text has no text-overflow, so a label that outgrows its slot silently
// clips mid-glyph - which is precisely how "SESSION" became "SSION" and
// "HEAP" became "HEAF". As HTML they get a real 60px box with ellipsis,
// and every label here is <= 4 characters besides.

const RADIUS = 118
const SEG_SPAN = 48
const SEG_GAP = 12
const LABEL_RADIUS = RADIUS + 26
const VIEW = 320
const C = VIEW / 2

function polar(cx: number, cy: number, radius: number, degrees: number) {
  const radians = ((degrees - 90) * Math.PI) / 180
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) }
}

/** Standard SVG arc between two angles, drawn clockwise. */
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

type Severity = "normal" | "warning" | "critical"

const SEVERITY_COLOR: Record<Severity, string> = {
  normal: "var(--success)",
  warning: "var(--warning)",
  critical: "var(--error)",
}

interface Segment {
  /** Max 6 characters, per the label rule. */
  label: string
  readout: string
  /** 0-1, how much of the arc fills. */
  fraction: number
  severity: Severity
}

/** Higher is worse (cpu, mem, temp). */
function loadSeverity(value: number, warn: number, crit: number): Severity {
  if (value >= crit) return "critical"
  if (value >= warn) return "warning"
  return "normal"
}

/** Higher is better (net, pwr, shld). */
function reserveSeverity(value: number, warn: number, crit: number): Severity {
  if (value <= crit) return "critical"
  if (value <= warn) return "warning"
  return "normal"
}

export function StatusRing({ visible }: { visible: boolean }) {
  const metrics = useJarvis((state) => state.metrics)

  const cpu = useAnimatedNumber(metrics.cpu)
  const mem = useAnimatedNumber(metrics.mem)
  const net = useAnimatedNumber(metrics.net)
  const temp = useAnimatedNumber(metrics.temp)
  const pwr = useAnimatedNumber(metrics.pwr)
  const shld = useAnimatedNumber(metrics.shld)

  const segments: Segment[] = [
    {
      label: "CPU",
      readout: `${Math.round(cpu)}%`,
      fraction: cpu / 100,
      severity: loadSeverity(cpu, 70, 88),
    },
    {
      label: "MEM",
      readout: `${Math.round(mem)}%`,
      fraction: mem / 100,
      severity: loadSeverity(mem, 75, 90),
    },
    {
      label: "NET",
      readout: `${Math.round(net)}%`,
      fraction: net / 100,
      severity: reserveSeverity(net, 40, 20),
    },
    {
      label: "TEMP",
      // Normalised against a 0-80C span so the arc is readable; the
      // readout stays in real degrees.
      readout: `${Math.round(temp)}°C`,
      fraction: Math.min(1, temp / 80),
      severity: loadSeverity(temp, 70, 80),
    },
    {
      label: "PWR",
      readout: `${Math.round(pwr)}%`,
      fraction: pwr / 100,
      severity: reserveSeverity(pwr, 40, 20),
    },
    {
      label: "SHLD",
      readout: `${Math.round(shld)}%`,
      fraction: shld / 100,
      severity: reserveSeverity(shld, 60, 30),
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
                  strokeLinecap="butt"
                />
              )}
            </g>
          )
        })}
      </svg>

      {/* Labels as HTML, so overflow rules actually apply. */}
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
