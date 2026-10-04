"use client"

import { useEffect, useRef } from "react"
import { create } from "zustand"

import { JarvisAuthError, getInbox, type InboxItem } from "@/lib/jarvis-client"
import { onWorkerMessage } from "@/lib/push"

// The inbox Jarvis's rounds fill (app/services/inbox.py), held once for
// whichever console is open. Both views keep it fresh with useInboxSync:
// on open, every few minutes, when the app comes back into view, and the
// moment a push arrives while it is open.

const EVERY_MS = 3 * 60_000

interface InboxState {
  pending: InboxItem[]
  recent: InboxItem[]
  loaded: boolean
  error: string | null
  /** The inbox view itself is showing (the phone's sheet, the desktop tab). */
  open: boolean
  setOpen: (open: boolean) => void
  /** An item decided here: moved out of pending without a refetch. */
  settle: (item: InboxItem) => void
  refresh: (token: string) => Promise<InboxItem[]>
}

export const useInbox = create<InboxState>((set, get) => ({
  pending: [],
  recent: [],
  loaded: false,
  error: null,
  open: false,
  setOpen: (open) => set({ open }),
  settle: (item) =>
    set((state) => ({
      pending: state.pending.filter((p) => p.id !== item.id),
      recent: [item, ...state.recent.filter((r) => r.id !== item.id)].slice(0, 10),
    })),
  refresh: async (token) => {
    const before = new Set(get().pending.map((p) => p.id))
    const firstLoad = !get().loaded
    const result = await getInbox(token)
    if (!result.ok) {
      set({ error: result.error ?? "Could not load the inbox.", loaded: true })
      return []
    }
    const pending = result.pending ?? []
    set({ pending, recent: result.recent ?? [], loaded: true, error: null })
    return firstLoad ? [] : pending.filter((p) => !before.has(p.id))
  },
}))

/** Keeps the inbox current while a console is open. `onNew` gets items
 *  that arrived since the last look (not the ones there at first load);
 *  `onOpenInbox` runs when he tapped a notification or opened ?inbox=1. */
export function useInboxSync(
  token: string,
  onAuthError: () => void,
  onNew: (items: InboxItem[]) => void,
  onOpenInbox: () => void
) {
  const handlers = useRef({ onAuthError, onNew, onOpenInbox })
  useEffect(() => {
    handlers.current = { onAuthError, onNew, onOpenInbox }
  })

  useEffect(() => {
    let stopped = false
    const refresh = async () => {
      if (stopped || document.visibilityState !== "visible") return
      try {
        const fresh = await useInbox.getState().refresh(token)
        if (fresh.length) handlers.current.onNew(fresh)
      } catch (err) {
        if (err instanceof JarvisAuthError) handlers.current.onAuthError()
        // Offline or asleep: the next tick tries again.
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), EVERY_MS)
    const onVisible = () => void refresh()
    document.addEventListener("visibilitychange", onVisible)
    const unsubscribe = onWorkerMessage((type) => {
      if (type === "jarvis-inbox") void refresh()
      if (type === "jarvis-open-inbox") {
        void refresh()
        handlers.current.onOpenInbox()
      }
    })
    // Opened from a notification: /?inbox=1. The flag is taken off the
    // address so a reload does not reopen it.
    const params = new URLSearchParams(window.location.search)
    if (params.has("inbox")) {
      params.delete("inbox")
      const rest = params.toString()
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`)
      handlers.current.onOpenInbox()
    }
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      unsubscribe()
    }
  }, [token])
}
