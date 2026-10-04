"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react"

import {
  JarvisAuthError,
  getMarketHistory,
  getMarketSnapshot,
  type ChartAnnotation,
  type MarketHistory,
  type MarketRange,
  type MarketQuote,
  type MarketSnapshot,
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
import { MarketChart } from "./market-chart"

interface MarketsPanelProps {
  token: string
  onAuthError: () => void
  liveSnapshot?: MarketSnapshot
  liveHistory?: MarketHistory
  /** Ask Jarvis something from the panel ("why does it look like this here?"). */
  onAsk?: (question: string) => void
}

const RANGES: MarketRange[] = ["1H", "1D", "1W", "1M", "1Y", "YTD"]

// Change bars are scaled against this move; anything bigger pins the bar.
const FULL_SCALE_PCT = 5

type Sourced<T> = { data: T; source: "fetch" | "live"; at: Date | null }

export function MarketsPanel({ token, onAuthError, liveSnapshot, liveHistory, onAsk }: MarketsPanelProps) {
  // A live tool result from a chat turn seeds the panel when it opens and
  // replaces what's shown whenever a new one arrives. The background fetch
  // on mount only fills in if nothing live got there first, so a slow
  // watchlist request can't clobber a fresher, more relevant quote.
  const [view, setView] = useState<Sourced<MarketSnapshot> | null>(() =>
    liveSnapshot ? { data: liveSnapshot, source: "live", at: null } : null,
  )
  const [history, setHistory] = useState<MarketHistory | null>(liveHistory ?? null)
  const [symbolInput, setSymbolInput] = useState(liveHistory?.symbol ?? "")
  const [loadingSnapshot, setLoadingSnapshot] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [range, setRange] = useState<MarketRange>(liveHistory?.range ?? "1D")
  // Jarvis's explanations, kept per symbol so they stay when the range
  // changes (the chart pins each to its nearest bar on whatever is shown).
  const [notes, setNotes] = useState<Record<string, ChartAnnotation[]>>(() =>
    liveHistory?.annotations?.length ? { [liveHistory.symbol]: liveHistory.annotations } : {}
  )

  // "Adjusting state when a prop changes", done during render as React
  // recommends rather than in an effect.
  const [prevLiveSnapshot, setPrevLiveSnapshot] = useState(liveSnapshot)
  if (liveSnapshot !== prevLiveSnapshot) {
    setPrevLiveSnapshot(liveSnapshot)
    if (liveSnapshot) setView({ data: liveSnapshot, source: "live", at: null })
  }
  const [prevLiveHistory, setPrevLiveHistory] = useState(liveHistory)
  if (liveHistory !== prevLiveHistory) {
    setPrevLiveHistory(liveHistory)
    if (liveHistory) {
      setHistory(liveHistory)
      setSymbolInput(liveHistory.symbol)
      if (liveHistory.range) setRange(liveHistory.range)
      const pinned = liveHistory.annotations
      if (pinned?.length) setNotes((prev) => ({ ...prev, [liveHistory.symbol]: pinned }))
    }
  }

  const snapshot = view?.data ?? null

  async function refreshSnapshot() {
    setLoadingSnapshot(true)
    try {
      setView({ data: await getMarketSnapshot(token), source: "fetch", at: new Date() })
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setView({ data: { ok: false, quotes: [], error: "Could not load market data." }, source: "fetch", at: null })
    } finally {
      setLoadingSnapshot(false)
    }
  }

  async function loadHistory(symbol: string, period: MarketRange = range) {
    const clean = symbol.trim().toUpperCase()
    if (!clean) return
    setSymbolInput(clean)
    setLoadingHistory(true)
    try {
      setHistory(await getMarketHistory(clean, token, period))
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setHistory({ ok: false, symbol: clean, error: "Could not load history." })
    } finally {
      setLoadingHistory(false)
    }
  }

  useEffect(() => {
    getMarketSnapshot(token)
      .then((result) => {
        const fetched: Sourced<MarketSnapshot> = { data: result, source: "fetch", at: new Date() }
        setView((prev) => prev ?? fetched)
        // Open on a chart rather than an empty box: the first watchlist
        // name, unless a chat turn already put a chart here.
        const first = result.ok ? result.quotes[0]?.symbol : undefined
        if (first) {
          getMarketHistory(first, token, "1D")
            .then((h) => {
              setHistory((prev) => prev ?? h)
              setSymbolInput((prev) => prev || first)
            })
            .catch(() => {})
        }
      })
      .catch((err) => {
        if (err instanceof JarvisAuthError) {
          onAuthError()
          return
        }
        const failed: Sourced<MarketSnapshot> = {
          data: { ok: false, quotes: [], error: "Could not load market data." },
          source: "fetch",
          at: null,
        }
        setView((prev) => prev ?? failed)
      })
      .finally(() => setLoadingSnapshot(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const quotes = snapshot?.quotes ?? []

  return (
    <div
      className="grid grid-cols-1 items-start @4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
      style={{ gap: "var(--sp-3)" }}
    >
      <PanelSection
        title="Watchlist"
        meta={view?.source === "live" ? "FROM CHAT" : syncStamp(view?.at ?? null)}
        action={<RefreshButton loading={loadingSnapshot} onClick={refreshSnapshot} label="Refresh watchlist" />}
      >
        {snapshot?.ok === false && (
          <p className="t-body" style={{ color: "var(--error)" }}>
            {snapshot.error}
          </p>
        )}
        {!snapshot && loadingSnapshot ? <ScanRows rows={2} height={64} /> : null}
        {quotes.length > 0 && <Breadth quotes={quotes} />}
        {quotes.length > 0 && (
          <motion.div
            className="grid grid-cols-2 @xl:grid-cols-3 @4xl:grid-cols-2 @6xl:grid-cols-3"
            style={{ gap: "var(--sp-2)" }}
            variants={listVariants}
            initial="hidden"
            animate="show"
          >
            {quotes.map((q) => (
              <QuoteTile
                key={q.symbol}
                quote={q}
                active={history?.symbol === q.symbol}
                onSelect={() => loadHistory(q.symbol)}
              />
            ))}
          </motion.div>
        )}
      </PanelSection>

      <PanelSection
        title="Price History"
        delay={0.08}
        action={
          <div className="flex shrink-0" style={{ gap: "var(--sp-1)" }}>
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className="btn"
                data-active={range === r}
                style={{ height: 24, padding: "0 var(--sp-2)" }}
                disabled={loadingHistory}
                onClick={() => {
                  setRange(r)
                  if (history?.symbol) loadHistory(history.symbol, r)
                }}
              >
                {r}
              </button>
            ))}
          </div>
        }
      >
        <form
          className="flex"
          style={{ gap: "var(--sp-2)" }}
          onSubmit={(event) => {
            event.preventDefault()
            loadHistory(symbolInput)
          }}
        >
          <input
            value={symbolInput}
            onChange={(event) => setSymbolInput(event.target.value)}
            placeholder="AAPL, BTC, EUR/USD"
            className="t-label min-w-0 flex-1"
            style={{
              height: 28,
              padding: "0 var(--sp-2)",
              background: "rgba(10, 14, 26, 0.6)",
              border: "1px solid rgba(var(--accent-rgb), 0.2)",
              color: "var(--text-primary)",
              textTransform: "uppercase",
            }}
          />
          <button
            type="submit"
            className="btn"
            style={{ height: 28, padding: "0 var(--sp-3)" }}
            disabled={loadingHistory || !symbolInput.trim()}
          >
            CHART
          </button>
        </form>

        {history?.ok === false && (
          <p className="t-body" style={{ color: "var(--error)" }}>
            {history.error}
          </p>
        )}
        {loadingHistory && !history?.candles ? <ScanRows rows={1} height={200} /> : null}
        {history?.ok && history.candles && history.candles.length > 0 && (
          <MarketChart
            history={history}
            annotations={notes[history.symbol] ?? []}
            loading={loadingHistory}
            onAsk={onAsk}
          />
        )}
        {!history && !loadingHistory && (
          <p className="t-body" style={{ color: "var(--text-secondary)" }}>
            Select a watchlist tile or enter a symbol.
          </p>
        )}
      </PanelSection>
    </div>
  )
}

// How the watchlist as a whole is moving: advancers vs decliners and the
// average move, as a split bar.
function Breadth({ quotes }: { quotes: MarketQuote[] }) {
  const moves = quotes.map((q) => q.change_percent).filter((m): m is number => m != null)
  if (moves.length === 0) return null
  const up = moves.filter((m) => m > 0).length
  const down = moves.filter((m) => m < 0).length
  const avg = moves.reduce((a, b) => a + b, 0) / moves.length
  const upShare = up + down === 0 ? 0.5 : up / (up + down)

  return (
    <div className="flex flex-col" style={{ gap: "var(--sp-1)" }}>
      <div className="t-label flex justify-between" style={{ color: "var(--text-secondary)" }}>
        <span>
          <span style={{ color: "var(--success)" }}>▲ {up}</span>{" "}
          <span style={{ color: "var(--error)" }}>▼ {down}</span>
        </span>
        <span>
          AVG <span style={{ color: toneColor(avg) }}>{signedPct(avg)}</span>
        </span>
      </div>
      <div className="flex overflow-hidden" style={{ height: 3, background: "rgba(255,51,51,0.5)" }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${upShare * 100}%` }}
          transition={{ duration: 0.8, ease: EASE_OUT }}
          style={{ background: "var(--success)", boxShadow: "0 0 8px rgba(0,255,136,0.5)" }}
        />
      </div>
    </div>
  )
}

function QuoteTile({
  quote,
  active,
  onSelect,
}: {
  quote: MarketQuote
  active: boolean
  onSelect: () => void
}) {
  const flash = useChangeFlash(quote.price)
  const pct = quote.change_percent ?? 0
  const up = pct >= 0
  const barWidth = Math.min(100, (Math.abs(pct) / FULL_SCALE_PCT) * 100)

  return (
    <motion.button
      type="button"
      variants={itemVariants}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onSelect}
      className="card relative flex min-w-0 flex-col items-start overflow-hidden text-left"
      style={{
        padding: "var(--sp-2) var(--sp-3)",
        gap: 2,
        borderColor: active ? "rgba(var(--accent-rgb), 0.9)" : undefined,
        boxShadow: active ? "0 0 12px rgba(var(--accent-rgb), 0.25)" : undefined,
        background: flash ? FLASH_BG[flash] : undefined,
      }}
    >
      <span className="t-label truncate-1 w-full" style={{ color: "var(--text-secondary)" }} title={quote.symbol}>
        {quote.symbol}
      </span>
      <AnimatedValue
        value={quote.price}
        format={(n) => usd(n)}
        className="t-value truncate-1 w-full"
        style={{ fontSize: 16, color: "var(--text-primary)" }}
      />
      <span className="t-label flex items-center" style={{ gap: 4, color: toneColor(quote.change_percent) }}>
        {up ? <TrendingUpIcon className="size-3" /> : <TrendingDownIcon className="size-3" />}
        {quote.change_percent != null ? signedPct(pct) : "—"}
      </span>
      <div className="absolute bottom-0 left-0 h-[2px] w-full" style={{ background: "rgba(var(--accent-rgb), 0.08)" }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${barWidth}%` }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
          style={{ height: "100%", background: up ? "var(--success)" : "var(--error)" }}
        />
      </div>
    </motion.button>
  )
}

