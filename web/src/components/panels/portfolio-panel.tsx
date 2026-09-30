"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"

import {
  JarvisAuthError,
  getPortfolio,
  type PortfolioPosition,
  type PortfolioResult,
} from "@/lib/jarvis-client"
import {
  AnimatedValue,
  EASE_OUT,
  FLASH_BG,
  PanelSection,
  RefreshButton,
  ScanRows,
  itemVariants,
  listVariants,
  signedPct,
  syncStamp,
  toneColor,
  usd,
  useChangeFlash,
} from "./hud-kit"

interface PortfolioPanelProps {
  token: string
  onAuthError: () => void
  livePortfolio?: PortfolioResult
}

// Allocation segments cycle through accent shades so the bar reads as one
// instrument (and follows the Normal/Serious accent flip) rather than a
// rainbow.
const SEGMENT_OPACITY = [1, 0.75, 0.55, 0.4, 0.3, 0.22]

type Sourced<T> = { data: T; source: "fetch" | "live"; at: Date | null }

export function PortfolioPanel({ token, onAuthError, livePortfolio }: PortfolioPanelProps) {
  // Same live-first rule as the Markets tab: a chat turn's portfolio result
  // seeds and replaces what's shown; the mount fetch only fills a gap.
  const [view, setView] = useState<Sourced<PortfolioResult> | null>(() =>
    livePortfolio ? { data: livePortfolio, source: "live", at: null } : null,
  )
  const [loading, setLoading] = useState(true)

  const [prevLive, setPrevLive] = useState(livePortfolio)
  if (livePortfolio !== prevLive) {
    setPrevLive(livePortfolio)
    if (livePortfolio) setView({ data: livePortfolio, source: "live", at: null })
  }

  const portfolio = view?.data ?? null

  async function refreshPortfolio() {
    setLoading(true)
    try {
      setView({ data: await getPortfolio(token), source: "fetch", at: new Date() })
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setView({ data: { ok: false, error: "Could not load portfolio." }, source: "fetch", at: null })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    getPortfolio(token)
      .then((result) => {
        const fetched: Sourced<PortfolioResult> = { data: result, source: "fetch", at: new Date() }
        setView((prev) => prev ?? fetched)
      })
      .catch((err) => {
        if (err instanceof JarvisAuthError) {
          onAuthError()
          return
        }
        const failed: Sourced<PortfolioResult> = {
          data: { ok: false, error: "Could not load portfolio." },
          source: "fetch",
          at: null,
        }
        setView((prev) => prev ?? failed)
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const account = portfolio?.account
  const positions = useMemo(
    () => [...(portfolio?.positions ?? [])].sort((a, b) => b.market_value - a.market_value),
    [portfolio?.positions],
  )
  const invested = positions.reduce((n, p) => n + p.market_value, 0)
  const costBasis = positions.reduce((n, p) => n + p.cost_basis, 0)
  const unrealized = positions.reduce((n, p) => n + p.unrealized_pl, 0)
  const unrealizedPct = costBasis ? (unrealized / costBasis) * 100 : 0
  const equityFlash = useChangeFlash(account?.equity)

  return (
    <div
      className="grid grid-cols-1 items-start @4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
      style={{ gap: "var(--sp-3)" }}
    >
      <PanelSection
        title="Account"
        meta={view?.source === "live" ? "FROM CHAT" : syncStamp(view?.at ?? null)}
        action={<RefreshButton loading={loading} onClick={refreshPortfolio} label="Refresh portfolio" />}
      >
        {portfolio?.ok === false && (
          <p className="t-body" style={{ color: "var(--error)" }}>
            {portfolio.error}
          </p>
        )}
        {!portfolio && loading ? <ScanRows rows={2} height={48} /> : null}
        {account && (
          <>
            <div
              className="flex flex-wrap items-end justify-between"
              style={{
                gap: "var(--sp-2)",
                padding: "var(--sp-1) var(--sp-2)",
                background: equityFlash ? FLASH_BG[equityFlash] : "transparent",
                borderRadius: "var(--radius)",
              }}
            >
              <div className="flex flex-col">
                <span className="t-label" style={{ color: "var(--text-secondary)" }}>
                  EQUITY
                </span>
                <AnimatedValue
                  value={account.equity}
                  format={(n) => usd(n)}
                  className="t-value text-glow"
                  style={{ fontSize: 24, color: "var(--text-primary)" }}
                />
              </div>
              <div className="flex flex-col items-end">
                <span className="t-label" style={{ color: "var(--text-secondary)" }}>
                  UNREALIZED P/L
                </span>
                <span className="t-value" style={{ color: toneColor(unrealized) }}>
                  <AnimatedValue value={unrealized} format={(n) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`} />{" "}
                  <span style={{ fontSize: 12 }}>{signedPct(unrealizedPct)}</span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3" style={{ gap: "var(--sp-2)" }}>
              <Metric label="CASH" value={account.cash} />
              <Metric label="INVESTED" value={invested} />
              <Metric label="BUYING POWER" value={account.buying_power} />
            </div>

            <Allocation positions={positions} cash={account.cash} />

            <span className="t-label" style={{ color: "var(--text-secondary)" }}>
              STATUS{" "}
              <span style={{ color: account.status === "ACTIVE" ? "var(--success)" : "var(--warning)" }}>
                {account.status}
              </span>{" "}
              · PAPER ACCOUNT · READ-ONLY
            </span>
          </>
        )}
      </PanelSection>

      <PanelSection title="Positions" meta={positions.length ? `${positions.length} OPEN` : null} delay={0.08}>
        {portfolio?.ok && positions.length === 0 && (
          <p className="t-body" style={{ color: "var(--text-secondary)" }}>
            No open positions.
          </p>
        )}
        {positions.length > 0 && (
          <motion.div
            className="flex flex-col"
            style={{ gap: "var(--sp-1)" }}
            variants={listVariants}
            initial="hidden"
            animate="show"
          >
            {positions.map((p) => (
              <PositionRow key={p.symbol} position={p} maxAbsPct={maxAbsPct(positions)} />
            ))}
          </motion.div>
        )}
      </PanelSection>
    </div>
  )
}

function maxAbsPct(positions: PortfolioPosition[]): number {
  return Math.max(1, ...positions.map((p) => Math.abs(p.unrealized_pl_percent)))
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col" style={{ gap: 2 }}>
      <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <AnimatedValue value={value} format={(n) => usd(n, 0)} className="t-value truncate-1" />
    </div>
  )
}

function Allocation({ positions, cash }: { positions: PortfolioPosition[]; cash: number }) {
  const top = positions.slice(0, SEGMENT_OPACITY.length - 1)
  const other = positions.slice(top.length).reduce((n, p) => n + p.market_value, 0)
  const segments = [
    ...top.map((p, i) => ({ label: p.symbol, value: p.market_value, opacity: SEGMENT_OPACITY[i] })),
    ...(other > 0 ? [{ label: "OTHER", value: other, opacity: SEGMENT_OPACITY[SEGMENT_OPACITY.length - 1] }] : []),
    { label: "CASH", value: Math.max(0, cash), opacity: 0 },
  ].filter((s) => s.value > 0)
  const total = segments.reduce((n, s) => n + s.value, 0)
  if (!total) return null

  return (
    <div className="flex flex-col" style={{ gap: "var(--sp-1)" }}>
      <span className="t-label" style={{ color: "var(--text-secondary)" }}>
        ALLOCATION
      </span>
      <div
        className="flex overflow-hidden"
        style={{ height: 8, border: "1px solid rgba(var(--accent-rgb), 0.2)", borderRadius: "var(--radius)" }}
      >
        {segments.map((s, i) => (
          <motion.div
            key={s.label}
            title={`${s.label} ${((s.value / total) * 100).toFixed(1)}%`}
            initial={{ width: 0 }}
            animate={{ width: `${(s.value / total) * 100}%` }}
            transition={{ duration: 0.8, ease: EASE_OUT, delay: i * 0.05 }}
            style={{
              background:
                s.label === "CASH"
                  ? "repeating-linear-gradient(135deg, rgba(var(--accent-rgb),0.15) 0 3px, transparent 3px 6px)"
                  : `rgba(var(--accent-rgb), ${s.opacity})`,
              borderRight: "1px solid var(--bg-base)",
            }}
          />
        ))}
      </div>
      <div className="t-label flex flex-wrap" style={{ gap: "var(--sp-1) var(--sp-3)", color: "var(--text-secondary)" }}>
        {segments.map((s) => (
          <span key={s.label}>
            <span style={{ color: "var(--text-primary)" }}>{s.label}</span> {((s.value / total) * 100).toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  )
}

function PositionRow({ position, maxAbsPct }: { position: PortfolioPosition; maxAbsPct: number }) {
  const flash = useChangeFlash(position.current_price)
  const pct = position.unrealized_pl_percent
  const color = toneColor(pct)
  const width = (Math.abs(pct) / maxAbsPct) * 100

  return (
    <motion.div
      variants={itemVariants}
      className="card grid items-center"
      style={{
        gridTemplateColumns: "minmax(0,1fr) auto",
        gap: "2px var(--sp-3)",
        padding: "var(--sp-2) var(--sp-3)",
        background: flash ? FLASH_BG[flash] : undefined,
      }}
    >
      <div className="flex min-w-0 items-baseline" style={{ gap: "var(--sp-2)" }}>
        <span className="t-header truncate-1" style={{ fontSize: 12 }}>
          {position.symbol}
        </span>
        <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
          {position.qty} @ {usd(position.current_price)}
        </span>
      </div>
      <AnimatedValue value={position.market_value} format={(n) => usd(n)} className="t-value text-right" />
      <div style={{ height: 3, background: "rgba(var(--accent-rgb), 0.08)" }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
          style={{ height: "100%", background: color }}
        />
      </div>
      <span className="t-label text-right" style={{ color }}>
        {position.unrealized_pl >= 0 ? "+" : "−"}
        {usd(Math.abs(position.unrealized_pl))} · {signedPct(pct)}
      </span>
    </motion.div>
  )
}
