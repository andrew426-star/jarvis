"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"

import { JarvisAuthError, getTopTrades, type TopTrades, type TradeSignal } from "@/lib/jarvis-client"
import { EASE_OUT, PanelSection, RefreshButton, ScanRows, relativeTime } from "./hud-kit"
import { formatPrice } from "./market-chart"

// K.I.V.'s top recommended trades (kiv-console's algorithmic trading
// signals): the latest daily scan's risk-approved signals, best confidence
// first. The list is replaced, not added to, whenever a newer scan lands:
// checked on open, every ten minutes, when the console comes back into
// view, and whenever Jarvis reads them in a conversation (`live`).

const EVERY_MS = 10 * 60_000

type Asset = "stock" | "crypto" | "fx"

function assetOf(trade: TradeSignal): Asset {
  return trade.asset_class === "crypto" ? "crypto" : "stock"
}

export function TopTradesSection({
  token,
  onAuthError,
  live,
  selected,
  onSelect,
}: {
  token: string
  onAuthError: () => void
  live?: TopTrades
  selected: string | null
  onSelect: (trade: TradeSignal) => void
}) {
  const [data, setData] = useState<TopTrades | null>(live ?? null)
  const [loading, setLoading] = useState(!live)
  // The scan the list first showed this session. A later one is marked new
  // until a trade is picked from it.
  const [seenScan, setSeenScan] = useState<string | null | undefined>(live?.scan_at)

  function take(next: TopTrades) {
    setData(next)
    if (next.ok && seenScan === undefined) setSeenScan(next.scan_at ?? null)
  }

  const [prevLive, setPrevLive] = useState(live)
  if (live !== prevLive) {
    setPrevLive(live)
    if (live) take(live)
  }

  function fetchTrades() {
    return getTopTrades(token)
      .then(take)
      .catch((err) => {
        if (err instanceof JarvisAuthError) {
          onAuthError()
          return
        }
        setData((prev) => prev ?? { ok: false, error: "Could not load trade signals." })
      })
      .finally(() => setLoading(false))
  }

  function refresh() {
    setLoading(true)
    void fetchTrades()
  }

  useEffect(() => {
    void fetchTrades()
    const timer = setInterval(() => void fetchTrades(), EVERY_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchTrades()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const fresh = Boolean(data?.ok && data.scan_at && seenScan !== undefined && data.scan_at !== seenScan)
  const trades = data?.trades ?? []

  return (
    <PanelSection
      title="Top Trades"
      meta={
        fresh ? (
          <span style={{ color: "var(--success)" }}>NEW SCAN</span>
        ) : data?.scan_at ? (
          `K.I.V. SCAN ${relativeTime(data.scan_at).toUpperCase()}`
        ) : (
          "K.I.V. SIGNALS"
        )
      }
      action={<RefreshButton loading={loading} onClick={refresh} label="Refresh trades" />}
      delay={0.04}
    >
      {data?.ok === false && (
        <p className="t-body" style={{ color: "var(--error)" }}>
          {data.error}
        </p>
      )}
      {!data && loading ? <ScanRows rows={3} height={52} /> : null}
      {data?.ok && trades.length === 0 && (
        <p className="t-body" style={{ color: "var(--text-secondary)" }}>
          The latest scan approved no trades.
        </p>
      )}
      {trades.length > 0 && (
        <motion.ol
          key={data?.scan_at ?? "none"}
          className="flex flex-col"
          style={{ gap: "var(--sp-2)" }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
        >
          {trades.map((trade, i) => (
            <li key={trade.id}>
              <TradeCard
                trade={trade}
                rank={i + 1}
                active={selected === trade.symbol}
                onSelect={() => {
                  setSeenScan(data?.scan_at ?? null)
                  onSelect(trade)
                }}
              />
            </li>
          ))}
        </motion.ol>
      )}
      {data?.ok && (
        <p className="t-label" style={{ color: "var(--text-secondary)" }}>
          {data.note ?? `${data.scan_approved ?? trades.length} approved of ${data.scan_signals ?? "?"} signals. Click one to chart it with its levels.`}
        </p>
      )}
    </PanelSection>
  )
}

/** "Palladium (PALL ETF proxy)" reads as "Palladium" on the card; the
 *  symbol and "ETF proxy" sit underneath. */
function commonName(trade: TradeSignal): string {
  return trade.name.replace(/\s*\(.*\)$/, "") || trade.symbol
}

function TradeCard({
  trade,
  rank,
  active,
  onSelect,
}: {
  trade: TradeSignal
  rank: number
  active: boolean
  onSelect: () => void
}) {
  const long = trade.direction === "long"
  const tone = long ? "var(--success)" : "var(--error)"
  const asset = assetOf(trade)
  const p = (n: number | null) => (n === null ? "—" : formatPrice(n, asset))

  return (
    <button
      type="button"
      onClick={onSelect}
      className="card flex w-full flex-col text-left"
      style={{
        padding: "var(--sp-2) var(--sp-3)",
        gap: 4,
        borderColor: active ? "rgba(var(--accent-rgb), 0.9)" : undefined,
        boxShadow: active ? "0 0 12px rgba(var(--accent-rgb), 0.25)" : undefined,
      }}
    >
      <div className="flex items-center" style={{ gap: "var(--sp-2)" }}>
        <span className="t-label" style={{ color: "var(--text-secondary)" }}>
          #{rank}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="t-value truncate-1" style={{ fontSize: 14, color: "var(--text-primary)" }} title={trade.name}>
            {commonName(trade)}
          </span>
          <span className="t-label" style={{ color: "var(--text-secondary)" }}>
            {trade.symbol}
            {/proxy\)/i.test(trade.name) ? " · ETF PROXY" : ""}
          </span>
        </span>
        <span
          className="t-label"
          style={{ padding: "0 6px", border: `1px solid ${tone}`, borderRadius: "var(--radius)", color: tone }}
        >
          {long ? "LONG" : "SHORT"}
        </span>
        <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
          {trade.strategy.replace(/_/g, " ")}
        </span>
        <span className="t-label ml-auto" style={{ color: "var(--accent)" }} title="Signal confidence">
          {Math.round(trade.confidence * 100)}%
        </span>
      </div>
      <div className="h-[2px] w-full" style={{ background: "rgba(var(--accent-rgb), 0.08)" }}>
        <div style={{ width: `${Math.min(100, trade.confidence * 100)}%`, height: "100%", background: "var(--accent)" }} />
      </div>
      <div className="t-label flex flex-wrap" style={{ gap: "var(--sp-2)", color: "var(--text-secondary)" }}>
        <span>
          IN <span style={{ color: "var(--text-primary)" }}>{p(trade.entry)}</span>
        </span>
        <span>
          STOP <span style={{ color: "var(--error)" }}>{p(trade.stop)}</span>
        </span>
        <span>
          TGT <span style={{ color: "var(--success)" }}>{p(trade.target)}</span>
        </span>
        {trade.reward_to_risk !== null && <span>R:R {trade.reward_to_risk}</span>}
        <span>
          SIZE {formatPrice(trade.position_size_usd, "stock").replace(".00", "")}
        </span>
      </div>
      {active && (
        <div className="flex flex-col" style={{ gap: 4, marginTop: 2 }}>
          {trade.summary ? (
            <p style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.45 }}>{trade.summary}</p>
          ) : (
            <ul className="flex flex-col" style={{ gap: 1 }}>
              {trade.rationale.map((line) => (
                <li key={line} style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                  · {line}
                </li>
              ))}
            </ul>
          )}
          {trade.sources.length > 0 && (
            <ul className="flex flex-col" style={{ gap: 1 }}>
              {trade.sources.map((source) => (
                <li key={source.url} style={{ fontSize: 11.5 }}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent)" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {source.title}
                  </a>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {" "}
                    · {source.publisher}
                    {source.kind === "news" ? " · context" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </button>
  )
}
