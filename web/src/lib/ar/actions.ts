import * as THREE from "three"

import { type Anchor, type Cue, type Project, type WearAction } from "@/lib/workshop/project/types"

// What a worn project does in the try-on. Jarvis says so in the project's
// wear.actions; a project from before that (or one he left it off) gets
// them read from what it is - a repulsor fires from its palm emitter, an
// arc reactor glows and throws a unibeam, a launcher shoots - so the try-on
// always has something to show.

const deg = THREE.MathUtils.degToRad

/** A cue for "auto": the natural gesture where it is worn. */
export function resolveCue(cue: Cue, anchor: Anchor): Cue {
  if (cue !== "auto") return cue
  if (anchor === "face") return "jaw"
  if (anchor === "hand" || anchor === "wrist" || anchor === "forearm") return "palm"
  if (anchor === "desk") return "button"
  return "raise"
}

/** A placed part or printed part whose name, label or id matches. */
function findPlaced(project: Project, pattern: RegExp) {
  const named = [
    ...project.parts.map((p) => ({ key: p.id, text: `${p.id} ${p.label ?? ""}` })),
    ...project.printed.map((p) => ({ key: p.name, text: p.name })),
  ]
  for (const { key, text } of named) {
    const spot = project.layout[key]
    if (spot && pattern.test(text)) {
      // A part's own +z is where it faces (an LED's dome, a disc's face).
      const dir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(deg(spot.rot[0] ?? 0), deg(spot.rot[1] ?? 0), deg(spot.rot[2] ?? 0)))
      return { at: spot.pos.slice(0, 3), dir: dir.toArray().map((v) => +v.toFixed(3)) }
    }
  }
  return null
}

const PALM: Partial<Record<Anchor, number[]>> = { hand: [0, 0, -20], wrist: [60, 0, -20], forearm: [150, 0, -20] }

function ledColor(project: Project): string | undefined {
  const led = project.parts.find((p) => p.type === "led" && p.props?.color)
  const map: Record<string, string> = { red: "#ff3020", green: "#40ff70", blue: "#3a8bff", white: "#dff4ff", yellow: "#ffd040" }
  return led ? map[String(led.props.color)] : undefined
}

export function resolveActions(project: Project, anchor: Anchor): WearAction[] {
  const given = project.wear?.actions
  if (given?.length) return given
  const text = `${project.name} ${project.goal}`.toLowerCase()
  const out: WearAction[] = []
  const front = anchor === "hand" || anchor === "wrist" || anchor === "forearm" ? [0, 0, -1] : [0, -1, 0]

  if (/repulsor/.test(text)) {
    const spot = findPlaced(project, /repulsor|palm|emitter/i)
    out.push({ name: "Repulsor", kind: "repulsor", cue: "auto", at: spot?.at ?? PALM[anchor] ?? [0, -20, 0], dir: spot?.dir ?? front, color: "#bfe6ff" })
  }
  if (/arc reactor|reactor|unibeam/.test(text)) {
    const spot = findPlaced(project, /reactor|core|ring/i)
    const at = spot?.at ?? [0, -10, 0]
    out.push({ name: "Reactor", kind: "glow", cue: "auto", at, dir: [0, -1, 0], color: "#9fdcff" })
    out.push({ name: "Unibeam", kind: "beam", cue: "auto", at, dir: [0, -1, 0], color: "#cfeeff", charge: 0.5 })
  }
  if (/web.?shoot|\bweb\b/.test(text)) {
    const spot = findPlaced(project, /nozzle|shooter|launcher/i)
    out.push({ name: "Web", kind: "projectile", cue: anchor === "desk" ? "button" : "thwip", at: spot?.at ?? [70, 0, -15], dir: [1, 0, -0.35], color: "#f4f4f0" })
  }
  if (/missile|rocket|launcher|cannon|gatling|\bgun\b/.test(text) && !out.some((a) => a.kind === "projectile")) {
    const spot = findPlaced(project, /barrel|launcher|tube|muzzle|cannon/i)
    const minigun = /gatling|minigun|cannon|\bgun\b/.test(text)
    out.push({ name: minigun ? "Fire" : "Launch", kind: "projectile", cue: "auto", at: spot?.at ?? [0, -40, 30], dir: spot?.dir ?? front, color: "#ffb347", burst: minigun ? 12 : 1, charge: minigun ? 0.06 : 0.6 })
  }
  if (!out.length) {
    const lit = project.parts.find((p) => (p.type === "led" || p.type === "rgb_led") && project.layout[p.id])
    if (lit) out.push({ name: "Power", kind: "glow", cue: "auto", at: project.layout[lit.id].pos.slice(0, 3), dir: front, color: ledColor(project) ?? "#9fdcff" })
  }
  return out
}
