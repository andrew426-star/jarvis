import { getOrCreateSessionId, getStoredToken, setStoredToken } from "@/lib/storage"

export type AuthState =
  | { status: "authenticated"; token: string; sessionId: string }
  | { status: "unauthenticated"; loginError: string | null }

// How this page load is signed in, worked out once from the URL and
// localStorage and cached for the life of the page. Read through
// useSyncExternalStore (like use-clock.ts) rather than set from an effect:
// the static export's server render can't see either source, so the
// server snapshot is null ("resolving") and the client snapshot replaces
// it after hydration without a mismatch. Shared by the desktop console
// and the phone view, so the ?session= hand-off is consumed exactly once.
let resolvedAuth: AuthState | null = null

export function resolveAuth(): AuthState {
  if (resolvedAuth) return resolvedAuth

  // A completed Google sign-in lands back here as ?session=... since
  // the callback has to hand the browser its credential somehow and
  // this app talks Bearer, not cookies.
  const params = new URLSearchParams(window.location.search)
  const granted = params.get("session")
  const failure = params.get("login_error")

  if (granted || failure) {
    // Strip it immediately: a session token in the address bar ends up
    // in history, bookmarks, and any screenshot of the app.
    window.history.replaceState({}, "", window.location.pathname)
  }

  if (granted) {
    setStoredToken(granted)
    resolvedAuth = { status: "authenticated", token: granted, sessionId: getOrCreateSessionId() }
  } else if (failure) {
    resolvedAuth = { status: "unauthenticated", loginError: failure }
  } else {
    const stored = getStoredToken()
    resolvedAuth = stored
      ? { status: "authenticated", token: stored, sessionId: getOrCreateSessionId() }
      : { status: "unauthenticated", loginError: null }
  }
  return resolvedAuth
}

// Sign-in state only changes by leaving the page (the Google redirect) or
// by an explicit sign-out handled in the view, so there is nothing to
// subscribe to.
export const subscribeAuth = () => () => {}
