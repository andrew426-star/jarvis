"use client"

import { create } from "zustand"

import { BY_ID } from "@/lib/workshop/lab/catalog"
import { DEFAULT_PARAMS, runTest, type LabParams, type LabResult, type LabTest } from "@/lib/workshop/lab/tests"

// The material lab: which materials are on the bench (up to six, side by
// side), which test, its settings, and the last run's results - opened
// from the workshop's MATERIALS button or by Jarvis (console tool,
// material_test), who reads the results back from CONSOLE_STATE.

export const MAX_LANES = 6

interface LabState {
  open: boolean
  materials: string[]
  test: LabTest
  params: LabParams
  results: LabResult[]
  /** The test those results are from. */
  ranTest: LabTest
  /** Bumped to start the animation. */
  run: number
  setOpen: (open: boolean) => void
  toggle: (id: string) => void
  setMaterials: (ids: string[]) => void
  setTest: (test: LabTest) => void
  setParams: (patch: Partial<LabParams>) => void
  /** Work the test out for every material on the bench and play it. */
  start: () => void
}

export const useLab = create<LabState>((set, get) => ({
  open: false,
  materials: ["natural_rubber", "glass", "pla", "aluminium"],
  test: "tensile",
  params: { ...DEFAULT_PARAMS },
  results: [],
  ranTest: "tensile",
  run: 0,
  setOpen: (open) => set({ open }),
  toggle: (id) =>
    set((s) => ({
      materials: s.materials.includes(id) ? s.materials.filter((m) => m !== id) : s.materials.length >= MAX_LANES ? s.materials : [...s.materials, id],
    })),
  setMaterials: (ids) => set({ materials: [...new Set(ids.filter((id) => BY_ID.has(id)))].slice(0, MAX_LANES) }),
  setTest: (test) => set({ test }),
  setParams: (patch) => set((s) => ({ params: { ...s.params, ...patch } })),
  start: () => {
    const { materials, test, params } = get()
    const results = materials.map((id) => runTest(test, BY_ID.get(id)!, params))
    set((s) => ({ results, ranTest: test, run: s.run + 1 }))
  },
}))

/** The last run, for Jarvis. */
export function labState() {
  const { open, ranTest: test, params, results } = useLab.getState()
  if (!open && !results.length) return null
  return {
    open,
    test,
    params,
    results: results.map((r) => ({ material: r.material.name, verdict: r.verdict, figures: Object.fromEntries(r.figures) })),
  }
}
