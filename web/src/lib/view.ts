// Which console this device gets: the full desktop HUD, or the phone view
// (components/mobile/mobile-console.tsx). Phones get the phone view by
// default; either can be forced with ?view=mobile or ?view=desktop, or
// from each view's own menu, and the choice is remembered per device.

export type View = "mobile" | "desktop"

const VIEW_KEY = "jarvis_view"

// A touch screen no wider than a large phone held sideways.
const PHONE_QUERY = "(pointer: coarse) and (max-width: 940px)"

let resolved: View | null = null

function isView(value: unknown): value is View {
  return value === "mobile" || value === "desktop"
}

export function resolveView(): View {
  if (resolved) return resolved
  const asked = new URLSearchParams(window.location.search).get("view")
  if (isView(asked)) {
    try {
      window.localStorage.setItem(VIEW_KEY, asked)
    } catch {}
  }
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(VIEW_KEY)
  } catch {}
  resolved = isView(stored) ? stored : window.matchMedia(PHONE_QUERY).matches ? "mobile" : "desktop"
  return resolved
}

/** Switch views. A reload, because the two never share a page. */
export function setView(view: View) {
  try {
    window.localStorage.setItem(VIEW_KEY, view)
  } catch {}
  window.location.replace(window.location.pathname)
}

export const subscribeView = () => () => {}
