// The J.A.R.V.I.S. extension's background worker: the one place that talks
// to Jarvis. It keeps a WebSocket open to the backend (app/api/routes/
// browser.py), sends the page in front of Andrew and his open tabs as they
// change, answers Jarvis's requests (read another tab), and shows and
// speaks his remarks. It is also the gatekeeper: nothing is taken from a
// page before blockedReason() and the pause have been checked, so a
// blocked site's text never leaves the browser.

import { blockedReason } from "./blocklist.js"

const DEFAULTS = {
  api: "", // the console's origin, which also serves the API
  token: "", // scoped browser token from /browser/pair
  sessionId: "", // the console's chat session, shared with the bubble
  follow: true, // chime in unprompted
  level: "normal", // quiet | normal | coach
  voice: true,
  pausedUntil: 0, // Infinity-ish (a far date) for "until I resume"
  remarksPausedUntil: 0, // "not now" from the bubble
  blocked: [],
  allowed: [],
  categories: { banking: true, email: true, health: true },
}

const PING_MS = 20_000 // also what keeps this worker alive (Chrome 116+)
const CAPTURE_DEBOUNCE_MS = 1200
const OBSERVE_MIN_GAP_MS = 30_000
const OBSERVE_MAX_PER_HOUR = 60
const PAGE_CHANGE_CHARS = 300
const FIELD_CHANGE_CHARS = 80

async function settings() {
  const stored = await chrome.storage.local.get(null)
  return { ...DEFAULTS, ...stored, categories: { ...DEFAULTS.categories, ...(stored.categories || {}) } }
}

const isPaused = (s) => Date.now() < s.pausedUntil

// --- The link ---------------------------------------------------------------

let socket = null
let state = "offline" // offline | connecting | connected | unauthorized
let pingTimer = null
let retryTimer = null
let retryDelay = 2000

function send(message) {
  if (socket && state === "connected") socket.send(JSON.stringify(message))
}

async function connect() {
  const s = await settings()
  if (!s.token || !s.api || socket || state === "unauthorized") return
  clearTimeout(retryTimer)
  state = "connecting"
  const url = s.api.replace(/^http/, "ws").replace(/\/$/, "") + "/browser/ws"
  let ws
  try {
    ws = new WebSocket(url)
  } catch {
    state = "offline"
    scheduleRetry()
    return
  }
  socket = ws
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token: s.token, session_id: s.sessionId, paused: isPaused(s) }))
  ws.onmessage = (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    void handle(message)
  }
  ws.onclose = (event) => {
    if (socket !== ws) return
    socket = null
    clearInterval(pingTimer)
    // 4001: refused or unpaired. Retrying would only be refused again.
    state = event.code === 4001 ? "unauthorized" : "offline"
    if (state === "offline") scheduleRetry()
  }
  ws.onerror = () => {}
}

function scheduleRetry() {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => void connect(), retryDelay)
  retryDelay = Math.min(retryDelay * 2, 60_000)
}

function disconnect() {
  const ws = socket
  socket = null
  clearInterval(pingTimer)
  clearTimeout(retryTimer)
  state = "offline"
  ws?.close()
}

async function handle(message) {
  switch (message.type) {
    case "welcome": {
      state = "connected"
      retryDelay = 2000
      clearInterval(pingTimer)
      pingTimer = setInterval(async () => send({ type: "ping", paused: isPaused(await settings()) }), PING_MS)
      // Jarvis starts from where Andrew is.
      void sendTabs()
      void captureActive("connected")
      break
    }
    case "error":
      if (message.error === "unauthorized") state = "unauthorized"
      break
    case "request":
      send({ type: "result", id: message.id, result: await answer(message.kind, message.args || {}) })
      break
    case "remark":
      await remark(message.message)
      break
    case "observed":
      break
  }
}

// --- Reading pages ------------------------------------------------------------

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tab
}

