"use client"

import dynamic from "next/dynamic"

import { ChatThread } from "@/components/chat-thread"
import type { CoreState } from "@/components/jarvis-core"
import { OrbitalPanel } from "@/components/orbital-panel"
import { PanelTabs, type TabKey } from "@/components/panel-tabs"
import { MarketsChip, NewsChip, PortfolioChip } from "@/components/panels/panel-chips"
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
  focusedPanel,
  panelSignals,
  onFocusPanel,
  onDefocus,
  liveMarketSnapshot,
  liveMarketHistory,
  liveNews,
  livePortfolio,
}: JarvisStageProps) {
  const mobileTab: TabKey = focusedPanel ?? "chat"

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
            and stationary; chips are positioned relative to it via
            .orbital-slot's CSS transform, not JS-measured. Anchor sits at
            68% down (not 50%) — all three slot angles are in the upper
            arc (-150/-90/-30), and the top slot's full orbit radius
            reaches straight up with no horizontal component to share it,
            unlike the two side slots. At a true 50% center that reach
            clipped past the viewport/header; matches .orbital-slot's own
            top:68% in globals.css, which must stay in sync with this. */}
        <div className="relative h-[300px] w-full shrink-0 sm:h-[360px] lg:h-[420px] lg:flex-1">
          <div className="absolute top-[68%] left-1/2 size-64 -translate-x-1/2 -translate-y-1/2 sm:size-72 lg:size-96">
            <JarvisCore state={coreState} />
          </div>

          {PANEL_KEYS.map((key) => (
            <div key={key} className="hidden lg:block">
              <OrbitalPanel
                angle={SLOT_ANGLE[key]}
                prominence={panelSignals[key] ? "touched" : "dormant"}
                receded={focusedPanel !== null && focusedPanel !== key}
                focused={focusedPanel === key}
                onClick={() => handleChipClick(key)}
              >
                {key === "markets" && <MarketsChip snapshot={liveMarketSnapshot} />}
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
          token={token}
          sessionId={sessionId}
          onAuthError={onAuthError}
          onToolResults={onToolResults}
          onSpeakingChange={onSpeakingChange}
          onPendingChange={onPendingChange}
        />
      </div>
    </div>
  )
}
