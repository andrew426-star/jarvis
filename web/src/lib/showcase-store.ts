"use client"

import { create } from "zustand"

// What Jarvis has put on screen with his showcase tool
// (app/tools/showcase.py), shown in the showcase window. Session only:
// images are large, and a reload is a fair point to clear the screen.

export type ShowcaseKind = "equation" | "text" | "code" | "file" | "image"

export interface ShowcaseItem {
  id: string
  kind: ShowcaseKind
  title: string
  caption?: string
  /** equation: LaTeX. text: text with $math$. code/file: the source. */
  content?: string
  language?: string
  filename?: string
  mime?: string
  /** text: the .txt it was saved as in Drive (app/tools/notes.py). */
  drive_link?: string
  /** image: base64, without the data: prefix. */
  image_data?: string
  time: string
}

const MAX_ITEMS = 12

interface ShowcaseState {
  items: ShowcaseItem[]
  /** The item on screen; null when the window is closed. */
  activeId: string | null
  add: (item: Omit<ShowcaseItem, "id">) => void
  show: (id: string) => void
  close: () => void
  remove: (id: string) => void
}

export const useShowcase = create<ShowcaseState>((set, get) => ({
  items: [],
  activeId: null,

  add: (input) => {
    const item = { ...input, id: crypto.randomUUID() }
    set({ items: [...get().items, item].slice(-MAX_ITEMS), activeId: item.id })
  },
  show: (activeId) => set({ activeId }),
  close: () => set({ activeId: null }),
  remove: (id) => {
    const items = get().items.filter((item) => item.id !== id)
    const activeId = get().activeId === id ? (items.at(-1)?.id ?? null) : get().activeId
    set({ items, activeId })
  },
}))

/** The open window, or the last one shown if he closed it. Often the
 * questions he is answering on the board, so its text travels with each
 * message: without it Jarvis knew only the title, and "check my answers"
 * had nothing to check against. */
export function showcaseState() {
  const { items, activeId } = useShowcase.getState()
  const item = items.find((i) => i.id === activeId) ?? items.at(-1)
  if (!item) return null
  return {
    title: item.title,
    kind: item.kind,
    open: item.id === activeId,
    content: item.kind === "image" ? "" : (item.content ?? "").slice(0, 5000),
  }
}

/** The same window as plain text, for watch's looks. */
export function onScreenText() {
  const state = showcaseState()
  return state?.content ? `${state.title}\n${state.content}` : ""
}