/** Why this tab is off-limits right now, or null. */
async function offLimits(tab, s) {
  if (!tab) return "no tab"
  if (tab.incognito) return "incognito"
  if (isPaused(s)) return "paused"
  return blockedReason(tab.url || "", s)
}

/** The page's text, from the content script (injected first if this tab
 *  was open before the extension was). */
async function extract(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "extract" })
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] })
      return await chrome.tabs.sendMessage(tabId, { type: "extract" })
    } catch {
      return null // a page extensions cannot read (the Web Store, a PDF viewer)
    }
  }
}

let captureTimer = null
function scheduleCapture(reason) {
  clearTimeout(captureTimer)
  captureTimer = setTimeout(() => void captureActive(reason), CAPTURE_DEBOUNCE_MS)
}

async function captureActive(reason) {
  if (state !== "connected") return
  const s = await settings()
  const tab = await activeTab()
  const why = await offLimits(tab, s)
  // On the console itself he is talking to Jarvis, not working: keep what
  // Jarvis last saw rather than calling it private.
  if (why === "the Jarvis console") return
  if (why) {
    // Jarvis learns only that the page is private, nothing of it.
    send({ type: "page", page: null })
    return
  }
  const page = (await extract(tab.id)) || { url: tab.url, title: tab.title, text: "", unreadable: true }
  send({ type: "page", page })
  maybeObserve(page, s, reason)
}

let tabsTimer = null
function scheduleTabs() {
  clearTimeout(tabsTimer)
  tabsTimer = setTimeout(() => void sendTabs(), 1000)
}

async function sendTabs() {
  if (state !== "connected") return
  const s = await settings()
  const tabs = await chrome.tabs.query({})
  send({
    type: "tabs",
    tabs: isPaused(s)
      ? []
      : tabs
          .filter((t) => !t.incognito)
          .map((t) =>
            blockedReason(t.url || "", s)
              ? { id: t.id, blocked: true, active: t.active }
              : { id: t.id, title: t.title, url: t.url, active: t.active }
          ),
  })
}

async function answer(kind, args) {
  if (kind !== "read_tab") return { ok: false, error: `Unknown request ${kind}.` }
  const s = await settings()
  let tab
  try {
    tab = await chrome.tabs.get(Number(args.tab_id))
  } catch {
    return { ok: false, error: "That tab is closed." }
  }
  const why = await offLimits(tab, s)
  if (why) return { ok: false, error: `That tab is private (${why}).` }
  const page = await extract(tab.id)
  return page ? { ok: true, page } : { ok: false, error: "That page cannot be read by an extension." }
}

// --- Following along ------------------------------------------------------------

let lastObserved = { url: "", textLength: 0, field: "", at: 0 }
let observeTimes = []

function maybeObserve(page, s, reason) {
  if (!s.follow || Date.now() < s.remarksPausedUntil || page.unreadable) return
  const now = Date.now()
  if (now - lastObserved.at < OBSERVE_MIN_GAP_MS) return
  observeTimes = observeTimes.filter((t) => now - t < 3_600_000)
  if (observeTimes.length >= OBSERVE_MAX_PER_HOUR) return

  const text = page.text || ""
  const field = page.field || ""
  if (text.length < 200 && field.length < 40) return // nothing to go on
  const newPage = page.url !== lastObserved.url
  const pageMoved = Math.abs(text.length - lastObserved.textLength) >= PAGE_CHANGE_CHARS
  const fieldMoved = Math.abs(field.length - lastObserved.field.length) >= FIELD_CHANGE_CHARS
  const selected = reason === "selection" && (page.selection || "").length >= 20
  if (!(newPage || pageMoved || fieldMoved || selected)) return

  lastObserved = { url: page.url, textLength: text.length, field, at: now }
  observeTimes.push(now)
  send({ type: "observe", level: s.level })
}

// --- Remarks, the bubble and the voice ----------------------------------------

async function toTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message)
    return true
  } catch {
    return false
  }
}

