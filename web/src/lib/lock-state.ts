"use client"

import { useEffect } from "react"
import { create } from "zustand"

// The console's lock (app/api/routes/unlock.py). A Google sign-in only
// opens the lock; the PIN (phone) or a face scan (desktop) returns a
// short-lived unlock token, and that is the token the console uses for
// everything else. It is kept for this tab only (sessionStorage): closing
// the app, or it running out, means unlocking again. The server enforces
// all of this; this store only follows it, and locks the moment the server
// answers 423 (jarvis-client.ts).

const KEY = "jarvis_unlock"

export interface Unlock {
  token: string
  /** Unix seconds. */
  expiresAt: number
  method: "pin" | "face"
}

function load(): Unlock | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Unlock) : null
    return parsed && parsed.expiresAt * 1000 > Date.now() ? parsed : null
  } catch {
    return null
  }
}

interface LockState {
  unlock: Unlock | null
  setUnlock: (unlock: Unlock) => void
  lock: () => void
}

export const useLock = create<LockState>((set) => ({
  unlock: typeof window === "undefined" ? null : load(),
  setUnlock: (unlock) => {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(unlock))
    } catch {}
    set({ unlock })
  },
  lock: () => {
    try {
      window.sessionStorage.removeItem(KEY)
    } catch {}
    set({ unlock: null })
  },
}))

/** Locks again when the unlock runs out, and when the console has been out
 *  of sight for `awayMs` (the phone in a pocket, a desktop tab left behind). */
export function useAutoRelock(awayMs: number) {
  const unlock = useLock((s) => s.unlock)
  useEffect(() => {
    if (!unlock) return
    const lock = useLock.getState().lock
    const expiry = setTimeout(lock, Math.max(0, unlock.expiresAt * 1000 - Date.now()))
    let hiddenAt: number | null = null
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now()
      } else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt > awayMs) lock()
        hiddenAt = null
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      clearTimeout(expiry)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [unlock, awayMs])
}
