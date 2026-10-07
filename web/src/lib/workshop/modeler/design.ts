import * as THREE from "three"
import { ConvexHull } from "three/addons/math/ConvexHull.js"

import type { Filament, PrintedPart, TEXTURES } from "@/lib/workshop/project/types"

// The workshop's modeler: a design built by hand from pieces - panels,
// blocks, rods, tubes, wedges and shapes captured from objects on the
// stage - each stretched, turned and placed in millimetres (z up, the
// OpenSCAD and layout frame). Pieces belong to parts, and a part is one
// material: everything in a part fuses into one print, so a design can be
// a PETG shell with a clear lid and a carbon-fill bracket, each its own
// printed part. A piece can also cut (a socket, a
// slot, a window) or stand in as a ghost (the object a case is built
// round: shown, never printed). Stretch zones lengthen the whole design
// at a plane without distorting its ends.
//
// Everything here becomes OpenSCAD (one program per part), compiled by
// the workshop's worker, so what the stage shows is what prints.

export type PieceKind = "panel" | "block" | "rod" | "tube" | "wedge" | "object"
export type PieceOp = "add" | "cut" | "ghost"
export type Vec3 = [number, number, number]

/** A shape captured from a stage object: millimetres, z up, centred on
 *  its footprint with its floor on z = 0. Faces wind as OpenSCAD wants
 *  them (clockwise seen from outside). */
export interface CapturedMesh {
  source: string
  points: number[][]
  faces: number[][]
  size: Vec3
}

export interface Piece {
  id: string
  name: string
  kind: PieceKind
  /** The part it fuses into (add), the part it cuts ("*" for every part). */
  part: string
  op: PieceOp
  /** mm. panel: width, height, thickness · block, wedge: x, y, z ·
   *  rod: diameter, -, length · tube: outer diameter, wall, length ·
   *  object: unused (its captured size). */
  size: Vec3
  /** Scale on each axis after sizing, 1 = as sized. */
  stretch: Vec3
  pos: Vec3
  /** Degrees, applied x then y then z (OpenSCAD's rotate). */
  rot: Vec3
  /** Mirrored across the design's YZ plane (x to -x). */
  mirror?: boolean
  /** panel and block: corner radius, mm. */
  radius?: number
  /** panel: bent about its height axis by this many degrees (0 flat). */
  curve?: number
  /** panel: a grid of round holes through it (vents, a mounting pattern). */
  holes?: { d: number; pitch: number; margin: number } | null
  /** object: its exact (thinned) surface, or the convex wrap of it. */
  form?: "mesh" | "hull"
  mesh?: CapturedMesh
  hidden?: boolean
}

export interface DesignPart {
  id: string
  name: string
  material: Filament
  color: string
  color2?: string
  texture: (typeof TEXTURES)[number]
}

/** Lengthen (or shorten) the design at a plane: everything past it moves
 *  out by `by` and the cross-section at the plane fills the gap. */
export interface StretchZone {
  id: string
  axis: 0 | 1 | 2
  at: number
  by: number
}

export interface Design {
  id: string
  name: string
  parts: DesignPart[]
  pieces: Piece[]
  zones: StretchZone[]
}

export const KIND_LABEL: Record<PieceKind, string> = {
  panel: "PANEL",
  block: "BLOCK",
  rod: "ROD",
  tube: "TUBE",
  wedge: "WEDGE",
  object: "FROM OBJECT",
}

/** What each size field means, by kind (null: not used). */
export const SIZE_LABELS: Record<PieceKind, [string | null, string | null, string | null]> = {
  panel: ["WIDTH", "HEIGHT", "THICK"],
  block: ["X", "Y", "Z"],
  rod: ["DIA", null, "LENGTH"],
  tube: ["DIA", "WALL", "LENGTH"],
  wedge: ["X", "Y", "Z"],
  object: [null, null, null],
}

/** The most stretch zones a design takes: each one triples the work a
 *  compile does on everything inside it. */
export const MAX_ZONES = 4

export const uid = () => Math.random().toString(36).slice(2, 10)