async function remark(text) {
  const s = await settings()
  if (!text || Date.now() < s.remarksPausedUntil) return
  const tab = await activeTab()
  // Only onto a page Jarvis may see: a remark is about what is in front
  // of him, and he has moved on if that is now a private page.
  if (await offLimits(tab, s)) return
  await toTab(tab.id, { type: "remark", text })
  if (s.voice) say(text, tab.id)
}

let offscreenReady = null
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return
  offscreenReady ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Speak Jarvis's replies aloud.",
    })
    .finally(() => (offscreenReady = null))
  await offscreenReady
}

let speakingTab = null
async function say(text, tabId) {
  const s = await settings()
  if (!s.voice || !text.trim()) return
  speakingTab = tabId
  await ensureOffscreen()
  chrome.runtime.sendMessage({ target: "offscreen", type: "say", text, api: s.api, token: s.token }).catch(() => {})
}

function stopSpeaking() {
  chrome.runtime.sendMessage({ target: "offscreen", type: "stop" }).catch(() => {})
}

// A sentence ends at . ! or ? followed by whitespace (as in the console's
// speech queue), so "3.5" mid-flow does not end one.
const SENTENCE = /^[\s\S]*?[.!?]+["')\]]*\s+/

/** A question from the bubble, answered through the same /invoke/stream
 *  the console uses, on the console's session. */
async function ask(text, tabId) {
  const s = await settings()
  if (!s.token) return toTab(tabId, { type: "answer", error: "Pair the extension with your console first." })
  // So Jarvis sees the page as it is now, not as it was a few seconds ago.
  await captureActive("ask")
  let res
  try {
    res = await fetch(s.api.replace(/\/$/, "") + "/invoke/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ message: text, session_id: s.sessionId || undefined, channel: "browser" }),
    })
  } catch {
    return toTab(tabId, { type: "answer", error: "Couldn't reach Jarvis." })
  }
  if (!res.ok || !res.body) {
    return toTab(tabId, { type: "answer", error: res.status === 401 ? "The pairing has expired. Pair again from the toolbar." : `Jarvis answered ${res.status}.` })
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  let spoken = ""
  const speakReady = (final) => {
    let match
    while ((match = spoken.match(SENTENCE))) {
      say(match[0], tabId)
      spoken = spoken.slice(match[0].length)
    }
    if (final && spoken.trim()) say(spoken, tabId)
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    let newline
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (!line.trim()) continue
      let event
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (event.type === "text") await toTab(tabId, { type: "answer", delta: event.delta })
      else if (event.type === "reset") await toTab(tabId, { type: "answer", reset: true })
      else if (event.type === "spoken") {
        spoken += event.delta
        speakReady(false)
      } else if (event.type === "done") {
        if (!event.spoken && event.response) spoken = event.response
        speakReady(true)
        await toTab(tabId, { type: "answer", final: event.response })
      } else if (event.type === "error") await toTab(tabId, { type: "answer", error: event.message })
    }
  }
}

// --- Pairing (from the popup) ---------------------------------------------------

async function pair(tabId) {
  const tab = await chrome.tabs.get(tabId)
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      try {
        return {
          console: Boolean(document.querySelector('meta[name="jarvis-console"]')),
          token: localStorage.getItem("jarvis_access_token"),
          sessionId: localStorage.getItem("jarvis_session_id"),
          // Under `next dev` the API is on another port; the console says where.
          api: document.querySelector('meta[name="jarvis-api"]')?.getAttribute("content") || "",
        }
      } catch {
        return { console: false }
      }
    },
  })
  if (!result?.console) return { ok: false, error: "This tab isn't your Jarvis console. Open the console, then pair." }
  if (!result.token) return { ok: false, error: "Sign in to the console first, then pair." }
  const api = (result.api || new URL(tab.url).origin).replace(/\/$/, "")
  let res
  try {
    res = await fetch(api + "/browser/pair", { method: "POST", headers: { Authorization: `Bearer ${result.token}` } })
  } catch {
    return { ok: false, error: `Couldn't reach ${api}.` }
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.ok) return { ok: false, error: body.error || body.detail || `Pairing failed (${res.status}).` }
  disconnect()
  await chrome.storage.local.set({ api, token: body.token, sessionId: result.sessionId || "" })
  state = "offline"
  await connect()
  return { ok: true, api }
}

