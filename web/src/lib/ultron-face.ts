"use client"

import * as THREE from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { STLLoader } from "three/addons/loaders/STLLoader.js"
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js"

import type { AgentStatus } from "@/lib/store"
import { loadUltronModel, onUltronModelChange, type UltronModel } from "@/lib/ultron-model"
import { sfx } from "@/lib/sfx"
import { mouthShape } from "@/lib/speech-track"
import { loadMesh } from "@/lib/workshop/meshes"
import { VisionHead } from "@/lib/vision-head"

/** The workshop mesh that, uploaded, is his head everywhere. */
const ULTRON_MESH = "ultron-head"
/** Andrew's sculpt of Vision, for the head inside the helmet (lib/vision-head.ts). */
const VISION_MESH = "vision-head"

// Ultron's head, for the console's centre in serious mode (lib/core-cipher.ts
// swaps it in for Jarvis's cipher). Built and checked against two Age of
// Ultron references - ILM's "Ultron cheek V2" sculpt (A. Jaeger, 2014, a
// three-quarter view) and the Marvel Studios archive replica (front).
//
// It is solid gunmetal: separate armour plates over an inner core, the
// grooves between them dark, glowing red only where the references glow
// (the cracks across the cranium, the slats along the cheek plates, the
// temple vents, the cheek turbines' hubs). The plates, from the layout:
//
//   cranium   plates fanning up and back from the brow like flames, broken
//             into panels; the crest band from the back of the skull, down
//             the forehead (with its inset plate), between the eyes, into
//   muzzle    the nose plate, widening to the upper lip, a ridge down its
//             middle, an M cut and a notch at its foot
//   brow      a heavy V-shaped ridge over each eye, furrowed above
//   eyes      almond openings in recessed sockets, red irises inside
//   cheeks    a turbine of twisted blades in each, round a hub, in a raised
//             rim; a thick C-plate wrapping it up the side to the temple
//   chin      ribbed plates under the lower lip, a disc at the bottom
//   fins      thick blades from the temples, round the cheeks to the chin
//   neck      stacked segments
//
// Andrew can load his own STL of the head (Settings > Appearance; kept in
// this browser, lib/ultron-model.ts): it replaces the built sculpt, in the
// same metal and light, with the irises set in its eye sockets, found by
// rendering its depth from the front and taking the deepest point of each.
//
// Every proportion is in LAYOUT, measured off the references. It pays
// attention: the head follows the pointer or a hand, the irises narrow when
// Andrew types, he looks about on his own, the jaw drops with his voice, a
// scan rings the head while he thinks, and it glitches now and then.

type XY = [number, number]

// Units: head half-width at the cheeks = 1.38. ILM rows: crown 95, eyes 500,
// mouth 835, chin 1140 -> crown-eye : eye-mouth : mouth-chin = 1.21 : 1 :
// 0.91. Replica, as fractions of the half-width: eyes 0.41 out, cheek
// aperture centred 0.65 out with radius ~0.45, chin 0.47 of the width,
// fins bulging 0.26 beyond the head.
const LAYOUT = {
  top: 2.3,
  eyeY: 0.68,
  mouthY: -0.64,
  chinY: -1.95,
  browY: 0.9,
  eyeX: 0.45,
  halfWidth: { crown: 1.2, brow: 1.24, cheek: 1.38, chin: 0.6 },
  mouthHalf: 0.3,
  bridge: 0.15,
  band: 0.24,
  muzzleFoot: 0.34,
  cheek: { x: 0.8, y: -0.88, r: 0.56 },
  chinDisc: { y: -1.72, r: 0.17 },
  fin: [
    [1.04, 1.02, -0.62], [1.5, 0.6, -0.44], [1.76, -0.3, -0.12], [1.62, -1.15, 0.14], [1.18, -1.76, 0.34],
  ] as [number, number, number][],
  neck: { r: 0.74, top: -1.55, bottom: -3.4, z: -0.4 },
}
const L = LAYOUT
const LOWER_LIP = L.mouthY - 0.14
// The C-plate's centre and radii (it runs up the side to the temple).
const CP = { x: L.cheek.x + 0.2, y: L.cheek.y + 0.3, rx0: L.cheek.r + 0.03, ry0: L.cheek.r + 0.5, rx1: L.cheek.r + 0.17, ry1: L.cheek.r + 0.64 }
// The flame lines across the cranium: x = x0 + k (y - browY).
const SWEEPS: XY[] = [[0.3, 0.42], [0.42, 0.58], [0.58, 0.66], [0.78, 0.55], [1.0, 0.3]]

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t))
const browAt = (ax: number) => L.browY - 0.1 + 0.3 * Math.min(1, ax / 0.95) - 0.5 * Math.max(0, ax - 0.95)

// --- the surface ---------------------------------------------------------------

const DOME_FROM = 1.2

/** Cross-section at height y: half-width, front and back depth, and how far the crown leans back. */
function section(y: number) {
  const hw = L.halfWidth
  if (y >= DOME_FROM) {
    const q = Math.min(1, (y - DOME_FROM) / (L.top - DOME_FROM))
    const r = Math.sqrt(Math.max(0, 1 - q ** 2.2))
    return { w: hw.crown * r, d: 1.08 * r, db: 1.68 * r, zs: -0.3 * q * q }
  }
  if (y >= L.cheek.y) {
    const t = (DOME_FROM - y) / (DOME_FROM - L.cheek.y)
    const w = y > L.browY ? lerp(hw.crown, hw.brow, (DOME_FROM - y) / (DOME_FROM - L.browY)) : lerp(hw.brow, hw.cheek, smooth(0, 1, (L.browY - y) / (L.browY - L.cheek.y)))
    return { w, d: 1.08, db: 1.68 - 0.28 * t, zs: 0 }
  }
  const s = Math.min(1, (L.cheek.y - y) / (L.cheek.y - L.chinY))
  return { w: hw.cheek - (hw.cheek - hw.chin) * s ** 1.7, d: 1.08 - 0.22 * s ** 1.3, db: 1.4 - 0.75 * s, zs: 0 }
}

/** The centre band's half-width at y: crest, bridge, muzzle. */
function bandHalf(y: number): number {
  if (y > L.browY + 0.25) return L.band
  if (y > L.eyeY) return lerp(L.bridge, L.band, (y - L.eyeY) / (L.browY + 0.25 - L.eyeY))
  return lerp(L.bridge, L.muzzleFoot, ((L.eyeY - y) / (L.eyeY - L.mouthY)) ** 1.2)
}

/** The large forms under the plates: the muzzle jutting, the sockets and cheeks sunk, the brow overhanging. */
function relief(x: number, y: number): number {
  const ax = Math.abs(x)
  const edge = smooth(-0.08, 0.06, bandHalf(y) - ax)
  const height = y > L.eyeY ? 0.04 : 0.06 + 0.24 * ((L.eyeY - y) / (L.eyeY - L.mouthY)) ** 0.9
  const band = height * edge * smooth(L.mouthY - 0.1, L.mouthY + 0.02, y)
  const brow = 0.12 * Math.exp(-(((y - browAt(ax) - 0.05) / 0.12) ** 2)) * smooth(1.25, 1.0, ax) * smooth(0.08, 0.2, ax)
  const socket = -0.2 * Math.exp(-(((ax - L.eyeX) / 0.3) ** 2) - ((y - L.eyeY) / 0.17) ** 2)
  const { x: cx, y: cy, r } = L.cheek
  const dr = Math.hypot(ax - cx, y - cy)
  const cheek = -0.1 * smooth(r * 0.95, r * 0.2, dr)
  const disc = 0.06 * Math.exp(-((x / 0.2) ** 2) - ((y - L.chinDisc.y) / 0.18) ** 2)
  return band + brow + socket + cheek + disc
}

function P(theta: number, y: number): THREE.Vector3 {
  const { w, d, db, zs } = section(y)
  const s = Math.sin(theta)
  const c = Math.cos(theta)
  const x = w * s
  let z = (c >= 0 ? d : db) * c + zs
  if (c > 0) z += relief(x, y) * c * c
  return new THREE.Vector3(x, y, z)
}

function normalAt(theta: number, y: number): THREE.Vector3 {
  const e = 0.004
  const yy = Math.min(L.top - 2 * e, Math.max(L.chinY + e, y))
  const du = P(theta + e, yy).sub(P(theta - e, yy))
  const dv = P(theta, yy + e).sub(P(theta, yy - e))
  return du.cross(dv).normalize()
}

/** A point on the surface lifted off it along the normal. */
function on(theta: number, y: number, lift = 0.018): THREE.Vector3 {
  const yy = Math.min(L.top - 0.008, Math.max(L.chinY + 0.004, y))
  return P(theta, yy).addScaledVector(normalAt(theta, yy), lift)
}

const thetaAt = (x: number, y: number) => Math.asin(Math.max(-0.995, Math.min(0.995, x / Math.max(1e-3, section(y).w))))
const face = (x: number, y: number, lift?: number) => on(thetaAt(x, y), y, lift)

/** Key points of the head, in its own frame, for render checks against the references. */
export function ultronLandmarks(): Record<string, THREE.Vector3> {
  const side = (y: number) => new THREE.Vector3(section(y).w, y, 0)
  return {
    crown: P(0, L.top - 0.002),
    eyeL: face(-L.eyeX, L.eyeY),
    eyeR: face(L.eyeX, L.eyeY),
    mouth: face(0, L.mouthY),
    chin: face(0, L.chinY + 0.01),
    chinDisc: face(0, L.chinDisc.y),
    cheekR: face(L.cheek.x, L.cheek.y),
    cheekRimOuter: face(Math.min(L.cheek.x + L.cheek.r, section(L.cheek.y).w * 0.995), L.cheek.y),
    cheekRimInner: face(L.cheek.x - L.cheek.r, L.cheek.y),
    sideAtCheek: side(L.cheek.y),
    sideAtEye: side(L.eyeY),
    sideAtChin: side(L.chinY + 0.05),
    finOut: new THREE.Vector3(...L.fin[2]),
    finTop: new THREE.Vector3(...L.fin[0]),
    finEnd: new THREE.Vector3(...L.fin[4]),
  }
}

// --- the plates ------------------------------------------------------------------

interface Plate {
  /** Which plate; cells are kept only inside one plate, so its edges become grooves. "" = an opening. */
  id: string
  /** How far it stands off the surface. */
  lift: number
  /** Rides on the jaw. */
  jaw?: boolean
}

const HOLE: Plate = { id: "", lift: 0 }

/** The cranium's panels: between the flame lines, broken into staggered lengths. */
function cranium(x: number, y: number, back: boolean): Plate {
  const ax = Math.abs(x)
  let band = 0
  for (const [x0, k] of SWEEPS) if (ax > x0 + k * (y - L.browY)) band += 1
  const seg = Math.floor((y + 0.45 * ax + band * 0.3 + (back ? 0.6 : 0)) / 0.95)
  return { id: `cr${back ? "b" : "f"}${band}_${seg}${x < 0 ? "l" : "r"}`, lift: 0.02 + 0.012 * (band % 2) }
}

