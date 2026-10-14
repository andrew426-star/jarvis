// The toolbar popup: pair with the console; what is waiting for Andrew
// (inbox counts by topic, the next reminder) and a "hold my calls" switch;
// and the controls he asked for - follow along or not, how readily Jarvis
// speaks up, whether he may act, voice, pausing, and which sites are private.

import { CATEGORIES } from "./blocklist.js"

const $ = (id) => document.getElementById(id)
const FOREVER = 8.64e15 // the latest Date: "until I resume"

const STATE_LABEL = {
  connected: ["Connected", "on"],
  connecting: ["Connecting", "warn"],
  offline: ["Offline", "warn"],
  unauthorized: ["Pairing expired", "bad"],
}

function status() {
  return chrome.runtime.sendMessage({ type: "status" })
}

async function update(change) {
  await chrome.storage.local.set(change)
  await chrome.runtime.sendMessage({ type: "settings-changed" })
  await render()
}

async function render() {
  const s = await status()
  $("unpaired").hidden = s.paired
  $("paired").hidden = !s.paired

  const paused = Date.now() < s.pausedUntil
  const [label, tone] = !s.paired ? ["Not paired", ""] : paused ? ["Paused", "warn"] : STATE_LABEL[s.state] || ["…", ""]
  $("state").textContent = label
  $("dot").className = `dot ${tone}`
  if (!s.paired) return

  $("follow").checked = s.follow
  $("voice").checked = s.voice
  $("level-row").style.opacity = s.follow ? "1" : "0.4"
  for (const button of $("level").querySelectorAll("button")) button.dataset.active = String(button.dataset.level === s.level)
  for (const button of $("act").querySelectorAll("button")) button.dataset.active = String(button.dataset.act === s.act)

  $("pause-row").hidden = paused
  $("paused-row").hidden = !paused
  if (paused) {
    $("paused-text").textContent =
      s.pausedUntil >= FOREVER ? "Paused until you resume" : `Paused until ${new Date(s.pausedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
  }

  // This site: block or unblock it.
  const site = $("site")
  site.replaceChildren()
  if (s.site?.host) {
    const host = document.createElement("span")
    host.className = "host"
    const mine = s.blocked.includes(s.site.host)
    host.textContent = s.site.reason ? `${s.site.host}: private (${s.site.reason})` : `${s.site.host}: Jarvis can read`
    site.append(host)
    if (mine || !s.site.reason) {
      const button = document.createElement("button")
      button.textContent = mine ? "ALLOW" : "BLOCK"
      button.addEventListener("click", () =>
        update({ blocked: mine ? s.blocked.filter((h) => h !== s.site.host) : [...s.blocked, s.site.host] })
      )
      site.append(button)
    }
  }

  const cats = $("cats")
  cats.replaceChildren()
  for (const [key, category] of Object.entries(CATEGORIES)) {
    const label = document.createElement("label")
    const box = document.createElement("input")
    box.type = "checkbox"
    box.checked = s.categories[key] !== false
    box.addEventListener("change", () => update({ categories: { ...s.categories, [key]: box.checked } }))
    label.append(box, `Never read ${category.label.toLowerCase()} sites`)
    cats.append(label)
  }

  $("server").textContent = s.api.replace(/^https?:\/\//, "")
  $("server").title = s.api
}

// What waits for him, the hold, the next reminder (background.js glance()).
const TOPIC_LABEL = {
  calls: "Calls", mail: "Mail", reminders: "Reminders", publicity: "Publicity", intel: "Intel",
  security: "Security", signals: "Signals", markets: "Markets", rounds: "Rounds",
}
let held = false

async function renderGlance() {
  const g = await chrome.runtime.sendMessage({ type: "glance" })
  $("glance").hidden = !g?.ok
  if (!g?.ok) return
  const topics = $("topics")
  topics.replaceChildren()
  const entries = Object.entries(g.inbox?.topics || {}).sort((a, b) => b[1] - a[1])
  if (!entries.length) {
    const none = document.createElement("span")
    none.className = "none"
    none.textContent = g.inbox ? "Nothing waiting. The inbox is clear." : "Inbox unavailable."
    topics.append(none)
  }
  for (const [topic, count] of entries) {
    const chip = document.createElement("span")
    chip.className = `topic ${topic}`
    const n = document.createElement("b")
    n.textContent = String(count)
    chip.append(n, ` ${TOPIC_LABEL[topic] || topic}`)
    topics.append(chip)
  }
  const next = $("next-reminder")
  next.hidden = !g.next_reminder
  if (g.next_reminder) {
    next.replaceChildren("Next reminder: ", Object.assign(document.createElement("b"), { textContent: g.next_reminder.text }), ` · ${g.next_reminder.when}`)
  }
  held = Boolean(g.hold?.held)
  $("hold-text").textContent = held ? `Calls held until ${g.hold.until}` : "Calls come through"
  $("hold-text").className = `hold-text${held ? " on" : ""}`
  $("hold-btn").textContent = held ? "LIFT THE HOLD" : "HOLD MY CALLS · 1 HR"
}

$("hold-btn").addEventListener("click", async () => {
  $("hold-btn").disabled = true
  await chrome.runtime.sendMessage({ type: "hold", minutes: held ? null : 60 })
  $("hold-btn").disabled = false
  await renderGlance()
})

$("pair").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  $("pair").disabled = true
  $("pair-error").hidden = true
  const result = await chrome.runtime.sendMessage({ type: "pair", tabId: tab.id })
  $("pair").disabled = false
  if (!result?.ok) {
    $("pair-error").textContent = result?.error || "Pairing failed."
    $("pair-error").hidden = false
    return
  }
  await render()
})

$("follow").addEventListener("change", (e) => update({ follow: e.target.checked }))
$("voice").addEventListener("change", (e) => update({ voice: e.target.checked }))
$("level").addEventListener("click", (e) => {
  const level = e.target?.dataset?.level
  if (level) void update({ level })
})
$("act").addEventListener("click", (e) => {
  const act = e.target?.dataset?.act
  if (act) void update({ act })
})
$("pause-row").addEventListener("click", (e) => {
  const value = e.target?.dataset?.pause
  if (!value) return
  void update({ pausedUntil: value === "forever" ? FOREVER : Date.now() + Number(value) * 60_000 })
})
$("resume").addEventListener("click", () => update({ pausedUntil: 0 }))
$("unpair").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "unpair" })
  await render()
})

void render()
void renderGlance()
// The connection state can change while the popup is open.
setInterval(() => void render(), 2000)
setInterval(() => void renderGlance(), 15000)
