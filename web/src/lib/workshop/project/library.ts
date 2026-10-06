import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

import { real } from "@/lib/workshop/project/materials"
import { prop, type Part } from "@/lib/workshop/project/types"
import { visuals } from "@/lib/workshop/visuals"

// The component library: catalog parts as real models, built from KiCad's
// 3D library by scripts/build-part-models.mjs into public/models/parts.
// Each model is in its stand-in's frame (components3d.ts: millimetres,
// z up, centred on its pins), and the manifest names its pins where its
// legs actually end, so wires3d.ts lands every wire on a real leg.
//
// Loaded per type, the first time a project needs it, and kept; a part
// whose model is missing, still loading or switched off (Visuals.realParts)
// is drawn by its primitive stand-in instead - pins and all, since the two
// are always asked the same question (hasModel).

type Vec = [number, number, number]

/** A pin on a library model (build-part-models.mjs). */
export interface LibraryPin {
  tip: Vec
  dir: Vec
  root: Vec
}

interface Entry {
  file: string
  pins: Record<string, LibraryPin>
  bounds: [[number, number, number], [number, number, number]]
}

const BASE = "/models/parts/"
const LED_COLORS: Record<string, number> = { red: 0xff2a2a, green: 0x2aff5a, yellow: 0xffd02a, white: 0xffffff, blue: 0x3a7bff, ir: 0x6a2a8a }

let manifest: Promise<Record<string, Entry> | null> | null = null
const templates = new Map<string, THREE.Group>()
let entriesNow: Record<string, Entry> | null = null
const pending = new Map<string, Promise<void>>()

function readManifest() {
  manifest ??= fetch(`${BASE}manifest.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data?.types as Record<string, Entry>) ?? null)
    .catch(() => null)
  return manifest
}

/** A KiCad colour-keyed material as one of ours (build script: materialFor). */
function realMaterial(source: THREE.MeshStandardMaterial): THREE.Material {
  const name = source.name
  if (name === "gold") return real.metal(0xd8ac52, 0.22)
  if (name.startsWith("metal")) return real.metal(0xc8ccd0, 0.3)
  return real.plastic(source.color.getHex(), 0.5)
}

function loadType(type: string, entry: Entry): Promise<void> {
  let job = pending.get(type)
  if (job) return job
  job = new GLTFLoader()
    .loadAsync(BASE + entry.file)
    .then((gltf) => {
      const group = new THREE.Group()
      const swaps = new Map<THREE.Material, THREE.Material>()
      gltf.scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        const source = mesh.material as THREE.MeshStandardMaterial
        if (!swaps.has(source)) swaps.set(source, realMaterial(source))
        const own = new THREE.Mesh(mesh.geometry, swaps.get(source)!)
        own.name = source.name
        own.castShadow = own.receiveShadow = true
        group.add(own)
      })
      templates.set(type, group)
    })
    .catch(() => {})
  pending.set(type, job)
  return job
}

/** Load the models a project's parts need (once each). Never throws: a
 *  part whose model does not load keeps its stand-in. */
export async function loadLibrary(types: Iterable<string>): Promise<void> {
  if (!visuals().realParts) return
  const entries = await readManifest()
  entriesNow = entries
  if (!entries) return
  await Promise.all([...new Set(types)].filter((t) => entries[t]).map((t) => loadType(t, entries[t])))
}

/** Whether a part is drawn from the library right now. */
function hasModel(type: string): boolean {
  return visuals().realParts && templates.has(type)
}


/** The part's pins on its library model, when it is drawn from one. */
export function libraryPins(type: string): Record<string, LibraryPin> | null {
  return hasModel(type) && entriesNow?.[type] ? entriesNow[type].pins : null
}

/** The part's library model (a fresh copy; geometry is shared), or null. */
export function libraryModel(part: Part): THREE.Group | null {
  const template = templates.get(part.type)
  if (!template || !hasModel(part.type)) return null
  const g = template.clone()
  if (part.type === "led" || part.type === "rgb_led") {
    // The body is the epoxy that lights; the legs stay tinned.
    const rgb = part.type === "rgb_led"
    const body = real.epoxy(rgb ? 0xffffff : (LED_COLORS[String(prop(part, "color", "red"))] ?? 0xff2a2a))
    g.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (mesh.isMesh && !mesh.name.startsWith("metal") && mesh.name !== "gold") mesh.material = body
    })
    g.userData.glow = rgb ? [body, body, body] : [body]
    g.userData.rgb = rgb
  }
  if (part.type === "adxl335") {
    // The GY-61's board under its parts; the header hangs below it.
    const board = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 1.6), real.pcb(0x8a1c1c))
    board.position.z = 0.8
    board.castShadow = board.receiveShadow = true
    g.add(board)
  }
  return g
}
