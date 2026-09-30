const TOOL_LABELS: Record<string, string> = {
  database_agent: "Contacts",
  web_research: "Research",
  think: "Reasoning",
  calculator: "Calc",
  market_analysis: "Markets",
  market_history: "History",
  portfolio: "Portfolio",
  company_financials: "Financials",
  kivaro_pipeline: "Pipeline",
  launch_tracker: "Launch",
  kiv_tasks: "Tasks",
  habits: "Habits",
  italian: "Italiano",
  speech_coach: "Speech",
  news_feed: "News",
  github: "GitHub",
  google_titan: "Google",
  spotify: "Spotify",
  zoho_mail: "Mail",
}

// Same language as every other interactive-looking element: transparent
// fill, 1px accent border, 2px radius. Never a solid chip.
export function ToolBadge({ tool }: { tool: string }) {
  return (
    <span
      className="t-label truncate-1 inline-flex shrink-0 items-center"
      style={{
        maxWidth: "88px",
        padding: "1px 6px",
        border: "1px solid rgba(var(--accent-rgb), 0.4)",
        borderRadius: "var(--radius)",
        background: "transparent",
        color: "var(--accent)",
      }}
      title={TOOL_LABELS[tool] ?? tool}
    >
      {TOOL_LABELS[tool] ?? tool}
    </span>
  )
}
