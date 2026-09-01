"use client"

import { useEffect, useState } from "react"

import { useJarvis } from "@/lib/store"
import { useAnimatedNumber } from "@/lib/use-animated-number"

// Four cards, each flex-1, each distributing its own content with
// justify-between. Equal height is enforced by the flex basis, and the
// internal distribution is what stops a short card leaving a dead gap.
//
// These four are simulated: a browser cannot read its host's process
// table, NIC throughput, or physical memory split. They move within the
// spec's ranges.

function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="card flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ padding: "var(--sp-3)", gap: "var(--sp-2)" }}
    >
      <h2 className="t-panel-header truncate-1 shrink-0">{title}</h2>
      <div className="flex min-h-0 flex-1 flex-col justify-between">{children}</div>
    </section>
  )
}

function StatusRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between" style={{ gap: "var(--sp-2)" }}>
      <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <div className="flex min-w-0 shrink-0 items-center" style={{ gap: "var(--sp-1)" }}>
        <span
          className="truncate-1"
          style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px" }}
        >
          {value}
        </span>
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
      </div>
    </div>
  )
}

function SystemStatusCard() {
  const metrics = useJarvis((state) => state.metrics)
  return (
    <CardShell title="System Status">
      <div
        className="t-status truncate-1"
        style={{ fontSize: "16px", color: "var(--success)", textShadow: "0 0 8px var(--success)" }}
      >
        NOMINAL
      </div>
      <div className="flex flex-col" style={{ gap: "var(--sp-1)" }}>
        <StatusRow label="CORE" value="ONLINE" color="var(--success)" />
        <StatusRow label="LINK" value="STABLE" color="var(--success)" />
        <StatusRow label="PWR" value={`${metrics.pwr}%`} color="var(--success)" />
        <StatusRow label="TEMP" value={`${metrics.temp}°C`} color="var(--success)" />
      </div>
    </CardShell>
  )
}

function ProcessesCard() {
  const procCount = useJarvis((state) => state.metrics.procCount)
  const animated = useAnimatedNumber(procCount)
  const [bars, setBars] = useState<number[]>(() => [18, 24, 14, 27, 20, 30, 16, 22])

  useEffect(() => {
    const id = window.setInterval(() => {
      setBars(Array.from({ length: 8 }, () => 10 + Math.round(Math.random() * 20)))
    }, 3000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <CardShell title="Processes">
      <div className="flex min-w-0 items-baseline justify-between" style={{ gap: "var(--sp-2)" }}>
        <span className="t-value truncate-1" style={{ color: "var(--accent)" }}>
          {Math.round(animated)}
        </span>
        <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
          ACTIVE
        </span>
      </div>
      <div className="flex items-end" style={{ gap: "2px", height: "30px" }}>
        {bars.map((height, index) => (
          <div
            key={index}
            style={{
              width: "3px",
              height: `${height}px`,
              background: "var(--accent)",
              opacity: 0.6,
              transition: "height 600ms ease",
            }}
          />
        ))}
      </div>
    </CardShell>
  )
}

function NetworkCard() {
  const [points, setPoints] = useState<number[]>(() => [22, 38, 30, 46, 34])
  const [speeds, setSpeeds] = useState({ up: 2.1, down: 1.4 })

  useEffect(() => {
    const id = window.setInterval(() => {
      setPoints((prev) => [...prev.slice(1), 15 + Math.round(Math.random() * 40)])
      setSpeeds({
        up: Number((1.2 + Math.random() * 2.2).toFixed(1)),
        down: Number((0.8 + Math.random() * 1.3).toFixed(1)),
      })
    }, 4000)
    return () => window.clearInterval(id)
  }, [])

  const path = points
    .map((value, index) => `${index === 0 ? "M" : "L"} ${index * 46} ${60 - value}`)
    .join(" ")

  return (
    <CardShell title="Network">
      <div className="flex flex-col" style={{ gap: "var(--sp-1)" }}>
        <StatusRow label="UP" value={`${speeds.up} GB/s`} color="var(--accent)" />
        <StatusRow label="DOWN" value={`${speeds.down} GB/s`} color="var(--accent)" />
      </div>
      <svg viewBox="0 0 184 60" className="w-full" style={{ height: "44px" }} aria-hidden>
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeOpacity={0.6}
          strokeWidth={1.5}
          style={{ transition: "d 600ms ease" }}
        />
      </svg>
    </CardShell>
  )
}

const MEMORY_SEGMENTS = [
  { label: "System", percent: 28, color: "var(--accent)" },
  { label: "Apps", percent: 35, color: "#0080ff" },
  { label: "Cache", percent: 12, color: "#0066cc" },
  { label: "Free", percent: 25, color: "rgba(122, 138, 154, 0.4)" },
]

function MemoryCard() {
  const radius = 30
  const circumference = 2 * Math.PI * radius

  // Offsets precomputed rather than accumulated inside the map. A
  // variable mutated during render restarts unpredictably when React
  // renders a component twice (StrictMode, or a discarded concurrent
  // render), which would silently scramble the donut.
  const arcs = MEMORY_SEGMENTS.reduce<{ segment: (typeof MEMORY_SEGMENTS)[number]; length: number; offset: number }[]>(
    (acc, segment) => {
      const length = (segment.percent / 100) * circumference
      const offset = acc.length === 0 ? 0 : acc[acc.length - 1].offset + acc[acc.length - 1].length
      acc.push({ segment, length, offset })
      return acc
    },
    []
  )

  return (
    <CardShell title="Memory">
      <div className="flex min-w-0 items-center" style={{ gap: "var(--sp-3)" }}>
        <svg viewBox="0 0 80 80" style={{ width: "68px", height: "68px", flex: "none" }} aria-hidden>
          <g transform="rotate(-90 40 40)">
            {arcs.map(({ segment, length, offset }) => (
              <circle
                key={segment.label}
                cx={40}
                cy={40}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={10}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
              />
            ))}
          </g>
        </svg>
        <div className="flex min-w-0 flex-1 flex-col" style={{ gap: "2px" }}>
          {MEMORY_SEGMENTS.map((segment) => (
            <div
              key={segment.label}
              className="flex min-w-0 items-center"
              style={{ gap: "var(--sp-1)" }}
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: segment.color }}
              />
              <span className="t-label truncate-1 flex-1" style={{ color: "var(--text-secondary)" }}>
                {segment.label}
              </span>
              <span
                className="shrink-0"
                style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px" }}
              >
                {segment.percent}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </CardShell>
  )
}

export function LeftPanel() {
  return (
    <aside
      className="panel flex min-h-0 flex-col overflow-hidden"
      style={{
        padding: "var(--sp-3)",
        gap: "var(--sp-3)",
        borderRight: "1px solid rgba(var(--accent-rgb), 0.15)",
      }}
    >
      <SystemStatusCard />
      <ProcessesCard />
      <NetworkCard />
      <MemoryCard />
    </aside>
  )
}