export function newPart(index: number, material: Filament = "pla"): DesignPart {
  const colors = ["#5a6a7a", "#d4a23c", "#1d1f23", "#b4bac2", "#8e1414", "#dfefff"]
  return { id: uid(), name: `Part ${index + 1}`, material, color: colors[index % colors.length], texture: "layers" }
}

export function newDesign(name = "Untitled design"): Design {
  return { id: uid(), name, parts: [newPart(0, "petg")], pieces: [], zones: [] }
}

const DEFAULT_SIZE: Record<Exclude<PieceKind, "object">, Vec3> = {
  panel: [80, 50, 3],
  block: [40, 30, 20],
  rod: [10, 10, 60],
  tube: [24, 2.4, 50],
  wedge: [40, 30, 20],
}

export function newPiece(kind: Exclude<PieceKind, "object">, part: string, count: number): Piece {
  return {
    id: uid(),
    name: `${KIND_LABEL[kind][0]}${KIND_LABEL[kind].slice(1).toLowerCase()} ${count + 1}`,
    kind,
    part,
    op: "add",
    size: [...DEFAULT_SIZE[kind]],
    stretch: [1, 1, 1],
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    radius: kind === "panel" ? 2 : 0,
    curve: 0,
    holes: null,
  }
}

// --- OpenSCAD ------------------------------------------------------------------

const f = (n: number) => {
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? "0" : String(r)
}
const v = (a: number[]) => `[${a.map(f).join(", ")}]`

/** Helpers every generated part includes. */
const HELPERS = `$fn = 48;
module _rr(w, h, r) {
  if (r > 0) offset(r) square([max(0.01, w - 2 * r), max(0.01, h - 2 * r)], center = true);
  else square([w, h], center = true);
}
module _panel(w, h, t, r, holes) {
  difference() {
    linear_extrude(t) _rr(w, h, r);
    for (p = holes) translate([p[0], p[1], -1]) cylinder(d = p[2], h = t + 2, $fn = 24);
  }
}
// A panel bent about its height (y) axis: its middle on z = 0, the edges
// curving down; the width is measured along the inside face.
module _bent(w, h, t, deg) {
  R = w / (deg * PI / 180);
  translate([0, 0, -R]) rotate([0, -90, 0]) rotate([-90, 0, 0]) rotate([0, 0, -deg / 2])
    rotate_extrude(angle = deg, $fn = 96) translate([R, -h / 2]) square([t, h]);
}
// Rounded on every edge: three rounded outlines, one per view, overlapped
// (no hull(), whose CGAL step can trip on near-flat point sets).
module _block(s, r) {
  if (r > 0) intersection() {
    linear_extrude(s[2]) _rr(s[0], s[1], r);
    translate([0, s[1] / 2, s[2] / 2]) rotate([90, 0, 0]) linear_extrude(s[1]) _rr(s[0], s[2], r);
    translate([-s[0] / 2, 0, s[2] / 2]) rotate([90, 0, 90]) linear_extrude(s[0]) _rr(s[1], s[2], r);
  }
  else translate([-s[0] / 2, -s[1] / 2, 0]) cube(s);
}
module _wedge(s) {
  rotate([90, 0, 0]) linear_extrude(s[1], center = true) polygon([[-s[0] / 2, 0], [s[0] / 2, 0], [-s[0] / 2, s[2]]]);
}
// Stretch at a plane across an axis: below it stays, past it moves out by
// \`by\`, and the cross-section at the plane fills the gap (by < 0 takes a
// slab out instead).
module _stretch(axis, at, by, B = 4000) {
  r = axis == 0 ? [0, -90, 0] : axis == 1 ? [90, 0, 0] : [0, 0, 0];
  hi = by < 0 ? at - by : at;
  rotate(-r) {
    intersection() { rotate(r) children(); translate([-B, -B, -B]) cube([2 * B, 2 * B, B + at]); }
    translate([0, 0, by]) intersection() { rotate(r) children(); translate([-B, -B, hi]) cube([2 * B, 2 * B, B]); }
    if (by > 0) translate([0, 0, at]) linear_extrude(by) projection(cut = true) translate([0, 0, -at]) rotate(r) children();
  }
}
`

