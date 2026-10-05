import { useLock, type Unlock } from "@/lib/lock-state"
import { useJarvis } from "@/lib/store"
import type { GalleryProject, Project, ProjectSummary, Report } from "@/lib/workshop/project/types"

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

/** Signed in but locked (423): the console shows its lock screen; this is
 *  not a sign-out. */
export class JarvisLockedError extends Error {
  constructor() {
    super("Locked.")
    this.name = "JarvisLockedError"
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
  }
  // Only a request that got an answer is a latency reading. Straight into
  // the store rather than a separate telemetry module: one owner for
  // every number the HUD displays. (This was in a finally, so a failed
  // request logged its time-to-failure and flashed LINK up first.)
  useJarvis.getState().setLatency(performance.now() - startedAt)

  if (res.status === 401) throw new JarvisAuthError()
  if (res.status === 423) {
    useLock.getState().lock()
    throw new JarvisLockedError()
  }
  if (!res.ok) throw new JarvisApiError(await extractErrorDetail(res))
  return res
}

/** The heartbeat (lib/use-heartbeat.ts): the cheapest round trip there is,
 *  so LAT measures the link and not some endpoint's own work. */
export async function ping(token: string): Promise<void> {
  await jarvisFetch("/health", token, { method: "GET", cache: "no-store" })
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

// --- The browser extension's link (extension/, app/api/routes/browser.py) ---

export interface BrowserStatus {
  connected: boolean
  paused: boolean
  last_seen: number | null
  page: { title: string; url: string } | null
  tabs: number
}

export async function getBrowserStatus(token: string): Promise<BrowserStatus> {
  const res = await jarvisFetch("/browser/status", token, { method: "GET" })
  return res.json()
}

/** Revokes every extension pairing and drops the live link. */
export async function unpairBrowser(token: string): Promise<void> {
  await jarvisFetch("/browser/unpair", token, { method: "POST" })
}

// --- Linked folders (lib/linked-folders.ts, app/api/routes/files.py) ---

/** path -> modified_at of Jarvis's copy of a linked folder. */
export async function getFilesManifest(folder: string, token: string): Promise<Record<string, string>> {
  const res = await jarvisFetch(`/files/manifest?${new URLSearchParams({ folder })}`, token, { method: "GET" })
  return (await res.json()).files
}

export async function syncFiles(
  folder: string,
  files: { path: string; content: string; size: number; modified_at: string }[],
  keep: string[] | null,
  token: string
): Promise<void> {
  await jarvisFetch("/files/sync", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder, files, keep }),
  })
}

export async function unlinkFolderFiles(folder: string, token: string): Promise<void> {
  await jarvisFetch(`/files/unlink?${new URLSearchParams({ folder })}`, token, { method: "POST" })
}

export type WatchLevel = "quiet" | "normal" | "coach"

export interface ObserveResult {
  /** Already held to the level's bar on the server. */
  speak: boolean
  message: string
  confidence: number
  /** Jarvis's running notes on the session, sent back with the next look. */
  notes: string
}

/** Watch mode's look at the whiteboard (lib/watch.ts). */
export async function observeBoard(
  token: string,
  body: {
    session_id: string
    image: string
    level: WatchLevel
    notes: string
    recent_remarks: string[]
    still_seconds: number
    /** What is open in the showcase window, e.g. the questions being answered. */
    on_screen: string
  }
): Promise<ObserveResult> {
  const res = await jarvisFetch("/watch/observe", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, image_type: "image/jpeg" }),
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
  /** Bar start, ISO UTC. */
  t: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** app/tools/market_history.py RANGES. */
export type MarketRange = "1H" | "1D" | "1W" | "1M" | "1Y" | "YTD"

/** One of Jarvis's explanations, pinned to the bar nearest its moment. */
export interface ChartAnnotation {
  t: string
  price: number
  title: string
  note: string
  source: string | null
}

export interface MarketHistory {
  ok: boolean
  symbol: string
  range?: MarketRange
  asset_class?: "stock" | "crypto" | "fx"
  /** Bar size: 1Min, 5Min, 30Min, 1Hour, 1Day. */
  timeframe?: string
  candles?: Candle[]
  /** What change is measured against: the previous close for 1D, else the range's open. */
  reference?: number
  delayed_note?: string | null
  annotations?: ChartAnnotation[]
  error?: string
}

/** One of K.I.V.'s top recommended trades (app/tools/trade_signals.py). */
export interface TradeSignal {
  id: string
  symbol: string
  asset_class: string
  direction: "long" | "short"
  strategy: string
  confidence: number
  entry: number | null
  stop: number | null
  target: number | null
  reward_to_risk: number | null
  position_size_usd: number
  position_size_qty: number
  rationale: string[]
  /** The common name ("Palladium (PALL ETF proxy)"); the symbol for older signals. */
  name: string
  /** The reasoning in plain English; absent for signals from before K.I.V. wrote it. */
  summary: string | null
  sources: TradeSource[]
  created_at: string
}

