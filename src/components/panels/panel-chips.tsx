"use client"

import { LineChartIcon, NewspaperIcon, WalletIcon } from "lucide-react"

import { Card } from "@/components/ui/card"
import type { MarketSnapshot, NewsResult, PortfolioResult } from "@/lib/jarvis-client"

// Purpose-built for chip size — not the full panels shrunk via CSS
// transform: scale(). A shrunk real chart/headline list is unreadable at
// this size; these show one glanceable real stat or an honest "nothing
// yet" placeholder, never a fake miniaturization.

interface MarketsChipProps {
  snapshot?: MarketSnapshot
}

export function MarketsChip({ snapshot }: MarketsChipProps) {
  const top = snapshot?.ok
    ? [...snapshot.quotes].sort(
        (a, b) => Math.abs(b.change_percent ?? 0) - Math.abs(a.change_percent ?? 0),
      )[0]
    : undefined

  return (
    <Card size="sm" className="glow-border-hover flex flex-col gap-1 p-2.5">
      <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase">
        <LineChartIcon className="size-3" /> Markets
      </span>
      {top ? (
        <span className="font-heading text-sm">
          {top.symbol} ${top.price.toFixed(2)}
          <span className={top.change_percent && top.change_percent >= 0 ? "text-primary" : "text-destructive"}>
            {" "}
            {top.change_percent?.toFixed(2)}%
          </span>
        </span>
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
    <Card size="sm" className="glow-border-hover flex flex-col gap-1 p-2.5">
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
    <Card size="sm" className="glow-border-hover flex flex-col gap-1 p-2.5">
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
