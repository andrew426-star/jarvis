// Runs in every page. It does three things, and only when asked:
//   - reads the page (text, selection, the box being typed in) when the
//     background worker asks, which it does only for pages Jarvis may see;
//   - tells the worker when the page has settled after a change, so Jarvis
//     can look again (a ping, no content);
//   - draws Jarvis's bubble: his remarks, spoken; a box to ask him about
//     the page (Alt+J); "not now"; "not on this site".
// Password, card and similar fields are never read.

;(() => {
  if (window.__jarvisContent) return
  window.__jarvisContent = true

  const PAGE_CHARS = 40_000
  const FIELD_CHARS = 8_000
  const SETTLE_MS = 2500
  const COLLAPSE_MS = 30_000
  const SENSITIVE = /pass|pwd|card|cvv|cvc|ssn|social|security|routing|account.?num|iban|pin\b|otp|2fa|token/i

  // --- Reading ---------------------------------------------------------------

  function sensitive(element) {
    if (!element) return true
    if (element instanceof HTMLInputElement) {
      if (!["text", "search", "url", "email", ""].includes(element.type)) return true
    }
    const hints = [element.name, element.id, element.getAttribute("autocomplete"), element.getAttribute("aria-label"), element.placeholder]
      .filter(Boolean)
      .join(" ")
    return SENSITIVE.test(hints) || /cc-/.test(element.getAttribute("autocomplete") || "")
  }

  function fieldText() {
    let element = document.activeElement
    // Into same-origin frames and shadow roots, to the real focus.
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement
    if (!element || element === document.body || element.closest?.("#jarvis-bubble-host")) return ""
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return sensitive(element) ? "" : element.value.slice(0, FIELD_CHARS)
    }
    if (element.isContentEditable) return sensitive(element) ? "" : (element.innerText || "").slice(0, FIELD_CHARS)
    return ""
  }

  function pageText() {
    // The main content when the page marks it, else the whole body.
    const main = document.querySelector("main, article, [role=main]")
    const root = main && (main.innerText || "").length > 500 ? main : document.body
    return (root?.innerText || "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, PAGE_CHARS)
  }

  function extract() {
    const selection = String(window.getSelection() || "").trim().slice(0, 5000)
    return {
      url: location.href,
      title: document.title,
      lang: document.documentElement.lang || "",
      text: pageText(),
      selection,
      field: fieldText(),
    }
  }

  // --- Noticing change ---------------------------------------------------------

  let settleTimer = null
  let reason = "changed"
  function changed(why) {
    if (why === "selection") reason = "selection"
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      if (document.visibilityState !== "visible") return
      try {
        chrome.runtime.sendMessage({ type: "changed", reason })
      } catch {
        // The extension was reloaded; this old copy is orphaned.
        observer.disconnect()
      }
      reason = "changed"
    }, SETTLE_MS)
  }

  const observer = new MutationObserver(() => changed("dom"))
  if (document.body) observer.observe(document.body, { subtree: true, childList: true, characterData: true })
  document.addEventListener("input", (event) => {
    // Typing in Jarvis's own bubble is not the page changing.
    if (event.target !== host) changed("input")
  }, true)
  document.addEventListener("selectionchange", () => {
    if (String(window.getSelection() || "").trim().length >= 20) changed("selection")
  })

  // --- The bubble --------------------------------------------------------------

  let host = null
  let ui = null
  let collapseTimer = null

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
      font: 13px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif; color: #d8f6ff; }
    .card { width: 340px; max-width: calc(100vw - 40px); background: rgba(5, 7, 14, 0.94); border: 1px solid rgba(0, 212, 255, 0.45);
      border-radius: 4px; box-shadow: 0 0 24px rgba(0, 212, 255, 0.18), 0 8px 30px rgba(0, 0, 0, 0.5); overflow: hidden;
      transform-origin: bottom right; animation: rise 180ms ease-out; }
    .card[hidden] { display: none; }
    @keyframes rise { from { opacity: 0; transform: translateY(6px) scale(0.98); } }
    header { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid rgba(0, 212, 255, 0.2); }
    .name { font: 600 11px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.22em; color: #00d4ff; }
    .x { all: unset; cursor: pointer; color: #7fa9b8; padding: 0 4px; font-size: 15px; line-height: 1; }
    .x:hover { color: #d8f6ff; }
    .body { padding: 10px 12px; max-height: 260px; overflow-y: auto; white-space: pre-wrap; }
    .body:empty { display: none; }
    .note { padding: 6px 12px 0; font-size: 11px; color: #ffaa00; }
    .error { color: #ff6b6b; }
    .actions { display: flex; gap: 6px; padding: 0 12px 8px; }
    .actions[hidden] { display: none; }
    .chip { all: unset; cursor: pointer; font-size: 11px; letter-spacing: 0.06em; color: #7fa9b8; border: 1px solid rgba(0, 212, 255, 0.25);
      border-radius: 2px; padding: 2px 8px; }
    .chip:hover { color: #00d4ff; border-color: rgba(0, 212, 255, 0.6); }
    form { display: flex; gap: 6px; padding: 8px 10px 10px; border-top: 1px solid rgba(0, 212, 255, 0.12); }
    input { flex: 1; min-width: 0; background: rgba(0, 212, 255, 0.05); border: 1px solid rgba(0, 212, 255, 0.3); border-radius: 2px;
      color: #d8f6ff; padding: 6px 8px; font: inherit; outline: none; }
    input:focus { border-color: #00d4ff; }
    input::placeholder { color: #5f8796; }
    .send { all: unset; cursor: pointer; color: #00d4ff; border: 1px solid rgba(0, 212, 255, 0.5); border-radius: 2px; padding: 0 10px;
      font-size: 11px; letter-spacing: 0.1em; display: flex; align-items: center; }
    .orb { all: unset; cursor: pointer; width: 44px; height: 44px; border-radius: 50%; position: relative;
      background: radial-gradient(circle, #e6fbff 0 14%, rgba(0, 212, 255, 0.85) 18%, rgba(0, 212, 255, 0.15) 46%, rgba(5, 7, 14, 0.9) 62%);
      border: 2px solid rgba(0, 212, 255, 0.85); box-shadow: 0 0 18px rgba(0, 212, 255, 0.45); }
    .orb::after { content: ""; position: absolute; inset: -7px; border-radius: 50%; border: 1px solid rgba(0, 212, 255, 0.35); }
    .orb.speaking { animation: pulse 0.9s ease-in-out infinite; }
    .orb.thinking::after { border-top-color: #00d4ff; animation: spin 0.9s linear infinite; }
    @keyframes pulse { 50% { box-shadow: 0 0 34px rgba(0, 212, 255, 0.85); transform: scale(1.06); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    .orb[hidden] { display: none; }
  `

  function build() {
    host = document.createElement("div")
    host.id = "jarvis-bubble-host"
    // On <html>, outside <body>: the page's own text never includes it.
    document.documentElement.appendChild(host)
    const root = host.attachShadow({ mode: "closed" })
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="wrap">
        <section class="card" hidden role="dialog" aria-label="J.A.R.V.I.S.">
          <header><span class="name">J.A.R.V.I.S.</span><button class="x" aria-label="Close" title="Close (Esc)">×</button></header>
          <div class="note" hidden></div>
          <div class="body" aria-live="polite"></div>
          <div class="actions" hidden>
            <button class="chip" data-act="not-now" title="No remarks for 15 minutes">NOT NOW</button>
            <button class="chip" data-act="never-here" title="Jarvis will never read this site">NOT ON THIS SITE</button>
          </div>
          <form><input placeholder="Ask about this page…" aria-label="Ask Jarvis" /><button class="send" type="submit">ASK</button></form>
        </section>
        <button class="orb" hidden aria-label="Open Jarvis" title="Jarvis (Alt+J)"></button>
      </div>`
    ui = {
      card: root.querySelector(".card"),
      note: root.querySelector(".note"),
      body: root.querySelector(".body"),
      actions: root.querySelector(".actions"),
      form: root.querySelector("form"),
      input: root.querySelector("input"),
      orb: root.querySelector(".orb"),
    }
    root.querySelector(".x").addEventListener("click", collapse)
    ui.orb.addEventListener("click", () => open(true))
    ui.actions.addEventListener("click", (event) => {
      const act = event.target?.dataset?.act
      if (!act) return
      chrome.runtime.sendMessage({ type: act })
      ui.body.textContent = act === "not-now" ? "Very good. I'll keep quiet for a while." : "Understood. I won't read this site again."
      ui.actions.hidden = true
      setTimeout(hide, 2500)
    })
    ui.form.addEventListener("submit", (event) => {
      event.preventDefault()
      const text = ui.input.value.trim()
      if (!text) return
      ui.input.value = ""
      ui.body.classList.remove("error")
      ui.body.textContent = ""
      ui.actions.hidden = true
      ui.orb.classList.add("thinking")
      clearTimeout(collapseTimer)
      chrome.runtime.sendMessage({ type: "ask", text })
    })
    // Typing in the bubble must not reach the page's own shortcuts.
    for (const type of ["keydown", "keyup", "keypress"]) {
      root.addEventListener(type, (event) => {
        event.stopPropagation()
        if (type === "keydown" && event.key === "Escape") collapse()
      })
    }
    ui.card.addEventListener("pointerenter", () => clearTimeout(collapseTimer))
  }

  function open(focus) {
    if (!host) build()
    ui.card.hidden = false
    ui.orb.hidden = false
    if (focus) setTimeout(() => ui.input.focus(), 0)
  }

  function collapse() {
    if (!ui) return
    ui.card.hidden = true
    chrome.runtime.sendMessage({ type: "stop-voice" })
  }

  function hide() {
    if (!ui) return
    ui.card.hidden = true
    ui.orb.hidden = true
  }

  function collapseLater() {
    clearTimeout(collapseTimer)
    collapseTimer = setTimeout(() => {
      if (ui && !ui.card.matches(":focus-within")) ui.card.hidden = true
    }, COLLAPSE_MS)
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    switch (message.type) {
      case "extract":
        reply(extract())
        return false
      case "remark":
        open(false)
        ui.note.hidden = true
        ui.body.classList.remove("error")
        ui.body.textContent = message.text
        ui.actions.hidden = false
        collapseLater()
        return false
      case "open":
        open(true)
        ui.note.hidden = !message.privateReason
        ui.note.textContent = message.privateReason
          ? `This site is private (${message.privateReason}): Jarvis can't see it, but you can still ask him anything.`
          : ""
        return false
      case "answer":
        if (!ui) return false
        if (message.reset) ui.body.textContent = ""
        if (message.delta) ui.body.textContent += message.delta
        if (message.final !== undefined) {
          ui.body.textContent = message.final
          ui.orb.classList.remove("thinking")
        }
        if (message.error) {
          ui.body.textContent = message.error
          ui.body.classList.add("error")
          ui.orb.classList.remove("thinking")
        }
        ui.body.scrollTop = ui.body.scrollHeight
        return false
      case "speaking":
        ui?.orb.classList.toggle("speaking", Boolean(message.on))
        return false
    }
    return false
  })
})()