/** Hole centres for a panel's grid, inside its margin. */
function holeGrid(w: number, h: number, holes: NonNullable<Piece["holes"]>): number[][] {
  const pitch = Math.max(holes.d + 0.8, holes.pitch)
  const span = (len: number) => {
    const room = len - 2 * holes.margin - holes.d
    if (room < 0) return []
    const n = Math.floor(room / pitch) + 1
    const start = -((n - 1) * pitch) / 2
    return Array.from({ length: n }, (_, i) => start + i * pitch)
  }
  const out: number[][] = []
  for (const x of span(w)) for (const y of span(h)) out.push([x, y, holes.d])
  return out.slice(0, 400)
}

/** The piece's shape at its own origin (footprint centred, floor z = 0). */
function shape(p: Piece): string {
  const [a, b, c] = p.size
  switch (p.kind) {
    case "panel": {
      const curve = p.curve ?? 0
      if (Math.abs(curve) >= 1) return `_bent(${f(a)}, ${f(b)}, ${f(c)}, ${f(Math.min(350, Math.abs(curve)))});`
      const holes = p.holes ? holeGrid(a, b, p.holes).map(v).join(", ") : ""
      return `_panel(${f(a)}, ${f(b)}, ${f(c)}, ${f(Math.max(0, Math.min(p.radius ?? 0, a / 2 - 0.01, b / 2 - 0.01)))}, [${holes}]);`
    }
    case "block":
      return `_block(${v([a, b, c])}, ${f(Math.max(0, Math.min(p.radius ?? 0, a / 2, b / 2, c / 2) - 0.01))});`
    case "rod":
      return `cylinder(d = ${f(a)}, h = ${f(c)});`
    case "tube":
      return `difference() { cylinder(d = ${f(a)}, h = ${f(c)}); translate([0, 0, -1]) cylinder(d = ${f(Math.max(0.2, a - 2 * b))}, h = ${f(c + 2)}); }`
    case "wedge":
      return `_wedge(${v([a, b, c])});`
    case "object": {
      const m = p.mesh
      if (!m) return ""
      const shape = p.form === "mesh" ? m : wrapOf(m)
      return `polyhedron(points = ${points(shape.points)}, faces = ${faces(shape.faces)});`
    }
  }
}

