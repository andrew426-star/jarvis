import { Badge } from "@/components/ui/badge"

const TOOL_LABELS: Record<string, string> = {
  database_agent: "Contacts",
  web_research: "Web Research",
  think: "Reasoning",
  calculator: "Calculator",
  market_analysis: "Market Data",
  portfolio: "Portfolio",
  company_financials: "Financials",
  kivaro_pipeline: "Pipeline",
  news_feed: "News",
  github: "GitHub",
  google_titan: "Google",
  spotify: "Spotify",
}

export function ToolBadge({ tool }: { tool: string }) {
  return (
    <Badge variant="outline" className="border-primary/30 text-primary">
      {TOOL_LABELS[tool] ?? tool}
    </Badge>
  )
}
