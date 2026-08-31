"use client"

import { useEffect, useState } from "react"

import type { CoreState } from "@/components/arc-reactor"
import { HudFrame } from "@/components/hud-frame"
import { JarvisStage, type PanelKey } from "@/components/jarvis-stage"
import { LoginGate } from "@/components/login-gate"
import { ModeToggle } from "@/components/mode-toggle"
import { BootStage, useBoot } from "@/lib/use-boot"
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

// tool_results names that map onto a panel - the same tool a reply used
// is the panel that should come forward.
const TOOL_PANEL_MAP: Record<string, PanelKey> = {
  market_analysis: "markets",
  market_history: "markets",
  news_feed: "news",
  portfolio: "portfolio",
}

const STATUS_LABEL: Record<CoreState, string> = {
  idle: "Standing By",
  thinking: "Processing",
  speaking: "Responding",
  listening: "Listening",
}

type Status = "resolving" | "unauthenticated" | "authenticated"

export function JarvisConsole() {
  const [status, setStatus] = useState<Status>("resolving")
  const [token, setToken] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState("")
  const [loginError, setLoginError] = useState<string | null>(null)

  // Resolved on mount, not read during render - localStorage does not
  // exist during the static export, the same class of bug as `window is
  // not defined`. Rendering a neutral placeholder until this runs avoids
  // a hydration mismatch.
  useEffect(() => {
    // A completed Google sign-in lands back here as ?session=... (or
    // ?login_error=...), since the callback has to hand the browser its
    // credential somehow and this app talks Bearer, not cookies.
    const params = new URLSearchParams(window.location.search)
    const grantedSession = params.get("session")
    const failure = params.get("login_error")

    if (grantedSession || failure) {
      // Strip it immediately: a session token sitting in the address bar
      // ends up in history, bookmarks, and any screenshot of the app.
      window.history.replaceState({}, "", window.location.pathname)
    }

    if (grantedSession) {
      setStoredToken(grantedSession)
      setToken(grantedSession)
      setSessionId(getOrCreateSessionId())
      setStatus("authenticated")
      return
    }

    if (failure) {
      setLoginError(failure)
      setStatus("unauthenticated")
      return
    }

    const storedToken = getStoredToken()
    if (storedToken) {
      setToken(storedToken)
      setSessionId(getOrCreateSessionId())
      setStatus("authenticated")
    } else {
      setStatus("unauthenticated")
    }
  }, [])

  function handleAuthError() {
    clearStoredToken()
    clearSession()
    setToken(null)
    setStatus("unauthenticated")
  }

  if (status === "resolving") {
    return <div className="min-h-screen" />
  }

  if (status === "unauthenticated" || !token) {
    return <LoginGate loginError={loginError} />
  }

  // Keyed on the token so signing out and back in genuinely remounts the
  // shell, replaying the boot sequence rather than snapping straight to
  // a live HUD.
  return <ConsoleShell key={token} token={token} sessionId={sessionId} onAuthError={handleAuthError} />
}

interface ConsoleShellProps {
  token: string
  sessionId: string
  onAuthError: () => void
}

// Split out so useBoot mounts with the authenticated HUD. Run at the
// top level it would start counting down while the login screen is
// still up, and someone who took a minute to sign in would arrive after
// the sequence had already finished.
function ConsoleShell({ token, sessionId, onAuthError }: ConsoleShellProps) {
  const { stage } = useBoot()

  const [activePanel, setActivePanel] = useState<PanelKey>("markets")
  const [panelSignals, setPanelSignals] = useState<Record<PanelKey, number | null>>({
    markets: null,
    news: null,
    portfolio: null,
  })
  const [mobileView, setMobileView] = useState<"console" | "data">("console")

  const [isPending, setIsPending] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [turns, setTurns] = useState(0)

  const [liveMarketSnapshot, setLiveMarketSnapshot] = useState<MarketSnapshot | undefined>()
  const [liveMarketHistory, setLiveMarketHistory] = useState<MarketHistory | undefined>()
  const [liveNews, setLiveNews] = useState<NewsResult | undefined>()
  const [livePortfolio, setLivePortfolio] = useState<PortfolioResult | undefined>()

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
    if (firstMapped) setActivePanel(TOOL_PANEL_MAP[firstMapped.name])
  }

  function handleFocusPanel(key: PanelKey) {
    setActivePanel(key)
    // Opening a panel by hand is real relevance too - someone checking
    // Assets without asking Jarvis anything should not leave the tab
    // looking permanently dormant.
    setPanelSignals((prev) => ({ ...prev, [key]: Date.now() }))
  }

  // Listening outranks speaking: during a barge-in the mic opens in the
  // same tick narration is cut, and the reactor should read as listening
  // immediately rather than flickering through "responding" on the way.
  const coreState: CoreState = isListening
    ? "listening"
    : isSpeaking
      ? "speaking"
      : isPending
        ? "thinking"
        : "idle"

  const chromeUp = stage >= BootStage.Panels

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden">
      <HudFrame bootStage={stage} />

      <header
        className="relative z-10 flex shrink-0 items-center justify-between px-5 pt-5 sm:px-9 sm:pt-7"
        style={{
          opacity: chromeUp ? 1 : 0,
          transition: "opacity 600ms ease-in-out",
        }}
      >
        <div className="flex items-baseline gap-3">
          <span className="font-display text-gradient-hud text-sm sm:text-base">
            J.A.R.V.I.S.
          </span>
          <span className="label-hud hidden sm:inline">Mark VII</span>
        </div>

        <div className="flex items-center gap-3 sm:gap-5">
          <div className="flex items-center gap-2">
            <span
              className={`size-1.5 ${coreState !== "idle" ? "animate-pulse-dot" : "opacity-40"}`}
              style={{
                background: "var(--hud)",
                boxShadow: coreState !== "idle" ? "0 0 8px var(--hud)" : "none",
              }}
            />
            <span className="label-hud" style={{ color: "var(--hud)" }}>
              {STATUS_LABEL[coreState]}
            </span>
          </div>
          <ModeToggle />
        </div>
      </header>

      <JarvisStage
        token={token}
        sessionId={sessionId}
        coreState={coreState}
        bootStage={stage}
        onAuthError={onAuthError}
        onToolResults={handleToolResults}
        onSpeakingChange={setIsSpeaking}
        onPendingChange={setIsPending}
        onTurnsChange={setTurns}
        turns={turns}
        isListening={isListening}
        onListeningChange={setIsListening}
        activePanel={activePanel}
        panelSignals={panelSignals}
        onFocusPanel={handleFocusPanel}
        mobileView={mobileView}
        onMobileViewChange={setMobileView}
        liveMarketSnapshot={liveMarketSnapshot}
        liveMarketHistory={liveMarketHistory}
        liveNews={liveNews}
        livePortfolio={livePortfolio}
      />
    </div>
  )
}
