"use client"

import { useRef } from "react"

import { ArcReactor, type CoreState } from "@/components/arc-reactor"
import { ChatThread, type ChatThreadHandle } from "@/components/chat-thread"
import { FrequencyBars } from "@/components/frequency-bars"
import { StatusRing } from "@/components/status-ring"
import { MarketsPanel } from "@/components/panels/markets-panel"
import { NewsPanel } from "@/components/panels/news-panel"
import { PortfolioPanel } from "@/components/panels/portfolio-panel"
import { stopNarration } from "@/lib/narration"
import { BootStage } from "@/lib/use-boot"
import type {
  MarketHistory,
  MarketSnapshot,
  NewsResult,
  PortfolioResult,
  ToolResult,
} from "@/lib/jarvis-client"

export type PanelKey = "markets" | "news" | "portfolio"

const PANEL_LABELS: Record<PanelKey, string> = {
  markets: "Markets",
  news: "Intel",
  portfolio: "Assets",
}

const PANEL_KEYS = Object.keys(PANEL_LABELS) as PanelKey[]

interface JarvisStageProps {
  token: string
  sessionId: string
  coreState: CoreState
  bootStage: BootStage
  onAuthError: () => void
  onToolResults: (results: ToolResult[]) => void
  onSpeakingChange: (speaking: boolean) => void
  onPendingChange: (pending: boolean) => void
  onTurnsChange: (turns: number) => void
  turns: number
  isListening: boolean
  onListeningChange: (listening: boolean) => void

  activePanel: PanelKey
  panelSignals: Record<PanelKey, number | null>
  onFocusPanel: (key: PanelKey) => void

  /** Mobile only - which of the two columns is on screen. */
  mobileView: "console" | "data"
  onMobileViewChange: (view: "console" | "data") => void

  liveMarketSnapshot?: MarketSnapshot
  liveMarketHistory?: MarketHistory
  liveNews?: NewsResult
  livePortfolio?: PortfolioResult
}

export function JarvisStage({
  token,
  sessionId,
  coreState,
  bootStage,
  onAuthError,
  onToolResults,
  onSpeakingChange,
  onPendingChange,
  onTurnsChange,
  turns,
  isListening,
  onListeningChange,
  activePanel,
  panelSignals,
  onFocusPanel,
  mobileView,
  onMobileViewChange,
  liveMarketSnapshot,
  liveMarketHistory,
  liveNews,
  livePortfolio,
}: JarvisStageProps) {
  const chatRef = useRef<ChatThreadHandle>(null)

  // The reactor is the primary way to talk to Jarvis; the mic button in
  // the chat dock stays as the secondary, keyboard-reachable path.
  function handleReactorActivate() {
    if (isListening) {
      chatRef.current?.stopRecording()
      return
    }
    // Barge-in. Narration is cut first so the mic never records Jarvis
    // talking over the user. Harmlessly a no-op when nothing is playing.
    stopNarration()
    chatRef.current?.startRecording()
  }

  const panelsUp = bootStage >= BootStage.Panels

  return (
    <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col gap-3 px-3 pb-3 sm:px-6 sm:pb-5">
      {/* Mobile switcher. Below lg there is not room for the reactor and
          a data column at once, so they take turns rather than both
          being squeezed into something neither can use. */}
      <nav className="flex gap-2 lg:hidden">
        {(["console", "data"] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => onMobileViewChange(view)}
            className="bracket-frame label-hud flex-1 py-2 transition-colors duration-200"
            style={{
              color: mobileView === view ? "var(--hud)" : "var(--hud-dim)",
              background:
                mobileView === view ? "hsl(var(--hue) var(--sat) 55% / 0.1)" : "transparent",
            }}
          >
            {view === "console" ? "Console" : "Telemetry"}
          </button>
        ))}
      </nav>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,380px)]">
        {/* ---- Left rail: data panels ---- */}
        <section
          className={`${panelsUp ? "boot-left" : "opacity-0"} min-h-0 flex-col gap-2 ${
            mobileView === "data" ? "flex" : "hidden"
          } lg:flex`}
        >
          <div className="flex gap-1">
            {PANEL_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onFocusPanel(key)}
                className="bracket-frame label-hud flex-1 py-1.5 transition-colors duration-200"
                style={{
                  ["--tick" as string]: "5px",
                  color: activePanel === key ? "var(--hud)" : "var(--hud-dim)",
                  background:
                    activePanel === key ? "hsl(var(--hue) var(--sat) 55% / 0.1)" : "transparent",
                }}
              >
                {PANEL_LABELS[key]}
                {/* A panel Jarvis has actually touched this session gets a
                    live dot - the same relevance signal the old orbital
                    chips carried, kept because it still earns its place. */}
                {panelSignals[key] !== null && (
                  <span
                    className="ml-1 inline-block size-1 align-middle"
                    style={{ background: "var(--hud-bright)" }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* All three stay mounted and are hidden with a class rather
              than conditionally rendered, so their background fetches
              never stall or refire when switching tabs. */}
          <div className="hud-panel min-h-0 flex-1 overflow-y-auto p-3">
            <div className={activePanel === "markets" ? "" : "hidden"}>
              <MarketsPanel
                token={token}
                onAuthError={onAuthError}
                liveSnapshot={liveMarketSnapshot}
                liveHistory={liveMarketHistory}
              />
            </div>
            <div className={activePanel === "news" ? "" : "hidden"}>
              <NewsPanel token={token} onAuthError={onAuthError} liveNews={liveNews} />
            </div>
            <div className={activePanel === "portfolio" ? "" : "hidden"}>
              <PortfolioPanel
                token={token}
                onAuthError={onAuthError}
                livePortfolio={livePortfolio}
              />
            </div>
          </div>
        </section>

        {/* ---- Centre: reactor, status ring, EQ ---- */}
        <section
          className={`min-h-0 flex-col items-center justify-center gap-4 ${
            mobileView === "console" ? "flex" : "hidden"
          } lg:flex`}
        >
          <div className="relative aspect-square w-full max-w-[min(58vh,420px)] shrink-0">
            {/* The ring is the same square box as the reactor, scaled up
                so its gauges sit outside the outermost reactor ring. */}
            <StatusRing
              bootStage={bootStage}
              turns={turns}
              className="pointer-events-none absolute inset-[-13%] h-[126%] w-[126%]"
            />
            <ArcReactor
              state={coreState}
              bootStage={bootStage}
              onActivate={handleReactorActivate}
              isListening={isListening}
              disabled={coreState === "thinking"}
            />
          </div>

          <div className="h-14 w-full max-w-[min(58vh,420px)] shrink-0 sm:h-16">
            <FrequencyBars
              active={coreState === "speaking" || coreState === "listening"}
              bootStage={bootStage}
            />
          </div>
        </section>

        {/* ---- Right rail: terminal ---- */}
        <section
          className={`${panelsUp ? "boot-right" : "opacity-0"} min-h-0 ${
            mobileView === "console" ? "flex" : "hidden"
          } flex-col lg:flex`}
        >
          <ChatThread
            ref={chatRef}
            token={token}
            sessionId={sessionId}
            onAuthError={onAuthError}
            onToolResults={onToolResults}
            onSpeakingChange={onSpeakingChange}
            onPendingChange={onPendingChange}
            onRecordingChange={onListeningChange}
            onTurnsChange={onTurnsChange}
          />
        </section>
      </div>
    </div>
  )
}
