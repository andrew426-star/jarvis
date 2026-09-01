"use client"

import { useEffect, useRef, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { RefreshCwIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  JarvisAuthError,
  getMarketHistory,
  getMarketSnapshot,
  type MarketHistory,
  type MarketSnapshot,
} from "@/lib/jarvis-client"

interface MarketsPanelProps {
  token: string
  onAuthError: () => void
  liveSnapshot?: MarketSnapshot
  liveHistory?: MarketHistory
}

export function MarketsPanel({ token, onAuthError, liveSnapshot, liveHistory }: MarketsPanelProps) {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null)
  const [loadingSnapshot, setLoadingSnapshot] = useState(true)
  const [symbolInput, setSymbolInput] = useState("")
  const [history, setHistory] = useState<MarketHistory | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Guards against the initial background fetch resolving *after* a fresher
  // live tool result already arrived from a chat turn — without this, a
  // slow watchlist fetch could clobber a just-arrived, more relevant quote.
  const hasLiveSnapshotRef = useRef(false)
  const hasLiveHistoryRef = useRef(false)

  async function refreshSnapshot() {
    setLoadingSnapshot(true)
    try {
      setSnapshot(await getMarketSnapshot(token))
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setSnapshot({ ok: false, quotes: [], error: "Could not load market data." })
    } finally {
      setLoadingSnapshot(false)
    }
  }

  async function loadHistory(symbol: string) {
    const clean = symbol.trim().toUpperCase()
    if (!clean) return
    hasLiveHistoryRef.current = false
    setLoadingHistory(true)
    try {
      setHistory(await getMarketHistory(clean, token))
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
        if (!hasLiveSnapshotRef.current) setSnapshot(result)
      })
      .catch((err) => {
        if (err instanceof JarvisAuthError) {
          onAuthError()
          return
        }
        if (!hasLiveSnapshotRef.current) {
          setSnapshot({ ok: false, quotes: [], error: "Could not load market data." })
        }
      })
      .finally(() => setLoadingSnapshot(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (liveSnapshot) {
      hasLiveSnapshotRef.current = true
      setSnapshot(liveSnapshot)
    }
  }, [liveSnapshot])

  useEffect(() => {
    if (liveHistory) {
      hasLiveHistoryRef.current = true
      setHistory(liveHistory)
      setSymbolInput(liveHistory.symbol)
    }
  }, [liveHistory])

  return (
    <div className="flex flex-col gap-4">
      <Card className="glow-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Watchlist</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={refreshSnapshot}
            aria-label="Refresh watchlist"
          >
            <RefreshCwIcon className={loadingSnapshot ? "animate-spin" : ""} />
          </Button>
        </CardHeader>
        <CardContent>
          {snapshot?.ok === false && <p className="text-sm text-destructive">{snapshot.error}</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {snapshot?.quotes.map((q) => {
              const up = (q.change ?? 0) >= 0
              return (
                <button
                  key={q.symbol}
                  type="button"
                  onClick={() => loadHistory(q.symbol)}
                  className="card flex min-w-0 flex-col items-start gap-0.5 p-2.5 text-left"
                >
                  {/* truncate-1 carries min-width:0, without which this
                      flex child refuses to shrink and a long ticker
                      overruns the price beneath it. */}
                  <span
                    className="truncate-1 w-full text-xs text-muted-foreground"
                    title={q.symbol}
                  >
                    {q.symbol}
                  </span>
                  <span className="truncate-1 w-full text-lg">${q.price.toFixed(2)}</span>
                  <span
                    className={`flex items-center gap-1 text-xs ${up ? "text-primary" : "text-destructive"}`}
                  >
                    {up ? <TrendingUpIcon className="size-3" /> : <TrendingDownIcon className="size-3" />}
                    {q.change_percent?.toFixed(2)}%
                  </span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="glow-border">
        <CardHeader>
          <CardTitle>Price History</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value)}
              placeholder="Symbol, e.g. AAPL"
              className="h-8 w-40"
            />
            <button
              type="button"
              className="btn"
              style={{ padding: "0 var(--sp-3)" }}
              onClick={() => loadHistory(symbolInput)}
              disabled={loadingHistory || !symbolInput.trim()}
            >
              Chart
            </button>
          </div>
          {history?.ok === false && <p className="text-sm text-destructive">{history.error}</p>}
          {history?.ok && history.candles && (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={history.candles}>
                <defs>
                  <linearGradient id="closeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(152 76% 46%)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(152 76% 46%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(150 12% 14%)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(140 10% 55%)" }} minTickGap={30} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "hsl(140 10% 55%)" }} width={50} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(150 15% 7%)",
                    border: "1px solid hsl(150 12% 14%)",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke="hsl(152 76% 46%)"
                  fill="url(#closeGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
          {!history && (
            <p className="text-sm text-muted-foreground">
              Pick a symbol above to see its recent price chart.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
