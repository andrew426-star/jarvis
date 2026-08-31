const TOOL_LABELS: Record<string, string> = {
  database_agent: "Contacts",
  web_research: "Web Research",
  think: "Reasoning",
  calculator: "Calculator",
  market_analysis: "Market Data",
  market_history: "Market History",
  portfolio: "Portfolio",
  company_financials: "Financials",
  kivaro_pipeline: "Pipeline",
  news_feed: "News",
  github: "GitHub",
  google_titan: "Google",
  spotify: "Spotify",
  zoho_mail: "Zoho Mail",
}

// Chamfered on the leading edge only - a cut corner rather than a
// rounded pill, matching the angular language everything else uses.
export function ToolBadge({ tool }: { tool: string }) {
  return (
    <span
      className="label-hud inline-flex items-center px-1.5 py-0.5"
      style={{
        color: "var(--hud)",
        border: "1px solid hsl(var(--hue) 70% 55% / 0.35)",
        background: "hsl(var(--hue-alt) 60% 12% / 0.6)",
        clipPath: "polygon(5px 0, 100% 0, 100% 100%, 0 100%, 0 5px)",
      }}
    >
      {TOOL_LABELS[tool] ?? tool}
    </span>
  )
}
