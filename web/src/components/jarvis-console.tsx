"use client"

import { useEffect, useState } from "react"

import { JarvisStage, type PanelKey } from "@/components/jarvis-stage"
import { LoginGate } from "@/components/login-gate"
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

// tool_results names that map onto a panel — the same tool a chat message
// used, when clicked/asked, is what the matching panel should focus.
const TOOL_PANEL_MAP: Record<string, PanelKey> = {
  market_analysis: "markets",
  market_history: "markets",
  news_feed: "news",
  portfolio: "portfolio",
}

const STATUS_LABEL = {
  idle: "STANDING BY",
  thinking: "PROCESSING",
  speaking: "RESPONDING",
  listening: "LISTENING",
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

  // Replaces the old single activeTab: TabKey — focusedPanel is null in
  // the ambient state (all three panels peripheral, chat full-height) or
  // one of the three panel keys when a reading pane is open. panelSignals
  // is the real relevance/recency signal driving chip prominence: the
  // Date.now() a panel was last touched (via a chat tool call or a manual
  // click), or null if never touched this session.
  const [focusedPanel, setFocusedPanel] = useState<PanelKey | null>(null)
  const [panelSignals, setPanelSignals] = useState<Record<PanelKey, number | null>>({
    markets: null,
    news: null,
    portfolio: null,
  })
  const [isPending, setIsPending] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isListening, setIsListening] = useState(false)

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
    const touched: PanelKey[] = []
    for (const entry of results) {
      if (entry.name === "market_analysis") {
        setLiveMarketSnapshot(entry.result as MarketSnapshot)
        touched.push("markets")
      }
      if (entry.name === "market_history") {
        setLiveMarketHistory(entry.result as MarketHistory)
        touched.push("markets")
      }
      if (entry.name === "news_feed") {
        setLiveNews(entry.result as NewsResult)
        touched.push("news")
      }
      if (entry.name === "portfolio") {
        setLivePortfolio(entry.result as PortfolioResult)
        touched.push("portfolio")
      }
    }
    if (touched.length === 0) return

    const now = Date.now()
    setPanelSignals((prev) => {
      const next = { ...prev }
      for (const key of touched) next[key] = now
      return next
    })

    const firstMapped = results.find((entry) => TOOL_PANEL_MAP[entry.name])
    if (firstMapped) setFocusedPanel(TOOL_PANEL_MAP[firstMapped.name])
  }

  function handleFocusPanel(key: PanelKey) {
    setFocusedPanel(key)
    // Manually opening a panel counts as relevance too — a user checking
    // Portfolio without asking Jarvis anything is still real signal, not
    // something that should leave the chip looking permanently dormant.
    setPanelSignals((prev) => ({ ...prev, [key]: Date.now() }))
  }

  function handleDefocus() {
    setFocusedPanel(null)
  }

  if (status === "resolving") {
    return <div className="min-h-screen" />
  }

  if (status === "unauthenticated" || !token) {
    return <LoginGate onAuthenticated={handleAuthenticated} />
  }

  // Listening outranks speaking: during a barge-in the mic opens in the
  // same tick narration is cut, and the core should read as listening
  // immediately rather than flickering through "responding" on the way.
  const coreState = isListening
    ? "listening"
    : isSpeaking
      ? "speaking"
      : isPending
        ? "thinking"
        : "idle"

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
        <JarvisStage
          token={token}
          sessionId={sessionId}
          coreState={coreState}
          onAuthError={handleAuthError}
          onToolResults={handleToolResults}
          onSpeakingChange={setIsSpeaking}
          onPendingChange={setIsPending}
          isListening={isListening}
          onListeningChange={setIsListening}
          focusedPanel={focusedPanel}
          panelSignals={panelSignals}
          onFocusPanel={handleFocusPanel}
          onDefocus={handleDefocus}
          liveMarketSnapshot={liveMarketSnapshot}
          liveMarketHistory={liveMarketHistory}
          liveNews={liveNews}
          livePortfolio={livePortfolio}
        />
      </div>
    </div>
  )
}
