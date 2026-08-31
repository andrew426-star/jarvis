// Normal / Serious. The palette itself lives in globals.css, keyed off a
// [data-mode] attribute on <html>; this only decides which value that
// attribute holds and remembers the choice.
//
// The initial read happens in a blocking script in layout.tsx, not here,
// because reading it in an effect means one painted frame of cyan before
// serious mode applies. That makes the <html> attribute - not React
// state - the source of truth, so this exposes a useSyncExternalStore
// subscription rather than something a component copies into useState.

export type Mode = "normal" | "serious"

const MODE_KEY = "jarvis_mode"
const MODE_EVENT = "jarvis:modechange"

export function getStoredMode(): Mode {
  if (typeof window === "undefined") return "normal"
  try {
    return window.localStorage.getItem(MODE_KEY) === "serious" ? "serious" : "normal"
  } catch {
    // Privacy-locked browsers throw rather than returning null.
    return "normal"
  }
}

/** Reads the live DOM attribute, which layout.tsx has already set. */
export function getMode(): Mode {
  if (typeof document === "undefined") return "normal"
  return document.documentElement.getAttribute("data-mode") === "serious" ? "serious" : "normal"
}

/** Static export prerenders with no DOM, so the server snapshot is fixed. */
export function getServerMode(): Mode {
  return "normal"
}

export function subscribeMode(onChange: () => void): () => void {
  window.addEventListener(MODE_EVENT, onChange)
  return () => window.removeEventListener(MODE_EVENT, onChange)
}

export function applyMode(mode: Mode): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  if (mode === "serious") root.setAttribute("data-mode", "serious")
  else root.removeAttribute("data-mode")

  try {
    window.localStorage.setItem(MODE_KEY, mode)
  } catch {
    // A preference that cannot be persisted still applies for this
    // session; nothing here is worth failing over.
  }

  window.dispatchEvent(new Event(MODE_EVENT))
}
