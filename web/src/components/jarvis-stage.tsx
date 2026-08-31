"use client"

import dynamic from "next/dynamic"
import { useRef } from "react"

import { ChatThread, type ChatThreadHandle } from "@/components/chat-thread"
import { CoreTendril } from "@/components/core-tendril"
import type { CoreState } from "@/components/jarvis-core"
import { OrbitalPanel } from "@/components/orbital-panel"
import { PanelTabs, type TabKey } from "@/components/panel-tabs"
import { MarketsChip, NewsChip, PortfolioChip } from "@/components/panels/panel-chips"
import { MarketsPanel } from "@/components/panels/markets-panel"
import { NewsPanel } from "@/components/panels/news-panel"
import { PortfolioPanel } from "@/components/panels/portfolio-panel"
import { stopNarration } from "@/lib/narration"
import type {
  MarketHistory,
  MarketSnapshot,
  NewsResult,
  PortfolioResult,
  ToolResult,
} from "@/lib/jarvis-client"

const JarvisCore = dynamic(() => import("@/components/jarvis-core"), {
  ssr: false,
  loading: () => <div className="glow-green mx-auto size-24 animate-pulse rounded-full bg-primary/10" />,
})

export type PanelKey = Exclude<TabKey, "chat">

// Upper arc only, so the lower half stays clear for the chat dock below
// (and for jarvis-core.tsx's own ProjectorBeam, which already renders a
// faint cone pointing down from the core — chat living in that space is
// a small continuity win, not just a layout convenience).
const SLOT_ANGLE: Record<PanelKey, number> = {
  news: -150,
  markets: -90,
  portfolio: -30,
}

const PANEL_KEYS = Object.keys(SLOT_ANGLE) as PanelKey[]

interface JarvisStageProps {
  token: string
  sessionId: string
  coreState: CoreState
  onAuthError: () => void
  onToolResults: (results: ToolResult[]) => void
  onSpeakingChange: (speaking: boolean) => void
  onPendingChange: (pending: boolean) => void
  isListening: boolean
  onListeningChange: (listening: boolean) => void

  focusedPanel: PanelKey | null
  panelSignals: Record<PanelKey, number | null>
  onFocusPanel: (key: PanelKey) => void
  onDefocus: () => void

  liveMarketSnapshot?: MarketSnapshot
  liveMarketHistory?: MarketHistory
  liveNews?: NewsResult
  livePortfolio?: PortfolioResult
}

