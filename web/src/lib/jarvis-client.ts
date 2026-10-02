import { useJarvis } from "@/lib/store"

// Empty string = same origin, which is the production shape: FastAPI
// serves this bundle and the API off one port, so "/invoke" is already
// the right URL. Only `next dev` on :3000 needs the variable set (to
// http://localhost:8000) — see web/.env.example.
const API_URL = process.env.NEXT_PUBLIC_JARVIS_API_URL ?? ""

// Sign-in is a full-page redirect through Google, not a fetch — the
// browser has to leave the app, so this is a URL rather than a call.
// Empty in production (same origin). Surfaced so the settings panel can
// show which backend it is actually talking to, and so the OAuth connect
// links resolve correctly under `next dev` too.
export function apiOrigin(): string {
  return API_URL
}

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
  /** Voice line for /speak, written to be heard rather than read. */
  spoken: string
  tools_used: string[]
  tool_results: ToolResult[]
  session_id: string
  context_turns: number
  context_window: number
  /** Where the time went: memory, each model call, each tool, total. */
  timings?: { step: string; model?: string; name?: string; ms: number }[]
}

export interface InvokeOptions {
  /** Base64 JPEG camera frame, sent while the camera is on. */
  image?: string
  /** Describe the frame up front (the Look button). */
  look?: boolean
  /** What the console has open, so Jarvis can operate it. */
  consoleState?: Record<string, unknown>
  /** Files attached to the message (lib/attachments.ts). */
  attachments?: { name: string; mime: string; data?: string; text?: string }[]
  /** "mobile" is the phone view: no console for Jarvis to operate. */
  channel?: "console" | "mobile"
}

// Only what the server reads: previews and sizes stay in the browser.
function wireAttachments(options: InvokeOptions) {
  return (options.attachments ?? []).map(({ name, mime, data, text }) => ({ name, mime, data, text }))
}

export async function invoke(
  message: string,
  sessionId: string,
  token: string,
  options: InvokeOptions = {}
): Promise<InvokeResult> {
  const res = await jarvisFetch("/invoke", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      session_id: sessionId,
      image: options.image,
      look: options.look ?? false,
      console_state: options.consoleState,
      attachments: wireAttachments(options),
    }),
  })
  return res.json()
}

export interface SessionContext {
  /** Null when the backend could not read its memory store. */
  turns: number | null
  window: number
}

export async function getSessionContext(sessionId: string, token: string): Promise<SessionContext> {
  const params = new URLSearchParams({ session_id: sessionId })
  const res = await jarvisFetch(`/session/context?${params}`, token, { method: "GET" })
  return res.json()
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "spoken"; delta: string }
  | { type: "reset" }
  | { type: "tool"; name: string; result: unknown }
  | ({ type: "done" } & InvokeResult)
  | { type: "error"; message: string }
  | { type: "status"; label: string }

// The server sends something at least every model round and tool round,
// and ends any turn by ~90s (TURN_DEADLINE_S in orchestrator.py). Silence
// this long means the connection is dead even though it never closed,
// which is what used to leave the console waiting with no reply at all.
const STREAM_STALL_MS = 100_000

/** /invoke/stream: the same turn as invoke(), delivered as it is written.
 *  Events go to onEvent as they arrive; resolves with the finished turn. */
export async function invokeStream(
  message: string,
  sessionId: string,
  token: string,
  options: InvokeOptions,
  onEvent: (event: StreamEvent) => void
): Promise<InvokeResult> {
  const abort = new AbortController()
  let stalled = false
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const feed = () => {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      stalled = true
      abort.abort()
    }, STREAM_STALL_MS)
  }
  feed()
  const stalledError = () =>
    new JarvisApiError("J.A.R.V.I.S. stopped responding mid-reply. Try again.")

  let res: Response
  try {
    res = await jarvisFetch("/invoke/stream", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        message,
        session_id: sessionId,
        channel: options.channel ?? "console",
        image: options.image,
        look: options.look ?? false,
        console_state: options.consoleState,
        attachments: wireAttachments(options),
      }),
    })
  } catch (err) {
    clearTimeout(watchdog)
    throw stalled ? stalledError() : err
  }
  if (!res.body) {
    clearTimeout(watchdog)
    throw new JarvisApiError("The reply stream never opened.")
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  let result: InvokeResult | null = null
  const handle = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as StreamEvent
    if (event.type === "error") throw new JarvisApiError(event.message)
    if (event.type === "done") result = event
    onEvent(event)
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      feed()
      pending += decoder.decode(value, { stream: true })
      // Newline-delimited JSON: complete lines are events, the tail waits.
      let newline: number
      while ((newline = pending.indexOf("\n")) >= 0) {
        handle(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
      }
    }
    handle(pending)
  } catch (err) {
    if (stalled) throw stalledError()
    if (err instanceof JarvisApiError) throw err
    throw new JarvisNetworkError()
  } finally {
    clearTimeout(watchdog)
  }
  if (!result) throw new JarvisApiError("The reply stream ended early.")
  return result
}

export interface RenderResult {
  image: string
  mime: string
  model: string
  note: string
}

/** A photoreal render of a workshop view, by Gemini's image models. */
export async function renderView(image: string, prompt: string | undefined, token: string): Promise<RenderResult> {
  const res = await jarvisFetch("/render", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, image_type: "image/png", prompt }),
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

// Whisper reads the container from the file name, and recorders differ:
// Chrome records WebM, Safari (every iPhone browser) records MP4.
function recordingName(type: string): string {
  if (type.includes("mp4") || type.includes("aac") || type.includes("m4a")) return "recording.mp4"
  if (type.includes("ogg")) return "recording.ogg"
  if (type.includes("wav")) return "recording.wav"
  return "recording.webm"
}

export async function transcribe(audio: Blob, token: string): Promise<string> {
  const form = new FormData()
  form.append("file", audio, recordingName(audio.type))
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

// --- Integration health -----------------------------------------------
// Backed by GET /status (app/api/routes/status.py). Authenticated,
// because it reveals which accounts are linked; returns presence and
// identity only, never a token.

export type ConnectionStatus = "connected" | "disconnected" | "not_configured" | "unknown"

export interface ConnectionInfo {
  provider: string
  status: ConnectionStatus
  /** Email or display name of the linked account, when there is one. */
  account: string | null
  updated_at: string | null
}

export interface StatusResult {
  ok: boolean
  connections: ConnectionInfo[]
}

export async function getStatus(token: string): Promise<StatusResult> {
  const res = await jarvisFetch("/status", token, { method: "GET" })
  return res.json()
}
