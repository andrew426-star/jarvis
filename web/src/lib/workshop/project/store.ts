"use client"

import { create } from "zustand"

import { saveProject } from "@/lib/jarvis-client"
import { useJarvis } from "@/lib/store"
import type { Project, Report, Segment } from "@/lib/workshop/project/types"
import type { SimSnapshot } from "@/lib/workshop/sim/runner"

// The workshop's open project. Jarvis's project tool loads one in (through
// console-commands), the panel edits and saves it; either way the server
// sends back its own copy - checked, compiled, priced - and that replaces
// what is here. The simulation (sim/controller.ts) publishes its snapshot
// here for the panel and for Jarvis's view of the console.

export type ProjectTab = "overview" | "parts" | "rig" | "circuit" | "code" | "sim"

interface ProjectState {
  project: Project | null
  report: Report | null
  /** Bumps whenever a new copy of the project arrives (the 3D assembly
   *  rebuilds on it). */
  version: number
  saving: boolean
  panelOpen: boolean
  /** The project gallery, over the stage. */
  galleryOpen: boolean
  tab: ProjectTab
  sim: SimSnapshot | null
  token: string | null
  /** The rig as edited in the panel or with the stage's gizmo, before it
   *  is saved (null: as the project has it). The stage shows it live. */
  rigDraft: Segment[] | null
  /** The segment the stage's move gizmo is on. */
  rigEdit: string | null
  /** The design axes on the stage. */
  axes: boolean
  /** Each wire's run on the stage as it is now, mm (for the panel). */
  runs: { wire: string; mm: number }[]
  setRigDraft: (segments: Segment[] | null) => void
  setRigEdit: (name: string | null) => void
  setAxes: (on: boolean) => void
  setRuns: (runs: { wire: string; mm: number }[]) => void
  load: (project: Project, report: Report | null) => void
  close: () => void
  setTab: (tab: ProjectTab) => void
  setPanelOpen: (open: boolean) => void
  setGalleryOpen: (open: boolean) => void
  setSim: (sim: SimSnapshot | null) => void
  setToken: (token: string | null) => void
  /** Save edits made in the panel; true when the server took them. */
  save: (changes: Partial<Project>) => Promise<boolean>
}

export const useProject = create<ProjectState>((set, get) => ({
  project: null,
  report: null,
  version: 0,
  saving: false,
  panelOpen: true,
  galleryOpen: false,
  tab: "overview",
  sim: null,
  token: null,
  rigDraft: null,
  rigEdit: null,
  axes: true,
  runs: [],
  setRigDraft: (rigDraft) => set({ rigDraft }),
  setRigEdit: (rigEdit) => set({ rigEdit }),
  setAxes: (axes) => set({ axes }),
  setRuns: (runs) => set({ runs }),
  load: (project, report) =>
    set((state) => ({
      project,
      report,
      version: state.version + 1,
      panelOpen: true,
      rigDraft: null,
      rigEdit: state.project?.id === project.id ? state.rigEdit : null,
    })),
  close: () => set((state) => ({ project: null, report: null, sim: null, version: state.version + 1, rigDraft: null, rigEdit: null, runs: [] })),
  setTab: (tab) => set({ tab }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setGalleryOpen: (galleryOpen) => set({ galleryOpen }),
  setSim: (sim) => set({ sim }),
  setToken: (token) => set({ token }),
  save: async (changes) => {
    const { project, token } = get()
    if (!project || !token) return false
    set({ saving: true })
    try {
      const saved = await saveProject({ ...project, ...changes }, token)
      if (!saved.ok) {
        useJarvis.getState().notify("warning", "Project not saved", saved.error)
        return false
      }
      get().load(saved.project, saved.report)
      return true
    } catch (err) {
      useJarvis.getState().notify("warning", "Project not saved", err instanceof Error ? err.message : String(err))
      return false
    } finally {
      set({ saving: false })
    }
  },
}))

/** The open project as Jarvis sees it, sent with every message. */
export function projectState() {
  const { project, sim, report } = useProject.getState()
  if (!project?.id) return null
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    parts: project.parts.length,
    compiled: !!project.hex,
    errors: report?.checks.filter((c) => c.level === "error").length ?? 0,
    sim: sim
      ? {
          running: sim.running,
          time_s: Math.round(sim.time_s * 10) / 10,
          readings: sim.parts.map((p) => p.reading),
          warnings: sim.warnings,
          serial: sim.serial.slice(-600),
          error: sim.error,
        }
      : null,
  }
}
