// Jarvis's voice for the extension. A background worker cannot play audio,
// so it hands each sentence here; this synthesises it with the backend's
// /speak (the same Fish Audio voice as the console) and plays the clips in
// order. Synthesis runs ahead of playback, so the next sentence is usually
// ready before the one in front of it ends.

let queue = [] // { text, clip: Promise<Blob | null> }
let playing = null
let running = false

function synthesise(text, api, token) {
  return fetch(api.replace(/\/$/, "") + "/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text }),
  })
    .then((res) => (res.ok ? res.blob() : null))
    .catch(() => null)
}

function play(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    playing = audio
    const done = () => {
      URL.revokeObjectURL(url)
      if (playing === audio) playing = null
      resolve()
    }
    audio.onended = done
    audio.onerror = done
    audio.play().catch(done)
  })
}

async function run() {
  if (running) return
  running = true
  chrome.runtime.sendMessage({ type: "speaking", on: true }).catch(() => {})
  while (queue.length) {
    const next = queue.shift()
    const blob = await next.clip
    if (blob) await play(blob)
  }
  running = false
  chrome.runtime.sendMessage({ type: "speaking", on: false }).catch(() => {})
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== "offscreen") return false
  if (message.type === "say") {
    queue.push({ text: message.text, clip: synthesise(message.text, message.api, message.token) })
    void run()
  } else if (message.type === "stop") {
    queue = []
    playing?.pause()
    playing = null
  }
  return false
})
