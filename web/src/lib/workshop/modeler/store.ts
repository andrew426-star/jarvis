"use client"

import { create } from "zustand"

import { newDesign, type Design } from "@/lib/workshop/modeler/design"

// The modeler's state: the design being worked on (with undo), the piece
// selected in it, and a library of designs kept in this browser. Designs
// are his drafts; what he builds goes into a project as printed parts
// (modeler-panel.tsx), which is what the server keeps.

const CURRENT_KEY = "jarvis_modeler_current"
const LIBRARY_KEY = "jarvis_modeler_library"
const HISTORY = 60
/** Edits under the same tag this close together are one undo step (a
 *  slider dragged, a number typed). */
const COALESCE_MS = 900

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Full or blocked: the design lives on for this session.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function persist(design: Design) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => write(CURRENT_KEY, design), 500)
}

export interface ModelerState {
  open: boolean
  design: Design
  selected: string | null
  past: Design[]
  future: Design[]
  lastTag: { tag: string; at: number } | null
  library: { id: string; name: string; saved: string; design: Design }[]
  /** What the last stage build found: compiling, and parts that failed. */
  status: { compiling: boolean; errors: { part: string; error: string }[] }
  hydrated: boolean
  hydrate: () => void
  setOpen: (open: boolean) => void
  /** Change the design; `tag` merges quick repeats into one undo step. */
  update: (change: (design: Design) => Design, tag?: string) => void
  select: (id: string | null) => void
  undo: () => void
  redo: () => void
  start: (design?: Design) => void
  keep: () => void
  forget: (id: string) => void
  setStatus: (status: ModelerState["status"]) => void
}

export const useModeler = create<ModelerState>((set, get) => ({
  open: false,
  design: newDesign(),
  selected: null,
  past: [],
  future: [],
  lastTag: null,
  library: [],
  status: { compiling: false, errors: [] },
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return
    const design = read<Design | null>(CURRENT_KEY, null)
    set({ hydrated: true, library: read(LIBRARY_KEY, []), ...(design?.pieces ? { design } : {}) })
  },
  setOpen: (open) => {
    get().hydrate()
    set({ open })
  },
  update: (change, tag) => {
    const { design, past, lastTag } = get()
    const next = change(design)
    if (next === design) return
    const now = Date.now()
    const merge = !!tag && lastTag?.tag === tag && now - lastTag.at < COALESCE_MS
    set({
      design: next,
      past: merge ? past : [...past, design].slice(-HISTORY),
      future: [],
      lastTag: tag ? { tag, at: now } : null,
    })
    persist(next)
  },
  select: (selected) => set({ selected }),
  undo: () => {
    const { past, design, future } = get()
    const previous = past[past.length - 1]
    if (!previous) return
    set({ design: previous, past: past.slice(0, -1), future: [design, ...future].slice(0, HISTORY), lastTag: null })
    persist(previous)
  },
  redo: () => {
    const { past, design, future } = get()
    const next = future[0]
    if (!next) return
    set({ design: next, past: [...past, design].slice(-HISTORY), future: future.slice(1), lastTag: null })
    persist(next)
  },
  start: (design = newDesign()) => {
    set({ design, selected: null, past: [], future: [], lastTag: null })
    persist(design)
  },
  keep: () => {
    const { design, library } = get()
    const entry = { id: design.id, name: design.name, saved: new Date().toISOString(), design }
    const next = [entry, ...library.filter((d) => d.id !== design.id)].slice(0, 30)
    set({ library: next })
    write(LIBRARY_KEY, next)
  },
  forget: (id) => {
    const next = get().library.filter((d) => d.id !== id)
    set({ library: next })
    write(LIBRARY_KEY, next)
  },
  setStatus: (status) => set({ status }),
}))