export interface TradeSource {
  kind: "data" | "news"
  title: string
  publisher: string
  url: string
  publishedAt: string | null
}

export interface TopTrades {
  ok: boolean
  trades?: TradeSignal[]
  /** When the scan these come from wrote its last signal. */
  scan_at?: string | null
  scan_signals?: number
  scan_approved?: number
  note?: string | null
  error?: string
}

export async function getTopTrades(token: string): Promise<TopTrades> {
  const res = await jarvisFetch("/panels/trades", token, { method: "GET", cache: "no-store" })
  return res.json()
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
  range: MarketRange = "1D"
): Promise<MarketHistory> {
  const params = new URLSearchParams({ symbol, range })
  const res = await jarvisFetch(`/panels/market/history?${params}`, token, { method: "GET" })
  return res.json()
}

/** The Intel categories as the hourly refresh stored them, from vetted
 *  outlets (app/services/intel.py); the same articles K.I.V.'s Intel Hub shows. */
export interface IntelResult {
  ok: boolean
  categories?: Record<string, NewsArticle[]>
  fetched_at?: string | null
  /** The stored set was stale or empty, and a refresh has started. */
  refreshing?: boolean
  error?: string
}

export async function getIntel(token: string): Promise<IntelResult> {
  const res = await jarvisFetch("/panels/intel", token, { method: "GET", cache: "no-store" })
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

// --- Notes (app/api/routes/notes.py) -----------------------------------
// The .txt notes Jarvis saved to the Jarvis Notes folder in Drive.

export interface NoteFile {
  id: string
  name: string
  title: string
  size: number
  modified_at: string | null
  link: string | null
}

export interface NotesResult {
  ok: boolean
  notes?: NoteFile[]
  folder_link?: string
  error?: string
}

export interface NoteContent extends NoteFile {
  ok: boolean
  content?: string
  error?: string
}

export async function getNotes(token: string, query?: string): Promise<NotesResult> {
  const params = query ? `?${new URLSearchParams({ query })}` : ""
  const res = await jarvisFetch(`/notes${params}`, token, { method: "GET" })
  return res.json()
}

export async function getNote(id: string, token: string): Promise<NoteContent> {
  const res = await jarvisFetch(`/notes/${encodeURIComponent(id)}`, token, { method: "GET" })
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

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Checklist {
  id: string
  title: string
  items: ChecklistItem[]
  done: number
  total: number
  archived: boolean
}

/** One tick from a checklist card (components/checklist-card.tsx). */
export async function setChecklistItem(
  listId: string,
  itemId: string,
  done: boolean,
  token: string
): Promise<Checklist> {
  const res = await jarvisFetch(`/checklists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  })
  const body = (await res.json()) as { ok: boolean; checklist?: Checklist; error?: string }
  if (!body.ok || !body.checklist) throw new JarvisApiError(body.error ?? "Could not update the checklist.")
  return body.checklist
}

// ---- Jarvis on his own: the inbox, rounds, and push (app/api/routes/autonomy.py)

export interface InboxItem {
  id: string
  kind: "notice" | "proposal"
  title: string
  body: string
  priority: "low" | "normal" | "high"
  tool: string | null
  args: Record<string, unknown> | null
  status: "pending" | "approved" | "declined" | "done" | "failed" | "dismissed"
  result: unknown
  created_at: string
  decided_at: string | null
  /** rounds: what Jarvis's rounds filed; markets and signals: the 15-minute
   *  market updates (app/services/market_updates.py). */
  topic: "rounds" | "markets" | "signals" | "security"
}

export interface InboxResult {
  ok: boolean
  pending?: InboxItem[]
  recent?: InboxItem[]
  error?: string
}

export interface InboxDecision {
  ok: boolean
  item?: InboxItem
  result?: unknown
  error?: string
}

export interface AutonomySettings {
  ok: boolean
  enabled: boolean
  quiet_start: number
  quiet_end: number
  last_round_at: string | null
  /** The VAPID public key; null when push is not set up on the server. */
  push_key: string | null
}

export async function getInbox(token: string): Promise<InboxResult> {
  const res = await jarvisFetch("/inbox", token, { method: "GET", cache: "no-store" })
  return (await res.json()) as InboxResult
}

export async function decideInboxItem(
  id: string,
  decision: "approve" | "decline" | "dismiss",
  token: string
): Promise<InboxDecision> {
  const res = await jarvisFetch(`/inbox/${encodeURIComponent(id)}/${decision}`, token, { method: "POST" })
  return (await res.json()) as InboxDecision
}

export async function getAutonomy(token: string): Promise<AutonomySettings> {
  const res = await jarvisFetch("/autonomy", token, { method: "GET", cache: "no-store" })
  return (await res.json()) as AutonomySettings
}

export async function setAutonomy(
  changes: Partial<Pick<AutonomySettings, "enabled" | "quiet_start" | "quiet_end">>,
  token: string
): Promise<AutonomySettings> {
  const res = await jarvisFetch("/autonomy", token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  })
  return (await res.json()) as AutonomySettings
}

/** A round now, whatever the hour: a full agent turn, so it takes a while. */
export async function runRoundsNow(token: string): Promise<{
  ok: boolean
  filed?: InboxItem[]
  log?: string
  skipped?: string
  /** Sources the round tried to read and could not. */
  failed_reads?: string[]
  /** Most sources failed: the round saw too little to judge. */
  blind?: boolean
}> {
  const res = await jarvisFetch("/autonomy/run", token, { method: "POST" })
  return await res.json()
}

export async function savePushSubscription(subscription: PushSubscriptionJSON, device: string, token: string): Promise<void> {
  await jarvisFetch("/push/subscribe", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...subscription, device }),
  })
}

export async function removePushSubscription(endpoint: string, token: string): Promise<void> {
  await jarvisFetch("/push/unsubscribe", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  })
}

export async function testPush(token: string): Promise<{ ok: boolean; delivered: number }> {
  const res = await jarvisFetch("/push/test", token, { method: "POST" })
  return await res.json()
}


// ---- The lock (app/api/routes/unlock.py). Called with the Google session
// token, which opens only these routes.

export interface LockStatus {
  ok: boolean
  pin_set: boolean
  face_enrolled: boolean
  pin_locked_until: string | null
  face_locked_until: string | null
}

export async function getLockStatus(sessionToken: string): Promise<LockStatus> {
  const res = await jarvisFetch("/auth/lock", sessionToken, { method: "GET", cache: "no-store" })
  return res.json()
}

type UnlockResponse = { unlock_token: string; expires_at: number; method: "pin" | "face"; distance?: number }

function asUnlock(body: UnlockResponse): Unlock {
  return { token: body.unlock_token, expiresAt: body.expires_at, method: body.method }
}

export async function unlockWithPin(pin: string, sessionToken: string): Promise<Unlock> {
  const res = await jarvisFetch("/auth/unlock/pin", sessionToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  })
  return asUnlock(await res.json())
}

export async function unlockWithFace(
  descriptors: number[][],
  liveness: { blinked: boolean; turned: boolean },
  sessionToken: string
): Promise<Unlock & { distance?: number }> {
  const res = await jarvisFetch("/auth/unlock/face", sessionToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ descriptors, liveness }),
  })
  const body = (await res.json()) as UnlockResponse
  return { ...asUnlock(body), distance: body.distance }
}

export async function enrollFace(pin: string, descriptors: number[][], sessionToken: string): Promise<void> {
  await jarvisFetch("/auth/face/enroll", sessionToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin, descriptors }),
  })
}

// --- Workshop projects (app/api/routes/workshop.py) ---

export type ProjectSaved = { ok: true; project: Project; report: Report } | { ok: false; error: string }

export async function listProjects(token: string): Promise<{ ok: boolean; projects?: ProjectSummary[]; error?: string }> {
  const res = await jarvisFetch("/workshop/projects", token, { method: "GET" })
  return res.json()
}

export async function getGallery(token: string): Promise<{ ok: boolean; projects?: GalleryProject[]; error?: string }> {
  const res = await jarvisFetch("/workshop/gallery", token, { method: "GET" })
  return res.json()
}

export async function openProject(id: string, token: string): Promise<ProjectSaved> {
  const res = await jarvisFetch(`/workshop/projects/${encodeURIComponent(id)}`, token, { method: "GET" })
  return res.json()
}

/** Save (and check, compile and price) a project; the server's copy comes back. */
export async function saveProject(project: Project, token: string): Promise<ProjectSaved> {
  const res = await jarvisFetch("/workshop/projects", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project }),
  })
  return res.json()
}

// --- the phone camera link (lib/phone-camera.ts) -------------------------------

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

/** A code for the desktop to show; the phone types it in. */
export async function openCameraLink(token: string): Promise<{ code: string; expires_in: number }> {
  return (await jarvisFetch("/camera-link/open", token, { method: "POST" })).json()
}

export async function postCameraSdp(code: string, kind: "offer" | "answer", sdp: string, token: string): Promise<void> {
  await jarvisFetch(`/camera-link/${encodeURIComponent(code)}/${kind}`, token, json({ sdp }))
}

export async function getCameraSdp(code: string, kind: "offer" | "answer", token: string): Promise<string | null> {
  const res = await jarvisFetch(`/camera-link/${encodeURIComponent(code)}/${kind}`, token, { method: "GET", cache: "no-store" })
  return ((await res.json()) as { sdp: string | null }).sdp
}

export async function closeCameraLink(code: string, token: string): Promise<void> {
  await jarvisFetch(`/camera-link/${encodeURIComponent(code)}`, token, { method: "DELETE" })
}
