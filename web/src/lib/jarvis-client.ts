import { useJarvis } from "@/lib/store"

// Empty string = same origin, which is the production shape: FastAPI
// serves this bundle and the API off one port, so "/invoke" is already
// the right URL. Only `next dev` on :3000 needs the variable set (to
// http://localhost:8000) — see web/.env.example.
const API_URL = process.env.NEXT_PUBLIC_JARVIS_API_URL ?? ""

// Sign-in is a full-page redirect through Google, not a fetch — the
// browser has to leave the app, so this is a URL rather than a call.
export function googleLoginUrl(): string {
  return `${API_URL}/auth/login/google`
}

export class JarvisAuthError extends Error {
  constructor() {
    super("Missing or invalid access token.")
    this.name = "JarvisAuthError"
  }
}

export class JarvisApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "JarvisApiError"
  }
}

export class JarvisNetworkError extends Error {
  constructor() {
    super("Could not reach J.A.R.V.I.S. — check your connection.")
    this.name = "JarvisNetworkError"
  }
}

async function extractErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.detail === "string") return body.detail
  } catch {
    // response wasn't JSON — fall through to the generic message
  }
  return `Request failed (${res.status}).`
}

async function jarvisFetch(path: string, token: string, init: RequestInit): Promise<Response> {
  let res: Response
  // Timed here rather than per call site so every route feeds the HUD's
  // latency gauge, including the panel polls nobody explicitly awaits.
  const startedAt = performance.now()
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    })
  } catch {
    throw new JarvisNetworkError()
  } finally {
    // Straight into the store rather than a separate telemetry
    // module: one owner for every number the HUD displays.
    useJarvis.getState().setLatency(performance.now() - startedAt)
  }

  if (res.status === 401) throw new JarvisAuthError()
  if (!res.ok) throw new JarvisApiError(await extractErrorDetail(res))
  return res
}

export async function verifyToken(token: string): Promise<void> {
  await jarvisFetch("/auth/verify", token, { method: "GET" })
}

export interface ToolResult {
  name: string
  result: unknown
}

export interface InvokeResult {
  response: string
  tools_used: string[]
  tool_results: ToolResult[]
  session_id: string
}

export async function invoke(
  message: string,
  sessionId: string,
  token: string
): Promise<InvokeResult> {
  const res = await jarvisFetch("/invoke", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId }),
  })
  return res.json()
}

export async function speak(text: string, token: string, voiceId?: string): Promise<Blob> {
  const res = await jarvisFetch("/speak", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: voiceId }),
  })
  return res.blob()
}

export async function transcribe(audio: Blob, token: string): Promise<string> {
  const form = new FormData()
  form.append("file", audio, "recording.webm")
  // No Content-Type header here on purpose — the browser sets the correct
  // multipart boundary itself when the body is a FormData instance.
  const res = await jarvisFetch("/transcribe", token, {
    method: "POST",
    body: form,
  })
  const data = await res.json()
  return data.text as string
}

// --- Panel data: direct REST access to the same tool functions Jarvis's
// agent loop calls, no Groq round-trip — lets a tab show real data the
// instant it's opened, without asking Jarvis anything first. ---

export interface MarketQuote {
  symbol: string
  price: number
  change: number | null
  change_percent: number | null
}

export interface MarketSnapshot {
  ok: boolean
  quotes: MarketQuote[]
  error?: string
}

export interface Candle {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface MarketHistory {
  ok: boolean
  symbol: string
  candles?: Candle[]
  error?: string
}

export interface NewsArticle {
  title: string
  url: string
  source: string
  published_at: string
}

export interface NewsResult {
  ok: boolean
  query: string
  articles?: NewsArticle[]
  cached?: boolean
  error?: string
}

// Mirrors kiv-console's own NEWS_CATEGORIES (src/lib/news/newsapi.ts)
// verbatim — same 6 themes, same query strings — so the News panel here
// can render the same Intel-Hub-style tabs. The backend itself has no
// category concept; each tab is just a separate /panels/news?query= call
// using one of these query strings.
export const NEWS_CATEGORIES = [
  {
    id: "market-moves",
    label: "Market-Moving Signals",
    query:
      '"Federal Reserve" OR "interest rate" OR "market selloff" OR "market rally" OR "market volatility" OR recession',
  },
  {
    id: "ai-tools-llms",
    label: "AI Tools & LLM Updates",
    query: '"large language model" OR LLM OR "generative AI" OR "AI model release" OR "AI tool"',
  },
  { id: "hedge-funds", label: "Hedge Fund Shifts", query: '"hedge fund"' },
  { id: "private-equity", label: "Private Equity Shifts", query: '"private equity"' },
  {
    id: "venture-capital",
    label: "Venture Capital & AI Funding",
    query: '"venture capital" OR "VC funding" OR "startup funding" OR "AI startup"',
  },
  {
    id: "ai-innovation",
    label: "AI Field Innovation",
    query: '"AI breakthrough" OR "AI research" OR "next-generation AI"',
  },
] as const satisfies readonly { id: string; label: string; query: string }[];

export type NewsCategoryId = (typeof NEWS_CATEGORIES)[number]["id"]

export interface PortfolioAccount {
  equity: number
  cash: number
  buying_power: number
  portfolio_value: number
  status: string
}

export interface PortfolioPosition {
  symbol: string
  qty: number
  market_value: number
  cost_basis: number
  unrealized_pl: number
  unrealized_pl_percent: number
  current_price: number
}

export interface PortfolioResult {
  ok: boolean
  account?: PortfolioAccount
  positions?: PortfolioPosition[]
  error?: string
}

export async function getMarketSnapshot(token: string): Promise<MarketSnapshot> {
  const res = await jarvisFetch("/panels/market", token, { method: "GET" })
  return res.json()
}

export async function getMarketHistory(
  symbol: string,
  token: string,
  days = 30
): Promise<MarketHistory> {
  const params = new URLSearchParams({ symbol, days: String(days) })
  const res = await jarvisFetch(`/panels/market/history?${params}`, token, { method: "GET" })
  return res.json()
}

export async function getNews(token: string, query?: string): Promise<NewsResult> {
  const params = query ? `?${new URLSearchParams({ query })}` : ""
  const res = await jarvisFetch(`/panels/news${params}`, token, { method: "GET" })
  return res.json()
}

export async function getPortfolio(token: string): Promise<PortfolioResult> {
  const res = await jarvisFetch("/panels/portfolio", token, { method: "GET" })
  return res.json()
}
