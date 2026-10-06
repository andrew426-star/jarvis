import * as THREE from "three"
import { STLLoader } from "three/addons/loaders/STLLoader.js"
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js"

import type { CalloutData } from "@/lib/workshop/callouts"
import type { BuiltItem } from "@/lib/workshop/models"
import { componentModel } from "@/lib/workshop/project/components3d"
import { loadGenuine } from "@/lib/workshop/project/genuine"
import { loadLibrary } from "@/lib/workshop/project/library"
import { filament } from "@/lib/workshop/project/materials"
import { buildAxes } from "@/lib/workshop/project/axes3d"
import { Rig, rigOf } from "@/lib/workshop/project/rig"
import { Cabling } from "@/lib/workshop/project/wires3d"
import { PARTS, type Part, type Project } from "@/lib/workshop/project/types"
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

/** The project in its own design frame: millimetres, z up, the origin
 *  where its layout and SCAD put it. `placedOnly` leaves out components
 *  with no layout position (the camera try-on, where a part lined up in
 *  front of the origin would float in mid-air). */
export async function buildDesign(
  project: Project,
  compile: (code: string) => Promise<Uint8Array>,
  { placedOnly = false }: { placedOnly?: boolean } = {}
): Promise<{ zUp: THREE.Group; bindings: Bindings; rig: Rig; failures: { name: string; error: string }[] }> {
  const zUp = new THREE.Group()
  // The design frame (mm, z up): what the fit check measures in.
  zUp.userData.designFrame = true
  // The pieces that move on their own (rig.ts): each part goes into its
  // segment's group, the rest straight into the design frame.
  const rig = new Rig(zUp, rigOf(project), project.wear?.anchor ?? null)
  const bindings: Bindings = { glow: new Map(), horn: new Map(), spin: new Map() }
  const failures: { name: string; error: string }[] = []

  // Unplaced parts in a row along x, in front of the origin, biggest first.
  const unplaced = project.parts.filter((p) => !project.layout[p.id])
  unplaced.sort((a, b) => ((PARTS[b.type]?.size?.[0] as number) ?? 10) - ((PARTS[a.type]?.size?.[0] as number) ?? 10))
  const rowWidth = unplaced.reduce((sum, p) => sum + Math.min(200, Number(PARTS[p.type]?.size?.[0] ?? 10)) + 12, 0)
  let cursor = -rowWidth / 2

  // The genuine UNO model, the first time a project has one.
  if (project.parts.some((p) => p.type === "uno")) await loadGenuine()
  // Real models for the rest, from the component library (library.ts).
  await loadLibrary(project.parts.map((p) => p.type))
  const placed = new Map<string, THREE.Object3D>()
  for (const part of project.parts) {
    if (placedOnly && !project.layout[part.id]) continue
    const model = componentModel(part)
    placed.set(part.id, model)
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
    model.userData.group = part.group
    model.userData.callout = componentCallout(part)
    rig.container(part.id, part.group).add(model)
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
  // What the cables must go around besides the components.
  const solids: THREE.Object3D[] = []
  for (const printed of project.printed) {
    try {
      const stl = await compile(printed.code)
      // An STL is flat facets: smooth across curves, sharp at real edges.
      const geometry = toCreasedNormals(loader.parse(stl.slice().buffer), deg(32))
      const mesh = new THREE.Mesh(geometry, filament(printed.material, printed.color, { color2: printed.color2, texture: printed.texture }))
      mesh.castShadow = mesh.receiveShadow = true
      // Marks it printable for the scene: feature-edge hologram, and STL
      // export of the compiler's own file.
      mesh.userData.printPart = slug(printed.name)
      mesh.userData.printedName = printed.name
      mesh.userData.callout = {
        id: printed.name,
        title: printed.name,
        spec: [String(printed.material ?? "pla").toUpperCase(), printed.notes?.[0]].filter(Boolean).join(" · "),
        printed: true,
      } satisfies CalloutData
      mesh.userData.group = printed.group
      mesh.userData.stl = stl
      mesh.userData.scad = printed.code
      const spot = project.layout[printed.name]
      if (spot) place(mesh, spot.pos, spot.rot)
      solids.push(mesh)
      rig.container(printed.name, printed.group).add(mesh)
    } catch (err) {
      failures.push({ name: printed.name, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // Segments where the editor last left them, then the wiring, as real
  // cables between the real pins, routed from there (and re-routed
  // whenever a segment moves).
  rig.measure()
  rig.apply(rig.segments, false)
  if (project.wires.length) {
    rig.cabling = new Cabling(project.parts, project.wires, placed, zUp, solids)
    zUp.add(rig.cabling.group)
  }

  return { zUp, bindings, rig, failures }
}

/** Build the assembly; printed parts are compiled by `compile` (the
 *  workshop's OpenSCAD worker). Failures come back to report, not throw.
 *  `bind` makes it the one the simulation animates (the stage's); the
 *  gallery and the folder's viewer build theirs unbound. */
export async function buildAssembly(
  project: Project,
  compile: (code: string) => Promise<Uint8Array>,
  { bind = true }: { bind?: boolean } = {}
): Promise<{ item: BuiltItem; rig: Rig; failures: { name: string; error: string }[] }> {
  const { zUp, bindings, rig, failures } = await buildDesign(project, compile)
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
  // The design frame's axes, sized to the build (left out of its bounds).
  if (bind) zUp.add(buildAxes(Math.max(size.x, size.y, size.z) * 0.6))

  const g = new THREE.Group()
  g.add(turned)
  g.scale.setScalar(MM * fit)
  g.position.y = 0.02
  if (bind) current = bindings

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
    rig,
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

/** What a component's callout says: what it is, its id and its value. */
function componentCallout(part: Part): CalloutData {
  const spec = PARTS[part.type]
  const ohms = Number(part.props?.ohms)
  const value =
    part.type === "resistor" && ohms
      ? ohms >= 1000
        ? `${ohms / 1000} kΩ`
        : `${ohms} Ω`
      : part.props?.color
        ? `${String(part.props.color)}`
        : spec?.kind ?? ""
  return { id: part.id, title: part.label || spec?.label || part.type, spec: [part.id, value].filter(Boolean).join(" · ") }
}
