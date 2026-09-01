"use client"

import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"

import { ArcReactor } from "@/components/hud/arc-reactor"
import { AudioVisualizer } from "@/components/hud/audio-visualizer"
import { BottomBar } from "@/components/hud/bottom-bar"
import { ChatInterface } from "@/components/hud/chat-interface"
import type { ChatMessageData } from "@/components/hud/chat-message"
import { DataStream } from "@/components/hud/data-stream"
import { GlobalEffects } from "@/components/hud/global-effects"
import { HolographicGrid } from "@/components/hud/holographic-grid"
import { LeftPanel } from "@/components/hud/left-panel"
import { RightPanel } from "@/components/hud/right-panel"
import { SettingsPanel } from "@/components/hud/settings-panel"
import { StatusRing } from "@/components/hud/status-ring"
import { TopBar } from "@/components/hud/top-bar"
import { LoginGate } from "@/components/login-gate"
import type { MicButtonHandle } from "@/components/mic-button"
import { MarketsPanel } from "@/components/panels/markets-panel"
import { NewsPanel } from "@/components/panels/news-panel"
import { PortfolioPanel } from "@/components/panels/portfolio-panel"
import {
  JarvisApiError,
  JarvisAuthError,
  JarvisNetworkError,
  invoke,
  type MarketHistory,
  type MarketSnapshot,
  type NewsResult,
  type PortfolioResult,
  type ToolResult,
} from "@/lib/jarvis-client"
import { stopNarration } from "@/lib/narration"
import { clockTime, useJarvis, type AgentStatus, type TabKey } from "@/lib/store"
import { useBoot } from "@/lib/use-boot"
import {
  clearSession,
  clearStoredToken,
  getOrCreateSessionId,
  getStoredToken,
  setStoredToken,
} from "@/lib/storage"

const TOOL_PANEL_MAP: Record<string, TabKey> = {
  market_analysis: "markets",
  market_history: "markets",
  news_feed: "intel",
  portfolio: "assets",
}

type Status = "resolving" | "unauthenticated" | "authenticated"

