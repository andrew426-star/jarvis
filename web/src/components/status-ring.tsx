"use client"

import { useEffect, useState } from "react"

import { audioAmplitude } from "@/lib/audio-amplitude"
import { readTelemetry, startTelemetry, stopTelemetry } from "@/lib/telemetry"
import { BootStage } from "@/lib/use-boot"

// Six gauge segments around the reactor.
//
// Every one of these is a real measurement. The brief said CPU / Memory
// / Network, but a browser cannot see the server's CPU - so these read
// what this page genuinely observes and are labelled for what they
// actually are. A gauge that invents its own number is just decoration
// wearing a instrument's clothes.
//
// RENDER   rolling frame time of this tab
// HEAP     JS heap in use (Chrome only; shows -- elsewhere)
// LATENCY  round trip of the last API call
// VOICE    live mic / narration amplitude
// SESSION  turns held in the backend's rolling context window
// LINK     browser online state

const RADIUS = 92
const SEGMENT_SPAN = 52
const SEGMENT_GAP = 8
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// Matches the backend's REDIS_SESSION_WINDOW_TURNS default. If that is
// ever raised, this is the number to follow it with - the gauge would
// otherwise sit pinned at full and quietly stop meaning anything.
const SESSION_WINDOW_TURNS = 10

interface Segment {
  id: string
  label: string
  /** 0-1, or null when the browser will not report it. */
  value: number | null
  /** Short text under the label. */
  readout: string
}

interface StatusRingProps {
  bootStage: BootStage
  turns: number
  className?: string
}

function segmentPath(index: number, fraction: number) {
  const start = -90 + index * (SEGMENT_SPAN + SEGMENT_GAP)
  const arc = CIRCUMFERENCE * (SEGMENT_SPAN / 360) * fraction
  return {
    rotation: start,
    dash: `${arc} ${CIRCUMFERENCE}`,
  }
}

export function StatusRing({ bootStage, turns, className }: StatusRingProps) {
  const [segments, setSegments] = useState<Segment[]>([])

  useEffect(() => {
    startTelemetry()

    // 5Hz. Fast enough that the gauges feel live, slow enough that this
    // is not competing with the reactor for frame budget; the CSS
    // transition on each arc covers the gaps between samples.
    const id = window.setInterval(() => {
      const t = readTelemetry()
      const voice = audioAmplitude.current
      setSegments([
        {
          id: "render",
          label: "RENDER",
          value: t.render,
          readout: `${Math.round(t.render * 100)}%`,
        },
        {
          id: "heap",
          label: "HEAP",
          value: t.heap,
          readout: t.heap === null ? "--" : `${Math.round(t.heap * 100)}%`,
        },
        {
          id: "latency",
          label: "LATENCY",
          value: t.latency,
          readout: t.latencyMs === null ? "--" : `${Math.round(t.latencyMs)}ms`,
        },
        {
          id: "voice",
          label: "VOICE",
          value: voice,
          readout: `${Math.round(voice * 100)}%`,
        },
        {
          id: "session",
          label: "SESSION",
          value: Math.min(1, turns / SESSION_WINDOW_TURNS),
          readout: `${Math.min(turns, SESSION_WINDOW_TURNS)}/${SESSION_WINDOW_TURNS}`,
        },
        {
          id: "link",
          label: "LINK",
          value: t.online ? 1 : 0,
          readout: t.online ? "OK" : "DOWN",
        },
      ])
    }, 200)

    return () => {
      window.clearInterval(id)
      stopTelemetry()
    }
  }, [turns])

  const visible = bootStage >= BootStage.Panels

  return (
    <svg
      viewBox="0 0 240 240"
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 700ms ease-in-out",
      }}
      role="img"
      aria-label="System status"
    >
      <g transform="translate(120 120)">
        {segments.map((segment, index) => {
          const track = segmentPath(index, 1)
          const fill = segmentPath(index, segment.value ?? 0)
          const midAngle = track.rotation + SEGMENT_SPAN / 2
          const labelRadius = RADIUS + 17
          const radians = (midAngle * Math.PI) / 180
          const lx = Math.cos(radians) * labelRadius
          const ly = Math.sin(radians) * labelRadius
          const unavailable = segment.value === null

          return (
            <g key={segment.id}>
              <circle
                r={RADIUS}
                fill="none"
                stroke="var(--hud)"
                strokeOpacity={0.14}
                strokeWidth={5}
                strokeDasharray={track.dash}
                transform={`rotate(${track.rotation})`}
              />
              {!unavailable && (
                <circle
                  r={RADIUS}
                  fill="none"
                  stroke="var(--hud)"
                  strokeWidth={5}
                  strokeDasharray={fill.dash}
                  transform={`rotate(${fill.rotation})`}
                  style={{ transition: "stroke-dasharray 220ms linear" }}
                />
              )}
              <text
                x={lx}
                y={ly - 2}
                textAnchor="middle"
                className="label-hud"
                style={{ fontSize: 7, fill: "var(--hud-dim)" }}
              >
                {segment.label}
              </text>
              <text
                x={lx}
                y={ly + 8}
                textAnchor="middle"
                className="readout"
                style={{
                  fontSize: 8,
                  fill: unavailable ? "var(--hud-dim)" : "var(--hud)",
                }}
              >
                {segment.readout}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}
