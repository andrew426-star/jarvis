"use client"

import * as THREE from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { STLLoader } from "three/addons/loaders/STLLoader.js"
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js"

import type { AgentStatus } from "@/lib/store"
import { loadUltronModel, onUltronModelChange, type UltronModel } from "@/lib/ultron-model"

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

// --- the head ----------------------------------------------------------------

const SHARDS = 7

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
  private readonly metal: THREE.MeshStandardMaterial
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

  constructor(glow: THREE.Texture, color: number, renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    // Gunmetal, reflecting a studio room.
    const pmrem = new THREE.PMREMGenerator(renderer)
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    this.metal = new THREE.MeshStandardMaterial({ color: 0x474b52, metalness: 0.92, roughness: 0.3, envMap: this.environment, envMapIntensity: 0.7 })
    this.coreMaterial = new THREE.MeshBasicMaterial({ color, vertexColors: true })

    // Lights travel with the group, not the head, so turning shows the form.
    const key = new THREE.DirectionalLight(0xfff4ec, 2.6)
    key.position.set(-3, 4, 5)
    this.rim = new THREE.DirectionalLight(color, 3.2)
    this.rim.position.set(4, 1.5, -3)
    const under = new THREE.DirectionalLight(color, 0.6)
    under.position.set(0, -4, 2)
    this.group.add(key, this.rim, under, new THREE.AmbientLight(0xffffff, 0.12))

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

    this.head.add(this.sculpt)
    this.head.scale.setScalar(0.86)
    this.head.position.y = 0.05
    this.group.add(this.head)

    void this.loadModel()
    this.stopModel = onUltronModelChange(() => void this.loadModel())
  }

  // --- Andrew's own model ---------------------------------------------------

  private async loadModel() {
    const saved = await loadUltronModel()
    if (!this.disposed) this.showModel(saved)
  }

  private showModel(saved: UltronModel | null) {
    if (this.model) {
      this.head.remove(this.model)
      this.model.geometry.dispose()
      const material = this.model.material as THREE.MeshStandardMaterial
      material.emissiveMap?.dispose()
      material.dispose()
      for (const child of this.model.children) {
        const screen = child as THREE.Mesh
        screen.geometry.dispose()
        const sheet = screen.material as THREE.MeshBasicMaterial
        sheet.map?.dispose()
        sheet.dispose()
      }
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
    // Each vertex's place as seen from the front, so the glow mask (made
    // from that view) lands where it was found.
    const fitted = geometry.boundingBox!
    const position = geometry.getAttribute("position")
    const uv = new Float32Array(position.count * 2)
    for (let i = 0; i < position.count; i += 1) {
      uv[i * 2] = (position.getX(i) - fitted.min.x) / (fitted.max.x - fitted.min.x)
      uv[i * 2 + 1] = (position.getY(i) - fitted.min.y) / (fitted.max.y - fitted.min.y)
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
    const material = this.metal.clone()
    material.emissive.set(0xffffff)
    material.emissiveMap = front.mask
    material.emissiveIntensity = 1
    this.model = new THREE.Mesh(geometry, material)
    if (front.screen) this.model.add(front.screen)
    this.head.add(this.model)
    return front.eyes
  }

  /** The model seen from the front: its depth, the eye slots (holes in the
   *  band where eyes sit, through to the inside) and the gem above them.
   *  Returns the gem as a glow mask on the surface, a red honeycomb screen
   *  set just behind the slots (as the real helmet's mesh inserts are), and
   *  where each side's slots are, for the blooms. */
  private readFront(geometry: THREE.BufferGeometry): { mask: THREE.CanvasTexture; screen: THREE.Mesh | null; eyes: THREE.Vector3[] } {
    const box = geometry.boundingBox!
    const N = 512
    const depthRange = box.max.z - box.min.z + 0.2
    const camera = new THREE.OrthographicCamera(box.min.x, box.max.x, box.max.y, box.min.y, 0, depthRange)
    camera.position.set(0, 0, box.max.z + 0.1)
    const material = new THREE.ShaderMaterial({
      vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "void main() { gl_FragColor = vec4(vec3(gl_FragCoord.z), 1.0); }",
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
    renderer.setRenderTarget(previous)
    renderer.setClearColor(clear, alpha)
    target.dispose()
    material.dispose()

    // Rows here run bottom-up, as the GPU reads them.
    const depth = (px: number, py: number) => pixels[(py * N + px) * 4] / 255
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
    for (let py = bandBottom - R; py <= bandTop + R; py += 1) {
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

    // The honeycomb, for the screen behind the slots: drawn top-down, so
    // the canvas row is N - 1 - py.
    const honeycomb = document.createElement("canvas")
    honeycomb.width = honeycomb.height = N
    const hctx = honeycomb.getContext("2d")!
    const image = hctx.createImageData(N, N)
    const HEX = 7
    for (let py = 0; py < N; py += 1) {
      for (let px = 0; px < N; px += 1) {
        if (py < bandBottom - 4 || py > bandTop + 4) continue
        // A honeycomb: bright cell walls, dimmer cells.
        const qx = px / (HEX * 1.732)
        const qy = py / HEX - (Math.floor(qx) % 2) * 0.5
        const fx = qx - Math.floor(qx) - 0.5
        const fy = qy - Math.floor(qy) - 0.5
        const wall = Math.max(Math.abs(fx) * 1.6, Math.abs(fy)) > 0.38 ? 1 : 0.45
        const o = ((N - 1 - py) * N + px) * 4
        image.data[o] = 255 * wall
        image.data[o + 1] = 18 * wall
        image.data[o + 2] = 40 * wall
        image.data[o + 3] = 255
      }
    }
    hctx.putImageData(image, 0, 0)

    // The gem's mask, on the surface: drawn top-down too.
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = N
    const ctx = canvas.getContext("2d")!

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
    if (found) {
      // The gem: a shield of light on the centre line, its point at the top
      // of the upper slots - on the reference, 0.19 of the helmet's height
      // and 0.7 as wide as it is tall.
      const h = Math.max(8, 0.19 * height)
      const w = h * 0.7
      const cy = N - 1 - (clusterTop + h / 2 - h * 0.05)
      ctx.save()
      ctx.translate(mid, cy)
      const gem = ctx.createLinearGradient(0, -h / 2, 0, h / 2)
      gem.addColorStop(0, "#fff3a0")
      gem.addColorStop(0.45, "#ffc21a")
      gem.addColorStop(1, "#ff8a00")
      ctx.fillStyle = gem
      ctx.beginPath()
      ctx.moveTo(-w / 2, -h / 2)
      ctx.lineTo(w / 2, -h / 2)
      ctx.lineTo(w / 2, h * 0.12)
      ctx.lineTo(0, h / 2)
      ctx.lineTo(-w / 2, h * 0.12)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = "rgba(255, 255, 255, 0.7)"
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, -h / 2)
      ctx.lineTo(0, h / 2)
      ctx.moveTo(-w / 2, -h / 2)
      ctx.lineTo(0, -h * 0.05)
      ctx.lineTo(w / 2, -h / 2)
      ctx.stroke()
      ctx.restore()
    }
    const mask = new THREE.CanvasTexture(canvas)
    mask.colorSpace = THREE.SRGBColorSpace

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
    return { mask, screen, eyes }
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
    if (this.model) {
      const flicker = this.glitch > 0 && Math.random() < 0.4 ? 0.3 : 1
      ;(this.model.material as THREE.MeshStandardMaterial).emissiveIntensity = (0.6 + hot * 0.4) * flicker
      const screen = this.model.children[0] as THREE.Mesh | undefined
      if (screen) (screen.material as THREE.MeshBasicMaterial).color.setScalar(Math.min(1.4, 0.55 + hot * 0.45) * flicker)
    }
    this.rim.color.copy(tint)
    this.rim.intensity = 2.6 + hot * 1.2
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
