"use client"

import { create } from "zustand"

// Ultron's bench: every engineering calculation he runs (app/tools/
// engineering.py - torque, power, beam, review), as it comes back, for his
// Bench app. Kept in this browser, newest first.

export interface BenchRun {
  id: string
  at: number
  op: string
  args: Record<string, unknown>
  result: Record<string, unknown>
}

const KEY = "ultron_bench"
const MAX = 40

function load(): BenchRun[] {
  if (typeof window === "undefined") return []
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as BenchRun[]
  } catch {
    return []
  }
}

interface BenchState {
  runs: BenchRun[]
  add: (args: Record<string, unknown>, result: Record<string, unknown>) => void
  clear: () => void
}

export const useBench = create<BenchState>((set, get) => ({
  runs: load(),
  add: (args, result) => {
    const run: BenchRun = { id: crypto.randomUUID(), at: Date.now(), op: String(args.op ?? args.operation ?? "run"), args, result }
    const runs = [run, ...get().runs].slice(0, MAX)
    try {
      localStorage.setItem(KEY, JSON.stringify(runs))
    } catch {
      // Too big or blocked: kept for this session.
    }
    set({ runs })
  },
  clear: () => {
    try {
      localStorage.removeItem(KEY)
    } catch {
      // Nothing kept.
    }
    set({ runs: [] })
  },
}))
