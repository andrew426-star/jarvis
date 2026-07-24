"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"

import { ChatThread } from "@/components/chat-thread"
import { LoginGate } from "@/components/login-gate"
import { PanelTabs, type TabKey } from "@/components/panel-tabs"
import { MarketsPanel } from "@/components/panels/markets-panel"
import { NewsPanel } from "@/components/panels/news-panel"
import { PortfolioPanel } from "@/components/panels/portfolio-panel"
import type {
  MarketHistory,
  MarketSnapshot,
  NewsResult,
  PortfolioResult,
  ToolResult,
} from "@/lib/jarvis-client"
import {
  clearSession,
  clearStoredToken,
  getOrCreateSessionId,
  getStoredToken,
  setStoredToken,
} from "@/lib/storage"

const JarvisCore = dynamic(() => import("@/components/jarvis-core"), {
  ssr: false,
  loading: () => <div className="glow-green mx-auto size-24 animate-pulse rounded-full bg-primary/10" />,
})

// tool_results names that map onto a tab — the same tool a chat message
// used, when clicked/asked, is what the matching tab should show.
const TOOL_TAB_MAP: Record<string, TabKey> = {
  market_analysis: "markets",
  market_history: "markets",
  news_feed: "news",
  portfolio: "portfolio",
}

const STATUS_LABEL = {
  idle: "STANDING BY",
  thinking: "PROCESSING",
  speaking: "RESPONDING",
} as const

type BracketPosition = "tl" | "tr" | "bl" | "br"

const BRACKET_STYLES: Record<BracketPosition, string> = {
  tl: "top-4 left-4 sm:top-6 sm:left-6 border-t-2 border-l-2",
  tr: "top-4 right-4 sm:top-6 sm:right-6 border-t-2 border-r-2",
  bl: "bottom-4 left-4 sm:bottom-6 sm:left-6 border-b-2 border-l-2",
  br: "bottom-4 right-4 sm:bottom-6 sm:right-6 border-b-2 border-r-2",
}

function CornerBracket({ position }: { position: BracketPosition }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed z-20 size-6 border-primary/30 sm:size-8 ${BRACKET_STYLES[position]}`}
    />
  )
}

type Status = "resolving" | "unauthenticated" | "authenticated"

export function JarvisConsole() {
  const [status, setStatus] = useState<Status>("resolving")
  const [token, setToken] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState("")

  const [activeTab, setActiveTab] = useState<TabKey>("chat")
  const [isPending, setIsPending] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)

  const [liveMarketSnapshot, setLiveMarketSnapshot] = useState<MarketSnapshot | undefined>()
  const [liveMarketHistory, setLiveMarketHistory] = useState<MarketHistory | undefined>()
  const [liveNews, setLiveNews] = useState<NewsResult | undefined>()
  const [livePortfolio, setLivePortfolio] = useState<PortfolioResult | undefined>()

  // Resolved on mount, not read during render — localStorage doesn't exist
  // during server-side prerendering, the same class of bug as `window is
  // not defined`. Rendering a neutral placeholder until this runs avoids a
  // hydration mismatch.
  useEffect(() => {
    const storedToken = getStoredToken()
    if (storedToken) {
      setToken(storedToken)
      setSessionId(getOrCreateSessionId())
      setStatus("authenticated")
    } else {
      setStatus("unauthenticated")
    }
  }, [])

  function handleAuthenticated(newToken: string) {
    setStoredToken(newToken)
    setToken(newToken)
    setSessionId(getOrCreateSessionId())
    setStatus("authenticated")
  }

  function handleAuthError() {
    clearStoredToken()
    clearSession()
    setToken(null)
    setStatus("unauthenticated")
  }

  function handleToolResults(results: ToolResult[]) {
    for (const entry of results) {
      if (entry.name === "market_analysis") setLiveMarketSnapshot(entry.result as MarketSnapshot)
      if (entry.name === "market_history") setLiveMarketHistory(entry.result as MarketHistory)
      if (entry.name === "news_feed") setLiveNews(entry.result as NewsResult)
      if (entry.name === "portfolio") setLivePortfolio(entry.result as PortfolioResult)
    }
    const firstMapped = results.find((entry) => TOOL_TAB_MAP[entry.name])
    if (firstMapped) setActiveTab(TOOL_TAB_MAP[firstMapped.name])
  }

  if (status === "resolving") {
    return <div className="min-h-screen" />
  }

  if (status === "unauthenticated" || !token) {
    return <LoginGate onAuthenticated={handleAuthenticated} />
  }

  const coreState = isSpeaking ? "speaking" : isPending ? "thinking" : "idle"

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden">
      <CornerBracket position="tl" />
      <CornerBracket position="tr" />
      <CornerBracket position="bl" />
      <CornerBracket position="br" />

      <header className="flex shrink-0 items-center justify-between px-6 pt-6 sm:px-12 sm:pt-8">
        <span className="font-heading text-sm tracking-[0.35em] text-gradient-green">J.A.R.V.I.S.</span>
        <div className="flex items-center gap-2 text-[0.65rem] tracking-[0.2em] text-muted-foreground uppercase">
          <span
            className={`size-1.5 rounded-full bg-primary ${coreState !== "idle" ? "glow-green animate-pulse" : "opacity-40"}`}
          />
          {STATUS_LABEL[coreState]}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col items-center px-4 pb-6 sm:px-8">
        <div className="pointer-events-none size-48 shrink-0 sm:size-56 md:size-64">
          <JarvisCore state={coreState} />
        </div>

        <div className="flex w-full min-h-0 flex-1 flex-col items-center gap-3">
          <PanelTabs active={activeTab} onChange={setActiveTab} />

          <div className="min-h-0 w-full max-w-4xl flex-1 border-t border-border/60 pt-4">
            <div className={activeTab === "chat" ? "h-full" : "hidden"}>
              <ChatThread
                token={token}
                sessionId={sessionId}
                onAuthError={handleAuthError}
                onToolResults={handleToolResults}
                onSpeakingChange={setIsSpeaking}
                onPendingChange={setIsPending}
              />
            </div>
            <div className={activeTab === "markets" ? "h-full overflow-y-auto" : "hidden"}>
              <MarketsPanel
                token={token}
                onAuthError={handleAuthError}
                liveSnapshot={liveMarketSnapshot}
                liveHistory={liveMarketHistory}
              />
            </div>
            <div className={activeTab === "news" ? "h-full overflow-y-auto" : "hidden"}>
              <NewsPanel token={token} onAuthError={handleAuthError} liveNews={liveNews} />
            </div>
            <div className={activeTab === "portfolio" ? "h-full overflow-y-auto" : "hidden"}>
              <PortfolioPanel token={token} onAuthError={handleAuthError} livePortfolio={livePortfolio} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