// The convex wrap of a captured shape, worked out here rather than by
// OpenSCAD's hull() (CGAL's, which asserts on some thinned meshes), and
// remembered per shape.
const wraps = new WeakMap<CapturedMesh, { points: number[][]; faces: number[][] }>()
function wrapOf(mesh: CapturedMesh) {
  let wrap = wraps.get(mesh)
  if (wrap) return wrap
  const hull = new ConvexHull().setFromPoints(mesh.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
  const index = new Map<THREE.Vector3, number>()
  const pts: number[][] = []
  const out: number[][] = []
  for (const face of hull.faces) {
    const loop: number[] = []
    let edge = face.edge
    do {
      const point = edge.head().point
      let i = index.get(point)
      if (i === undefined) {
        i = pts.length
        index.set(point, i)
        pts.push([point.x, point.y, point.z])
      }
      loop.push(i)
      edge = edge.next
    } while (edge !== face.edge)
    // Counter-clockwise from outside; OpenSCAD wants clockwise.
    out.push(loop.reverse())
  }
  wrap = { points: pts, faces: out }
  wraps.set(mesh, wrap)
  return wrap
}

const points = (pts: number[][]) => `[${pts.map((p) => `[${p.map((x) => f(x)).join(",")}]`).join(",")}]`
const faces = (fs: number[][]) => `[${fs.map((t) => `[${t.join(",")}]`).join(",")}]`

/** The piece placed: stretched, turned, moved, maybe mirrored. */
function placed(p: Piece): string {
  const s = shape(p)
  if (!s) return ""
  const stretched = p.stretch.every((k) => k === 1) ? s : `scale(${v(p.stretch)}) ${s}`
  const turned = p.rot.every((k) => k === 0) ? stretched : `rotate(${v(p.rot)}) ${stretched}`
  const moved = p.pos.every((k) => k === 0) ? turned : `translate(${v(p.pos)}) ${turned}`
  return `${p.mirror ? "mirror([1, 0, 0]) " : ""}${moved} // ${p.name.replace(/\n/g, " ")}`
}

/** Wrap a body in the design's stretch zones. */
function zoned(design: Design, body: string): string {
  const zones = design.zones.filter((z) => z.by !== 0).slice(0, MAX_ZONES)
  if (!zones.length) return body
  return `${zones.map((z) => `_stretch(${z.axis}, ${f(z.at)}, ${f(z.by)})`).join(" ")}\n${body}`
}

/** One part's OpenSCAD: its pieces fused, less every cut that reaches it.
 *  Null when it has nothing to print. */
export function partCode(design: Design, part: DesignPart): string | null {
  const live = design.pieces.filter((p) => !p.hidden)
  const adds = live.filter((p) => p.op === "add" && p.part === part.id).map(placed).filter(Boolean)
  if (!adds.length) return null
  const cuts = live.filter((p) => p.op === "cut" && (p.part === "*" || p.part === part.id)).map(placed).filter(Boolean)
  const indent = (lines: string[]) => lines.map((l) => `    ${l}`).join("\n")
  const body = cuts.length
    ? `difference() {\n  union() {\n${indent(adds)}\n  }\n  union() {\n${indent(cuts)}\n  }\n}`
    : `union() {\n${indent(adds)}\n}`
  return `// ${design.name} · ${part.name} (${part.material}) - workshop modeler
${HELPERS}
${zoned(design, body)}
`
}

/** The ghosts (what the design is built round), for the stage only. */
export function ghostCode(design: Design): string | null {
  const ghosts = design.pieces.filter((p) => !p.hidden && p.op === "ghost").map(placed).filter(Boolean)
  if (!ghosts.length) return null
  return `${HELPERS}\n${zoned(design, `union() {\n${ghosts.join("\n")}\n}`)}\n`
}

/** A printed part's name in a project: the design's and the part's. */
export const printedName = (design: Design, part: DesignPart) => `${design.name} · ${part.name}`.slice(0, 80)

/** The design's parts as a project's printed parts (those with anything
 *  in them), each placed at the design's origin. */
export function toPrinted(design: Design): PrintedPart[] {
  const out: PrintedPart[] = []
  for (const part of design.parts) {
    const code = partCode(design, part)
    if (!code) continue
    const pieces = design.pieces.filter((p) => p.op === "add" && p.part === part.id && !p.hidden)
    out.push({
      name: printedName(design, part),
      code,
      notes: [`Modeled: ${pieces.length} piece${pieces.length === 1 ? "" : "s"}`, ...new Set(pieces.map((p) => KIND_LABEL[p.kind].toLowerCase()))].slice(0, 4),
      group: design.name.slice(0, 40),
      material: part.material,
      color: part.color,
      color2: part.color2,
      texture: part.texture,
    })
  }
  return out
}

// --- where pieces sit --------------------------------------------------------------

/** The piece's own bounds before it is placed. */
function localBox(p: Piece): THREE.Box3 {
  const [a, b, c] = p.size
  switch (p.kind) {
    case "panel": {
      const curve = Math.abs(p.curve ?? 0)
      if (curve >= 1) {
        // Sampled round the arc, inside face and outside (as _bent builds it).
        const rad = (Math.min(350, curve) * Math.PI) / 180
        const R = a / rad
        const box = new THREE.Box3()
        for (let i = 0; i <= 24; i += 1) {
          const phi = -rad / 2 + (rad * i) / 24
          for (const rho of [R, R + c]) box.expandByPoint(new THREE.Vector3(rho * Math.sin(phi), 0, rho * Math.cos(phi) - R))
        }
        box.min.y = -b / 2
        box.max.y = b / 2
        return box
      }
      return new THREE.Box3(new THREE.Vector3(-a / 2, -b / 2, 0), new THREE.Vector3(a / 2, b / 2, c))
    }
    case "rod":
    case "tube":
      return new THREE.Box3(new THREE.Vector3(-a / 2, -a / 2, 0), new THREE.Vector3(a / 2, a / 2, c))
    case "object": {
      const s = p.mesh?.size ?? [1, 1, 1]
      return new THREE.Box3(new THREE.Vector3(-s[0] / 2, -s[1] / 2, 0), new THREE.Vector3(s[0] / 2, s[1] / 2, s[2]))
    }
    default:
      return new THREE.Box3(new THREE.Vector3(-a / 2, -b / 2, 0), new THREE.Vector3(a / 2, b / 2, c))
  }
}

const deg = THREE.MathUtils.degToRad

/** Where the piece sits in the design (its axis-aligned bounds, mm). */
export function pieceBox(p: Piece): THREE.Box3 {
  // OpenSCAD's rotate([x, y, z]) turns about x, then y, then z: three's ZYX.
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...p.pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(p.rot[0]), deg(p.rot[1]), deg(p.rot[2]), "ZYX")),
    new THREE.Vector3(...p.stretch)
  )
  if (p.mirror) matrix.premultiply(new THREE.Matrix4().makeScale(-1, 1, 1))
  return localBox(p).applyMatrix4(matrix)
}

