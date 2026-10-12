"use client"

import { create } from "zustand"

// Ultron's directive (app/tools/directive.py): the objective he is driving
// on the engineering side, its phases and their steps. His tool returns
// changes as actions; they are applied here and kept in this browser, and
// sent back with every message (console-commands.ts consoleState) so he
// sees the plan as it stands before he changes it.

export type StepStatus = "queued" | "active" | "done" | "blocked"

export interface DirectiveStep {
  text: string
  status: StepStatus
  note?: string
  /** When it last changed, ms. */
  at?: number
}

export interface Directive {
  objective: string
  phases: { name: string; steps: DirectiveStep[] }[]
  /** When it was set, ms. */
  since: number
}

export type DirectiveAction =
  | { op: "set"; objective: string; phases: { name: string; steps: DirectiveStep[] }[] }
  | { op: "step"; phase: number; step: number; status: StepStatus; note?: string }
  | { op: "add"; phase: number; text: string }
  | { op: "clear" }

const KEY = "ultron_directive"

function load(): Directive | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Directive) : null
  } catch {
    return null
  }
}

function save(directive: Directive | null) {
  try {
    if (directive) localStorage.setItem(KEY, JSON.stringify(directive))
    else localStorage.removeItem(KEY)
  } catch {
    // Kept for this session only.
  }
}

interface DirectiveState {
  directive: Directive | null
  /** The step that changed last, for its row to light up: "phase.step". */
  flash: string | null
  apply: (actions: DirectiveAction[]) => void
  /** Andrew ticking a step himself. */
  setStatus: (phase: number, step: number, status: StepStatus) => void
}

export const useDirective = create<DirectiveState>((set, get) => ({
  directive: load(),
  flash: null,
  apply: (actions) => {
    let d = get().directive
    let flash: string | null = null
    for (const a of actions) {
      if (a.op === "clear") d = null
      else if (a.op === "set") d = { objective: a.objective, phases: a.phases.map((p) => ({ name: p.name, steps: p.steps.map((s) => ({ ...s, at: Date.now() })) })), since: Date.now() }
      else if (d && a.op === "add" && d.phases[a.phase - 1]) {
        d = { ...d, phases: d.phases.map((p, i) => (i === a.phase - 1 ? { ...p, steps: [...p.steps, { text: a.text, status: "queued", at: Date.now() }] } : p)) }
        flash = `${a.phase}.${d.phases[a.phase - 1].steps.length}`
      } else if (d && a.op === "step" && d.phases[a.phase - 1]?.steps[a.step - 1]) {
        d = {
          ...d,
          phases: d.phases.map((p, i) =>
            i !== a.phase - 1 ? p : { ...p, steps: p.steps.map((s, j) => (j === a.step - 1 ? { ...s, status: a.status, note: a.note ?? s.note, at: Date.now() } : s)) }
          ),
        }
        flash = `${a.phase}.${a.step}`
      }
    }
    save(d)
    set({ directive: d, flash })
    if (flash) setTimeout(() => get().flash === flash && set({ flash: null }), 1600)
  },
  setStatus: (phase, step, status) => get().apply([{ op: "step", phase, step, status }]),
}))

/** The directive as Ultron is shown it. */
export function directiveState() {
  const d = useDirective.getState().directive
  if (!d) return null
  return {
    objective: d.objective,
    phases: d.phases.map((p) => ({ name: p.name, steps: p.steps.map((s) => ({ text: s.text, status: s.status, ...(s.note ? { note: s.note } : {}) })) })),
  }
}

/** Steps done of all. */
export function directiveProgress(d: Directive | null): { done: number; total: number } {
  const steps = d?.phases.flatMap((p) => p.steps) ?? []
  return { done: steps.filter((s) => s.status === "done").length, total: steps.length }
}
