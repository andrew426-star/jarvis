"use client"

import { useEffect, useState } from "react"

import { getPortfolio, type PortfolioResult } from "@/lib/jarvis-client"
import { useJarvis } from "@/lib/store"
import { useAnimatedNumber } from "@/lib/use-animated-number"

// Four cards, each flex-1, each distributing its own content with
// justify-between so a short card cannot leave a dead gap.
//
// Every value here is real: the health of this app's own backend link,
// its session against the agent's context window, its measured latency,
// and the live Alpaca account behind /panels/portfolio. Nothing is
// simulated - a HUD full of invented numbers tells you nothing about
// the system it is supposedly monitoring.

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

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between" style={{ gap: "var(--sp-2)" }}>
      <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span
        className="truncate-1"
        style={{
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: "12px",
          color: color ?? "var(--text-primary)",
          maxWidth: "60%",
          textAlign: "right",
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

function SystemCard() {
  const signals = useJarvis((state) => state.signals)

  const linkColor =
    signals.link === "up"
      ? "var(--success)"
      : signals.link === "down"
        ? "var(--error)"
        : "var(--text-secondary)"

  const latColor =
    signals.latencyMs === null
      ? "var(--text-secondary)"
      : signals.latencyMs > 1000
        ? "var(--error)"
        : signals.latencyMs > 300
          ? "var(--warning)"
          : "var(--success)"

  return (
    <CardShell title="System">
      <div
        className="t-status truncate-1"
        style={{
          fontSize: "16px",
          color: linkColor,
          textShadow: signals.link === "up" ? "0 0 8px var(--success)" : "none",
        }}
      >
        {signals.link === "up" ? "NOMINAL" : signals.link === "down" ? "LINK LOST" : "STANDBY"}
      </div>
      <div className="flex flex-col" style={{ gap: "var(--sp-1)" }}>
        <Row
          label="LINK"
          value={signals.link === "up" ? "UP" : signals.link === "down" ? "DOWN" : "IDLE"}
          color={linkColor}
        />
        <Row label="AUTH" value="VALID" color="var(--success)" />
        <Row
          label="LAT"
          value={signals.latencyMs === null ? "--" : `${signals.latencyMs}ms`}
          color={latColor}
        />
        <Row label="FPS" value={`${Math.round(signals.fps)}`} />
      </div>
    </CardShell>
  )
}

function SessionCard() {
  const signals = useJarvis((state) => state.signals)
  const turns = useAnimatedNumber(signals.turns)
  const filled = Math.min(1, signals.turns / signals.contextWindow)

  return (
    <CardShell title="Session">
      <div className="flex min-w-0 items-baseline justify-between" style={{ gap: "var(--sp-2)" }}>
        <span className="t-value truncate-1" style={{ color: "var(--accent)" }}>
          {Math.round(turns)}
          <span style={{ color: "var(--text-secondary)" }}>/{signals.contextWindow}</span>
        </span>
        <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
          TURNS
        </span>
      </div>

      <div className="flex flex-col" style={{ gap: "var(--sp-1)" }}>
        {/* Context window occupancy. Once this fills, the backend starts
            rolling the oldest turns out of Redis - worth being able to
            see before Jarvis "forgets" something you said. */}
        <div style={{ height: "4px", background: "rgba(var(--accent-rgb), 0.15)" }}>
          <div
            style={{
              width: `${filled * 100}%`,
              height: "100%",
              background: filled >= 1 ? "var(--warning)" : "var(--accent)",
              transition: "width 400ms ease",
            }}
          />
        </div>
        <Row label="TOOLS" value={`${signals.toolsUsed.length}`} color="var(--accent)" />
        <Row
          label="LAST"
          value={signals.toolsUsed.at(-1) ?? "none"}
          color={signals.toolsUsed.length ? "var(--text-primary)" : "var(--text-secondary)"}
        />
      </div>
    </CardShell>
  )
}

function LatencyCard() {
  const history = useJarvis((state) => state.signals.latencyHistory)

  const max = Math.max(200, ...history)
  const path = history
    .map((value, index) => {
      const x = history.length === 1 ? 0 : (index / (history.length - 1)) * 184
      const y = 44 - (value / max) * 40
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(" ")

  const average = history.length
    ? Math.round(history.reduce((total, value) => total + value, 0) / history.length)
    : null

  return (
    <CardShell title="Latency">
      <div className="flex flex-col" style={{ gap: "var(--sp-1)" }}>
        <Row label="AVG" value={average === null ? "--" : `${average}ms`} color="var(--accent)" />
        <Row label="PEAK" value={history.length ? `${Math.max(...history)}ms` : "--"} />
        <Row label="CALLS" value={`${history.length}`} />
      </div>
      {history.length > 1 ? (
        <svg viewBox="0 0 184 48" className="w-full" style={{ height: "40px" }} aria-hidden>
          <path d={path} fill="none" stroke="var(--accent)" strokeOpacity={0.7} strokeWidth={1.5} />
        </svg>
      ) : (
        <p className="t-label" style={{ color: "var(--text-secondary)" }}>
          Awaiting traffic
        </p>
      )}
    </CardShell>
  )
}

function PortfolioCard({ token, onAuthError }: { token: string; onAuthError: () => void }) {
  const [data, setData] = useState<PortfolioResult | null>(null)
  const notify = useJarvis((state) => state.notify)
  const setLinkDown = useJarvis((state) => state.setLinkDown)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const result = await getPortfolio(token)
        if (!cancelled) setData(result)
      } catch (error) {
        if (cancelled) return
        // A 401 here means the session died; hand it to the same handler
        // every other call uses rather than silently showing stale data.
        if (error instanceof Error && error.name === "JarvisAuthError") {
          onAuthError()
          return
        }
        setLinkDown()
        notify("warning", "Portfolio unavailable", "Could not reach the account endpoint.")
      }
    }

    void load()
    // Five minutes. Positions do not move fast enough to justify more,
    // and every call keeps a free Render instance awake.
    const id = window.setInterval(load, 5 * 60 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [token, onAuthError, notify, setLinkDown])

  const account = data?.ok ? data.account : undefined
  const positions = data?.ok ? (data.positions ?? []) : []
  const totalPl = positions.reduce((total, position) => total + position.unrealized_pl, 0)
  const plColor = totalPl >= 0 ? "var(--success)" : "var(--error)"

  // Allocation by market value, biggest first, top four plus cash.
  const ranked = [...positions].sort((a, b) => b.market_value - a.market_value).slice(0, 4)
  const totalValue = account?.portfolio_value || 1
  const slices = [
    ...ranked.map((position, index) => ({
      label: position.symbol,
      value: position.market_value,
      color: ["var(--accent)", "#0080ff", "#0066cc", "#004c99"][index],
    })),
    { label: "Cash", value: account?.cash ?? 0, color: "rgba(122, 138, 154, 0.4)" },
  ].filter((slice) => slice.value > 0)

  const radius = 30
  const circumference = 2 * Math.PI * radius
  const arcs = slices.reduce<{ label: string; color: string; length: number; offset: number }[]>(
    (acc, slice) => {
      const length = (slice.value / totalValue) * circumference
      const offset = acc.length === 0 ? 0 : acc[acc.length - 1].offset + acc[acc.length - 1].length
      acc.push({ label: slice.label, color: slice.color, length, offset })
      return acc
    },
    []
  )

  return (
    <CardShell title="Portfolio">
      {account ? (
        <>
          <div className="flex min-w-0 items-baseline justify-between" style={{ gap: "var(--sp-2)" }}>
            <span className="t-value truncate-1" style={{ color: "var(--accent)" }}>
              ${Math.round(account.portfolio_value).toLocaleString()}
            </span>
            <span
              className="truncate-1 shrink-0"
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "12px",
                color: plColor,
              }}
            >
              {totalPl >= 0 ? "+" : ""}
              {Math.round(totalPl).toLocaleString()}
            </span>
          </div>

          <div className="flex min-w-0 items-center" style={{ gap: "var(--sp-3)" }}>
            <svg
              viewBox="0 0 80 80"
              style={{ width: "56px", height: "56px", flex: "none" }}
              aria-hidden
            >
              <g transform="rotate(-90 40 40)">
                {arcs.map((arc) => (
                  <circle
                    key={arc.label}
                    cx={40}
                    cy={40}
                    r={radius}
                    fill="none"
                    stroke={arc.color}
                    strokeWidth={10}
                    strokeDasharray={`${arc.length} ${circumference - arc.length}`}
                    strokeDashoffset={-arc.offset}
                  />
                ))}
              </g>
            </svg>
            <div className="flex min-w-0 flex-1 flex-col" style={{ gap: "2px" }}>
              {arcs.slice(0, 4).map((arc) => (
                <div key={arc.label} className="flex min-w-0 items-center" style={{ gap: "var(--sp-1)" }}>
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: arc.color }}
                  />
                  <span
                    className="t-label truncate-1 flex-1"
                    style={{ color: "var(--text-secondary)" }}
                    title={arc.label}
                  >
                    {arc.label}
                  </span>
                  <span
                    className="shrink-0"
                    style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "11px" }}
                  >
                    {Math.round((arc.length / circumference) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="t-label" style={{ color: "var(--text-secondary)" }}>
          {data && !data.ok ? (data.error ?? "Unavailable") : "Loading account…"}
        </p>
      )}
    </CardShell>
  )
}

export function LeftPanel({ token, onAuthError }: { token: string; onAuthError: () => void }) {
  return (
    <aside
      className="panel flex min-h-0 flex-col overflow-hidden"
      style={{
        padding: "var(--sp-3)",
        gap: "var(--sp-3)",
        borderRight: "1px solid rgba(var(--accent-rgb), 0.15)",
      }}
    >
      <SystemCard />
      <SessionCard />
      <LatencyCard />
      <PortfolioCard token={token} onAuthError={onAuthError} />
    </aside>
  )
}