export function designBox(design: Design): THREE.Box3 {
  const box = new THREE.Box3()
  for (const p of design.pieces) if (!p.hidden && p.op !== "cut") box.union(pieceBox(p))
  return box
}

export type Side = "+x" | "-x" | "+y" | "-y" | "+z" | "-z"

/** Move `piece` flush onto a side of `target`, centred on it across the
 *  other two axes (`gap` mm apart; negative sinks it in). */
export function attach(piece: Piece, target: Piece, side: Side, gap = 0): Vec3 {
  const a = pieceBox(target)
  const b = pieceBox(piece)
  const axis = "xyz".indexOf(side[1])
  const move = new THREE.Vector3()
  const ca = a.getCenter(new THREE.Vector3())
  const cb = b.getCenter(new THREE.Vector3())
  for (let k = 0; k < 3; k += 1) {
    if (k === axis) {
      move.setComponent(k, side[0] === "+" ? a.max.getComponent(k) + gap - b.min.getComponent(k) : a.min.getComponent(k) - gap - b.max.getComponent(k))
    } else move.setComponent(k, ca.getComponent(k) - cb.getComponent(k))
  }
  const round = (x: number) => Math.round(x * 100) / 100
  return [round(piece.pos[0] + move.x), round(piece.pos[1] + move.y), round(piece.pos[2] + move.z)]
}

// --- designs from an object ----------------------------------------------------------

export type Derive = "copy" | "cradle" | "enclosure" | "cover" | "plate"

export const DERIVE_LABEL: Record<Derive, { label: string; blurb: string }> = {
  copy: { label: "COPY", blurb: "The object's own shape, to stretch, cut and rework" },
  cradle: { label: "CRADLE", blurb: "A block with the object's shape sunk into it: a holder or tray" },
  enclosure: { label: "ENCLOSURE", blurb: "Floor, four walls and a clear lid round it, each a panel" },
  cover: { label: "COVER", blurb: "A skin over it, open underneath, that slips on" },
  plate: { label: "PLATE", blurb: "A base plate on its footprint, with a mounting-hole grid" },
}

/**
 * Pieces (and any new parts) that build `kind` round a captured object:
 * the object rides along as a ghost, so the design is seen against what
 * it is for. `clearance` is the fit allowance all round, `wall` the
 * thickness of what is built.
 */