/** The plate at a point, in face coordinates (x, y) on the front, or the back of the head. */
function plateAt(x: number, y: number, back: boolean): Plate {
  const ax = Math.abs(x)
  const side = x < 0 ? "l" : "r"
  const { eyeX, eyeY, mouthY } = L

  if (back) {
    if (y > L.browY - 0.2) return cranium(x, y, true)
    return { id: `nape${Math.floor((y + 3) / 0.38)}${side}`, lift: 0.02 }
  }

  // Eyes: the opening, the lids round it, the recessed socket.
  const ex = (ax - eyeX) / 0.17
  const ey = (y - eyeY + 0.01 * ex * ex) / 0.075
  if (ex * ex + ey * ey < 1) return HOLE
  const sx = (ax - eyeX) / 0.36
  const sy = (y - eyeY) / 0.23
  if (sx * sx + sy * sy < 1) {
    const lid = (ax - eyeX) ** 2 / 0.27 ** 2 + (y - eyeY) ** 2 / 0.14 ** 2 < 1
    if (lid) return { id: `lid${y > eyeY ? "u" : "d"}${side}`, lift: 0.02 }
    return { id: `socket${side}`, lift: -0.02 }
  }

  // The centre band: crest, bridge, muzzle.
  if (ax < bandHalf(y) && y > mouthY) {
    if (y > L.top - 0.75 && y < L.top - 0.36 && ax < 0.13) return { id: "emblem", lift: 0.07 }
    if (y > L.browY + 0.25) return { id: "crest", lift: 0.04 }
    if (y > eyeY) return { id: "bridge", lift: 0.05 }
    if (ax > 0.07 && ax < 0.15 && y > mouthY + 0.26 && y < mouthY + 0.46) return { id: `mcut${side}`, lift: 0.01 }
    if (ax < 0.055 && y > mouthY + 0.46) return { id: "ridge", lift: 0.08 }
    return { id: `muzzle${side}`, lift: 0.05 }
  }

  // Mouth: the gap (an opening) and the lower lip.
  if (ax < L.mouthHalf + 0.04 && y < mouthY && y > mouthY - 0.035) return HOLE
  if (ax < L.mouthHalf + 0.04 && y <= mouthY - 0.035 && y > LOWER_LIP) return { id: "lip", lift: 0.03, jaw: true }

  // Chin: the disc and the ribs above it.
  const dd = Math.hypot(x, y - L.chinDisc.y)
  if (dd < L.chinDisc.r) {
    const inner = dd < L.chinDisc.r * 0.6
    return { id: inner ? "discin" : "disc", lift: inner ? 0.05 : 0.07, jaw: true }
  }
  if (ax < 0.3 && y < LOWER_LIP - 0.03 && y > L.chinDisc.y + L.chinDisc.r * 0.7) return { id: `rib${Math.floor((x + 0.3) / 0.1)}`, lift: 0.03, jaw: true }

  // Cheek: the turbine, its hub and rim.
  const { x: cx, y: cy, r } = L.cheek
  const dr = Math.hypot(ax - cx, y - cy)
  if (dr < r) {
    if (dr > r * 0.88) return { id: `rim${side}`, lift: 0.06 }
    if (dr < r * 0.14) return { id: `hub${side}`, lift: 0.04 }
    if (dr < r * 0.3) return { id: `hubring${side}`, lift: 0.0 }
    const a = Math.atan2(y - cy, ax - cx) - 1.3 * (dr / r)
    const turn = Math.PI * 2
    const blade = Math.floor((((a % turn) + turn) % turn) / (turn / 12))
    return { id: `blade${side}${blade}`, lift: -0.04 + 0.05 * (dr / r) }
  }

  // The C-plate round it, and the slats along it.
  const e0 = Math.hypot((ax - CP.x) / CP.rx0, (y - CP.y) / CP.ry0)
  const e1 = Math.hypot((ax - CP.x) / CP.rx1, (y - CP.y) / CP.ry1)
  const ca = Math.atan2((y - CP.y) / CP.ry1, (ax - CP.x) / CP.rx1)
  if (e0 > 1 && e1 < 1 && ca > -2.75 && ca < 1.5) {
    if (ca > 0.15 && ca < 1.35 && e1 > 0.94) return { id: `slat${side}${Math.floor(ca / 0.1)}`, lift: 0.05 }
    return { id: `cplate${side}${ca < -1.2 ? "b" : "a"}`, lift: 0.08 }
  }

  // Brow: the ridge, and the furrows above it.
  const b = browAt(ax)
  if (ax > 0.1 && ax < 1.12 && y > b - 0.02 && y < b + 0.13) return { id: `brow${side}`, lift: 0.07 }
  if (ax > 0.14 && ax < 0.95 && y >= b + 0.13 && y < b + 0.46) return { id: `furrow${side}${Math.floor((y - b - 0.13 - 0.22 * ax) / 0.1)}`, lift: 0.02 }

  // Temple: the vents behind the eye, the plate round them.
  if (ax > 0.97 && y > L.cheek.y + 0.2 && y < b) {
    if (ax < 1.14 && y > eyeY - 0.08 && y < eyeY + 0.12) return { id: `vent${side}${Math.floor(y / 0.07)}`, lift: -0.01 }
    return { id: `temple${side}`, lift: 0.03 }
  }

  if (y > b) return cranium(x, y, false)

  // The cheekbone, between the socket and the turbine; the jaw below.
  if (y > L.cheek.y) return { id: `cheekbone${side}${ax + (y - eyeY) * 0.4 > 0.78 ? "o" : "i"}`, lift: 0.03 }
  return { id: `jaw${side}${ax > 0.45 ? "o" : "i"}`, lift: 0.02 }
}

/** How strongly the core glows at a point: red only where the references glow. */
function glowAt(x: number, y: number, back: boolean): number {
  const ax = Math.abs(x)
  if (back) return 0
  // Cracks along two of the flame lines.
  for (const i of [1, 3]) {
    const [x0, k] = SWEEPS[i]
    if (y > L.browY + 0.1 && Math.abs(ax - (x0 + k * (y - L.browY))) < 0.022) return 1
  }
  const ca = Math.atan2((y - CP.y) / CP.ry1, (ax - CP.x) / CP.rx1)
  const e1 = Math.hypot((ax - CP.x) / CP.rx1, (y - CP.y) / CP.ry1)
  if (ca > 0.15 && ca < 1.35 && e1 > 0.88 && e1 < 1.06) return 1
  if (ax > 0.97 && ax < 1.14 && y > L.eyeY - 0.08 && y < L.eyeY + 0.12) return 0.5
  if (Math.hypot(ax - L.cheek.x, y - L.cheek.y) < L.cheek.r * 0.16) return 1
  if (ax < L.mouthHalf + 0.05 && Math.abs(y - L.mouthY + 0.017) < 0.03) return 0.5
  if (Math.hypot((ax - L.eyeX) / 0.2, (y - L.eyeY) / 0.1) < 1) return 0.6
  return 0
}

interface Built {
  plates: THREE.BufferGeometry
  jaw: THREE.BufferGeometry
  core: THREE.BufferGeometry
}

/** The head as plates over a core: the surface sampled on a grid, each cell
 *  kept only if it lies well inside one plate, so every plate boundary is a
 *  groove; plates bevel down toward their edges so the edges catch light. */
function buildHead(): Built {
  const NT = 460
  const NY = 430
  const cols = NT + 1
  const count = cols * (NY + 1)
  const base = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  const ids = new Int32Array(count)
  const lifts = new Float32Array(count)
  const jaws = new Uint8Array(count)
  const glow = new Float32Array(count)
  const names = new Map<string, number>()

  for (let j = 0; j <= NY; j += 1) {
    const y = L.chinY + ((L.top - 0.004 - L.chinY) * j) / NY
    for (let i = 0; i <= NT; i += 1) {
      const theta = -Math.PI + (Math.PI * 2 * i) / NT
      const v = j * cols + i
      const p = P(theta, y)
      base.set([p.x, p.y, p.z], v * 3)
      const back = Math.cos(theta) < 0.05
      const plate = plateAt(p.x, y, back)
      if (!names.has(plate.id)) names.set(plate.id, names.size)
      ids[v] = plate.id === "" ? -1 : names.get(plate.id)!
      lifts[v] = plate.lift
      jaws[v] = plate.jaw ? 1 : 0
      glow[v] = glowAt(p.x, y, back)
    }
  }

  // Normals from the grid's neighbours (the seam at theta = +-pi wraps).
  const at = (i: number, j: number) => ((Math.min(NY, Math.max(0, j)) * cols + ((i + NT) % NT)) * 3)
  const du = new THREE.Vector3()
  const dv = new THREE.Vector3()
  for (let j = 0; j <= NY; j += 1) {
    for (let i = 0; i <= NT; i += 1) {
      const a = at(i + 1, j)
      const b = at(i - 1, j)
      const c = at(i, j + 1)
      const d = at(i, j - 1)
      du.set(base[a] - base[b], base[a + 1] - base[b + 1], base[a + 2] - base[b + 2])
      dv.set(base[c] - base[d], base[c + 1] - base[d + 1], base[c + 2] - base[d + 2])
      du.cross(dv).normalize()
      normal.set([du.x, du.y, du.z], (j * cols + i) * 3)
    }
  }

  // Distance (in cells, up to R) to the nearest vertex of another plate.
  const R = 3
  const edge = new Uint8Array(count)
  for (let j = 0; j <= NY; j += 1) {
    for (let i = 0; i <= NT; i += 1) {
      const v = j * cols + i
      let d = R
      for (let dj = -R; dj <= R && d > 0; dj += 1) {
        const jj = j + dj
        if (jj < 0 || jj > NY) continue
        for (let di = -R; di <= R; di += 1) {
          const ii = (i + di + NT) % NT
          if (ids[jj * cols + ii] !== ids[v]) d = Math.min(d, Math.max(Math.abs(di), Math.abs(dj)) - 1)
        }
      }
      edge[v] = Math.max(0, d)
    }
  }

  const lifted = new Float32Array(count * 3)
  for (let v = 0; v < count; v += 1) {
    // Bevelled: the plate's full height in its body, down toward its edges.
    const lift = 0.012 + lifts[v] * (0.35 + (0.65 * edge[v]) / R) + (0.012 * edge[v]) / R
    for (let k = 0; k < 3; k += 1) lifted[v * 3 + k] = base[v * 3 + k] + normal[v * 3 + k] * lift
  }

  const plateIndex: number[] = []
  const jawIndex: number[] = []
  const coreIndex: number[] = []
  for (let j = 0; j < NY; j += 1) {
    for (let i = 0; i < NT; i += 1) {
      const a = j * cols + i
      const b = a + 1
      const c = a + cols
      const d = c + 1
      coreIndex.push(a, b, c, c, b, d)
      // A plate cell: all four corners in one plate, none on its very edge.
      if (ids[a] < 0 || ids[a] !== ids[b] || ids[a] !== ids[c] || ids[a] !== ids[d]) continue
      if (!edge[a] || !edge[b] || !edge[c] || !edge[d]) continue
      ;(jaws[a] ? jawIndex : plateIndex).push(a, b, c, c, b, d)
    }
  }

  const geometry = (positions: Float32Array, index: number[]) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    g.setIndex(index)
    g.computeVertexNormals()
    return g
  }

  // The core, just under the surface, coloured by where it glows.
  const corePositions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  for (let v = 0; v < count; v += 1) {
    for (let k = 0; k < 3; k += 1) corePositions[v * 3 + k] = base[v * 3 + k] - normal[v * 3 + k] * 0.01
    colors.set([glow[v], glow[v], glow[v]], v * 3)
  }
  const core = geometry(corePositions, coreIndex)
  core.setAttribute("color", new THREE.BufferAttribute(colors, 3))

  return { plates: geometry(lifted, plateIndex), jaw: geometry(lifted.slice(), jawIndex), core }
}