async function unpair() {
  const s = await settings()
  disconnect()
  if (s.api && s.token) {
    // Revokes this token (and any other copy) on the server too.
    await fetch(s.api + "/browser/unpair", { method: "POST", headers: { Authorization: `Bearer ${s.token}` } }).catch(() => {})
  }
  await chrome.storage.local.remove(["token", "sessionId"])
  state = "offline"
}

// --- Events -------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target === "offscreen") return false
  const tabId = sender.tab?.id
  switch (message.type) {
    case "changed":
      // Only the page in front of him matters; background tabs are read
      // when Jarvis asks for them.
      if (sender.tab?.active) scheduleCapture(message.reason)
      return false
    case "ask":
      if (tabId !== undefined) void ask(message.text, tabId)
      return false
    case "not-now":
      void chrome.storage.local.set({ remarksPausedUntil: Date.now() + 15 * 60_000 })
      stopSpeaking()
      return false
    case "never-here": {
      void (async () => {
        const s = await settings()
        const host = new URL(sender.tab.url).hostname
        await chrome.storage.local.set({ blocked: [...new Set([...s.blocked, host])] })
        stopSpeaking()
        void captureActive("blocked")
        void sendTabs()
      })()
      return false
    }
    case "stop-voice":
      stopSpeaking()
      return false
    case "speaking":
      // From the offscreen player: the bubble's core pulses while he talks.
      if (speakingTab !== null) void toTab(speakingTab, { type: "speaking", on: message.on })
      return false
    case "status":
      void (async () => {
        const s = await settings()
        const tab = await activeTab()
        reply({
          state,
          api: s.api,
          paired: Boolean(s.token),
          follow: s.follow,
          level: s.level,
          voice: s.voice,
          pausedUntil: s.pausedUntil,
          categories: s.categories,
          blocked: s.blocked,
          site: tab?.url ? { host: (() => { try { return new URL(tab.url).hostname } catch { return "" } })(), reason: blockedReason(tab.url, s), tabId: tab.id } : null,
        })
      })()
      return true
    case "pair":
      void pair(message.tabId).then(reply)
      return true
    case "unpair":
      void unpair().then(() => reply({ ok: true }))
      return true
    case "settings-changed":
      // Pausing, blocking or a new category takes effect at once.
      void (async () => {
        const s = await settings()
        send({ type: "ping", paused: isPaused(s) })
        void captureActive("settings")
        void sendTabs()
        if (state === "unauthorized" && s.token) state = "offline"
        void connect()
      })()
      return false
  }
  return false
})

chrome.tabs.onActivated.addListener(() => {
  scheduleCapture("switched")
  scheduleTabs()
})
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "complete" && tab.active) scheduleCapture("loaded")
  if (change.title || change.url || change.status === "complete") scheduleTabs()
})
chrome.tabs.onRemoved.addListener(scheduleTabs)
chrome.tabs.onCreated.addListener(scheduleTabs)
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) scheduleCapture("switched")
})

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-bubble") return
  const tab = await activeTab()
  if (!tab) return
  const s = await settings()
  const why = await offLimits(tab, s)
  if (!(await toTab(tab.id, { type: "open", privateReason: why }))) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
      await toTab(tab.id, { type: "open", privateReason: why })
    } catch {
      // A page extensions cannot touch.
    }
  }
})

// Away from the computer (locked), the link is dropped; it comes back on
// return. The alarm restarts the link after the browser has put this
// worker to sleep.
chrome.idle.onStateChanged.addListener((idle) => {
  if (idle === "locked") disconnect()
  else void connect()
})
chrome.alarms.create("keepalive", { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(() => void connect())
chrome.runtime.onStartup.addListener(() => void connect())
chrome.runtime.onInstalled.addListener(() => void connect())
void connect()