export function derive(
  mesh: CapturedMesh,
  kind: Derive,
  part: DesignPart,
  { clearance = 0.6, wall = 2.4 }: { clearance?: number; wall?: number } = {}
): { pieces: Piece[]; parts: DesignPart[] } {
  const [sx, sy, sz] = mesh.size
  const name = mesh.source.slice(0, 32)
  const object = (extra: Partial<Piece>): Piece => ({
    id: uid(),
    name,
    kind: "object",
    part: part.id,
    op: "add",
    size: [0, 0, 0],
    stretch: [1, 1, 1],
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    form: "hull",
    mesh,
    ...extra,
  })
  const ghost = () => object({ name: `${name} (fit)`, op: "ghost" })
  // The object grown by the clearance on every side, about its middle.
  const grown = (by: number): Pick<Piece, "stretch" | "pos"> => ({
    stretch: [(sx + 2 * by) / sx, (sy + 2 * by) / sy, (sz + 2 * by) / sz],
    pos: [0, 0, -by],
  })
  const panel = (label: string, w: number, h: number, pos: Vec3, rot: Vec3, partId = part.id): Piece => ({
    ...newPiece("panel", partId, 0),
    name: label,
    size: [w, h, wall],
    radius: 0,
    pos,
    rot,
  })

  switch (kind) {
    case "copy":
      return { pieces: [object({ form: "mesh" })], parts: [] }
    case "cradle": {
      const depth = Math.max(wall + 2, sz * 0.45)
      const base: Piece = {
        ...newPiece("block", part.id, 0),
        name: `${name} cradle`,
        size: [sx + 2 * (clearance + wall), sy + 2 * (clearance + wall), depth + wall],
        radius: Math.min(4, wall),
      }
      // Sunk in from the top, sat on a floor `wall` thick.
      const socket = object({ name: `${name} socket`, op: "cut", ...grown(clearance) })
      socket.pos = [0, 0, wall - clearance]
      const g = ghost()
      g.pos = [0, 0, wall]
      return { pieces: [base, socket, g], parts: [] }
    }
    case "enclosure": {
      const W = sx + 2 * clearance
      const D = sy + 2 * clearance
      const H = sz + 2 * clearance
      const lid: DesignPart = { ...newPart(1, "clear"), name: "Lid", color: "#dfefff" }
      const mid = wall + H / 2
      const g = ghost()
      g.pos = [0, 0, wall + clearance]
      return {
        parts: [lid],
        pieces: [
          panel("Floor", W + 2 * wall, D + 2 * wall, [0, 0, 0], [0, 0, 0]),
          panel("Front wall", W + 2 * wall, H, [0, -D / 2, mid], [90, 0, 0]),
          panel("Back wall", W + 2 * wall, H, [0, D / 2, mid], [-90, 0, 0]),
          panel("Left wall", H, D, [-W / 2, 0, mid], [0, -90, 0]),
          panel("Right wall", H, D, [W / 2, 0, mid], [0, 90, 0]),
          panel("Lid", W + 2 * wall, D + 2 * wall, [0, 0, wall + H], [0, 0, 0], lid.id),
          g,
        ],
      }
    }
    case "cover": {
      const outer = object({ name: `${name} cover`, ...grown(clearance + wall) })
      const inner = object({ name: `${name} inside`, op: "cut", ...grown(clearance) })
      // Open underneath: a slab off the bottom, up to the object's floor.
      const open: Piece = {
        ...newPiece("block", part.id, 0),
        name: "Open bottom",
        op: "cut",
        size: [sx + 4 * (clearance + wall) + 2, sy + 4 * (clearance + wall) + 2, clearance + wall + 1],
        pos: [0, 0, -(clearance + wall) - 1],
      }
      return { pieces: [outer, inner, open, ghost()], parts: [] }
    }
    case "plate": {
      const plate: Piece = {
        ...newPiece("panel", part.id, 0),
        name: `${name} plate`,
        size: [sx + 2 * (clearance + wall) + 10, sy + 2 * (clearance + wall) + 10, Math.max(3, wall)],
        radius: 4,
        holes: { d: 3.2, pitch: 20, margin: 5 },
      }
      const g = ghost()
      g.pos = [0, 0, plate.size[2]]
      return { pieces: [plate, g], parts: [] }
    }
  }
}
