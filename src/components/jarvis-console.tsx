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
    <div className="mx-auto flex h-screen max-w-3xl flex-col gap-3 px-4 py-4">
      <div className="flex flex-col items-center gap-1">
        <div className="size-40 sm:size-48">
          <JarvisCore state={coreState} />
        </div>
        <h1 className="font-heading text-xl text-gradient-green">J.A.R.V.I.S.</h1>
      </div>

      <PanelTabs active={activeTab} onChange={setActiveTab} />

      <div className="min-h-0 flex-1">
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
  )
}
