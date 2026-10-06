// Runs in every page. It does four things, and only when asked:
//   - reads the page (text, selection, the box being typed in) when the
//     background worker asks, which it does only for pages Jarvis may see;
//   - tells the worker when the page has settled after a change, so Jarvis
//     can look again (a ping, no content);
//   - draws Jarvis's bubble: his remarks, spoken; a box to ask him about
//     the page (Alt+J); "not now"; "not on this site";
//   - acts for Jarvis: lists what can be clicked or typed in, and clicks,
//     types, picks and scrolls on request, inside a glowing rim with a STOP
//     button. Anything with consequences (send, buy, delete, submit...) waits
//     for Andrew to press ALLOW on the page.
// Password, card and similar fields are never read or typed into.

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

  // --- Acting ------------------------------------------------------------------
  // Jarvis sees the page's controls as a numbered list (elements) and acts
  // on them by number. Numbers stick to their element for the life of the
  // page, so a list a few seconds old still points at the right things.

  const INTERACTIVE = [
    "a[href]", "button", "input", "textarea", "select", "summary", "[contenteditable='']", "[contenteditable='true']",
    "[role=button]", "[role=link]", "[role=tab]", "[role=menuitem]", "[role=checkbox]", "[role=radio]", "[role=switch]",
    "[role=option]", "[role=combobox]", "[role=textbox]", "[role=searchbox]", "[onclick]",
  ].join(",")
  const MAX_ELEMENTS = 250
  const CONFIRM_MS = 18_000 // inside Jarvis's 30s budget for one round of tools
  const RIM_IDLE_MS = 12_000
  // Clicks that do something hard to take back. Any of these, a form's
  // submit, or Enter outside a search box waits for ALLOW.
  const RISKY = /\b(buy|purchase|pay|order|checkout|check ?out|send|post|publish|tweet|reply|submit|delete|remove|trash|discard|unsubscribe|subscribe|confirm|transfer|withdraw|donate|book|reserve|apply|enrol+|register|sign ?up|accept|approve|merge|deploy|share|invite|upload|save|archive|leave|block|report|cancel)\b/i

  let nextRef = 1
  const refOf = new WeakMap()
  const byRef = new Map()

  function refFor(element) {
    let ref = refOf.get(element)
    if (!ref) {
      ref = nextRef++
      refOf.set(element, ref)
      byRef.set(ref, new WeakRef(element))
    }
    return ref
  }

  function* candidates(root) {
    yield* root.querySelectorAll(INTERACTIVE)
    for (const element of root.querySelectorAll("*")) if (element.shadowRoot) yield* candidates(element.shadowRoot)
  }

  function visible(element) {
    const rect = element.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    const style = getComputedStyle(element)
    return style.visibility !== "hidden" && style.opacity !== "0"
  }

  const clean = (text, n = 80) => String(text || "").replace(/\s+/g, " ").trim().slice(0, n)

  function labelOf(element) {
    const labelledBy = element.getAttribute("aria-labelledby")
    const byId = labelledBy && labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText).join(" ")
    return clean(
      element.getAttribute("aria-label") ||
        byId ||
        element.labels?.[0]?.innerText ||
        (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type) ? element.value : "") ||
        (element instanceof HTMLSelectElement ? "" : element.innerText) ||
        element.placeholder ||
        element.title ||
        element.querySelector?.("img[alt]")?.alt ||
        element.name
    )
  }

  function kindOf(element) {
    const role = element.getAttribute("role")
    if (role) return role
    if (element instanceof HTMLInputElement) return `input:${element.type || "text"}`
    if (element.isContentEditable) return "editor"
    return element.tagName.toLowerCase() === "a" ? "link" : element.tagName.toLowerCase()
  }

  /** The page's controls, on screen first, as compact lines for Jarvis. */
  function elements() {
    const seen = new Set()
    const onScreen = []
    const below = []
    for (const element of candidates(document)) {
      if (seen.has(element) || !visible(element) || element.closest("#jarvis-bubble-host, #jarvis-drive-host")) continue
      // A control inside a control (a span with onclick in a button) is one control.
      if (element.parentElement?.closest(INTERACTIVE) && seen.has(element.parentElement.closest(INTERACTIVE))) continue
      seen.add(element)
      const rect = element.getBoundingClientRect()
      const inView = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
      ;(inView ? onScreen : below).push(element)
    }
    const lines = []
    for (const element of [...onScreen, ...below].slice(0, MAX_ELEMENTS)) {
      const parts = [`[${refFor(element)}]`, kindOf(element), JSON.stringify(labelOf(element))]
      if (element instanceof HTMLAnchorElement && element.href) parts.push("-> " + clean(element.href.replace(location.origin, ""), 100))
      const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
      if (field && privateField(element)) parts.push("(private field)")
      else if (field && !sensitive(element) && element.value && !["button", "submit", "reset"].includes(element.type))
        parts.push(`value=${JSON.stringify(clean(element.value, 60))}`)
      if (element.checked) parts.push("checked")
      if (element.disabled || element.getAttribute("aria-disabled") === "true") parts.push("disabled")
      if (!onScreen.includes(element)) parts.push("(scroll to see)")
      lines.push(parts.join(" "))
    }
    return {
      url: location.href,
      title: document.title,
      elements: lines,
      more: onScreen.length + below.length > MAX_ELEMENTS,
      scrolled: `${Math.round(scrollY)} of ${Math.max(0, document.documentElement.scrollHeight - innerHeight)}px`,
    }
  }

  /** Fields Jarvis never types into or reports: passwords, cards, codes. */
  function privateField(target) {
    if (target instanceof HTMLInputElement && ["password", "hidden", "file"].includes(target.type)) return true
    const hints = [target.name, target.id, target.getAttribute("autocomplete"), target.getAttribute("aria-label"), target.placeholder]
      .filter(Boolean)
      .join(" ")
    return SENSITIVE.test(hints) || /cc-/.test(target.getAttribute("autocomplete") || "")
  }

  function element(ref) {
    const found = byRef.get(Number(ref))?.deref()
    return found && found.isConnected ? found : null
  }

  function isSearch(field) {
    const form = field?.form || field?.closest?.("form")
    const hints = `${field?.type} ${field?.name} ${field?.getAttribute?.("role")} ${field?.getAttribute?.("aria-label")} ${form?.getAttribute("role")} ${form?.action}`
    return /search|\bq\b|query/i.test(hints)
  }

  /** Why this action needs Andrew's ALLOW, or null. */
  function risk(act, target, mode) {
    if (act.action === "scroll") return null
    if (mode === "ask") return "you asked to approve every action"
    if (act.action === "click") {
      const label = labelOf(target)
      if (RISKY.test(label)) return "label" // the label says it all
      const submits = (target instanceof HTMLButtonElement && target.type === "submit") || (target instanceof HTMLInputElement && target.type === "submit")
      if (submits && target.form && !isSearch(target.form.querySelector("input"))) return "it submits a form"
    }
    const enter = (act.action === "type" && act.submit) || (act.action === "press" && act.key === "Enter")
    if (enter && !isSearch(target)) return "pressing Enter here may send or submit"
    return null
  }

  // The rim: a glow around the whole window while Jarvis is driving, a
  // pill at the top saying what he is doing, and STOP (or Esc).
  const DRIVE_STYLE = `
    :host { all: initial; }
    .rim { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; border-radius: 0;
      box-shadow: inset 0 0 0 2px rgba(0, 212, 255, 0.9), inset 0 0 22px 4px rgba(0, 212, 255, 0.55), inset 0 0 70px 10px rgba(0, 140, 255, 0.25);
      animation: breathe 2.2s ease-in-out infinite; opacity: 0; transition: opacity 350ms ease; }
    .rim.on { opacity: 1; }
    .rim.ask { box-shadow: inset 0 0 0 2px rgba(255, 170, 0, 0.95), inset 0 0 22px 4px rgba(255, 170, 0, 0.55), inset 0 0 70px 10px rgba(255, 120, 0, 0.25); }
    @keyframes breathe { 50% { filter: brightness(1.45); } }
    .pill { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 2147483647; display: none; align-items: center; gap: 10px;
      max-width: calc(100vw - 32px); padding: 6px 8px 6px 12px; background: rgba(5, 7, 14, 0.94); border: 1px solid rgba(0, 212, 255, 0.55);
      border-radius: 4px; box-shadow: 0 0 22px rgba(0, 212, 255, 0.35); color: #d8f6ff; font: 12px/1.4 "Segoe UI", system-ui, sans-serif; }
    .pill.on { display: flex; }
    .pill.ask { border-color: rgba(255, 170, 0, 0.8); box-shadow: 0 0 22px rgba(255, 170, 0, 0.35); }
    .name { font-weight: 600; font-size: 10px; letter-spacing: 0.22em; color: #00d4ff; white-space: nowrap; }
    .pill.ask .name { color: #ffaa00; }
    .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    button { all: unset; cursor: pointer; font-size: 10px; letter-spacing: 0.12em; padding: 3px 9px; border-radius: 2px; white-space: nowrap; }
    .stop { color: #ff6b6b; border: 1px solid rgba(255, 107, 107, 0.6); }
    .allow { color: #05070e; background: #ffaa00; font-weight: 600; }
    .cancel { color: #d8f6ff; border: 1px solid rgba(216, 246, 255, 0.4); }
    button[hidden] { display: none; }
    .mark { position: fixed; pointer-events: none; z-index: 2147483646; border: 2px solid #00d4ff; border-radius: 3px;
      box-shadow: 0 0 14px rgba(0, 212, 255, 0.8); display: none; transition: all 160ms ease; }
    .mark.on { display: block; }
    .mark.ask { border-color: #ffaa00; box-shadow: 0 0 14px rgba(255, 170, 0, 0.8); }
  `

  let drive = null
  let rimTimer = null
  let pendingConfirm = null

  function buildDrive() {
    const driveHost = document.createElement("div")
    driveHost.id = "jarvis-drive-host"
    document.documentElement.appendChild(driveHost)
    const root = driveHost.attachShadow({ mode: "closed" })
    root.innerHTML = `
      <style>${DRIVE_STYLE}</style>
      <div class="rim"></div>
      <div class="mark"></div>
      <div class="pill" role="status">
        <span class="name">J.A.R.V.I.S.</span><span class="what"></span>
        <button class="allow" hidden>ALLOW</button><button class="cancel" hidden>CANCEL</button>
        <button class="stop" title="Stop Jarvis (Esc)">STOP</button>
      </div>`
    drive = {
      rim: root.querySelector(".rim"),
      mark: root.querySelector(".mark"),
      pill: root.querySelector(".pill"),
      what: root.querySelector(".what"),
      allow: root.querySelector(".allow"),
      cancel: root.querySelector(".cancel"),
      stop: root.querySelector(".stop"),
    }
    drive.stop.addEventListener("click", stopDriving)
    drive.allow.addEventListener("click", () => settleConfirm(true))
    drive.cancel.addEventListener("click", () => settleConfirm(false))
    // Only Andrew's own Esc (a real key press) stops him, never one Jarvis sends.
    document.addEventListener("keydown", (event) => {
      if (event.isTrusted && event.key === "Escape" && drive.rim.classList.contains("on")) stopDriving()
    }, true)
  }

  function showDriving(what, ask = false) {
    if (!drive) buildDrive()
    drive.what.textContent = what
    for (const part of [drive.rim, drive.pill]) {
      part.classList.add("on")
      part.classList.toggle("ask", ask)
    }
    drive.allow.hidden = drive.cancel.hidden = !ask
    drive.stop.hidden = ask
    clearTimeout(rimTimer)
    if (!ask) rimTimer = setTimeout(endDriving, RIM_IDLE_MS)
  }

  function endDriving() {
    if (!drive) return
    clearTimeout(rimTimer)
    for (const part of [drive.rim, drive.pill, drive.mark]) part.classList.remove("on", "ask")
  }

  function stopDriving() {
    settleConfirm(false)
    chrome.runtime.sendMessage({ type: "stop-acting" }).catch(() => {})
    showDriving("Stopped.")
    clearTimeout(rimTimer)
    rimTimer = setTimeout(endDriving, 1500)
  }

  function markElement(target, ask = false) {
    if (!drive) buildDrive()
    const rect = target.getBoundingClientRect()
    Object.assign(drive.mark.style, { left: `${rect.left - 4}px`, top: `${rect.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px` })
    drive.mark.classList.add("on")
    drive.mark.classList.toggle("ask", ask)
  }

  function settleConfirm(ok) {
    if (!pendingConfirm) return
    const { resolve, timer } = pendingConfirm
    pendingConfirm = null
    clearTimeout(timer)
    resolve(ok)
  }

  /** Waits for Andrew's ALLOW or CANCEL on the page (false after CONFIRM_MS). */
  function confirmOnPage(what, target) {
    settleConfirm(false)
    chrome.runtime.sendMessage({ type: "attention" }).catch(() => {})
    showDriving(what, true)
    if (target) markElement(target, true)
    return new Promise((resolve) => {
      pendingConfirm = { resolve, timer: setTimeout(() => settleConfirm(false), CONFIRM_MS) }
    }).then((ok) => {
      showDriving(ok ? "Allowed." : "Cancelled.")
      return ok
    })
  }

  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  function pointerClick(target) {
    const rect = target.getBoundingClientRect()
    const at = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
    target.dispatchEvent(new PointerEvent("pointerover", at))
    target.dispatchEvent(new PointerEvent("pointerdown", at))
    target.dispatchEvent(new MouseEvent("mousedown", at))
    target.focus?.({ preventScroll: true })
    target.dispatchEvent(new PointerEvent("pointerup", at))
    target.dispatchEvent(new MouseEvent("mouseup", at))
    target.click()
  }

  function key(target, name) {
    const init = { key: name, code: name === " " ? "Space" : name, bubbles: true, cancelable: true, composed: true }
    if (name === "Enter") Object.assign(init, { keyCode: 13, which: 13 })
    const go = target.dispatchEvent(new KeyboardEvent("keydown", init))
    target.dispatchEvent(new KeyboardEvent("keypress", init))
    target.dispatchEvent(new KeyboardEvent("keyup", init))
    // A synthetic Enter submits nothing by itself: do what the browser would.
    if (go && name === "Enter" && target.form) target.form.requestSubmit()
  }

  function setText(target, text, clear) {
    target.focus()
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (clear) target.select()
      else target.setSelectionRange(target.value.length, target.value.length)
      const before = target.value
      // insertText goes through the page's own input handling (React and co.).
      if (!document.execCommand("insertText", false, text) || target.value === before) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), "value").set
        setter.call(target, clear ? text : before + text)
        target.dispatchEvent(new Event("input", { bubbles: true }))
      }
      target.dispatchEvent(new Event("change", { bubbles: true }))
      return
    }
    if (clear) document.execCommand("selectAll")
    else {
      const range = document.createRange()
      range.selectNodeContents(target)
      range.collapse(false)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    }
    document.execCommand("insertText", false, text)
  }

  function scrollTarget() {
    const page = document.scrollingElement
    if (page && page.scrollHeight > page.clientHeight + 4) return page
    // An app that scrolls a panel, not the page: the panel under the middle.
    let node = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
    while (node && node !== document.body) {
      const style = getComputedStyle(node)
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node
      node = node.parentElement
    }
    return page || document.body
  }

  async function act(request) {
    const { action, mode } = request
    if (action === "scroll" && !request.ref) {
      const box = scrollTarget()
      const step = box.clientHeight * 0.8
      const to = { up: box.scrollTop - step, down: box.scrollTop + step, top: 0, bottom: box.scrollHeight }[request.direction || "down"]
      showDriving(`Scrolling ${request.direction || "down"}`)
      box.scrollTo({ top: to, behavior: "smooth" })
      await pause(450)
      return { ok: true, did: `scrolled ${request.direction || "down"}` }
    }

    const target = element(request.ref)
    if (!target) return { ok: false, error: `Element ${request.ref} is gone (the page changed). Call elements again.` }
    const label = labelOf(target) || kindOf(target)
    if (["type", "select", "press"].includes(action) && privateField(target)) {
      return { ok: false, error: "That is a password, card or similar private field. Andrew fills those in himself." }
    }
    if (target.disabled) return { ok: false, error: `"${label}" is disabled.` }

    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })
    const verb = { click: "Clicking", type: "Typing into", select: "Choosing in", press: `Pressing ${request.key} in`, scroll: "Scrolling to" }[action] || action
    const why = risk(request, target, mode)
    if (why) {
      const allowed = await confirmOnPage(`Allow ${verb.toLowerCase()} "${label}"?${why === "label" ? "" : ` (${why})`}`, target)
      if (!allowed) return { ok: false, declined: true, error: `Andrew did not allow ${verb.toLowerCase()} "${label}". Do not retry it unless he asks.` }
    } else {
      showDriving(`${verb} "${label}"`)
      markElement(target)
      await pause(350) // long enough to see what he is about to touch
    }
    drive?.mark.classList.remove("on")

    switch (action) {
      case "scroll":
        return { ok: true, did: `scrolled to "${label}"` }
      case "click":
        pointerClick(target)
        return { ok: true, did: `clicked "${label}"` }
      case "type": {
        setText(target, String(request.text ?? ""), request.clear !== false)
        if (request.submit) key(target, "Enter")
        return { ok: true, did: `typed into "${label}"${request.submit ? " and pressed Enter" : ""}` }
      }
      case "select": {
        if (!(target instanceof HTMLSelectElement)) return { ok: false, error: `"${label}" is not a dropdown list; click it, then click the option.` }
        const wanted = String(request.option || "").toLowerCase()
        const options = [...target.options]
        const option = options.find((o) => o.text.trim().toLowerCase() === wanted || o.value.toLowerCase() === wanted) ||
          options.find((o) => o.text.toLowerCase().includes(wanted))
        if (!option) return { ok: false, error: `No option like "${request.option}".`, options: options.slice(0, 40).map((o) => o.text.trim()) }
        target.value = option.value
        target.dispatchEvent(new Event("input", { bubbles: true }))
        target.dispatchEvent(new Event("change", { bubbles: true }))
        return { ok: true, did: `chose "${option.text.trim()}" in "${label}"` }
      }
      case "press":
        key(target, request.key)
        return { ok: true, did: `pressed ${request.key} in "${label}"` }
    }
    return { ok: false, error: `Unknown action ${action}.` }
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    switch (message.type) {
      case "extract":
        reply(extract())
        return false
      case "elements":
        reply(elements())
        return false
      case "act":
        act(message.request).then(reply, (error) => reply({ ok: false, error: String(error?.message || error) }))
        return true
      case "confirm":
        confirmOnPage(message.text).then((ok) => reply({ ok }))
        return true
      case "driving":
        showDriving(message.text)
        return false
      case "halted":
        settleConfirm(false)
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
