import library from "@/lib/workshop/parts.json"

// A workshop project, as app/tools/workshop_project.py saves it: parts from
// the shared library (parts.json), wires between their pins, the UNO
// sketch and its compiled HEX, printed OpenSCAD parts, and where each
// thing sits in 3D (millimetres, z up - the same frame as OpenSCAD).

export interface PartSpec {
  label: string
  kind: "mcu" | "passive" | "input" | "output" | "driver" | "sensor" | "power" | "mech"
  catalog?: string
  pins?: Record<string, string>
  props?: Record<string, unknown>
  size?: number[]
  approx?: boolean
  note?: string
  [key: string]: unknown
}

export const PARTS = library.types as unknown as Record<string, PartSpec>

export interface Part {
  id: string
  type: string
  props: Record<string, unknown>
  label?: string
  catalog?: string
  /** Sub-assembly it belongs to ("Chassis", "Arm"...). */
  group?: string
}

export interface Wire {
  a: string
  b: string
  color?: string
}

/** What a printed part is printed in, for how it renders. */
export const FILAMENTS = ["pla", "silk", "petg", "matte", "resin", "carbon", "metal", "clear", "marble", "wood", "glitter", "dual_silk", "glow", "thermo", "uv"] as const
export const TEXTURES = ["layers", "fuzzy", "smooth"] as const
export type Filament = (typeof FILAMENTS)[number]

export interface PrintedPart {
  name: string
  code: string
  notes: string[]
  group?: string
  material?: Filament
  /** CSS colour of the filament or finish. */
  color?: string
  /** The second colour: marble veins, a dual silk's other face, what a
   *  thermochromic turns, the glow or fluorescence. */
  color2?: string
  /** As printed (layer lines), fuzzy skin, or sanded/ironed smooth. */
  texture?: (typeof TEXTURES)[number]
}

export interface Placement {
  pos: number[]
  rot: number[]
}

export const ANCHORS = ["face", "chest", "shoulder", "upper_arm", "forearm", "wrist", "hand", "desk"] as const
export type Anchor = (typeof ANCHORS)[number]
/** Anchors found by the body-pose model rather than the face or hands. */
export const BODY_ANCHORS: readonly Anchor[] = ["chest", "shoulder", "upper_arm"]

export const ACTION_KINDS = ["repulsor", "beam", "projectile", "deploy", "glow"] as const
export type ActionKind = (typeof ACTION_KINDS)[number]
export const CUES = ["auto", "palm", "fist", "point", "thwip", "jaw", "raise", "button"] as const
export type Cue = (typeof CUES)[number]

/** Something a worn project does, simulated in the try-on
 *  (app/tools/workshop_project.py ACTION_GUIDE). Points and directions are
 *  in the design frame (mm), like the layout. */
export interface WearAction {
  name: string
  kind: ActionKind
  cue: Cue
  /** Emitter, launcher or pivot. */
  at: number[]
  dir: number[]
  color?: string
  /** deploy: part ids, printed part names or groups that move. */
  targets?: string[]
  move?: number[]
  turn?: number[]
  /** Seconds to charge (repulsor, beam) or between shots (projectile). */
  charge?: number
  /** projectile: shots per trigger. */
  burst?: number
  /** The segment it rides on (default: the one whose parts are at `at`). */
  segment?: string
}

/**
 * A rigid piece of the build that moves on its own (app/tools/workshop_project.py
 * SEGMENT_GUIDE): a gauntlet's hand plate hinged at the wrist, or the
 * controller moved off the build onto a mount elsewhere on the body. Its
 * members are part ids, printed part names or groups; the wires to them
 * follow wherever it goes. Millimetres and degrees, in the design frame.
 */
export interface Segment {
  name: string
  members: string[]
  /** The segment it hangs from (a finger from the hand); else the build. */
  parent?: string
  /** The joint it turns about. */
  pivot?: number[]
  /** Where it has been moved to, from where the layout puts its members. */
  move?: number[]
  /** How far the joint is turned (x, y, z degrees), shown on the stage. */
  pose?: number[]
  /** The joint's range per axis, [[min, max] x3] degrees. */
  limits?: number[][]
  /** Try-on: the body point it follows on its own (the hand, while the
   *  bracer stays on the wrist). Without one it rides with its parent. */
  anchor?: Anchor
  /** The design point that sits on that anchor (default: where the
   *  anchor is at rest relative to the main one, along the arm). */
  at?: number[]
}

/** How the camera try-on wears it (app/tools/workshop_project.py WEAR_GUIDE). */
export interface Wear {
  anchor: Anchor
  group?: string
  offset: number[]
  rot: number[]
  scale?: number
  actions?: WearAction[]
}

export interface Project {
  id: string | null
  name: string
  goal: string
  status: ProjectStatus
  notes: string
  parts: Part[]
  wires: Wire[]
  code: string
  printed: PrintedPart[]
  layout: Record<string, Placement>
  extras: { item: string; qty: number }[]
  wear?: Wear | null
  segments?: Segment[]
  hex: string | null
  compiled_code: string | null
}

export const STATUSES = ["idea", "design", "simulate", "build", "complete"] as const
export type ProjectStatus = (typeof STATUSES)[number]

/** A project as the gallery lists it: enough for its card and hologram. */
export interface GalleryProject {
  id: string
  name: string
  goal: string
  status: ProjectStatus
  parts: Part[]
  printed: PrintedPart[]
  layout: Record<string, Placement>
  segments?: Segment[]
  wires: number
  compiled: boolean
  estimated_total: number
  errors: number
  groups: string[]
  updated_at: string
}

export interface Check {
  level: "error" | "warning" | "note"
  part: string
  text: string
}

export interface BomLine {
  item: string
  for: string[]
  need: number
  buy: number
  unit: string
  price: number
  cost: number
  where: string
  part_number: string
}

export interface Report {
  checks: Check[]
  bom: { lines: BomLine[]; subtotal: number; estimated_total: number; not_stocked: string[] }
  dropped: string[]
  compile: {
    ok: boolean
    error?: string
    unavailable?: boolean
    cached?: boolean
    flash_bytes?: number | null
    ram_bytes?: number | null
    warnings?: string[]
  }
}

export interface ProjectSummary {
  id: string
  name: string
  parts: number
  updated_at: string
}

export function emptyProject(name = "Untitled project"): Project {
  return {
    id: null,
    name,
    goal: "",
    status: "idea",
    notes: "",
    parts: [],
    wires: [],
    code: "",
    printed: [],
    layout: {},
    extras: [],
    hex: null,
    compiled_code: null,
  }
}

export function specOf(part: Part): PartSpec | undefined {
  return PARTS[part.type]
}

export function prop<T>(part: Part, key: string, fallback: T): T {
  const value = part.props?.[key] ?? specOf(part)?.props?.[key]
  return (value ?? fallback) as T
}