// A blade swept along a curve: a rectangle in section, wide through the
// middle and tapering to both ends. Its broad face turns outward (its width
// runs front to back), so from the front it is a thin crescent, as on the
// replica.
function sweptBlade(curve: THREE.CatmullRomCurve3, width: number, thick: number, side: number): THREE.BufferGeometry {
  const N = 56
  const rings: THREE.Vector3[][] = []
  for (let i = 0; i <= N; i += 1) {
    const s = i / N
    const c = curve.getPoint(s)
    const t = curve.getTangent(s)
    const up = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0, 0, 1)).normalize()
    const across = new THREE.Vector3().crossVectors(up, t).normalize()
    const w = (0.03 + width * Math.sin(Math.PI * Math.min(1, s * 1.1)) ** 0.7) / 2
    const h = (thick * (0.4 + 0.6 * Math.sin(Math.PI * s))) / 2
    const ring = [
      c.clone().addScaledVector(across, w).addScaledVector(up, h),
      c.clone().addScaledVector(across, -w).addScaledVector(up, h),
      c.clone().addScaledVector(across, -w).addScaledVector(up, -h),
      c.clone().addScaledVector(across, w).addScaledVector(up, -h),
    ]
    for (const p of ring) p.x *= side
    rings.push(ring)
  }
  // Each face its own strip, so the blade's edges stay sharp.
  const positions: number[] = []
  for (let f = 0; f < 4; f += 1) {
    for (let i = 0; i < N; i += 1) {
      const a = rings[i][f]
      const b = rings[i][(f + 1) % 4]
      const c = rings[i + 1][f]
      const d = rings[i + 1][(f + 1) % 4]
      const quad = side > 0 ? [a, c, b, b, c, d] : [a, b, c, b, d, c]
      for (const p of quad) positions.push(p.x, p.y, p.z)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

// --- the console's look on the metal -------------------------------------------

/** Shared by every metal surface of the head (the built one and Andrew's
 *  model): the live accent, his heat, and a clock for the sweep. */
interface Holo {
  tint: { value: THREE.Color }
  heat: { value: number }
  time: { value: number }
}

/** Four flat bands of light, as cel animation shades: what makes the metal
 *  read as the What If...? series' painted, inked look rather than chrome. */
function toonBands(): THREE.DataTexture {
  const bands = new THREE.DataTexture(new Uint8Array([22, 78, 168, 255]), 4, 1, THREE.RedFormat)
  bands.minFilter = THREE.NearestFilter
  bands.magFilter = THREE.NearestFilter
  bands.needsUpdate = true
  return bands
}

/** Ultron's metal in the What If...? series' style: cel-shaded silver in
 *  flat bands, and a crisp rim of the console's red where the surface turns
 *  away - a hard-edged band, as the show paints it, brighter with his heat. */
function toonMetal(material: THREE.MeshToonMaterial, holo: Holo): THREE.MeshToonMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.holoTint = holo.tint
    shader.uniforms.holoHeat = holo.heat
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform vec3 holoTint;\nuniform float holoHeat;\nvoid main() {")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          float facing = 1.0 - abs(dot(normal, normalize(vViewPosition)));
          float rim = smoothstep(0.74, 0.78, facing);
          totalEmissiveRadiance += holoTint * rim * (0.45 + 0.45 * holoHeat);
          // A crisp sheen where the key light would glance off: the glossy
          // highlight the reference renders paint on the metal.
          float sheen = smoothstep(0.88, 0.91, dot(normal, normalize(vec3(-0.5, 0.62, 0.6))));
          totalEmissiveRadiance += vec3(0.3, 0.34, 0.4) * sheen;
        }`,
      )
  }
  material.customProgramCacheKey = () => "ultron-toon-metal"
  return material
}

/** The ink line round a model: its surface pushed out along the normals and
 *  drawn from the back in near-black - an inverted hull, the outline cel
 *  art draws round every shape. */
function inkOutline(geometry: THREE.BufferGeometry, width: number, index?: number[]): THREE.Mesh {
  const position = geometry.getAttribute("position")
  const normal = geometry.getAttribute("normal")
  const pushed = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i += 1) {
    pushed[i * 3] = position.getX(i) + normal.getX(i) * width
    pushed[i * 3 + 1] = position.getY(i) + normal.getY(i) * width
    pushed[i * 3 + 2] = position.getZ(i) + normal.getZ(i) * width
  }
  const hull = new THREE.BufferGeometry()
  hull.setAttribute("position", new THREE.BufferAttribute(pushed, 3))
  if (index) hull.setIndex(index)
  return new THREE.Mesh(hull, new THREE.MeshBasicMaterial({ color: 0x0b0607, side: THREE.BackSide }))
}

// --- Vision's mouth ---------------------------------------------------------------

/** Vision's lips, behind the helmet's lower faceplate: an upper lip with its
 *  cupid's bow, a fuller lower lip, the dark of the mouth and a line of
 *  teeth, reshaped every frame from a mouth shape (lib/speech-track.ts) so
 *  he speaks the words being said. Built in its own frame: x across, y up,
 *  z out of the face; w wide and h tall at rest. */
class VisionMouth {
  readonly group = new THREE.Group()
  private readonly upper: THREE.Mesh
  private readonly lower: THREE.Mesh
  private readonly inside: THREE.Mesh
  private readonly teeth: THREE.Mesh
  private static readonly COLS = 33
  private static readonly ROWS = 6

  constructor(private readonly w: number, private readonly h: number, lip: THREE.Material) {
    const grid = () => {
      const g = new THREE.BufferGeometry()
      const C = VisionMouth.COLS
      const R = VisionMouth.ROWS
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(C * R * 3), 3))
      const index: number[] = []
      for (let j = 0; j < R - 1; j += 1) for (let i = 0; i < C - 1; i += 1) {
        const a = j * C + i
        index.push(a, a + 1, a + C, a + C, a + 1, a + C + 1)
      }
      g.setIndex(index)
      return g
    }
    const strip = () => {
      const g = new THREE.BufferGeometry()
      const C = VisionMouth.COLS
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(C * 2 * 3), 3))
      const index: number[] = []
      for (let i = 0; i < C - 1; i += 1) index.push(i, i + 1, i + C, i + C, i + 1, i + C + 1)
      g.setIndex(index)
      return g
    }
    this.upper = new THREE.Mesh(grid(), lip)
    this.lower = new THREE.Mesh(grid(), lip)
    this.inside = new THREE.Mesh(strip(), new THREE.MeshBasicMaterial({ color: 0x1c0409, side: THREE.DoubleSide }))
    this.teeth = new THREE.Mesh(strip(), new THREE.MeshBasicMaterial({ color: 0xe9e2d6, side: THREE.DoubleSide }))
    this.group.add(this.inside, this.teeth, this.upper, this.lower)
    this.set({ open: 0, wide: 0.5, round: 0, press: 0, tuck: 0 })
  }

  set(m: { open: number; wide: number; round: number; press: number; tuck: number }) {
    const { w, h } = this
    const C = VisionMouth.COLS
    const R = VisionMouth.ROWS
    const half = (w / 2) * (0.84 + 0.26 * m.wide - 0.3 * m.round)
    const gap = h * 0.95 * m.open * (1 - m.press)
    const thick = 1 - 0.28 * m.press
    const up = this.upper.geometry.getAttribute("position") as THREE.BufferAttribute
    const lo = this.lower.geometry.getAttribute("position") as THREE.BufferAttribute
    const ins = this.inside.geometry.getAttribute("position") as THREE.BufferAttribute
    const tee = this.teeth.geometry.getAttribute("position") as THREE.BufferAttribute
    for (let i = 0; i < C; i += 1) {
      const u = (i / (C - 1)) * 2 - 1
      const f = Math.max(0, 1 - u * u)
      const x = u * half * (1 - m.round * 0.12 * f)
      const open = (gap / 2) * Math.pow(f, 0.7)
      // Upper lip: the lip line, and the top edge with its cupid's bow.
      const uIn = open
      const uOut = open + h * thick * (0.34 * Math.pow(f, 0.55) - 0.07 * Math.exp(-((u / 0.13) ** 2)) + 0.035 * Math.exp(-(((Math.abs(u) - 0.2) / 0.09) ** 2)))
      // Lower lip: fuller, tucking under the teeth for f and v.
      const lIn = -open - m.tuck * h * 0.06 * f
      const lOut = lIn - h * thick * 0.44 * Math.pow(f, 0.5) * (1 - 0.3 * m.tuck)
      const bulge = h * 0.3 * Math.sqrt(f) * thick
      const pout = m.round * h * 0.28 * Math.sqrt(f)
      for (let j = 0; j < R; j += 1) {
        const t = j / (R - 1)
        const z = bulge * Math.sin(Math.PI * Math.min(1, t * 1.15)) + pout
        up.setXYZ(j * C + i, x, uIn + (uOut - uIn) * t, z)
        lo.setXYZ(j * C + i, x, lIn + (lOut - lIn) * t, z * 1.08)
      }
      ins.setXYZ(i, x, uIn, -h * 0.05)
      ins.setXYZ(i + C, x, lIn, -h * 0.05)
      tee.setXYZ(i, x * 0.86, uIn - h * 0.01, -h * 0.03)
      tee.setXYZ(i + C, x * 0.86, uIn - Math.min(gap * 0.4, h * 0.16) * Math.pow(f, 0.5), -h * 0.03)
    }
    for (const a of [up, lo, ins, tee]) a.needsUpdate = true
    this.upper.geometry.computeVertexNormals()
    this.lower.geometry.computeVertexNormals()
    this.teeth.visible = gap > h * 0.05
  }
}

/** MCU Vision's face, painted flat for the sculpted face behind the
 *  faceplate: crimson skin, the gold seams that run from his brow round
 *  the eyes and down the cheeks to the jaw, the nose's seams, the chin's
 *  plate, and the silver-gold panels at the sides of his face - each seam
 *  cut in with a darker groove beside it, as the film's are. Laid out in
 *  the face's own coordinates: u across (-1.3..1.3, the face's edges at
 *  +-1), v up (-0.1 chin .. 1.1 brow). */
function visionSkin(eyeV: number, mouthV: number, noseV: number): THREE.CanvasTexture {
  const S = 1024
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = S
  const c = canvas.getContext("2d")!
  const X = (u: number) => ((u + 1.3) / 2.6) * S
  const Y = (v: number) => (1 - (v + 0.1) / 1.2) * S
  // Skin: crimson, a touch darker toward the edges.
  const skin = c.createRadialGradient(X(0), Y(eyeV - 0.15), S * 0.05, X(0), Y(eyeV - 0.15), S * 0.55)
  skin.addColorStop(0, "#c03358")
  skin.addColorStop(1, "#8e2140")
  c.fillStyle = skin
  c.fillRect(0, 0, S, S)
  // The side panels: silver-gold metal from the temple down past the jaw.
  for (const side of [1, -1]) {
    const grad = c.createLinearGradient(X(side * 0.78), 0, X(side * 1.3), 0)
    grad.addColorStop(0, "#c9a85a")
    grad.addColorStop(0.5, "#b9b3a6")
    grad.addColorStop(1, "#8d877c")
    c.fillStyle = grad
    c.beginPath()
    c.moveTo(X(side * 0.86), Y(1.1))
    c.bezierCurveTo(X(side * 0.8), Y(eyeV), X(side * 0.86), Y(mouthV), X(side * 0.62), Y(-0.1))
    c.lineTo(X(side * 1.3), Y(-0.1))
    c.lineTo(X(side * 1.3), Y(1.1))
    c.closePath()
    c.fill()
  }
  /** A seam: a dark groove, then the gold line in it. */
  const seam = (draw: () => void, width: number) => {
    c.lineCap = "round"
    c.lineJoin = "round"
    c.strokeStyle = "#5a1027"
    c.lineWidth = width * 2.4
    c.beginPath()
    draw()
    c.stroke()
    c.strokeStyle = "#e3c271"
    c.lineWidth = width
    c.beginPath()
    draw()
    c.stroke()
  }
  for (const side of [1, -1]) {
    // From the brow, round the outside of the eye, down the cheek to the jaw.
    seam(() => {
      c.moveTo(X(side * 0.1), Y(1.08))
      c.bezierCurveTo(X(side * 0.42), Y(eyeV + 0.24), X(side * 0.76), Y(eyeV + 0.1), X(side * 0.74), Y(eyeV - 0.12))
      c.bezierCurveTo(X(side * 0.72), Y(mouthV + 0.12), X(side * 0.62), Y(mouthV - 0.06), X(side * 0.36), Y(0.02))
    }, 7)
    // Under the eye, out to the cheekbone.
    seam(() => {
      c.moveTo(X(side * 0.2), Y(eyeV - 0.1))
      c.quadraticCurveTo(X(side * 0.48), Y(eyeV - 0.16), X(side * 0.72), Y(eyeV - 0.06))
    }, 5)
    // Down the side of the nose.
    seam(() => {
      c.moveTo(X(side * 0.09), Y(eyeV + 0.16))
      c.lineTo(X(side * 0.08), Y(noseV + 0.08))
    }, 4)
    // From the nose's wing to the corner of the mouth.
    seam(() => {
      c.moveTo(X(side * 0.18), Y(noseV))
      c.quadraticCurveTo(X(side * 0.34), Y((noseV + mouthV) / 2), X(side * 0.34), Y(mouthV - 0.04))
    }, 4)
  }
  // The forehead's seam down the middle, under the stone.
  seam(() => {
    c.moveTo(X(0), Y(1.1))
    c.lineTo(X(0), Y(eyeV + 0.12))
  }, 6)
  // The chin's plate.
  seam(() => {
    c.moveTo(X(-0.3), Y(mouthV - 0.12))
    c.bezierCurveTo(X(-0.28), Y(0.02), X(0.28), Y(0.02), X(0.3), Y(mouthV - 0.12))
  }, 5)
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 4
  return map
}

/** One of Vision's eyes: the white, a blue iris that follows his gaze, the
 *  pupil, and a dark upper lid that closes to blink. In its own frame, x
 *  across, y up, z out of the face; r its half width. */
class VisionEye {
  readonly group = new THREE.Group()
  readonly iris = new THREE.Group()
  private readonly lid: THREE.Mesh

  constructor(readonly r: number, side: number, bands: THREE.Texture) {
    const white = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshToonMaterial({ color: 0xece2d8, gradientMap: bands }))
    white.scale.y = 0.48
    this.group.add(white)
    const iris = new THREE.Mesh(new THREE.CircleGeometry(r * 0.44, 32), new THREE.MeshBasicMaterial({ color: 0x3f8fc4 }))
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.4, r * 0.44, 32), new THREE.MeshBasicMaterial({ color: 0x173a55 }))
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(r * 0.18, 24), new THREE.MeshBasicMaterial({ color: 0x07080b }))
    const glint = new THREE.Mesh(new THREE.CircleGeometry(r * 0.07, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    iris.position.z = 0.002
    ring.position.z = 0.0025
    pupil.position.z = 0.003
    glint.position.set(-r * 0.12 * side, r * 0.12, 0.004)
    this.iris.add(iris, ring, pupil, glint)
    // Only the part over the white shows: clipped by the white's outline in
    // a stencil would be costly; the iris is small enough to stay inside.
    this.group.add(this.iris)
    this.lid = new THREE.Mesh(new THREE.CircleGeometry(r * 1.06, 40, 0, Math.PI), new THREE.MeshToonMaterial({ color: 0x8e2140, gradientMap: bands }))
    this.lid.position.z = 0.006
    this.group.add(this.lid)
  }

  /** Gaze -1..1 each way; open 0 (shut) .. 1. */
  set(gaze: THREE.Vector2, open: number) {
    this.iris.position.set(gaze.x * this.r * 0.42, gaze.y * this.r * 0.14, 0)
    // The lid comes down from above, over the top of the white.
    this.lid.scale.set(1, 0.5 * (1 - open) + 0.06, 1)
    this.lid.position.y = this.r * 0.48 * (1 - (1 - open) * 1.0) - this.r * 0.02
    this.lid.rotation.z = Math.PI
    this.lid.scale.y = -(0.06 + 0.5 * (1 - open))
  }
}

// --- the head ----------------------------------------------------------------

const SHARDS = 7
/** How long the faceplate takes to open or close, s. */
const HELM_S = 0.9
/** His head's width inside the helmet, in eye-slot spacings. */
const VISION_FIT = 1.8
/** And a little lower than the slots' middle, by that spacing. */
const VISION_DROP = 0.04

interface Shard {
  mesh: THREE.LineLoop
  radius: number
  speed: number
  phase: number
  tilt: number
}

export interface FaceInput {
  status: AgentStatus
  /** 0..1, his voice (or Andrew's while listening). */
  amp: number
  energy: number
  /** -1..1 where the pointer or a hand is, relative to the core; null when away. */
  look: { x: number; y: number } | null
  /** Seconds since Andrew last typed. */
  sinceTyped: number
  /** The live tint (accent, pulled red by an error). */
  tint: THREE.Color
}

export class UltronFace {
  readonly group = new THREE.Group()
  private readonly head = new THREE.Group()
  /** The built head; hidden while Andrew's own model is shown. */
  private readonly sculpt = new THREE.Group()
  private model: THREE.Mesh | null = null
  private readonly irisHome: THREE.Vector3[] = []
  private readonly renderer: THREE.WebGLRenderer
  private readonly stopModel: () => void
  private disposed = false
  private readonly jaw = new THREE.Group()
  private readonly metal: THREE.MeshToonMaterial
  private readonly gemMaterial: THREE.MeshToonMaterial
  private readonly goldMaterial: THREE.MeshToonMaterial
  private readonly skinMaterial: THREE.MeshToonMaterial
  private readonly lipMaterial: THREE.MeshToonMaterial
  /** The faceplate, brow to chin, on its hinge: swings up into the helmet,
   *  as an Iron Man helmet's does, to show Vision's face inside. */
  private faceplate: THREE.Group | null = null
  private hinge = new THREE.Vector3()
  private plateOpen = 0
  private plateGoal = 0
  /** The slots' glowing screen, which rides on the faceplate. */
  private screen: THREE.Mesh | null = null
  private mouth: VisionMouth | null = null
  private readonly visionEyes: VisionEye[] = []
  /** His own sculpt, rigged, when the vision-head mesh is there; else the
   *  built face above (sheet, eyes, lips). */
  private visionHead: VisionHead | null = null
  /** The built face's parts, hidden while the sculpt stands in for them. */
  private builtFace: THREE.Object3D[] = []
  private readonly visionMaterial: THREE.MeshToonMaterial
  private readonly bands: THREE.Texture
  private gemAt: THREE.Vector3 | null = null
  private ring: THREE.Mesh | null = null
  /** The Mind Stone's flare, 1 at its peak, decaying. */
  private flare = 0
  private lastFlare = -100
  private lastActive = -100
  private lastSeen = -100
  private wasSpeaking = false
  private readonly mouthNow = { open: 0, wide: 0.5, round: 0, press: 0, tuck: 0 }
  private readonly glowMap: THREE.Texture
  private readonly coreMaterial: THREE.MeshBasicMaterial
  private readonly rim: THREE.DirectionalLight
  private readonly environment: THREE.Texture
  private readonly irises: THREE.Group[] = []
  private readonly irisMaterial: THREE.MeshBasicMaterial
  private readonly eyeGlows: THREE.Sprite[] = []
  private readonly mouthGlow: THREE.Mesh
  private readonly scanMaterial: THREE.LineBasicMaterial
  private readonly scan: THREE.Line
  private readonly shards: Shard[] = []
  private readonly gaze = new THREE.Vector2()
  private readonly gazeTarget = new THREE.Vector2()
  private wander = 0
  private readonly wanderAt = new THREE.Vector2()
  private glitch = 0
  private glitchTimer = 3
  private blink = 0
  private blinkTimer = 4
  private open = 0
  private narrow = 0
  private readonly holo: Holo = { tint: { value: new THREE.Color(0xff1430) }, heat: { value: 0.5 }, time: { value: 0 } }

  constructor(glow: THREE.Texture, color: number, renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    // Gunmetal, reflecting a studio room.
    const pmrem = new THREE.PMREMGenerator(renderer)
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    // Cel-shaded silver in the What If...? style (toonMetal), and the Mind
    // Stone's gold, glowing.
    const bands = toonBands()
    this.metal = toonMetal(new THREE.MeshToonMaterial({ color: 0x75879b, gradientMap: bands }), this.holo)
    this.gemMaterial = new THREE.MeshToonMaterial({ color: 0xffeeb0, emissive: 0xffd36a, emissiveIntensity: 0.9, gradientMap: bands })
    this.goldMaterial = toonMetal(new THREE.MeshToonMaterial({ color: 0xc9a046, gradientMap: bands }), this.holo)
    // Vision's skin, in the reference's crimson, and his lips a shade deeper.
    this.skinMaterial = new THREE.MeshToonMaterial({ color: 0xb02c4e, gradientMap: bands, side: THREE.DoubleSide })
    this.lipMaterial = new THREE.MeshToonMaterial({ color: 0x8a1b3c, gradientMap: bands, side: THREE.DoubleSide })
    // Vision's face: its painted skin (visionSkin) on the toon bands.
    this.visionMaterial = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: bands, side: THREE.DoubleSide })
    this.bands = bands
    this.glowMap = glow
    this.coreMaterial = new THREE.MeshBasicMaterial({ color, vertexColors: true })

    // Lights travel with the group, not the head, so turning shows the form.
    const key = new THREE.DirectionalLight(0xfff6f0, 2.4)
    key.position.set(-5, 4, 2.2)
    this.rim = new THREE.DirectionalLight(color, 0.7)
    this.rim.position.set(4, 1.5, -3)
    const under = new THREE.DirectionalLight(color, 0.15)
    under.position.set(0, -4, 2)
    this.group.add(key, this.rim, under, new THREE.AmbientLight(0x8fa3cc, 0.22))

    const built = buildHead()
    this.sculpt.add(new THREE.Mesh(built.plates, this.metal), new THREE.Mesh(built.core, this.coreMaterial))
    this.jaw.add(new THREE.Mesh(built.jaw, this.metal))
    this.sculpt.add(this.jaw)

    // Eyes: a dark ball in each opening, a red iris on it, a bloom.
    const eyeball = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.6, roughness: 0.2, envMap: this.environment })
    this.irisMaterial = new THREE.MeshBasicMaterial({ color })
    for (const side of [1, -1]) {
      const at = face(L.eyeX * side, L.eyeY, -0.06)
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16), eyeball)
      ball.position.copy(at)
      this.sculpt.add(ball)
      const iris = new THREE.Group()
      iris.position.copy(at).add(new THREE.Vector3(0, 0, 0.145))
      iris.lookAt(iris.position.clone().add(new THREE.Vector3(side * 0.12, 0.04, 1)))
      iris.add(new THREE.Mesh(new THREE.RingGeometry(0.026, 0.062, 40), this.irisMaterial))
      iris.add(new THREE.Mesh(new THREE.RingGeometry(0.068, 0.078, 40), this.irisMaterial))
      const bloom = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      bloom.scale.setScalar(0.4)
      bloom.position.z = 0.02
      iris.add(bloom)
      this.eyeGlows.push(bloom)
      this.irises.push(iris)
      this.irisHome.push(iris.position.clone())
      this.head.add(iris)
    }

    // The glow in the mouth when he speaks.
    const m = L.mouthHalf + 0.04
    this.mouthGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(m * 2, 0.06),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.mouthGlow.position.set(0, L.mouthY - 0.02, face(0, L.mouthY - 0.02).z + 0.02)
    this.sculpt.add(this.mouthGlow)

    // Fins: a thick blade and a thinner one inside it.
    for (const side of [1, -1]) {
      const curve = new THREE.CatmullRomCurve3(L.fin.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
      const inner = new THREE.CatmullRomCurve3(L.fin.map(([x, y, z]) => new THREE.Vector3(x * 0.9, y * 0.97, z + 0.04)))
      this.sculpt.add(new THREE.Mesh(sweptBlade(curve, 0.34, 0.07, side), this.metal), new THREE.Mesh(sweptBlade(inner, 0.12, 0.04, side), this.metal))
    }

    // Neck: stacked segments over a dark core.
    const { r: nr, top: nt, bottom: nb, z: nz } = L.neck
    const neckCore = new THREE.Mesh(new THREE.CylinderGeometry(nr * 0.9, nr * 0.95, nt - nb, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x120204 }))
    neckCore.position.set(0, (nt + nb) / 2, nz)
    this.sculpt.add(neckCore)
    for (let y = nt - 0.12; y > nb; y -= 0.3) {
      const rr = nr * (1 + (0.08 * (nt - y)) / (nt - nb))
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr * 1.02, 0.24, 48), this.metal)
      ring.position.set(0, y - 0.12, nz)
      this.sculpt.add(ring)
    }

    // Thinking: a ring round the head, sweeping down.
    this.scanMaterial = new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    this.scan = new THREE.Line(new THREE.BufferGeometry(), this.scanMaterial)
    this.scan.geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(65 * 3), 3))
    this.scan.visible = false
    this.head.add(this.scan)

    for (let i = 0; i < SHARDS; i += 1) {
      const s = 0.08 + Math.random() * 0.1
      const pts = [new THREE.Vector3(0, s, 0), new THREE.Vector3(s * 0.8, -s * 0.6, 0), new THREE.Vector3(-s * 0.5, -s * 0.4, 0)]
      const mesh = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), this.scanMaterial)
      this.shards.push({ mesh, radius: 2.3 + Math.random() * 0.4, speed: 0.2 + Math.random() * 0.3, phase: (i / SHARDS) * Math.PI * 2, tilt: (Math.random() - 0.5) * 1.2 })
      this.group.add(mesh)
    }

    // The built head is the fallback only: hidden until loading finds no
    // model, so the old head never shows while his own loads.
    this.sculpt.visible = false
    this.head.add(this.sculpt)
    this.head.scale.setScalar(0.86)
    this.head.position.y = 0.05
    this.group.add(this.head)

    void this.loadModel()
    this.stopModel = onUltronModelChange(() => void this.loadModel())
  }

  // --- Andrew's own model ---------------------------------------------------

  /** Andrew's model: one loaded in this browser (Settings > Appearance), or
   *  else the workshop mesh "ultron-head" (Workshop > Meshes), which follows
   *  him to every device he signs in on. Neither: the built head. */
  private async loadModel() {
    let saved = await loadUltronModel()
    if (!saved) {
      try {
        const bytes = await loadMesh(ULTRON_MESH)
        saved = { name: ULTRON_MESH, data: bytes.slice().buffer, up: "z", turn: 0 }
      } catch {
        saved = null
      }
    }
    if (!this.disposed) this.showModel(saved)
  }

  private showModel(saved: UltronModel | null) {
    if (this.model) {
      this.head.remove(this.model)
      this.model.geometry.dispose()
      // Its own children (outline, glow, screen) go; the shared metal and
      // gem materials stay.
      this.model.traverse((child) => {
        if (child === this.model) return
        const part = child as THREE.Mesh
        part.geometry?.dispose()
        // (An array of materials is the shared metal and gold.)
        if (Array.isArray(part.material)) return
        const material = part.material as THREE.MeshBasicMaterial | undefined
        // The shared toon materials (metal, gem, gold, skin, lips) stay.
        if (!material || [this.metal, this.gemMaterial, this.goldMaterial, this.skinMaterial, this.lipMaterial, this.visionMaterial].includes(material as never)) return
        material.map?.dispose()
        material.dispose()
      })
      this.faceplate = null
      this.screen = null
      this.visionEyes.length = 0
      this.visionHead?.dispose()
      this.visionHead = null
      this.builtFace = []
      this.mouth = null
      this.ring = null
      this.gemAt = null
      this.model = null
    }
    const eyes = saved ? this.buildModel(saved) : null
    this.sculpt.visible = !this.model
    // On a model, the eyes are its own (glowing through its slots); only
    // the blooms stay, over them.
    this.irises.forEach((iris, i) => {
      iris.position.copy(eyes ? eyes[i] : this.irisHome[i])
      iris.lookAt(iris.position.clone().add(new THREE.Vector3((i === 0 ? 1 : -1) * 0.12, 0.04, 1)))
      for (const child of iris.children) child.visible = !eyes
    })
  }

  /** Parses, orients and fits the model; returns where its eyes are (right, left). */
  private buildModel(saved: UltronModel): THREE.Vector3[] | null {
    let geometry: THREE.BufferGeometry
    try {
      geometry = new STLLoader().parse(saved.data.slice(0))
    } catch {
      return null
    }
    if (saved.up === "z") geometry.rotateX(-Math.PI / 2)
    geometry.rotateY((saved.turn * Math.PI) / 180)
    // Smooth across the facets, sharp across real edges.
    geometry = toCreasedNormals(geometry, Math.PI / 6)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    // Filling the core's frame: a helmet has no neck to leave room for.
    const scale = Math.min(4.7 / size.y, 5.0 / size.x)
    geometry.translate(-centre.x, -centre.y, -centre.z)
    geometry.scale(scale, scale, scale)
    geometry.translate(0, 0.05, 0)
    geometry.computeBoundingBox()
    const front = this.readFront(geometry)
    // The gem's own faces: those on the front surface inside its socket.
    // Ordered metal first, gem after, as two groups of one mesh.
    const position = geometry.getAttribute("position")
    const metalTris: number[] = []
    const gemTris: number[] = []
    const goldTris: number[] = []
    const faceTris: number[] = []
    const faceGoldTris: number[] = []
    const centroid = new THREE.Vector3()
    const gemCentre = new THREE.Vector3()
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    for (let t = 0; t < position.count / 3; t += 1) {
      a.fromBufferAttribute(position, t * 3)
      b.fromBufferAttribute(position, t * 3 + 1)
      c.fromBufferAttribute(position, t * 3 + 2)
      centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3)
      const tri = [t * 3, t * 3 + 1, t * 3 + 2]
      if (front.isGem(centroid)) {
        gemTris.push(...tri)
        gemCentre.add(centroid)
      } else if (front.isFace(centroid)) (front.isGold(centroid) ? faceGoldTris : faceTris).push(...tri)
      else if (front.isGold(centroid)) goldTris.push(...tri)
      else metalTris.push(...tri)
    }
    const body = [...metalTris, ...gemTris, ...goldTris]
    geometry.setIndex(body)
    geometry.clearGroups()
    geometry.addGroup(0, metalTris.length, 0)
    geometry.addGroup(metalTris.length, gemTris.length, 1)
    geometry.addGroup(metalTris.length + gemTris.length, goldTris.length, 2)
    this.model = new THREE.Mesh(geometry, [this.metal, this.gemMaterial, this.goldMaterial])
    // The ink line round it: the same surface pushed out a little along its
    // normals, drawn from the back in near-black (an inverted hull).
    this.model.add(inkOutline(geometry, 0.032, body))
    // The faceplate: its own mesh on the same surface, hung from its hinge
    // (the group sits at the hinge; the mesh back by it, so at rest it is
    // exactly where it was). The slots' screen rides on it.
    this.faceplate = null
    this.screen = front.screen
    this.hinge.copy(front.hinge)
    if (faceTris.length + faceGoldTris.length) {
      const plateGeometry = new THREE.BufferGeometry()
      plateGeometry.setAttribute("position", geometry.getAttribute("position"))
      plateGeometry.setAttribute("normal", geometry.getAttribute("normal"))
      plateGeometry.setIndex([...faceTris, ...faceGoldTris])
      plateGeometry.addGroup(0, faceTris.length, 0)
      plateGeometry.addGroup(faceTris.length, faceGoldTris.length, 1)
      const plate = new THREE.Mesh(plateGeometry, [this.metal, this.goldMaterial])
      plate.add(inkOutline(geometry, 0.032, [...faceTris, ...faceGoldTris]))
      plate.position.copy(front.hinge).negate()
      if (front.screen) plate.add(front.screen)
      this.faceplate = new THREE.Group()
      this.faceplate.position.copy(front.hinge)
      this.faceplate.add(plate)
      this.model.add(this.faceplate)
    } else if (front.screen) this.model.add(front.screen)
    // Vision's face inside: the sculpted sheet, his eyes, his lips.
    if (front.vision) {
      this.model.add(front.vision.sheet)
      this.builtFace.push(front.vision.sheet)
      front.vision.eyes.forEach((at, i) => {
        const eye = new VisionEye(front.vision!.eyeSize, i === 0 ? 1 : -1, this.bands)
        eye.group.position.copy(at)
        this.visionEyes.push(eye)
        this.builtFace.push(eye.group)
        this.model!.add(eye.group)
      })
    }
    this.mouth = null
    if (front.mouth) {
      const w = front.mouth.width
      this.mouth = new VisionMouth(w, w * 0.3, this.lipMaterial)
      this.mouth.group.position.copy(front.mouth.at)
      this.model.add(this.mouth.group)
      this.builtFace.push(this.mouth.group)
    }
    this.gemAt = null
    if (gemTris.length) {
      gemCentre.multiplyScalar(3 / gemTris.length)
      this.gemAt = gemCentre.clone()
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowMap, color: 0xffe08a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      glow.position.copy(gemCentre).add(new THREE.Vector3(0, 0, 0.12))
      glow.scale.setScalar(0.45)
      glow.userData.gemGlow = true
      this.model.add(glow)
      // The flare's shockwave: a ring that spreads from the stone.
      this.ring = new THREE.Mesh(
        new THREE.RingGeometry(0.16, 0.2, 64),
        new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      )
      this.ring.position.copy(gemCentre).add(new THREE.Vector3(0, 0, 0.15))
      this.model.add(this.ring)
    }
    this.head.add(this.model)
    void this.loadVision(this.model, front)
    return front.eyes
  }

  /** His own Vision sculpt, rigged (lib/vision-head.ts), set inside this
   *  helmet: as wide as the helmet's inside (about twice its eye slots'
   *  spacing), his eyes level with the slots, and set back so his nose
   *  sits just behind the closed faceplate. Without the mesh, the built
   *  face stays. */
  private async loadVision(model: THREE.Mesh, front: ReturnType<UltronFace["readFront"]>) {
    let bytes: Uint8Array
    try {
      bytes = await loadMesh(VISION_MESH)
    } catch {
      return
    }
    if (this.disposed || this.model !== model) return
    let head: VisionHead
    try {
      head = new VisionHead(new STLLoader().parse(bytes.slice().buffer), this.bands, this.renderer)
    } catch {
      return
    }
    const lm = head.landmarks
    const slots = front.eyes
    const spacing = Math.abs(slots[0].x - slots[1].x)
    const scale = (spacing * VISION_FIT) / Math.max(1e-3, lm.width)
    const eyeMid = lm.eyes[0].clone().add(lm.eyes[1]).multiplyScalar(0.5)
    const slotMid = slots[0].clone().add(slots[1]).multiplyScalar(0.5)
    head.group.scale.setScalar(scale)
    const noseAt = new THREE.Vector3(slotMid.x, slotMid.y + (lm.nose.y - eyeMid.y) * scale, 0)
    const shut = front.frontAt(noseAt.x, noseAt.y)
    head.group.position.set(
      slotMid.x - eyeMid.x * scale,
      slotMid.y - eyeMid.y * scale - VISION_DROP * spacing,
      (Number.isFinite(shut) ? shut : slotMid.z) - 0.07 - lm.nose.z * scale
    )
    model.add(head.group)
    this.visionHead = head
    for (const part of this.builtFace) part.visible = false
  }

  /** The model seen from the front: its depth, the eye slots (holes in the
   *  band where eyes sit, through to the inside) and the gem's socket above
   *  them. Returns a red honeycomb screen set just behind the slots (as the
   *  real helmet's mesh inserts are), where each side's slots are, and a
   *  test for which of its faces are the gem. */
  private readFront(geometry: THREE.BufferGeometry): {
    screen: THREE.Mesh | null
    eyes: THREE.Vector3[]
    /** Whether a point of the model is the gem: on its front surface, in the socket. */
    isGem: (p: THREE.Vector3) => boolean
    /** The faceplate: the helmet's face, brow to chin, which hinges up. */
    isFace: (p: THREE.Vector3) => boolean
    /** Its hinge: the axis (along x) through this point. */
    hinge: THREE.Vector3
    /** The gold framing the lower face. */
    isGold: (p: THREE.Vector3) => boolean
    /** Vision's face inside: the sculpted sheet, where his eyes go, and their size. */
    vision: { sheet: THREE.Mesh; eyes: THREE.Vector3[]; eyeSize: number } | null
    /** Where Vision's lips go, and how wide. */
    mouth: { at: THREE.Vector3; width: number } | null
    /** The closed helmet's front surface (z) at a point (x, y). */
    frontAt: (x: number, y: number) => number
  } {
    const box = geometry.boundingBox!
    const N = 512
    const depthRange = box.max.z - box.min.z + 0.2
    const camera = new THREE.OrthographicCamera(box.min.x, box.max.x, box.max.y, box.min.y, 0, depthRange)
    camera.position.set(0, 0, box.max.z + 0.1)
    const material = new THREE.ShaderMaterial({
      vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      // 16 bits of depth (high byte red, low green): a gem socket a couple
      // of millimetres deep is a handful of 8-bit steps, too few to find.
      fragmentShader:
        "void main() { float d = gl_FragCoord.z * 255.0; gl_FragColor = vec4(floor(d) / 255.0, fract(d), 0.0, 1.0); }",
      side: THREE.DoubleSide,
    })
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(geometry, material))
    const target = new THREE.WebGLRenderTarget(N, N)
    const renderer = this.renderer
    const previous = renderer.getRenderTarget()
    const clear = renderer.getClearColor(new THREE.Color())
    const alpha = renderer.getClearAlpha()
    const pixels = new Uint8Array(N * N * 4)
    renderer.setRenderTarget(target)
    renderer.setClearColor(0xffffff, 1)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.readRenderTargetPixels(target, 0, 0, N, N, pixels)
    // Cleared to white: background reads as depth 1 (both bytes full).
    renderer.setRenderTarget(previous)
    renderer.setClearColor(clear, alpha)
    target.dispose()
    material.dispose()

    // Rows here run bottom-up, as the GPU reads them.
    const depth = (px: number, py: number) => pixels[(py * N + px) * 4] / 255 + pixels[(py * N + px) * 4 + 1] / 65025
    const solid = (px: number, py: number) => depth(px, py) < 0.995
    let top = -1
    let bottom = N
    for (let py = 0; py < N; py += 1) {
      for (let px = 0; px < N; px += 1) {
        if (!solid(px, py)) continue
        top = Math.max(top, py)
        bottom = Math.min(bottom, py)
      }
    }
    const height = Math.max(1, top - bottom)
    const mid = N / 2

    // The face's front depth in the eye band (its median), and every pixel
    // well behind it there - seen through a slot - is an eye.
    const bandTop = Math.round(top - 0.22 * height)
    const bandBottom = Math.round(top - 0.6 * height)
    const band: number[] = []
    for (let py = bandBottom; py <= bandTop; py += 1) {
      for (let px = 0; px < N; px += 1) if (solid(px, py) && Math.abs(px - mid) < 0.3 * N) band.push(depth(px, py))
    }
    band.sort((a, b) => a - b)
    const face = band.length ? band[Math.floor(band.length * 0.35)] : 0.3
    const eye = new Uint8Array(N * N)
    const sides = [
      { n: 0, x: 0, y: 0, top: -1, bottom: N },
      { n: 0, x: 0, y: 0, top: -1, bottom: N },
    ]
    // A slot is a sudden drop: well behind the nearest surface around it
    // (a min filter, R pixels each way), where a side curving away is not.
    const R = 10
    const at = (px: number, py: number) => (solid(px, py) ? depth(px, py) : 1)
    const rowMin = new Float32Array(N * N).fill(1)
    for (let py = 0; py < N; py += 1) {
      if (py < 0 || py >= N) continue
      for (let px = 0; px < N; px += 1) {
        let m = 1
        for (let k = Math.max(0, px - R); k <= Math.min(N - 1, px + R); k += 1) m = Math.min(m, at(k, py))
        rowMin[py * N + px] = m
      }
    }
    const near = (px: number, py: number) => {
      let m = 1
      for (let k = Math.max(0, py - R); k <= Math.min(N - 1, py + R); k += 1) m = Math.min(m, rowMin[k * N + px])
      return m
    }
    for (let py = bandBottom; py <= bandTop; py += 1) {
      for (let px = 0; px < N; px += 1) {
        const off = Math.abs(px - mid) / N
        if (off < 0.04 || off > 0.3) continue
        const d = at(px, py)
        if (d - near(px, py) < 0.1 || d - face < 0.08) continue
        eye[py * N + px] = 1
        const side = sides[px > mid ? 0 : 1]
        side.n += 1
        side.x += px
        side.y += py
        side.top = Math.max(side.top, py)
        side.bottom = Math.min(side.bottom, py)
      }
    }

    // Specks are not slots: keep connected regions of a real size only.
    const seen = new Uint8Array(N * N)
    const stack: number[] = []
    for (let start = 0; start < N * N; start += 1) {
      if (!eye[start] || seen[start]) continue
      const region: number[] = []
      stack.push(start)
      seen[start] = 1
      while (stack.length) {
        const i = stack.pop()!
        region.push(i)
        for (const j of [i - 1, i + 1, i - N, i + N]) {
          if (j >= 0 && j < N * N && eye[j] && !seen[j]) {
            seen[j] = 1
            stack.push(j)
          }
        }
      }
      if (region.length < 300) for (const i of region) eye[i] = 0
    }
    for (const side of sides) Object.assign(side, { n: 0, x: 0, y: 0, top: -1, bottom: N })
    for (let py = bandBottom; py <= bandTop; py += 1) {
      for (let px = 0; px < N; px += 1) {
        if (!eye[py * N + px]) continue
        const side = sides[px > mid ? 0 : 1]
        side.n += 1
        side.x += px
        side.y += py
        side.top = Math.max(side.top, py)
        side.bottom = Math.min(side.bottom, py)
      }
    }

    // The eyes' light, for the screen behind the slots: glowing bars, white-
    // hot along their middle and red toward their edges, as the reference's
    // eyes are. Each pixel's depth into its slot (a chamfer distance) sets
    // how hot it is. Drawn top-down, so the canvas row is N - 1 - py.
    const dist = new Float32Array(N * N)
    for (let i = 0; i < N * N; i += 1) dist[i] = eye[i] ? 1e6 : 0
    for (let py = 1; py < N - 1; py += 1) for (let px = 1; px < N - 1; px += 1) {
      const i = py * N + px
      if (dist[i]) dist[i] = Math.min(dist[i], dist[i - 1] + 1, dist[i - N] + 1, dist[i - N - 1] + 1.4, dist[i - N + 1] + 1.4)
    }
    for (let py = N - 2; py > 0; py -= 1) for (let px = N - 2; px > 0; px -= 1) {
      const i = py * N + px
      if (dist[i]) dist[i] = Math.min(dist[i], dist[i + 1] + 1, dist[i + N] + 1, dist[i + N + 1] + 1.4, dist[i + N - 1] + 1.4)
    }
    const honeycomb = document.createElement("canvas")
    honeycomb.width = honeycomb.height = N
    const hctx = honeycomb.getContext("2d")!
    const image = hctx.createImageData(N, N)
    for (let py = Math.max(0, bandBottom - 6); py <= Math.min(N - 1, bandTop + 6); py += 1) {
      for (let px = 0; px < N; px += 1) {
        const i = py * N + px
        const o = ((N - 1 - py) * N + px) * 4
        const k = eye[i] ? Math.min(1, dist[i] / 7) : 0
        image.data[o] = eye[i] ? 255 : 90
        image.data[o + 1] = eye[i] ? 26 + 200 * k * k : 0
        image.data[o + 2] = eye[i] ? 44 + 190 * k * k : 8
        image.data[o + 3] = 255
      }
    }
    hctx.putImageData(image, 0, 0)

    // The slot cluster's rows: only rows with a real run of slot pixels, so
    // stray specks at the corners do not stretch it.
    let clusterTop = -1
    let clusterBottom = N
    for (let py = bandBottom; py <= bandTop; py += 1) {
      let n = 0
      for (let px = 0; px < N; px += 1) n += eye[py * N + px]
      if (n < 12) continue
      clusterTop = Math.max(clusterTop, py)
      clusterBottom = Math.min(clusterBottom, py)
    }
    const found = sides.every((side) => side.n > 20) && clusterTop > clusterBottom

    // The gem: the model's own socket for it - the recess on the centre line
    // just above the slots. Every pixel's recess is its depth behind the
    // nearest surface within a few pixels; the deepest one near the centre
    // line seeds a fill over the socket, out to where the recess fades.
    const gem = new Uint8Array(N * N)
    if (found) {
      const g0 = clusterTop - Math.round(0.04 * height)
      const g1 = Math.min(N - 1, clusterTop + Math.round(0.2 * height))
      const halfW = Math.round(0.08 * N)
      const RG = 6
      const recess = new Float32Array(N * N)
      for (let py = g0; py <= g1; py += 1) {
        for (let px = mid - halfW; px <= mid + halfW; px += 1) {
          let m = 2
          for (let dy = -RG; dy <= RG; dy += 1) for (let dx = -RG; dx <= RG; dx += 1) m = Math.min(m, at(px + dx, py + dy))
          recess[py * N + px] = at(px, py) - m
        }
      }
      let seed = -1
      let best = 0
      for (let py = g0; py <= g1; py += 1) {
        for (let px = mid - Math.round(0.015 * N); px <= mid + Math.round(0.015 * N); px += 1) {
          if (recess[py * N + px] > best && solid(px, py)) {
            best = recess[py * N + px]
            seed = py * N + px
          }
        }
      }
      if (seed >= 0) {
        const floor = best * 0.3
        const fill = [seed]
        gem[seed] = 1
        while (fill.length) {
          const i = fill.pop()!
          const px = i % N
          const py = Math.floor(i / N)
          for (const [qx, qy] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
            if (qx < mid - halfW || qx > mid + halfW || qy < g0 || qy > g1) continue
            const j = qy * N + qx
            if (gem[j] || !solid(qx, qy) || recess[j] < floor) continue
            gem[j] = 1
            fill.push(j)
          }
        }
        // Close it into the whole socket floor: fill the holes the facets
        // leave (pixels whose recess dips between ridges).
        for (let pass = 0; pass < 2; pass += 1) {
          const grown = gem.slice()
          for (let py = g0; py <= g1; py += 1) {
            for (let px = mid - halfW; px <= mid + halfW; px += 1) {
              const i = py * N + px
              if (gem[i] || !solid(px, py)) continue
              let n = 0
              for (const j of [i - 1, i + 1, i - N, i + N]) n += gem[j]
              if (n >= 3) grown[i] = 1
            }
          }
          gem.set(grown)
        }
      }
    }

    // The lower face: the openings below the eyes (the cheek hollows and
    // the mouth slot), the plate over the mouth that slides back, and the
    // gold that frames them, as on the reference.
    const low = new Uint8Array(N * N)
    const plateMask = new Uint8Array(N * N)
    const goldMask = new Uint8Array(N * N)
    let mouthBox: { x0: number; x1: number; y0: number; y1: number } | null = null
    let visionMouth: { at: THREE.Vector3; width: number } | null = null
    // The background around the outline: empty pixels reached from the
    // image's border. Empty pixels it does not reach are seen through the
    // helmet - an opening, like the mouth slot on a helmet open beneath.
    const outside = new Uint8Array(N * N)
    {
      const fill: number[] = []
      for (let k = 0; k < N; k += 1) for (const i of [k, (N - 1) * N + k, k * N, k * N + N - 1]) if (!solid(i % N, Math.floor(i / N)) && !outside[i]) { outside[i] = 1; fill.push(i) }
      while (fill.length) {
        const i = fill.pop()!
        const x = i % N
        for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, i - N, i + N]) {
          if (j < 0 || j >= N * N || outside[j] || solid(j % N, Math.floor(j / N))) continue
          outside[j] = 1
          fill.push(j)
        }
      }
    }
    if (found) {
      const lowTop = clusterBottom - 3
      const lowBottom = bottom + Math.round(0.04 * height)
      for (let py = lowBottom; py <= lowTop; py += 1) {
        for (let px = 0; px < N; px += 1) {
          if (Math.abs(px - mid) > 0.32 * N) continue
          const d = at(px, py)
          // An opening: deep, or seen right through - but never the background
          // round the outline.
          if (outside[py * N + px]) continue
          if (!solid(px, py) || (d - near(px, py) >= 0.1 && d - face >= 0.05)) low[py * N + px] = 1
        }
      }
      // Its pieces; the one on the centre line is the mouth.
      const seenLow = new Uint8Array(N * N)
      const pieces: number[][] = []
      for (let start = 0; start < N * N; start += 1) {
        if (!low[start] || seenLow[start]) continue
        const region: number[] = []
        const stack2 = [start]
        seenLow[start] = 1
        while (stack2.length) {
          const i = stack2.pop()!
          region.push(i)
          for (const j of [i - 1, i + 1, i - N, i + N]) if (j >= 0 && j < N * N && low[j] && !seenLow[j]) { seenLow[j] = 1; stack2.push(j) }
        }
        if (region.length < 150) for (const i of region) low[i] = 0
        else pieces.push(region)
      }
      let best = Infinity
      for (const region of pieces) {
        let x0 = N, x1 = 0, y0 = N, y1 = 0, cx = 0
        for (const i of region) {
          const x = i % N
          const y = Math.floor(i / N)
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); cx += x
        }
        cx /= region.length
        const off = Math.abs(cx - mid)
        if (off < 0.05 * N && off < best && x1 - x0 > 0.03 * N) {
          best = off
          mouthBox = { x0, x1, y0, y1 }
        }
      }
      if (mouthBox) {
        const halfMouth = (mouthBox.x1 - mouthBox.x0) / 2
        // The plate: over the mouth, from its slot up toward the eyes.
        const plateTop = mouthBox.y1 + Math.round(0.6 * (clusterBottom - mouthBox.y1))
        const plateHalf = Math.max(halfMouth * 0.98, 0.1 * N)
        for (let py = mouthBox.y0 - 2; py <= plateTop; py += 1) {
          for (let px = Math.round(mid - plateHalf); px <= Math.round(mid + plateHalf); px += 1) {
            if (solid(px, py) && !low[py * N + px]) plateMask[py * N + px] = 1
          }
        }
        // Gold: a band round the cheek hollows (not the plate's side), and
        // under the mouth.
        for (let py = lowBottom; py <= lowTop; py += 1) {
          for (let px = 0; px < N; px += 1) {
            const i = py * N + px
            if (low[i] || plateMask[i] || !solid(px, py)) continue
            const underMouth = Math.abs(px - mid) <= Math.max(halfMouth * 1.3, 0.12 * N) && py < mouthBox.y0 - 2 && py >= mouthBox.y0 - 7
            let byHollow = false
            if (Math.abs(px - mid) > Math.max(halfMouth * 0.98, 0.1 * N)) {
              for (let dy = -5; dy <= 5 && !byHollow; dy += 1) for (let dx = -5; dx <= 5; dx += 1) {
                const j = (py + dy) * N + px + dx
                if (low[j] && Math.abs(px + dx - mid) > halfMouth * 1.05) { byHollow = true; break }
              }
            }
            if (byHollow || underMouth) goldMask[i] = 1
          }
        }
      }
    }

    // The faceplate: the whole face of the helmet, brow to chin, as an Iron
    // Man helmet's is - the front surface between the cheeks, below the Mind
    // Stone (which stays on the brow, where Vision's own sits).
    let gemBottom = N
    for (let i = 0; i < N * N; i += 1) if (gem[i]) gemBottom = Math.min(gemBottom, Math.floor(i / N))
    let eyeOuter = 0
    for (let i = 0; i < N * N; i += 1) if (eye[i]) eyeOuter = Math.max(eyeOuter, Math.abs((i % N) - mid))
    if (!eyeOuter) eyeOuter = 0.24 * N
    const browPy = found ? Math.max(clusterTop + 3, Math.min(gemBottom - 3, clusterTop + Math.round(0.06 * height))) : Math.round(top - 0.25 * height)
    const lowest = mouthBox ? mouthBox.y0 : browPy - Math.round(0.45 * height)
    const chinPy = Math.max(bottom + 2, lowest - Math.round(0.1 * height))
    const faceSpan = Math.max(1, browPy - chinPy)
    /** The faceplate's half width at a row: the eye slots' reach at the
     *  brow, narrowing to the chin. */
    const eyesBottom = found ? clusterBottom - 4 : chinPy + 0.6 * faceSpan
    const faceHalf = (py: number) => (eyeOuter + 0.03 * N) * (0.62 + 0.38 * THREE.MathUtils.clamp((py - chinPy) / Math.max(1, eyesBottom - chinPy), 0, 1))
    const faceMask = new Uint8Array(N * N)
    for (let py = chinPy; py <= browPy; py += 1) {
      for (let px = 0; px < N; px += 1) if (solid(px, py) && !gem[py * N + px] && Math.abs(px - mid) <= faceHalf(py)) faceMask[py * N + px] = 1
    }
    const unitX = (box.max.x - box.min.x) / N
    const unitY = (box.max.y - box.min.y) / N
    // Hinged at the temples, as an Iron Man helmet's: at the brow's height,
    // well back in the head, so the plate swings up close over the dome.
    const hinge = new THREE.Vector3(0, box.min.y + browPy * unitY, box.min.z + 0.38 * (box.max.z - box.min.z))

    // Vision's face behind it: the MCU Vision's, sculpted to fill the
    // helmet - a sheet over the face's area following the helmet's own
    // curve (smoothed), set back, with the face's forms on it (brow, eye
    // sockets, nose, cheekbones, lips, chin) and kept everywhere behind the
    // faceplate - shown only while the plate is open.
    const eyeV = found ? ((clusterTop + clusterBottom) / 2 - chinPy) / faceSpan : 0.72
    const mouthV = mouthBox ? ((mouthBox.y0 + mouthBox.y1) / 2 - chinPy) / faceSpan : 0.28
    const noseV = mouthV + 0.36 * (eyeV - mouthV)
    const faceH = faceSpan * unitY
    const g = (x: number) => Math.exp(-x * x)
    /** The face's forms at (u across, v up), forward of the base, in units. */
    const relief = (u: number, v: number) => {
      const au = Math.abs(u)
      let r = -0.32 * Math.min(1.2, u * u)
      // Brow ridge, and the eye sockets under it.
      r += 0.05 * g((v - (eyeV + 0.13)) / 0.07) * g(u / 0.8)
      r -= 0.08 * g((au - 0.42) / 0.2) * g((v - eyeV) / 0.1)
      // The nose: a bridge between the eyes rising to the tip, its wings.
      const along = THREE.MathUtils.clamp((eyeV + 0.05 - v) / (eyeV + 0.05 - noseV), 0, 1)
      const below = v < noseV ? g((noseV - v) / 0.035) : 1
      r += (0.03 + 0.15 * Math.pow(along, 1.6)) * below * g(u / (0.07 + 0.07 * along))
      r += 0.045 * g((au - 0.13) / 0.06) * g((v - (noseV + 0.015)) / 0.035)
      // Cheekbones.
      r += 0.05 * g((au - 0.6) / 0.17) * g((v - (eyeV - 0.18)) / 0.1)
      // The lips' fullness, the groove under them, the chin.
      r += 0.05 * g(u / 0.38) * g((v - mouthV) / 0.08)
      r -= 0.03 * g(u / 0.28) * g((v - (mouthV - 0.1)) / 0.03)
      r += 0.06 * g(u / 0.3) * g((v - 0.08) / 0.09)
      return r * faceH
    }
    let vision: { sheet: THREE.Mesh; eyes: THREE.Vector3[]; eyeSize: number } | null = null
    const G2 = 160
    const step2 = N / G2
    /** The face's front: the eye band's depth. */
    const faceFront = box.max.z + 0.1 - face * depthRange
    const sheetZ = new Float32Array((G2 + 1) * (G2 + 1)).fill(NaN)
    {
      const covered = (gx: number, gy: number) => {
        for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
          const px = Math.round((gx + dx) * step2)
          const py = Math.round((gy + dy) * step2)
          if (px < 0 || py < 0 || px >= N || py >= N) continue
          if (py < chinPy - 4 || Math.abs(px - mid) > faceHalf(py) * 1.08) continue
          if (faceMask[py * N + px] || low[py * N + px]) return true
        }
        return false
      }
      const verts: number[] = []
      const uvs: number[] = []
      const base: number[] = []
      const slot2 = new Int32Array((G2 + 1) * (G2 + 1)).fill(-1)
      const back = 0.2 * faceH
      for (let gy = 0; gy <= G2; gy += 1) for (let gx = 0; gx <= G2; gx += 1) {
        if (!covered(gx, gy)) continue
        const px = Math.min(N - 1, Math.round(gx * step2))
        const py = Math.min(N - 1, Math.round(gy * step2))
        // Never out past the helmet's outline, into the background round it.
        if (outside[py * N + px]) continue
        // Seen right through the helmet there: only the face's own openings
        // (the mouth's slot), not the gaps under its sides.
        if (!solid(px, py) && Math.abs(px - mid) > faceHalf(py) * 0.7) continue
        // Nor where the nearest surface is deep in the helmet (the neck and
        // the jaw's inside, seen under it): a face is not that deep.
        if (near(px, py) - face > (0.55 * faceH) / depthRange) continue
        slot2[gy * (G2 + 1) + gx] = base.length
        base.push(box.max.z + 0.1 - near(px, py) * depthRange - back)
        verts.push(box.min.x + (gx / G2) * (box.max.x - box.min.x), box.min.y + (gy / G2) * (box.max.y - box.min.y), 0)
        const u = THREE.MathUtils.clamp((px - mid) / faceHalf(py), -1.3, 1.3)
        const v = THREE.MathUtils.clamp((py - chinPy) / faceSpan, -0.1, 1.1)
        uvs.push((u + 1.3) / 2.6, (v + 0.1) / 1.2)
      }
      // The helmet's curve without its grooves and slots: smoothed well.
      for (let pass = 0; pass < 14; pass += 1) {
        const z = base.slice()
        for (let gy = 0; gy <= G2; gy += 1) for (let gx = 0; gx <= G2; gx += 1) {
          const i = slot2[gy * (G2 + 1) + gx]
          if (i < 0) continue
          let sum = z[i]
          let n = 1
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const qx = gx + dx
            const qy = gy + dy
            if (qx < 0 || qy < 0 || qx > G2 || qy > G2) continue
            const j = slot2[qy * (G2 + 1) + qx]
            if (j >= 0) {
              sum += z[j]
              n += 1
            }
          }
          base[i] = sum / n
        }
      }
      for (let gy = 0; gy <= G2; gy += 1) for (let gx = 0; gx <= G2; gx += 1) {
        const i = slot2[gy * (G2 + 1) + gx]
        if (i < 0) continue
        const px = Math.min(N - 1, Math.round(gx * step2))
        const py = Math.min(N - 1, Math.round(gy * step2))
        const u = THREE.MathUtils.clamp((px - mid) / faceHalf(py), -1.3, 1.3)
        const v = (py - chinPy) / faceSpan
        const z = base[i] + relief(u, v)
        verts[i * 3 + 2] = z
        // A face is only so deep: past half its height behind its front
        // (the sides curling away), it ends - inside the helmet's sides.
        if (z < faceFront - 0.5 * faceH) continue
        sheetZ[gy * (G2 + 1) + gx] = z
      }
      const index: number[] = []
      for (let gy = 0; gy < G2; gy += 1) for (let gx = 0; gx < G2; gx += 1) {
        const cells = [gy * (G2 + 1) + gx, gy * (G2 + 1) + gx + 1, (gy + 1) * (G2 + 1) + gx, (gy + 1) * (G2 + 1) + gx + 1]
        const q = cells.map((k) => slot2[k])
        if (q.some((x) => x < 0) || cells.some((k) => Number.isNaN(sheetZ[k]))) continue
        index.push(q[0], q[1], q[2], q[2], q[1], q[3])
      }
      if (index.length) {
        const sheet = new THREE.BufferGeometry()
        sheet.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3))
        sheet.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
        sheet.setIndex(index)
        sheet.computeVertexNormals()
        this.visionMaterial.map?.dispose()
        this.visionMaterial.map = visionSkin(eyeV, mouthV, noseV)
        this.visionMaterial.needsUpdate = true
        const mesh = new THREE.Mesh(sheet, this.visionMaterial)
        mesh.add(inkOutline(sheet, 0.012))
        // Where the face is at a pixel: the sheet's nearest point.
        const onSheet = (px: number, py: number) => {
          const gx = Math.round(px / step2)
          const gy = Math.round(py / step2)
          const z = sheetZ[gy * (G2 + 1) + gx]
          return new THREE.Vector3(box.min.x + (gx / G2) * (box.max.x - box.min.x), box.min.y + (gy / G2) * (box.max.y - box.min.y), Number.isNaN(z) ? box.max.z - 0.3 : z)
        }
        const eyePy = chinPy + eyeV * faceSpan
        const eyes = [1, -1].map((side) => onSheet(mid + side * 0.36 * faceHalf(eyePy), eyePy).add(new THREE.Vector3(0, 0, 0.012)))
        vision = { sheet: mesh, eyes, eyeSize: 0.13 * faceHalf(eyePy) * unitX }
        // The lips on the face, sized to it rather than to the slot.
        if (mouthBox) {
          const mouthPy = chinPy + mouthV * faceSpan
          const at = onSheet(mid, mouthPy)
          const width = Math.min(((mouthBox.x1 - mouthBox.x0) / N) * (box.max.x - box.min.x) * 1.2, 0.62 * faceHalf(mouthPy) * unitX)
          visionMouth = { at: at.add(new THREE.Vector3(0, 0, -width * 0.04)), width }
        }
      }
    }
    void unitX
    // The screen: a sheet following the slots' rims, a little behind them,
    // covering the slots (and a margin), seen only through them.
    const G = 128
    const step = N / G
    const inside = (gx: number, gy: number) => {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const px = Math.round((gx + dx) * step)
          const py = Math.round((gy + dy) * step)
          if (px >= 0 && py >= 0 && px < N && py < N && eye[py * N + px]) return true
        }
      }
      return false
    }
    const verts: number[] = []
    const uvs: number[] = []
    const index: number[] = []
    const slot = new Int32Array((G + 1) * (G + 1)).fill(-1)
    for (let gy = 0; gy <= G; gy += 1) {
      for (let gx = 0; gx <= G; gx += 1) {
        if (!inside(gx, gy)) continue
        const px = Math.min(N - 1, Math.round(gx * step))
        const py = Math.min(N - 1, Math.round(gy * step))
        const rim = near(px, py)
        slot[gy * (G + 1) + gx] = verts.length / 3
        verts.push(
          box.min.x + (gx / G) * (box.max.x - box.min.x),
          box.min.y + (gy / G) * (box.max.y - box.min.y),
          box.max.z + 0.1 - rim * depthRange - 0.09,
        )
        uvs.push(gx / G, gy / G)
      }
    }
    for (let gy = 0; gy < G; gy += 1) {
      for (let gx = 0; gx < G; gx += 1) {
        const a = slot[gy * (G + 1) + gx]
        const b = slot[gy * (G + 1) + gx + 1]
        const c = slot[(gy + 1) * (G + 1) + gx]
        const d = slot[(gy + 1) * (G + 1) + gx + 1]
        if (a < 0 || b < 0 || c < 0 || d < 0) continue
        index.push(a, b, c, c, b, d)
      }
    }
    let screen: THREE.Mesh | null = null
    if (index.length) {
      const sheet = new THREE.BufferGeometry()
      sheet.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3))
      sheet.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
      sheet.setIndex(index)
      const map = new THREE.CanvasTexture(honeycomb)
      map.colorSpace = THREE.SRGBColorSpace
      screen = new THREE.Mesh(sheet, new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, toneMapped: false }))
    }

    const world = (px: number, py: number, d: number) =>
      new THREE.Vector3(
        box.min.x + ((px + 0.5) / N) * (box.max.x - box.min.x),
        box.min.y + ((py + 0.5) / N) * (box.max.y - box.min.y),
        box.max.z + 0.1 - d * depthRange + 0.05,
      )
    const eyes = found
      ? sides.map((side) => world(side.x / side.n, side.y / side.n, face))
      : [new THREE.Vector3(0.18 * (box.max.x - box.min.x), box.max.y - 0.4 * (box.max.y - box.min.y), box.max.z), new THREE.Vector3(-0.18 * (box.max.x - box.min.x), box.max.y - 0.4 * (box.max.y - box.min.y), box.max.z)]
    const isGem = (p: THREE.Vector3) => {
      const px = Math.floor(((p.x - box.min.x) / (box.max.x - box.min.x)) * N)
      const py = Math.floor(((p.y - box.min.y) / (box.max.y - box.min.y)) * N)
      if (px < 0 || py < 0 || px >= N || py >= N || !gem[py * N + px]) return false
      // On the front surface there, not the inside of the helmet behind it.
      const d = (box.max.z + 0.1 - p.z) / depthRange
      return Math.abs(d - depth(px, py)) < 0.01
    }
    const onFront = (p: THREE.Vector3, mask: Uint8Array) => {
      const px = Math.floor(((p.x - box.min.x) / (box.max.x - box.min.x)) * N)
      const py = Math.floor(((p.y - box.min.y) / (box.max.y - box.min.y)) * N)
      if (px < 0 || py < 0 || px >= N || py >= N || !mask[py * N + px]) return false
      return Math.abs((box.max.z + 0.1 - p.z) / depthRange - depth(px, py)) < 0.012
    }
    // The faceplate's faces: everything of the helmet in its area that is
    // in front of Vision's face - its skin, its walls, the slots' sides and
    // any inner layer - so nothing of it is left on his face when it opens.
    const isFace = (p: THREE.Vector3) => {
      const px = Math.floor(((p.x - box.min.x) / (box.max.x - box.min.x)) * N)
      const py = Math.floor(((p.y - box.min.y) / (box.max.y - box.min.y)) * N)
      if (px < 0 || py < 0 || px >= N || py >= N || !faceMask[py * N + px]) return false
      const z = sheetZ[Math.round(py / step2) * (G2 + 1) + Math.round(px / step2)]
      // Where the face has ended (curled away at its sides): all of it as
      // deep as the face goes.
      return p.z > (Number.isNaN(z) ? faceFront - 0.5 * faceH : z + 0.01)
    }
    return {
      screen,
      eyes,
      isGem,
      isFace,
      hinge,
      isGold: (p: THREE.Vector3) => onFront(p, goldMask),
      vision,
      mouth: visionMouth,
      frontAt: (x: number, y: number) => {
        const px = Math.floor(((x - box.min.x) / (box.max.x - box.min.x)) * N)
        const py = Math.floor(((y - box.min.y) / (box.max.y - box.min.y)) * N)
        if (px < 0 || py < 0 || px >= N || py >= N || !solid(px, py)) return -Infinity
        return box.max.z + 0.1 - near(px, py) * depthRange
      },
    }
  }

  update(dt: number, t: number, input: FaceInput) {
    const { status, amp, energy, look, sinceTyped, tint } = input
    const thinking = status === "thinking"

    // Gaze: the pointer or hand when there is one; Andrew's typing pulls it
    // down toward the chat; left alone, he looks about on his own.
    this.wander -= dt
    if (this.wander <= 0) {
      this.wander = 1.5 + Math.random() * 3.5
      this.wanderAt.set((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 0.7)
    }
    if (look) this.gazeTarget.set(look.x, look.y)
    else if (sinceTyped < 2.5) this.gazeTarget.set(0, 0.8)
    else if (thinking) this.gazeTarget.set(Math.sin(t * 0.9) * 0.5, -0.35)
    else this.gazeTarget.copy(this.wanderAt)
    this.gaze.lerp(this.gazeTarget, Math.min(1, dt * (look ? 7 : 4)))
    this.head.rotation.y = this.gaze.x * 0.5 + Math.sin(t * 0.37) * 0.04
    this.head.rotation.x = this.gaze.y * 0.28
    this.head.rotation.z = -this.gaze.x * 0.04

    // The red in him: the core's glow, the rim light, the irises - hotter
    // with energy and voice, pulsing while he thinks.
    const hot = 0.55 + energy * 0.5 + amp * 0.9 + (thinking ? 0.25 + 0.25 * Math.sin(t * 18) : 0)
    this.coreMaterial.color.copy(tint).multiplyScalar(Math.min(1.6, 0.5 + hot * 0.6))
    this.holo.tint.value.copy(tint)
    this.holo.heat.value = Math.min(1.5, hot * 0.7)
    this.holo.time.value += dt
    if (this.model) {
      const flicker = this.glitch > 0 && Math.random() < 0.4 ? 0.3 : 1
      const speaking = status === "speaking"
      const active = speaking || status === "listening" || status === "thinking"
      if (active) this.lastActive = t
      // The Mind Stone flares - light, a spreading ring, and its hum - as he
      // appears (back after being hidden) and each time he starts to speak.
      const appeared = t - this.lastSeen > 1.5
      if ((appeared || (speaking && !this.wasSpeaking)) && t - this.lastFlare > 6) {
        this.flare = 1
        this.lastFlare = t
        sfx.stoneHum()
      }
      this.lastSeen = t
      this.wasSpeaking = speaking
      this.flare = Math.max(0, this.flare - dt / 2.4)
      const f = this.flare
      this.gemMaterial.emissiveIntensity = (0.7 + hot * 0.35 + f * 3.5) * flicker
      if (this.ring) {
        const life = 1 - f
        const material = this.ring.material as THREE.MeshBasicMaterial
        material.opacity = f > 0 ? Math.pow(f, 1.5) * 0.9 : 0
        this.ring.scale.setScalar(1 + life * 9)
      }
      for (const child of this.model.children) {
        if (child.userData.gemGlow) {
          const sprite = child as THREE.Sprite
          ;(sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.5 + hot * 0.3 + f) * flicker
          sprite.scale.setScalar(0.45 * (1 + f * 3.2))
        }
      }
      if (this.screen) (this.screen.material as THREE.MeshBasicMaterial).color.setScalar(Math.min(1.5, 0.6 + hot * 0.45 + f * 0.4) * flicker)
      // The faceplate opens while he is engaged and closes after a quiet
      // quarter-minute: as an Iron Man helmet's, it unlatches and lifts
      // clear of the face, then swings up and back on its hinge into the
      // helmet, over his brow - at a machine's even pace, with its sound.
      const goal = t - this.lastActive < 15 ? 1 : 0
      if (goal !== this.plateGoal && this.faceplate) sfx.helm(goal === 1, HELM_S)
      this.plateGoal = goal
      this.plateOpen = THREE.MathUtils.clamp(this.plateOpen + (goal ? dt : -dt) / HELM_S, 0, 1)
      const o = this.plateOpen * this.plateOpen * (3 - 2 * this.plateOpen)
      if (this.faceplate) {
        // Out first (the first fifth), then up: the lift eases off as it swings.
        const lift = Math.sin(Math.min(1, this.plateOpen * 2.5) * Math.PI * 0.5) * (1 - o * 0.6)
        // Swung up, it slides back into the helmet under the dome and is
        // gone: open, the face is bare from the brow to the chin, framed by
        // the helmet's sides (as the What If...? helm is).
        const tuck = THREE.MathUtils.smoothstep(o, 0.45, 1)
        this.faceplate.position.copy(this.hinge).add(new THREE.Vector3(0, lift * 0.04 - o * 0.32 - tuck * 0.1, lift * 0.1 - o * 0.18 - tuck * 0.9))
        this.faceplate.rotation.x = -o * 1.62
        this.faceplate.scale.setScalar(1 - o * 0.1 - tuck * 0.15)
        this.faceplate.visible = this.plateOpen < 0.995
      }
      // His own eyes behind it: Vision's, following the same gaze as the
      // slots' light, blinking with it.
      for (const eye of this.visionEyes) eye.set(this.gaze, 1 - this.blink)
      // His face is there only while the plate is off it.
      const bare = !this.faceplate || this.plateOpen > 0.02
      this.model.traverse((node) => {
        if ((node as THREE.Mesh).material === this.visionMaterial) node.visible = bare && !this.visionHead
      })
      for (const eye of this.visionEyes) eye.group.visible = bare && !this.visionHead
      if (this.mouth) this.mouth.group.visible = bare && !this.visionHead
      if (this.visionHead) this.visionHead.group.visible = bare
      // The slots' blooms go with the faceplate.
      for (const bloom of this.eyeGlows) bloom.visible = o < 0.35
      // Vision's mouth: the letter being said now, opened by the voice's
      // loudness; between words, it rests.
      if (this.mouth || this.visionHead) {
        const shape = mouthShape()
        const voice = Math.min(1, amp * 2.6)
        const target = shape
          ? { ...shape, open: shape.open * (0.45 + 0.75 * voice) }
          : { open: speaking ? voice * 0.8 : 0, wide: 0.5, round: 0, press: 0, tuck: 0 }
        const k = Math.min(1, dt * 18)
        for (const key of ["open", "wide", "round", "press", "tuck"] as const) this.mouthNow[key] += (target[key] - this.mouthNow[key]) * k
        this.mouth?.set(this.mouthNow)
        this.visionHead?.set(this.mouthNow, this.gaze)
      }
    }
    this.rim.color.copy(tint)
    this.rim.intensity = 0.5 + hot * 0.4
    this.scanMaterial.color.copy(tint)

    // Irises: narrow while Andrew types or talks; blink now and then.
    this.blinkTimer -= dt
    if (this.blinkTimer <= 0) {
      this.blink = 1
      this.blinkTimer = 3 + Math.random() * 5
    }
    this.blink = Math.max(0, this.blink - dt * 7)
    const attending = sinceTyped < 2.5 || status === "listening"
    this.narrow += ((attending ? 0.4 : 0) - this.narrow) * Math.min(1, dt * 10)
    for (const iris of this.irises) iris.scale.y = Math.max(0.1, 1 - this.narrow - this.blink * 0.9)
    this.irisMaterial.color.copy(tint).lerp(new THREE.Color(0xffffff), Math.min(0.45, 0.15 + amp * 0.5))
    this.irisMaterial.visible = !(this.glitch > 0 && Math.random() < 0.5)
    for (const bloom of this.eyeGlows) {
      const material = bloom.material as THREE.SpriteMaterial
      material.color.copy(tint)
      material.opacity = Math.min(1, 0.45 + hot * 0.4) * (1 - this.blink * 0.8)
      bloom.scale.setScalar(0.3 + hot * 0.2)
    }

    // Jaw: with his voice; a slight part while thinking.
    const speaking = status === "speaking"
    const target = speaking ? Math.min(1, amp * 2.4) : thinking ? 0.08 : 0
    this.open += (target - this.open) * Math.min(1, dt * (speaking ? 18 : 6))
    const drop = this.open * 0.14
    this.jaw.position.y = -drop
    const mouth = this.mouthGlow.material as THREE.MeshBasicMaterial
    mouth.color.copy(tint)
    mouth.opacity = Math.min(0.95, this.open * 1.8)
    this.mouthGlow.scale.y = 1 + this.open * 3.5
    this.mouthGlow.position.y = L.mouthY - 0.02 - drop / 2

    // Thinking: a ring round the head, sweeping down it.
    this.scan.visible = thinking
    if (thinking) {
      const y = L.top - 0.15 - ((t * 0.9) % 1) * (L.top - L.chinY - 0.2)
      const ring = this.scan.geometry.getAttribute("position") as THREE.BufferAttribute
      for (let i = 0; i <= 64; i += 1) {
        const p = on(-Math.PI + (i / 64) * Math.PI * 2, y, 0.12)
        ring.setXYZ(i, p.x, p.y, p.z)
      }
      ring.needsUpdate = true
    }

    // Glitch: now and then (more often while he thinks) the head jumps
    // sideways for a few frames and the irises stutter.
    this.glitchTimer -= dt
    if (this.glitchTimer <= 0) {
      this.glitch = 0.12 + Math.random() * 0.15
      this.glitchTimer = thinking ? 0.8 + Math.random() * 1.5 : 4 + Math.random() * 7
    }
    this.glitch = Math.max(0, this.glitch - dt)
    if (this.glitch > 0) {
      this.head.position.x = (Math.random() - 0.5) * 0.16
      this.head.position.y = 0.05 + (Math.random() - 0.5) * 0.05
    } else {
      this.head.position.set(0, 0.05, 0)
    }

    const spin = thinking ? 2.4 : 1
    for (const shard of this.shards) {
      shard.phase += dt * shard.speed * spin * (1 + energy)
      shard.mesh.position.set(Math.cos(shard.phase) * shard.radius, Math.sin(shard.phase * 2) * 0.25 + shard.tilt, Math.sin(shard.phase) * shard.radius * 0.45)
      shard.mesh.rotation.x += dt * 1.3 * spin
      shard.mesh.rotation.y += dt * 0.9 * spin
    }
  }

  dispose() {
    this.disposed = true
    this.stopModel()
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | undefined
      material?.dispose()
    })
    this.environment.dispose()
  }
}
