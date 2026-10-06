"use client"

import { rigOf, savedSegments, type RigSegment } from "@/lib/workshop/project/rig"
import { useProject } from "@/lib/workshop/project/store"

// Editing the open project's rig: the panel's fields and the stage's move
// gizmo both change a draft (shown live on the stage, wires and all) and
// save it a moment after the last change.

/** The rig as it is being edited: the draft, else the project's own. */
export function editableRig(): RigSegment[] {
  const { project, rigDraft } = useProject.getState()
  if (rigDraft) return rigDraft as RigSegment[]
  return project ? rigOf(project) : []
}

/** Change one segment in the draft. */
export function editSegment(name: string, change: (segment: RigSegment) => RigSegment) {
  useProject.getState().setRigDraft(editableRig().map((s) => (s.name === name ? change(s) : s)))
}

/** Replace the whole rig in the draft (adding or removing a segment). */
export function setRig(segments: RigSegment[]) {
  useProject.getState().setRigDraft(segments)
}

let timer: ReturnType<typeof setTimeout> | null = null

/** Save the draft now. */
export async function saveRig(): Promise<boolean> {
  if (timer) clearTimeout(timer)
  timer = null
  const { rigDraft, save } = useProject.getState()
  if (!rigDraft) return true
  const round = (v?: number[]) => v?.map((n) => Math.round(n * 2) / 2)
  const segments = savedSegments(rigDraft as RigSegment[]).map((s) => ({ ...s, move: round(s.move), pose: round(s.pose), pivot: round(s.pivot), at: round(s.at) }))
  return save({ segments })
}

/** Save the draft once the edits stop for `ms`. */
export function saveRigSoon(ms = 800) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void saveRig(), ms)
}
