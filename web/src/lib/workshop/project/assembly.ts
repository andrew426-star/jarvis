import * as THREE from "three"
import { STLLoader } from "three/addons/loaders/STLLoader.js"

import type { BuiltItem } from "@/lib/workshop/models"
import { componentModel } from "@/lib/workshop/project/components3d"
import { PARTS, type Project } from "@/lib/workshop/project/types"
import type { SimSnapshot } from "@/lib/workshop/sim/runner"

// A project as one item on the workshop stage: every component at its
// real size and every printed part, placed by the project's layout
// (millimetres, z up, the OpenSCAD frame) - so a mount can be checked
// against what it holds before it is printed. Parts with no placement
// line up in front. While the simulation runs, LEDs light and servo
// horns, motor shafts and steppers turn (animate below).

/** One workshop unit is 100 mm. */
const MM = 0.01
/** Largest the assembly is drawn, in workshop units, before it is scaled
 *  down to fit the stage (the spec line says so). */
const MAX_UNITS = 3.2

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "part"

export interface Bindings {
  glow: Map<string, { materials: THREE.MeshStandardMaterial[]; rgb: boolean; base: THREE.Color }>
  horn: Map<string, THREE.Object3D>
  spin: Map<string, THREE.Object3D>
}

let current: Bindings | null = null

const deg = THREE.MathUtils.degToRad

function place(object: THREE.Object3D, pos: number[], rot: number[]) {
  object.position.set(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0)
  object.rotation.set(deg(rot[0] ?? 0), deg(rot[1] ?? 0), deg(rot[2] ?? 0))
}

export function assemblyName(project: Project) {
  return `${project.name} (assembly)`
}

/** Build the assembly; printed parts are compiled by `compile` (the
 *  workshop's OpenSCAD worker). Failures come back to report, not throw. */
export async function buildAssembly(
  project: Project,
  compile: (code: string) => Promise<Uint8Array>
): Promise<{ item: BuiltItem; failures: { name: string; error: string }[] }> {
  const zUp = new THREE.Group()
  const bindings: Bindings = { glow: new Map(), horn: new Map(), spin: new Map() }
  const failures: { name: string; error: string }[] = []

  // Unplaced parts in a row along x, in front of the origin, biggest first.
  const unplaced = project.parts.filter((p) => !project.layout[p.id])
  unplaced.sort((a, b) => ((PARTS[b.type]?.size?.[0] as number) ?? 10) - ((PARTS[a.type]?.size?.[0] as number) ?? 10))
  const rowWidth = unplaced.reduce((sum, p) => sum + Math.min(200, Number(PARTS[p.type]?.size?.[0] ?? 10)) + 12, 0)
  let cursor = -rowWidth / 2

  for (const part of project.parts) {
    const model = componentModel(part)
    const spot = project.layout[part.id]
    if (spot) place(model, spot.pos, spot.rot)
    else {
      const [width = 10, depth = 10] = (PARTS[part.type]?.size as number[] | undefined) ?? []
      const w = Math.min(200, width)
      // Long stock (extrusion, rod) lies along x; keep it from dwarfing the row.
      model.position.set(cursor + w / 2, -90 - depth / 2, 0)
      if (width > 200) model.position.x = cursor + w / 2
      cursor += w + 12
    }
    zUp.add(model)
    if (model.userData.glow) {
      const materials = model.userData.glow as THREE.MeshStandardMaterial[]
      bindings.glow.set(part.id, { materials, rgb: !!model.userData.rgb, base: materials[0].color.clone() })
    }
    const horn = model.getObjectByName("horn")
    if (horn) bindings.horn.set(part.id, horn)
    const spin = model.getObjectByName("spin")
    if (spin) bindings.spin.set(part.id, spin)
  }

  const loader = new STLLoader()
  for (const printed of project.printed) {
    try {
      const stl = await compile(printed.code)
      const geometry = loader.parse(stl.slice().buffer)
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0x4a5563, roughness: 0.62, metalness: 0.08, flatShading: true })
      )
      mesh.castShadow = mesh.receiveShadow = true
      // Marks it printable for the scene: feature-edge hologram, and STL
      // export of the compiler's own file.
      mesh.userData.printPart = slug(printed.name)
      mesh.userData.stl = stl
      mesh.userData.scad = printed.code
      const spot = project.layout[printed.name]
      if (spot) place(mesh, spot.pos, spot.rot)
      zUp.add(mesh)
    } catch (err) {
      failures.push({ name: printed.name, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // OpenSCAD's z up into the workshop's y up, sat on the floor and centred.
  zUp.rotation.x = -Math.PI / 2
  const turned = new THREE.Group()
  turned.add(zUp)
  turned.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(turned)
  const size = bounds.getSize(new THREE.Vector3())
  const centre = bounds.getCenter(new THREE.Vector3())
  turned.position.set(-centre.x, -bounds.min.y, -centre.z)
  const largest = Math.max(size.x, size.y, size.z, 1) * MM
  const fit = Math.min(1, MAX_UNITS / largest)

  const g = new THREE.Group()
  g.add(turned)
  g.scale.setScalar(MM * fit)
  g.position.y = 0.02
  current = bindings

  const errors = failures.length ? [`${failures.length} PRINTED PART(S) FAILED`] : []
  return {
    item: {
      object: g,
      spec: {
        key: "project",
        name: assemblyName(project),
        designation: `PROJECT · ${project.parts.length} PARTS · ${project.printed.length} PRINTED · ${size.x.toFixed(0)}×${size.z.toFixed(0)}×${size.y.toFixed(0)} MM${fit < 1 ? ` · SHOWN 1:${(1 / fit).toFixed(1)}` : ""}`,
        lines: [
          ...errors,
          project.goal ? project.goal.slice(0, 58) : "REAL SIZE, OPENSCAD FRAME (Z UP)",
          project.hex ? "SKETCH COMPILED · READY TO SIMULATE" : "NO COMPILED SKETCH",
        ].slice(0, 4),
      },
    },
    failures,
  }
}

/** Drop the bindings when the assembly leaves the stage. */
export function releaseAssembly() {
  current = null
}

/** Show the simulation on the assembly: LEDs, horns, shafts. `dt` is the
 *  real time since the last call, for continuous rotation. */
export function animate(snapshot: SimSnapshot | null, dt: number) {
  const b = current
  if (!b) return
  const states = new Map((snapshot?.parts ?? []).map((p) => [p.id, p]))
  for (const [id, glow] of b.glow) {
    const levels = states.get(id)?.glow ?? [0]
    if (glow.rgb) {
      const [r = 0, gr = 0, bl = 0] = levels
      const mixed = new THREE.Color(r, gr, bl)
      const level = Math.max(r, gr, bl)
      for (const m of glow.materials) {
        m.emissive.copy(mixed)
        m.emissiveIntensity = level * 3
        m.color.copy(level > 0.02 ? mixed : glow.base)
      }
    } else {
      for (const m of glow.materials) m.emissiveIntensity = (levels[0] ?? 0) * 3
    }
  }
  for (const [id, horn] of b.horn) {
    const s = states.get(id)
    if (!s) continue
    if (s.angle !== undefined) horn.rotation.z = deg(s.angle - 90)
    else if (s.rpm) horn.rotation.z += (s.rpm / 60) * Math.PI * 2 * dt
  }
  for (const [id, spin] of b.spin) {
    const s = states.get(id)
    if (!s) continue
    if (s.type === "stepper" && s.angle !== undefined) spin.rotation.z = -deg(s.angle)
    else if (s.rpm) spin.rotation.z += (s.rpm / 60) * Math.PI * 2 * dt
  }
}
