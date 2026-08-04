"use client"

import { LineChartIcon, NewspaperIcon, WalletIcon } from "lucide-react"

import { Card } from "@/components/ui/card"
import type { Candle, MarketHistory, MarketSnapshot, NewsResult, PortfolioResult } from "@/lib/jarvis-client"

// Purpose-built for chip size — not the full panels shrunk via CSS
// transform: scale(). A shrunk real chart/headline list is unreadable at
// this size; these show one glanceable real stat or an honest "nothing
// yet" placeholder, never a fake miniaturization.

const SPARKLINE_WIDTH = 60
const SPARKLINE_HEIGHT = 20

// Hand-rolled inline SVG, deliberately not Recharts (already a
// dependency) — its ResponsiveContainer/axis machinery is real overhead
// for a tiny always-on decoration when the full chart already exists in
// the reading pane for the actual reading experience.
function Sparkline({ candles }: { candles: Candle[] }) {
  const closes = candles.slice(-20).map((c) => c.close)
  if (closes.length < 2) return null
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const points = closes
    .map((c, i) => {
      const x = (i / (closes.length - 1)) * SPARKLINE_WIDTH
      const y = SPARKLINE_HEIGHT - ((c - min) / range) * SPARKLINE_HEIGHT
      return `${x},${y}`
    })
    .join(" ")
  const up = closes[closes.length - 1] >= closes[0]

  return (
    <svg width={SPARKLINE_WIDTH} height={SPARKLINE_HEIGHT} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={up ? "hsl(152 76% 46%)" : "hsl(0 72% 55%)"}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

interface MarketsChipProps {
  snapshot?: MarketSnapshot
  history?: MarketHistory
}

export function MarketsChip({ snapshot, history }: MarketsChipProps) {
  const top = snapshot?.ok
    ? [...snapshot.quotes].sort(
        (a, b) => Math.abs(b.change_percent ?? 0) - Math.abs(a.change_percent ?? 0),
      )[0]
    : undefined
  const candles = history?.ok ? history.candles : undefined

  return (
    <Card size="sm" className="hud-chip-frame glow-border-hover flex flex-col gap-1 p-2.5">
      <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase">
        <LineChartIcon className="size-3" /> Markets
      </span>
      {top ? (
        <div className="flex items-center justify-between gap-2">
          <span className="font-heading text-sm">
            {top.symbol} ${top.price.toFixed(2)}
            <span className={top.change_percent && top.change_percent >= 0 ? "text-primary" : "text-destructive"}>
              {" "}
              {top.change_percent?.toFixed(2)}%
            </span>
          </span>
          {candles && candles.length >= 2 && <Sparkline candles={candles} />}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">Ask about a symbol</span>
      )}
    </Card>
  )
}

interface NewsChipProps {
  news?: NewsResult
}

export function NewsChip({ news }: NewsChipProps) {
  const latest = news?.ok ? news.articles?.[0] : undefined

  return (
    <Card size="sm" className="hud-chip-frame glow-border-hover flex flex-col gap-1 p-2.5">
      <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase">
        <NewspaperIcon className="size-3" /> News
      </span>
      {latest ? (
        <span className="line-clamp-2 text-sm">{latest.title}</span>
      ) : (
        <span className="text-xs text-muted-foreground">Ask what&apos;s happening</span>
      )}
    </Card>
  )
}

interface PortfolioChipProps {
  portfolio?: PortfolioResult
}

export function PortfolioChip({ portfolio }: PortfolioChipProps) {
  const account = portfolio?.ok ? portfolio.account : undefined

  return (
    <Card size="sm" className="hud-chip-frame glow-border-hover flex flex-col gap-1 p-2.5">
      <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase">
        <WalletIcon className="size-3" /> Portfolio
      </span>
      {account ? (
        <span className="font-heading text-sm">${account.equity.toLocaleString()}</span>
      ) : (
        <span className="text-xs text-muted-foreground">Check your account</span>
      )}
    </Card>
  )
}
