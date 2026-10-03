"use client"

import { useSyncExternalStore } from "react"

import { sfx } from "@/lib/sfx"
import { useSpatial } from "@/lib/spatial-store"
import { useClock } from "@/lib/use-clock"
import { useJarvis, type TabKey } from "@/lib/store"
import { centralDate, centralTime, centralZoneLabel } from "@/lib/time"

const TABS: { key: TabKey; label: string }[] = [
  { key: "markets", label: "Markets" },
  { key: "intel", label: "Intel" },
  { key: "assets", label: "Assets" },
  { key: "notes", label: "Notes" },
]

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex min-w-0 items-center" style={{ gap: "var(--sp-1)" }}>
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: color ?? "var(--accent)", opacity: 0.7 }}
      />
      <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span
        className="truncate-1"
        style={{
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: "12px",
          color: color ?? "var(--accent)",
        }}
      >
        {value}
      </span>
    </div>
  )
}

export function TopBar() {
  // sfx owns the mute state (it persists it); the label subscribes to it.
  // The server snapshot is "not muted" because the static export's
  // server render has no localStorage to read.
  const muted = useSyncExternalStore(sfx.subscribeMuted, sfx.isMuted, () => false)

  const { activeTab, setActiveTab, mode, toggleMode, signals } = useJarvis()
  const setWorkshopOpen = useSpatial((state) => state.setWorkshopOpen)
  // 0 until the first client tick - see use-clock.ts for why the clock
  // is an external store rather than state driven by an effect.
  const epoch = useClock()
  const now = epoch === 0 ? null : new Date(epoch)

  const serious = mode === "serious"

  return (
    <header
      className="relative flex items-center justify-between overflow-hidden"
      style={{
        height: "48px",
        padding: "0 var(--sp-4)",
        gap: "var(--sp-4)",
        background: "rgba(5, 5, 10, 0.8)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid rgba(var(--accent-rgb), 0.3)",
      }}
    >
      <div className="bar-sweep" aria-hidden />

      {/* Left: identity, health dot, tabs */}
      <div className="relative flex min-w-0 items-center" style={{ gap: "var(--sp-3)" }}>
        <span
          className="truncate-1 shrink-0"
          style={{
            fontFamily: "var(--font-orbitron), sans-serif",
            fontSize: "14px",
            fontWeight: 600,
            letterSpacing: "0.15em",
            color: "var(--accent)",
          }}
        >
          J.A.R.V.I.S.
        </span>
        <span
          className="anim-dot size-2 shrink-0 rounded-full"
          style={{ background: "var(--success)", boxShadow: "0 0 8px var(--success)" }}
          aria-label="Online"
        />
        <nav className="flex shrink-0 items-center" style={{ gap: "var(--sp-2)" }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(activeTab === tab.key ? null : tab.key)}
              data-active={activeTab === tab.key}
              className="btn"
              style={{ padding: "4px 12px" }}
            >
              {tab.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setActiveTab(null)
              setWorkshopOpen(true)
            }}
            className="btn"
            style={{ padding: "4px 12px" }}
          >
            Workshop
          </button>
        </nav>
      </div>

      {/* Centre: clock. Absolutely positioned so it stays optically
          centred no matter how wide the two side groups grow. */}
      <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center">
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "14px",
            color: "var(--text-primary)",
            lineHeight: 1.1,
          }}
        >
          {now ? centralTime(now) : "--:--:--"}
        </span>
        <span className="t-time">
          {now
            ? `${centralDate(now)} · ${centralZoneLabel(now)}`
            : ""}
        </span>
      </div>

      {/* Right: audio, mode toggle and live link health */}
      <div className="relative flex min-w-0 shrink-0 items-center" style={{ gap: "var(--sp-4)" }}>
        <button
          type="button"
          onClick={() => sfx.toggleMuted()}
          aria-pressed={muted}
          className="btn shrink-0"
          style={{ padding: "4px 12px" }}
        >
          {muted ? "Muted" : "Audio"}
        </button>

        <button
          type="button"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            toggleMode({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
          }}
          aria-pressed={serious}
          className="btn shrink-0"
          style={{ padding: "4px 12px" }}
        >
          {serious ? "Serious" : "Normal"}
        </button>

        <div className="hidden items-center lg:flex" style={{ gap: "var(--sp-3)" }}>
          <Metric
            label="LINK"
            value={signals.link === "up" ? "UP" : signals.link === "down" ? "DOWN" : "IDLE"}
            color={
              signals.link === "up"
                ? "var(--success)"
                : signals.link === "down"
                  ? "var(--error)"
                  : "var(--text-secondary)"
            }
          />
          <Metric
            label="LAT"
            value={signals.latencyMs === null ? "--" : `${signals.latencyMs}ms`}
            color={
              signals.latencyMs === null
                ? "var(--text-secondary)"
                : signals.latencyMs > 1000
                  ? "var(--error)"
                  : signals.latencyMs > 300
                    ? "var(--warning)"
                    : "var(--success)"
            }
          />
          <Metric label="CTX" value={`${signals.turns}/${signals.contextWindow}`} />
        </div>
      </div>
    </header>
  )
}