export function JarvisStage({
  token,
  sessionId,
  coreState,
  onAuthError,
  onToolResults,
  onSpeakingChange,
  onPendingChange,
  isListening,
  onListeningChange,
  focusedPanel,
  panelSignals,
  onFocusPanel,
  onDefocus,
  liveMarketSnapshot,
  liveMarketHistory,
  liveNews,
  livePortfolio,
}: JarvisStageProps) {
  const chatRef = useRef<ChatThreadHandle>(null)
  const mobileTab: TabKey = focusedPanel ?? "chat"

  // The core is the primary way to talk to Jarvis; the mic button in the
  // chat dock stays as the secondary, keyboard-reachable path.
  function handleCoreClick() {
    if (isListening) {
      chatRef.current?.stopRecording()
      return
    }
    // Barge-in. Narration is cut first so the mic never records Jarvis
    // talking over the user. Harmlessly a no-op when nothing is playing.
    stopNarration()
    chatRef.current?.startRecording()
  }

  function handleMobileTabChange(tab: TabKey) {
    if (tab === "chat") onDefocus()
    else onFocusPanel(tab)
  }

  function handleChipClick(key: PanelKey) {
    if (focusedPanel === key) onDefocus()
    else onFocusPanel(key)
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3 lg:mx-auto lg:max-w-6xl">
      <nav className="lg:hidden">
        <PanelTabs active={mobileTab} onChange={handleMobileTabChange} />
      </nav>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-6">
        {/* Core + orbit slots. Always visible — the core stays centered
            and stationary; chips (and tendrils) are positioned relative
            to it via .orbital-slot's/.core-tendril's shared CSS
            transform, not JS-measured. Anchor is --core-anchor-top (a
            shared CSS var, globals.css), not a literal percentage here —
            it's genuinely centered on mobile/tablet (no chips render
            below lg) and biased down only at lg, where the top slot's
            full orbit radius reaching straight up (unlike the two side
            slots, which only reach half their radius vertically) needs
            real headroom against the viewport/header. */}
        <div className="relative h-[340px] w-full shrink-0 sm:h-[400px] lg:h-[480px] lg:flex-1">
          <div className="absolute top-[var(--core-anchor-top)] left-1/2 size-72 -translate-x-1/2 -translate-y-1/2 sm:size-80 lg:size-[28rem]">
            {/* Canvas made inert so the button below it takes the click.
                The lattice is thin lines, so raycasting against the mesh
                would be a coin flip; a plain circular button is reliable
                and is focusable/announceable, which a hit-test isn't.
                Inset to roughly the globe so it doesn't swallow the
                empty corners of the box. */}
            <div className="pointer-events-none absolute inset-0">
              <JarvisCore state={coreState} />
            </div>
            <button
              type="button"
              onClick={handleCoreClick}
              // While a request is in flight the mic is disabled anyway
              // (chat-input is disabled by `pending`), so this only makes
              // that existing refusal visible instead of silent.
              disabled={coreState === "thinking"}
              aria-label={isListening ? "Stop listening" : "Talk to J.A.R.V.I.S."}
              aria-pressed={isListening}
              className="absolute inset-[16%] rounded-full transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
            />
          </div>

          {PANEL_KEYS.map((key) => (
            <div key={key} className="hidden lg:contents">
              <CoreTendril
                angle={SLOT_ANGLE[key]}
                active={panelSignals[key] !== null}
                prominence={panelSignals[key] ? "touched" : "dormant"}
                receded={focusedPanel !== null && focusedPanel !== key}
              />
              <OrbitalPanel
                angle={SLOT_ANGLE[key]}
                prominence={panelSignals[key] ? "touched" : "dormant"}
                receded={focusedPanel !== null && focusedPanel !== key}
                focused={focusedPanel === key}
                onClick={() => handleChipClick(key)}
              >
                {key === "markets" && <MarketsChip snapshot={liveMarketSnapshot} history={liveMarketHistory} />}
                {key === "news" && <NewsChip news={liveNews} />}
                {key === "portfolio" && <PortfolioChip portfolio={livePortfolio} />}
              </OrbitalPanel>
            </div>
          ))}
        </div>

        {/* Reading pane — only rendered visible when a panel is focused.
            All three full panels stay mounted at all times (hidden via
            className, not conditional rendering) so their own background
            fetches never stall or refire when switching focus — the same
            property the old single-content-area layout already had. */}
        <div
          className={
            focusedPanel
              ? "flex min-h-0 w-full flex-1 flex-col overflow-y-auto lg:w-[480px] lg:flex-none"
              : "hidden"
          }
        >
          <div className={focusedPanel === "markets" ? "" : "hidden"}>
            <MarketsPanel
              token={token}
              onAuthError={onAuthError}
              liveSnapshot={liveMarketSnapshot}
              liveHistory={liveMarketHistory}
            />
          </div>
          <div className={focusedPanel === "news" ? "" : "hidden"}>
            <NewsPanel token={token} onAuthError={onAuthError} liveNews={liveNews} />
          </div>
          <div className={focusedPanel === "portfolio" ? "" : "hidden"}>
            <PortfolioPanel token={token} onAuthError={onAuthError} livePortfolio={livePortfolio} />
          </div>
        </div>
      </div>

      {/* Chat dock — full height when ambient, a compact strip on desktop
          when a panel is focused (hidden entirely on mobile when focused,
          matching the old one-tab-at-a-time behavior there). */}
      <div
        className={
          focusedPanel
            ? "hidden lg:flex lg:h-32 lg:shrink-0 lg:flex-col lg:overflow-hidden"
            : "flex min-h-0 flex-1 flex-col"
        }
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
        />
      </div>
    </div>
  )
}
