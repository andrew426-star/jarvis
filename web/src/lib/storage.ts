const TOKEN_KEY = "jarvis_access_token"
const SESSION_KEY = "jarvis_session_id"

// SSR-guarded: these are only ever called from inside useEffect (after
// mount), but the guard stays cheap insurance against the "localStorage is
// not defined" class of bug if a call site ever moves.
const hasWindow = () => typeof window !== "undefined"

export function getStoredToken(): string | null {
  if (!hasWindow()) return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export function setStoredToken(token: string): void {
  if (!hasWindow()) return
  window.localStorage.setItem(TOKEN_KEY, token)
}

export function clearStoredToken(): void {
  if (!hasWindow()) return
  window.localStorage.removeItem(TOKEN_KEY)
}

export function getOrCreateSessionId(): string {
  if (!hasWindow()) return ""
  const existing = window.localStorage.getItem(SESSION_KEY)
  if (existing) return existing
  const created = crypto.randomUUID()
  window.localStorage.setItem(SESSION_KEY, created)
  return created
}

export function clearSession(): void {
  if (!hasWindow()) return
  window.localStorage.removeItem(SESSION_KEY)
}
