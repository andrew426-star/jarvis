"use client"

import { useEffect, useRef, useState } from "react"
import { RefreshCwIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { JarvisAuthError, getPortfolio, type PortfolioResult } from "@/lib/jarvis-client"

interface PortfolioPanelProps {
  token: string
  onAuthError: () => void
  livePortfolio?: PortfolioResult
}

export function PortfolioPanel({ token, onAuthError, livePortfolio }: PortfolioPanelProps) {
  const [portfolio, setPortfolio] = useState<PortfolioResult | null>(null)
  const [loading, setLoading] = useState(true)

  // Guards against the initial background fetch resolving after a fresher
  // live tool result already arrived from a chat turn.
  const hasLivePortfolioRef = useRef(false)

  async function refreshPortfolio() {
    setLoading(true)
    try {
      setPortfolio(await getPortfolio(token))
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setPortfolio({ ok: false, error: "Could not load portfolio." })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    getPortfolio(token)
      .then((result) => {
        if (!hasLivePortfolioRef.current) setPortfolio(result)
      })
      .catch((err) => {
        if (err instanceof JarvisAuthError) {
          onAuthError()
          return
        }
        if (!hasLivePortfolioRef.current) setPortfolio({ ok: false, error: "Could not load portfolio." })
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (livePortfolio) {
      hasLivePortfolioRef.current = true
      setPortfolio(livePortfolio)
    }
  }, [livePortfolio])

  const account = portfolio?.account

  return (
    <div className="flex flex-col gap-4">
      <Card className="glow-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Account</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={refreshPortfolio}
            aria-label="Refresh portfolio"
          >
            <RefreshCwIcon className={loading ? "animate-spin" : ""} />
          </Button>
        </CardHeader>
        <CardContent>
          {portfolio?.ok === false && <p className="text-sm text-destructive">{portfolio.error}</p>}
          {account && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Equity</span>
                <span className="font-heading text-lg">${account.equity.toLocaleString()}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Cash</span>
                <span className="font-heading text-lg">${account.cash.toLocaleString()}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Buying Power</span>
                <span className="font-heading text-lg">${account.buying_power.toLocaleString()}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Status</span>
                <span className="font-heading text-lg">{account.status}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glow-border">
        <CardHeader>
          <CardTitle>Positions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {portfolio?.ok && portfolio.positions?.length === 0 && (
            <p className="text-sm text-muted-foreground">No open positions.</p>
          )}
          {portfolio?.positions?.map((position) => {
            const up = position.unrealized_pl >= 0
            return (
              <div
                key={position.symbol}
                className="glow-border flex items-center justify-between rounded-lg p-2.5"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-heading text-sm">{position.symbol}</span>
                  <span className="text-xs text-muted-foreground">
                    {position.qty} sh @ ${position.current_price.toFixed(2)}
                  </span>
                </div>
                <div
                  className={`flex items-center gap-1 text-sm font-medium ${up ? "text-primary" : "text-destructive"}`}
                >
                  {up ? <TrendingUpIcon className="size-3.5" /> : <TrendingDownIcon className="size-3.5" />}
                  {position.unrealized_pl_percent.toFixed(2)}%
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
