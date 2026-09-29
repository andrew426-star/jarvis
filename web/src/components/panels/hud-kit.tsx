"use client"

import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { RefreshCwIcon } from "lucide-react"

import { useAnimatedNumber } from "@/lib/use-animated-number"
import { centralTime, centralZoneLabel } from "@/lib/time"

// Shared building blocks for the three data tabs (Markets, Intel, Assets)
// so they speak the same HUD language as the rest of the console: sharp
// 2px cards, Orbitron headers, JetBrains numerals, one accent colour.
//
// Motion budget: globals.css allows three infinite animations and they're
// spent on the background. Everything here is one-shot — entrances,
// value tweens, change flashes — plus the bar-sweep shimmer, which only
// runs while a panel is actually loading.

export const EASE_OUT = [0.16, 1, 0.3, 1] as const

export const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035 } },
}

export const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_OUT } },
}

export function PanelSection({
  title,
  meta,
  action,
  children,
  delay = 0,
}: {
  title: string
  meta?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  delay?: number
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT, delay }}
      className="card relative flex min-w-0 flex-col"
      style={{ padding: "var(--sp-3)", gap: "var(--sp-3)" }}
    >
      <Corners />
      <header className="flex min-w-0 items-center justify-between" style={{ gap: "var(--sp-2)" }}>
        <div className="flex min-w-0 items-baseline" style={{ gap: "var(--sp-2)" }}>
          <h3 className="t-panel-header truncate-1">{title}</h3>
          {meta ? (
            <span className="t-time truncate-1" style={{ fontSize: "11px" }}>
              {meta}
            </span>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </motion.section>
  )
}

// Bracket corners — the targeting-reticle frame used around HUD readouts.
function Corners() {
  const base: React.CSSProperties = {
    position: "absolute",
    width: 8,
    height: 8,
    borderColor: "rgba(var(--accent-rgb), 0.6)",
    pointerEvents: "none",
  }
  return (
    <>
      <span style={{ ...base, top: -1, left: -1, borderTop: "1px solid", borderLeft: "1px solid" }} />
      <span style={{ ...base, top: -1, right: -1, borderTop: "1px solid", borderRight: "1px solid" }} />
      <span style={{ ...base, bottom: -1, left: -1, borderBottom: "1px solid", borderLeft: "1px solid" }} />
      <span style={{ ...base, bottom: -1, right: -1, borderBottom: "1px solid", borderRight: "1px solid" }} />
    </>
  )
}

export function RefreshButton({
  loading,
  onClick,
  label,
}: {
  loading: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      className="btn shrink-0"
      style={{ width: 28, height: 28, padding: 0 }}
      onClick={onClick}
      disabled={loading}
      aria-label={label}
      title={label}
    >
      <RefreshCwIcon className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
    </button>
  )
}

// Returns "up" / "down" for ~0.8s after a value changes, so a new reading
// visibly lands instead of silently replacing the old one.
export function useChangeFlash(value: number | null | undefined): "up" | "down" | null {
  const previous = useRef(value)
  const [flash, setFlash] = useState<"up" | "down" | null>(null)

  useEffect(() => {
    const prev = previous.current
    previous.current = value
    if (prev == null || value == null || prev === value) return
    setFlash(value > prev ? "up" : "down")
    const id = setTimeout(() => setFlash(null), 800)
    return () => clearTimeout(id)
  }, [value])

  return flash
}

export const FLASH_BG: Record<"up" | "down", string> = {
  up: "rgba(0, 255, 136, 0.12)",
  down: "rgba(255, 51, 51, 0.12)",
}

export function AnimatedValue({
  value,
  format,
  className,
  style,
}: {
  value: number
  format: (n: number) => string
  className?: string
  style?: React.CSSProperties
}) {
  const shown = useAnimatedNumber(value, 700)
  return (
    <span className={className} style={style}>
      {format(shown)}
    </span>
  )
}

export const usd = (n: number, digits = 2) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

export const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`

export function toneColor(n: number | null | undefined): string {
  if (n == null || n === 0) return "var(--text-secondary)"
  return n > 0 ? "var(--success)" : "var(--error)"
}

// A line that draws itself in on mount and whenever its data changes.
export function Sparkline({
  values,
  width = 96,
  height = 28,
  color = "var(--accent)",
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - 2 - ((v - min) / span) * (height - 4)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <motion.polyline
        key={points.join(" ")}
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0.4 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.9, ease: EASE_OUT }}
      />
    </svg>
  )
}

// Loading placeholder rows with the shared bar-sweep shimmer.
export function ScanRows({ rows = 3, height = 36 }: { rows?: number; height?: number }) {
  return (
    <div className="flex flex-col" style={{ gap: "var(--sp-2)" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="relative overflow-hidden"
          style={{
            height,
            borderRadius: "var(--radius)",
            background: "rgba(var(--accent-rgb), 0.04)",
            border: "1px solid rgba(var(--accent-rgb), 0.08)",
          }}
        >
          <div className="bar-sweep" />
        </div>
      ))}
    </div>
  )
}

export function syncStamp(date: Date | null): string | null {
  if (!date) return null
  return `SYNC ${centralTime(date)} ${centralZoneLabel(date)}`
}

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