export function JarvisConsole() {
  const [status, setStatus] = useState<Status>("resolving")
  const [token, setToken] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState("")
  const [loginError, setLoginError] = useState<string | null>(null)

  useEffect(() => {
    // A completed Google sign-in lands back here as ?session=... since
    // the callback has to hand the browser its credential somehow and
    // this app talks Bearer, not cookies.
    const params = new URLSearchParams(window.location.search)
    const granted = params.get("session")
    const failure = params.get("login_error")

    if (granted || failure) {
      // Strip it immediately: a session token in the address bar ends up
      // in history, bookmarks, and any screenshot of the app.
      window.history.replaceState({}, "", window.location.pathname)
    }

    if (granted) {
      setStoredToken(granted)
      setToken(granted)
      setSessionId(getOrCreateSessionId())
      setStatus("authenticated")
      return
    }
    if (failure) {
      setLoginError(failure)
      setStatus("unauthenticated")
      return
    }

    const stored = getStoredToken()
    if (stored) {
      setToken(stored)
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

  if (status === "resolving") return <div style={{ height: "100vh" }} />
  if (status === "unauthenticated" || !token) return <LoginGate loginError={loginError} />

  // Keyed on the token so signing out and back in remounts the shell and
  // replays the boot sequence rather than snapping to a live HUD.
  return <Shell key={token} token={token} sessionId={sessionId} onAuthError={handleAuthError} />
}

function Shell({
  token,
  sessionId,
  onAuthError,
}: {
  token: string
  sessionId: string
  onAuthError: () => void
}) {
  const boot = useBoot()
  const micRef = useRef<MicButtonHandle>(null)

  const {
    mode,
    activeTab,
    listening,
    setStatus: setAgentStatus,
    rerollMetrics,
    pushLog,
  } = useJarvis()

  const [messages, setMessages] = useState<ChatMessageData[]>([])
  const [pending, setPending] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [liveMarketSnapshot, setLiveMarketSnapshot] = useState<MarketSnapshot | undefined>()
  const [liveMarketHistory, setLiveMarketHistory] = useState<MarketHistory | undefined>()
  const [liveNews, setLiveNews] = useState<NewsResult | undefined>()
  const [livePortfolio, setLivePortfolio] = useState<PortfolioResult | undefined>()

  // Listening outranks speaking: during a barge-in the mic opens in the
  // same tick narration is cut, and the reactor should read as listening
  // immediately rather than flickering through "responding" on the way.
  const agentStatus: AgentStatus = listening
    ? "listening"
    : speaking
      ? "speaking"
      : pending
        ? "thinking"
        : "idle"

  useEffect(() => {
    setAgentStatus(agentStatus)
  }, [agentStatus, setAgentStatus])

  // Simulated host metrics, on the spec's 5s cadence.
  useEffect(() => {
    const id = window.setInterval(rerollMetrics, 5000)
    return () => window.clearInterval(id)
  }, [rerollMetrics])

  function handleToolResults(results: ToolResult[]) {
    let firstPanel: TabKey | null = null
    for (const entry of results) {
      if (entry.name === "market_analysis") setLiveMarketSnapshot(entry.result as MarketSnapshot)
      if (entry.name === "market_history") setLiveMarketHistory(entry.result as MarketHistory)
      if (entry.name === "news_feed") setLiveNews(entry.result as NewsResult)
      if (entry.name === "portfolio") setLivePortfolio(entry.result as PortfolioResult)
      const mapped = TOOL_PANEL_MAP[entry.name]
      if (mapped && !firstPanel) firstPanel = mapped
      pushLog("OK", `Tool ${entry.name}`)
    }
    if (firstPanel) useJarvis.getState().setActiveTab(firstPanel)
  }

  async function handleSend(text: string, viaVoice: boolean) {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text, time: clockTime() },
    ])
    setPending(true)
    setError(null)
    pushLog("NONE", viaVoice ? "Voice command received" : "Command received")

    try {
      const result = await invoke(text, sessionId, token)
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.response,
          time: clockTime(),
          toolsUsed: result.tools_used,
          autoPlay: true,
          reopenMicAfter: viaVoice,
        },
      ])
      if (result.tool_results.length > 0) handleToolResults(result.tool_results)
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        pushLog("ERR", "Session rejected")
        onAuthError()
        return
      }
      const message =
        err instanceof JarvisNetworkError || err instanceof JarvisApiError
          ? err.message
          : "Something went wrong."
      setError(message)
      pushLog("ERR", message)
    } finally {
      setPending(false)
    }
  }

  function handleReactorToggle() {
    if (listening) {
      micRef.current?.stopRecording()
      return
    }
    // Barge-in. Narration is cut first so the mic never records Jarvis
    // talking over the user; a no-op when nothing is playing.
    stopNarration()
    micRef.current?.startRecording()
  }

  const serious = mode === "serious"

  return (
    <div className="hud-grid">
      <HolographicGrid serious={serious} />
      <DataStream visible={boot.streams} serious={serious} />

      {/* Step 2 of the boot: a single line draws across the centre.
          scaleX, not width - rule 10 allows transform and opacity only,
          and a width animation would relayout every frame. */}
      {!boot.chrome && (
        <div
          className="pointer-events-none fixed top-1/2 right-0 left-0"
          style={{ zIndex: 40 }}
          aria-hidden
        >
          <div
            style={{
              height: "1px",
              background: "var(--accent)",
              boxShadow: "0 0 12px var(--accent)",
              transform: `scaleX(${boot.line ? 1 : 0})`,
              transition: "transform 300ms ease-in-out",
            }}
          />
        </div>
      )}

      <motion.div
        className="bar-full"
        initial={{ y: -48, opacity: 0 }}
        animate={boot.chrome ? { y: 0, opacity: 1 } : { y: -48, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        style={{ zIndex: 20 }}
      >
        <TopBar />
      </motion.div>

      <motion.div
        className="hud-side min-h-0"
        initial={{ x: -220, opacity: 0 }}
        animate={boot.chrome ? { x: 0, opacity: 1 } : { x: -220, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut", delay: 0.08 }}
        style={{ zIndex: 20, display: "flex" }}
      >
        <LeftPanel />
      </motion.div>

      {/* Centre column. Flex rather than the spec's absolute positioning:
          absolute children cannot participate in min-h-0, so a long chat
          would have escaped its region - which rules 1 and 2 forbid. */}
      <main
        className="relative flex min-h-0 flex-col overflow-hidden"
        style={{ padding: "var(--sp-4) var(--sp-5)", gap: "var(--sp-3)", zIndex: 10 }}
      >
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <div className="relative aspect-square h-full max-h-full">
            <StatusRing visible={boot.statusRing} />
            <div className="absolute inset-[13%]">
              <ArcReactor
                status={agentStatus}
                onToggle={handleReactorToggle}
                ringsRevealed={boot.rings}
              />
            </div>
          </div>
        </div>

        {/* Comms terminal, or a data panel when a tab is selected. Same
            region either way, capped at 40% of the column so the reactor
            is never pushed off screen. */}
        <div
          className="flex min-h-0 flex-col"
          style={{
            maxHeight: "40%",
            opacity: boot.chat ? 1 : 0,
            transition: "opacity 400ms ease",
          }}
        >
          {activeTab === null ? (
            <ChatInterface
              messages={messages}
              pending={pending}
              error={error}
              token={token}
              onAuthError={onAuthError}
              onSpeakingChange={setSpeaking}
              onReopenMic={() => micRef.current?.startRecording()}
            />
          ) : (
            <div className="card min-h-0 flex-1 overflow-y-auto" style={{ padding: "var(--sp-3)" }}>
              <div className={activeTab === "markets" ? "" : "hidden"}>
                <MarketsPanel
                  token={token}
                  onAuthError={onAuthError}
                  liveSnapshot={liveMarketSnapshot}
                  liveHistory={liveMarketHistory}
                />
              </div>
              <div className={activeTab === "intel" ? "" : "hidden"}>
                <NewsPanel token={token} onAuthError={onAuthError} liveNews={liveNews} />
              </div>
              <div className={activeTab === "assets" ? "" : "hidden"}>
                <PortfolioPanel
                  token={token}
                  onAuthError={onAuthError}
                  livePortfolio={livePortfolio}
                />
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0">
          <AudioVisualizer status={agentStatus} visible={boot.visualizer} />
        </div>
      </main>

      <motion.div
        className="hud-side min-h-0"
        initial={{ x: 220, opacity: 0 }}
        animate={boot.chrome ? { x: 0, opacity: 1 } : { x: 220, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut", delay: 0.08 }}
        style={{ zIndex: 20, display: "flex" }}
      >
        <RightPanel />
      </motion.div>

      <motion.div
        className="bar-full"
        initial={{ y: 56, opacity: 0 }}
        animate={boot.chrome ? { y: 0, opacity: 1 } : { y: 56, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut", delay: 0.16 }}
        style={{ zIndex: 20 }}
      >
        <BottomBar
          token={token}
          disabled={pending}
          onSend={handleSend}
          onAuthError={onAuthError}
          micRef={micRef}
        />
      </motion.div>

      <SettingsPanel />
      <GlobalEffects />
    </div>
  )
}
