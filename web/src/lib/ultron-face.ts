"use client"

import * as THREE from "three"

import type { AgentStatus } from "@/lib/store"

// Ultron's head, for the console's centre in serious mode (lib/core-cipher.ts
// swaps it in for Jarvis's cipher). Built and checked against two Age of
// Ultron references - ILM's "Ultron cheek V2" sculpt (A. Jaeger, 2014, a
// three-quarter view) and the Marvel Studios archive replica (front):
//
//   cranium   a tall oval, swept back; the crest band runs unbroken from
//             the crown down the forehead, between the eyes and into the
//             muzzle; long plates sweep back over the skull, broken into
//             panels; red light leaks from cracks on the side
//   brow      massive, overhanging, three furrows over each eye running up
//             and out from the centre
//   eyes      small round red irises deep in mechanical sockets
//   muzzle    the nose plate, narrowest between the eyes and widening to a
//             flat bottom edge that is the upper lip; a ridge down its
//             middle, an M cut in its lower half, a notch at its foot
//   cheeks    a large ringed aperture each, centred just below the mouth,
//             its rim the face's edge; a thick C-plate wraps it from the
//             eye's outer corner round the outside and under it, with a
//             column of glowing slats along the plate beside the fin root
//   chin      vertical ribbed plates under the mouth, a round disc at the
//             very bottom of the chin
//   fins      a crescent from each temple at brow height, around the
//             outside of the cheek aperture, ending level with the chin
//   neck      a thick segmented column
//
// Every proportion is in LAYOUT, measured off the references (see the
// numbers there), so a correction is a number, not a hunt.
//
// It is drawn as a hologram: a shell lit at its edges (fresnel) that hides
// what is behind it, with every seam laid on the surface. It pays attention:
// the head follows the pointer or a hand, the lids narrow when Andrew types,
// he looks about on his own, the jaw moves with his voice, a scan rings the
// head while he thinks, and it glitches now and then.

type XY = [number, number]

// Units: head half-width at the cheeks = 1.3. References, by ILM pixel rows:
// crown 95, eyes 500, mouth 835, chin 1140 -> crown-eye : eye-mouth :
// mouth-chin = 1.21 : 1 : 0.91. Replica, as fractions of the half-width:
// eyes 0.41 from the centre, cheek aperture radius 0.45 centred 0.65 out,
// chin 0.47 of the full width, fins bulging 0.26 beyond the head.
const LAYOUT = {
  top: 2.3,
  eyeY: 0.68,
  mouthY: -0.64,
  chinY: -1.95,
  browY: 0.9, // the brow ridge above the eye's centre, at the eye
  eyeX: 0.45,
  halfWidth: { crown: 1.2, brow: 1.24, cheek: 1.38, chin: 0.6 },
  mouthHalf: 0.3,
  bridge: 0.15, // the band's half-width between the eyes
  band: 0.24, // ...on the forehead
  muzzleFoot: 0.34, // ...at the upper lip
  cheek: { x: 0.8, y: -0.88, r: 0.56 },
  chinDisc: { y: -1.72, r: 0.16 },
  fin: [
    [1.04, 1.02, -0.62], [1.5, 0.6, -0.44], [1.76, -0.3, -0.12], [1.62, -1.15, 0.14], [1.18, -1.76, 0.34],
  ] as [number, number, number][],
  neck: { r: 0.74, top: -1.55, bottom: -3.4, z: -0.4 },
}
const L = LAYOUT

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const bump = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) =>
  Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2)
const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t))

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
    // Temples to the cheeks: widening to the apertures' rims.
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

/** The features, as a push out of (or into) the face at x, y. */
function relief(x: number, y: number): number {
  const ax = Math.abs(x)
  // The centre band: low on the skull, higher between the eyes, standing
  // furthest out at the foot of the muzzle.
  const edge = smooth(-0.05, 0.04, bandHalf(y) - ax)
  const height = y > L.eyeY ? 0.05 + 0.04 * smooth(L.browY + 0.4, L.eyeY, y) : 0.09 + 0.26 * ((L.eyeY - y) / (L.eyeY - L.mouthY)) ** 0.9
  const band = height * edge * smooth(L.mouthY - 0.06, L.mouthY + 0.03, y)
  // Brow: an overhanging ridge, dipping into the band at the centre.
  const browAt = L.browY - 0.1 + 0.3 * Math.min(1, ax / 0.95) - 0.5 * Math.max(0, ax - 0.95)
  const brow = 0.17 * Math.exp(-(((y - browAt) / 0.1) ** 2)) * smooth(1.25, 1.0, ax) * smooth(0.08, 0.2, ax)
  const socket = -0.19 * bump(ax, y, L.eyeX, L.eyeY, 0.27, 0.15)
  // Cheek aperture: a raised rim round a recessed iris of blades.
  const { x: cx, y: cy, r } = L.cheek
  const dr = Math.hypot(ax - cx, y - cy)
  const cheek = 0.06 * Math.exp(-(((dr - r) / 0.08) ** 2)) - 0.07 * smooth(r * 0.85, r * 0.3, dr)
  // Chin: the ribbed column and the disc at its foot.
  const ribs = 0.05 * smooth(0.3, 0.2, ax) * smooth(L.mouthY - 0.05, L.mouthY - 0.15, y) * smooth(L.chinY, L.chinDisc.y, y)
  const disc = 0.1 * bump(x, y, 0, L.chinDisc.y, 0.19, 0.17)
  const mouth = -0.05 * Math.exp(-(((y - L.mouthY) / 0.03) ** 2)) * smooth(L.mouthHalf + 0.1, L.mouthHalf, ax)
  return band + brow + socket + cheek + ribs + disc + mouth
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

/** A point on the surface lifted off it along the normal, so lines sit on the shell. */
function on(theta: number, y: number, lift = 0.018): THREE.Vector3 {
  const e = 0.004
  const yy = Math.min(L.top - 2 * e, Math.max(L.chinY + e, y))
  const p = P(theta, yy)
  const du = P(theta + e, yy).sub(P(theta - e, yy))
  const dv = P(theta, yy + e).sub(P(theta, yy - e))
  const n = du.cross(dv).normalize()
  return p.addScaledVector(n, lift)
}

const thetaAt = (x: number, y: number) => Math.asin(Math.max(-0.995, Math.min(0.995, x / Math.max(1e-3, section(y).w))))

/** Face coordinates (x, y as seen from the front) onto the surface. */
const face = (x: number, y: number, lift?: number) => on(thetaAt(x, y), y, lift)

/** Key points of the head, in its own frame, for render checks against the references. */
export function ultronLandmarks(): Record<string, THREE.Vector3> {
  const side = (x: number, y: number) => new THREE.Vector3(section(y).w * Math.sign(x || 1), y, 0)
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
    sideAtCheek: side(1, L.cheek.y),
    sideAtEye: side(1, L.eyeY),
    sideAtChin: side(1, L.chinY + 0.05),
    finOut: new THREE.Vector3(...L.fin[2]),
    finTop: new THREE.Vector3(...L.fin[0]),
    finEnd: new THREE.Vector3(...L.fin[4]),
  }
}

// --- line building -----------------------------------------------------------

class Lines {
  readonly points: number[] = []

  /** A polyline in face coordinates, densified so it follows the surface. */
  path(xy: XY[], mirror = true, closed = false, lift?: number) {
    const sides = mirror ? [1, -1] : [1]
    for (const side of sides) {
      const pts: THREE.Vector3[] = []
      const list = closed ? [...xy, xy[0]] : xy
      for (let i = 0; i < list.length - 1; i += 1) {
        const [x0, y0] = list[i]
        const [x1, y1] = list[i + 1]
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.035))
        for (let k = 0; k < n; k += 1) pts.push(face((x0 + ((x1 - x0) * k) / n) * side, y0 + ((y1 - y0) * k) / n, lift))
      }
      const [xl, yl] = list[list.length - 1]
      pts.push(face(xl * side, yl, lift))
      this.strip(pts)
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, from = 0, to = Math.PI * 2, mirror = true, lift?: number) {
    const n = Math.max(12, Math.ceil(((to - from) * Math.max(rx, ry)) / 0.03))
    const xy: XY[] = []
    for (let i = 0; i <= n; i += 1) {
      const a = from + ((to - from) * i) / n
      xy.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
    }
    this.path(xy, mirror, false, lift)
  }

  /** A line over the skull at x(y): up the front, over the top, down the back. */
  meridian(xOf: (y: number) => number, y0: number, yBack: number, mirror = true) {
    for (const side of mirror ? [1, -1] : [1]) {
      const pts: THREE.Vector3[] = []
      let y = y0
      while (y < L.top) {
        const x = xOf(y)
        if (Math.abs(x) >= section(y).w * 0.97) break
        pts.push(on(Math.asin(x / section(y).w) * side, y))
        y += 0.03
      }
      for (let yb = y - 0.03; yb >= yBack; yb -= 0.03) {
        const x = Math.min(xOf(yb), section(yb).w * 0.97)
        pts.push(on((Math.PI - Math.asin(x / section(yb).w)) * side, yb))
      }
      this.strip(pts)
    }
  }

  /** A line in surface coordinates (theta, y). */
  surface(ty: XY[], mirror = true, lift?: number) {
    for (const side of mirror ? [1, -1] : [1]) this.strip(ty.map(([t, y]) => on(t * side, y, lift)))
  }

  strip(pts: THREE.Vector3[]) {
    for (let i = 0; i < pts.length - 1; i += 1) this.points.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z)
  }

  build(material: THREE.Material): THREE.LineSegments {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.points, 3))
    const lines = new THREE.LineSegments(geometry, material)
    lines.renderOrder = 1
    return lines
  }
}

// A little deterministic noise for the cracks, so they are the same every load.
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

// --- the hologram shell --------------------------------------------------------

const SHELL_VERTEX = `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`

const SHELL_FRAGMENT = `
uniform vec3 tint;
uniform float glow;
uniform float base;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec3 n = normalize(vNormal);
  float rim = pow(1.0 - abs(dot(n, vView)), 2.4);
  float key = max(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0);
  gl_FragColor = vec4(tint * (base + 0.05 * key + 0.7 * rim * glow), 1.0);
}`

function shellMaterial(color: number, base = 0.012, side: THREE.Side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(color) }, glow: { value: 1 }, base: { value: base } },
    vertexShader: SHELL_VERTEX,
    fragmentShader: SHELL_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    // It writes depth, so the seams and the far side behind it are hidden.
    depthWrite: true,
    side,
  })
}

function headGeometry(): THREE.BufferGeometry {
  const NT = 128
  const NY = 120
  const positions: number[] = []
  for (let j = 0; j <= NY; j += 1) {
    const y = L.chinY + ((L.top - 0.002 - L.chinY) * j) / NY
    for (let i = 0; i <= NT; i += 1) {
      const p = P(-Math.PI + (Math.PI * 2 * i) / NT, y)
      positions.push(p.x, p.y, p.z)
    }
  }
  const index: number[] = []
  for (let j = 0; j < NY; j += 1) {
    for (let i = 0; i < NT; i += 1) {
      const a = j * (NT + 1) + i
      const b = a + NT + 1
      index.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

// The temple fin: a crescent from the temple at brow height, round the
// outside of the cheek aperture, to the chin.
function finCurve(scale: number): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(L.fin.map(([x, y, z]) => new THREE.Vector3(x * scale, y, z)))
}

function finRibbon(curve: THREE.CatmullRomCurve3, width: number, side: number, outline: Lines): THREE.BufferGeometry {
  const N = 48
  const positions: number[] = []
  const inner: THREE.Vector3[] = []
  const outer: THREE.Vector3[] = []
  for (let i = 0; i <= N; i += 1) {
    const s = i / N
    const c = curve.getPoint(s)
    const t = curve.getTangent(s)
    const across = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0, 0, 1)).normalize()
    // Thick through the middle, tapering to the root and to a point at the tip.
    const w = (0.03 + width * Math.sin(Math.PI * Math.min(1, s * 1.15)) ** 0.7) / 2
    const a = c.clone().addScaledVector(across, w)
    const b = c.clone().addScaledVector(across, -w)
    a.x *= side
    b.x *= side
    inner.push(a)
    outer.push(b)
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }
  outline.strip(inner)
  outline.strip(outer)
  outline.strip([inner[0], outer[0]])
  outline.strip([inner[N], outer[N]])
  const index: number[] = []
  for (let i = 0; i < N; i += 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
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
  private readonly jaw = new THREE.Group()
  private readonly lids: THREE.Group[] = []
  private readonly irises: THREE.Group[] = []
  private readonly shells: THREE.ShaderMaterial[] = []
  private readonly dim: THREE.LineBasicMaterial
  private readonly main: THREE.LineBasicMaterial
  private readonly hot: THREE.LineBasicMaterial
  private readonly irisMaterial: THREE.MeshBasicMaterial
  private readonly eyeGlows: THREE.Sprite[] = []
  private readonly mouthGlow: THREE.Mesh
  private readonly mouthBase: Float32Array
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
  private lidClose = 0

  constructor(glow: THREE.Texture, color: number) {
    const lineMaterial = (opacity: number) =>
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
    this.dim = lineMaterial(0.32)
    this.main = lineMaterial(0.75)
    this.hot = lineMaterial(1)

    const shell = shellMaterial(color)
    this.shells.push(shell)
    const skull = new THREE.Mesh(headGeometry(), shell)
    skull.renderOrder = -10
    this.head.add(skull)

    const dim = new Lines()
    const main = new Lines()
    const hot = new Lines()
    const { eyeX, eyeY, browY, mouthY } = L

    // The centre band, unbroken from the back of the skull to the upper lip:
    // its two edges, and a ridge down the middle of the muzzle.
    const bandEdge: XY[] = []
    for (let y = L.top - 0.35; y >= mouthY + 0.02; y -= 0.05) bandEdge.push([bandHalf(y), y])
    main.path(bandEdge)
    main.meridian(() => L.band, L.top - 0.36, 0.2)
    dim.path([[0.05, eyeY + 0.05], [0.07, mouthY + 0.35]])
    // An inset plate high on the forehead, in the band.
    main.path([[0, L.top - 0.38], [0.13, L.top - 0.4], [0.13, L.top - 0.66], [0.07, L.top - 0.72], [0, L.top - 0.72]])
    dim.path([[0, L.top - 0.85], [0.1, L.top - 0.9], [0.1, browY + 0.35]])
    // The muzzle: an M cut in its lower half, a notch at its foot, the lip edge.
    // The M: two square-sided slots joined across the ridge.
    dim.path([[0, mouthY + 0.46], [0.07, mouthY + 0.38], [0.15, mouthY + 0.46], [0.15, mouthY + 0.26]])
    main.path([[0, mouthY + 0.2], [0.07, mouthY + 0.2], [0.07, mouthY + 0.04], [0, mouthY + 0.04]])
    main.path([[0, mouthY + 0.015], [0.2, mouthY + 0.012], [L.muzzleFoot, mouthY + 0.02]])
    dim.path([[0.2, mouthY + 0.75], [0.3, mouthY + 0.2]])

    // Cranium: long plates sweeping back from the brow, broken into panels.
    // They fan up and out from the brow's centre like flames, at close to
    // 45 degrees, run off the side of the dome and sweep down the back.
    const sweeps: [number, number, number][] = [[0.3, 0.42, browY + 0.24], [0.42, 0.58, browY + 0.2], [0.58, 0.66, browY + 0.14], [0.78, 0.55, browY + 0.06]]
    sweeps.forEach(([x0, k, y0], i) => (i === 1 ? hot : i % 2 === 0 ? main : dim).meridian((y) => x0 + k * (y - browY), y0, 0.4 + i * 0.15))
    const random = rng(11)
    for (let k = 0; k < 14; k += 1) {
      const i = k % 3
      const [xa, ka] = sweeps[i]
      const [xb, kb] = sweeps[i + 1]
      const y = browY + 0.35 + random() * (L.top - browY - 0.75)
      dim.path([[xa + ka * (y - browY), y], [xb + kb * (y + 0.06 - browY), y + 0.06]])
    }
    for (const [yy, from, to] of [[1.75, 1.1, 2.7], [1.3, 1.3, 2.5]] as [number, number, number][]) {
      const ty: XY[] = []
      for (let t = from; t <= to; t += 0.04) ty.push([t, yy + 0.07 * Math.sin(t * 3)])
      dim.surface(ty)
    }
    // Red light from cracks on the side of the skull.
    for (let k = 0; k < 5; k += 1) {
      const ty: XY[] = []
      let t = 0.9 + random() * 0.9
      let y = browY + 0.2 + random() * 0.9
      for (let i = 0; i < 6; i += 1) {
        ty.push([t, y])
        t += 0.06 + random() * 0.09
        y += (random() - 0.55) * 0.12
      }
      ;(k < 3 ? hot : main).surface(ty, k % 2 === 0)
    }

    // Brow: the overhanging ridge, and three furrows up and out from the centre.
    main.path([[0.12, browY - 0.14], [0.4, browY - 0.04], [0.7, browY + 0.1], [0.96, browY + 0.2], [1.12, browY + 0.02]])
    main.path([[0.13, browY - 0.1], [0.4, browY], [0.7, browY + 0.14], [0.94, browY + 0.25]], true, false, 0.035)
    for (let f = 0; f < 3; f += 1) {
      const dy = 0.13 + f * 0.1
      dim.path([[0.2 + f * 0.03, browY + dy - 0.06], [0.5, browY + dy + 0.06], [0.8 - f * 0.05, browY + dy + 0.18 + f * 0.02]])
    }

    // Eyes: the socket and its mechanical plates; the lids (which move).
    main.path([[0.16, eyeY + 0.06], [0.32, eyeY + 0.2], [0.6, eyeY + 0.24], [0.86, eyeY + 0.14], [0.94, eyeY - 0.04], [0.8, eyeY - 0.2], [0.52, eyeY - 0.25], [0.28, eyeY - 0.18], [0.16, eyeY - 0.04]], true, true)
    dim.ellipse(L.cheek.x, L.cheek.y, L.cheek.r + 0.14, L.cheek.r + 0.14, 1.2, 2.5)
    dim.path([[0.8, eyeY - 0.2], [1.02, eyeY - 0.26]])
    dim.path([[0.28, eyeY - 0.18], [0.24, eyeY - 0.38]])
    for (const side of [1, -1]) {
      const lid = new Lines()
      lid.path([[0.25, eyeY], [0.36, eyeY + 0.1], [0.52, eyeY + 0.13], [0.68, eyeY + 0.1], [0.8, eyeY + 0.01]].map(([x, y]) => [x * side, y] as XY), false, false, 0.03)
      const lower = new Lines()
      lower.path([[0.25, eyeY], [0.38, eyeY - 0.09], [0.54, eyeY - 0.12], [0.7, eyeY - 0.08], [0.8, eyeY + 0.01]].map(([x, y]) => [x * side, y] as XY), false, false, 0.03)
      const group = new THREE.Group()
      group.add(lid.build(this.main))
      this.lids.push(group)
      this.head.add(group, lower.build(this.main))
    }
    this.irisMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    for (const side of [1, -1]) {
      const at = face(eyeX * side, eyeY, 0.02)
      const iris = new THREE.Group()
      iris.position.copy(at)
      iris.lookAt(at.clone().add(new THREE.Vector3(side * 0.15, 0.05, 1)))
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.032, 0.082, 40), this.irisMaterial)
      ring.renderOrder = 2
      iris.add(ring)
      for (const r of [0.1, 0.125]) {
        const loop = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(Array.from({ length: 40 }, (_, i) => new THREE.Vector3(Math.cos((i / 40) * Math.PI * 2) * r, Math.sin((i / 40) * Math.PI * 2) * r, 0))),
          r < 0.11 ? this.hot : this.main,
        )
        loop.renderOrder = 2
        iris.add(loop)
      }
      const bloom = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      bloom.scale.setScalar(0.55)
      bloom.position.z = 0.05
      bloom.renderOrder = 3
      iris.add(bloom)
      this.eyeGlows.push(bloom)
      this.irises.push(iris)
      this.head.add(iris)
    }

    // Cheeks: the aperture - rim, rings, twisted blades, a hot centre - and
    // the thick C-plate wrapping it from the eye's outer corner, round the
    // outside, and under it.
    const { x: cx, y: cy, r } = L.cheek
    main.ellipse(cx, cy, r, r)
    dim.ellipse(cx, cy, r * 0.8, r * 0.8)
    main.ellipse(cx, cy, r * 0.55, r * 0.55)
    main.ellipse(cx, cy, r * 0.97, r * 0.97)
    dim.ellipse(cx, cy, r * 0.32, r * 0.32)
    hot.ellipse(cx, cy, r * 0.12, r * 0.12)
    for (let k = 0; k < 10; k += 1) {
      const a = (k / 10) * Math.PI * 2
      const xy: XY[] = []
      for (let i = 0; i <= 6; i += 1) {
        const rr = r * (0.32 + (0.48 * i) / 6)
        const b = a + (0.75 * i) / 6
        xy.push([cx + Math.cos(b) * rr, cy + Math.sin(b) * rr])
      }
      dim.path(xy)
    }
    // It runs up the side of the head to the temple at eye level (beside the
    // fin root), so it is centred out and up from the aperture and tall.
    const pc: XY = [cx + 0.2, cy + 0.3]
    main.ellipse(pc[0], pc[1], r + 0.02, r + 0.5, -2.75, 1.5)
    main.ellipse(pc[0], pc[1], r + 0.1, r + 0.6, -2.7, 1.5)
    // The cheekbone: from the eye's outer corner down to the aperture's top.
    main.path([[0.86, eyeY - 0.16], [0.9, eyeY - 0.5], [cx + 0.08, cy + r + 0.02]])
    // The glowing slats along the plate, beside the fin root.
    for (let k = 0; k < 9; k += 1) {
      const a = 1.3 - k * 0.12
      const p0: XY = [pc[0] + Math.cos(a) * (r + 0.03), pc[1] + Math.sin(a) * (r + 0.52)]
      const p1: XY = [pc[0] + Math.cos(a) * (r + 0.09), pc[1] + Math.sin(a) * (r + 0.58)]
      hot.path([p0, p1])
    }

    // Temple: vents behind the eye, and the socket the fin roots in.
    for (let k = 0; k < 4; k += 1) dim.path([[0.98, eyeY - 0.1 + k * 0.07], [1.12, eyeY - 0.08 + k * 0.07]])
    main.ellipse(1.06, browY + 0.12, 0.07, 0.1)

    // Mouth: the lower lip and its plates, the ribbed chin and its disc ride
    // on the jaw, which drops when he speaks.
    for (const x of [0.07, 0.15, 0.23]) dim.path([[x, mouthY + 0.1], [x, mouthY + 0.01]])
    const jaw = new Lines()
    const jawHot = new Lines()
    const lowerLip = mouthY - 0.14
    jaw.path([[0, lowerLip], [0.18, lowerLip + 0.01], [L.mouthHalf + 0.04, mouthY - 0.01]])
    // The chin's ribs, down to the disc.
    for (const x of [0, 0.1, 0.2]) jaw.path([[x, lowerLip - 0.04], [x * 0.9, L.chinDisc.y + L.chinDisc.r + 0.02]], x !== 0)
    jaw.path([[0.3, lowerLip - 0.02], [0.32, L.chinDisc.y + 0.05], [0.2, L.chinY + 0.04]])
    jaw.path([[0.52, mouthY - 0.3], [0.5, L.chinY + 0.25], [0.32, L.chinY + 0.02]])
    jaw.ellipse(0, L.chinDisc.y, L.chinDisc.r, L.chinDisc.r, 0, Math.PI * 2, false)
    jaw.ellipse(0, L.chinDisc.y, L.chinDisc.r * 0.6, L.chinDisc.r * 0.6, 0, Math.PI * 2, false)
    jawHot.path([[-0.05, L.chinDisc.y + 0.08], [0.05, L.chinDisc.y + 0.08]], false)
    this.jaw.add(jaw.build(this.main), jawHot.build(this.hot))
    this.head.add(this.jaw)

    // The glow between the lips: its lower edge rides down with the jaw.
    const m = L.mouthHalf + 0.04
    const rim: XY[] = [[-m, mouthY - 0.01], [-0.18, mouthY], [0, mouthY], [0.18, mouthY], [m, mouthY - 0.01], [0.18, lowerLip + 0.01], [0, lowerLip], [-0.18, lowerLip + 0.01]]
    this.mouthGlow = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape(rim.map(([x, y]) => new THREE.Vector2(x, y)))),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    // In front of the shell, which juts out at the muzzle foot.
    this.mouthGlow.position.z = face(0, mouthY - 0.07).z + 0.03
    this.mouthGlow.renderOrder = 2
    this.mouthBase = Float32Array.from(this.mouthGlow.geometry.getAttribute("position").array)
    this.head.add(this.mouthGlow)

    // Fins: the blade and a thinner one inside it, each side.
    const finShell = shellMaterial(color, 0.05, THREE.DoubleSide)
    this.shells.push(finShell)
    for (const side of [1, -1]) {
      const outline = new Lines()
      const blade = new THREE.Mesh(finRibbon(finCurve(1), 0.34, side, outline), finShell)
      const inner = new THREE.Mesh(finRibbon(finCurve(0.9), 0.07, side, outline), finShell)
      blade.renderOrder = -10
      inner.renderOrder = -10
      this.head.add(blade, inner, outline.build(this.main))
    }

    // Neck: a thick segmented column.
    const neckShell = shellMaterial(color, 0.008)
    this.shells.push(neckShell)
    const { r: nr, top: nt, bottom: nb, z: nz } = L.neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(nr, nr * 1.08, nt - nb, 48, 1, true), neckShell)
    neck.position.set(0, (nt + nb) / 2, nz)
    neck.renderOrder = -11
    this.head.add(neck)
    const neckLines = new Lines()
    for (let y = nt - 0.35; y > nb; y -= 0.3) {
      const rr = nr * (1 + (0.08 * (nt - y)) / (nt - nb)) + 0.012
      const ring: THREE.Vector3[] = []
      for (let i = 0; i <= 48; i += 1) {
        const a = (i / 48) * Math.PI * 2
        ring.push(new THREE.Vector3(Math.sin(a) * rr, y, Math.cos(a) * rr + nz))
      }
      neckLines.strip(ring)
    }
    this.head.add(neckLines.build(this.dim))

    this.head.add(dim.build(this.dim), main.build(this.main), hot.build(this.hot))

    // Thinking: a ring around the head, sweeping down.
    this.scan = new THREE.Line(new THREE.BufferGeometry(), this.hot)
    this.scan.geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(65 * 3), 3))
    this.scan.visible = false
    this.scan.renderOrder = 1
    this.head.add(this.scan)

    for (let i = 0; i < SHARDS; i += 1) {
      const s = 0.08 + Math.random() * 0.1
      const pts = [new THREE.Vector3(0, s, 0), new THREE.Vector3(s * 0.8, -s * 0.6, 0), new THREE.Vector3(-s * 0.5, -s * 0.4, 0)]
      const mesh = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), this.main)
      this.shards.push({ mesh, radius: 2.3 + Math.random() * 0.4, speed: 0.2 + Math.random() * 0.3, phase: (i / SHARDS) * Math.PI * 2, tilt: (Math.random() - 0.5) * 1.2 })
      this.group.add(mesh)
    }

    // Sized to sit inside the cipher's frame.
    this.head.scale.setScalar(0.86)
    this.head.position.y = 0.05
    this.group.add(this.head)
  }

  update(dt: number, t: number, input: FaceInput) {
    const { status, amp, energy, look, sinceTyped, tint } = input
    this.dim.color.copy(tint)
    this.main.color.copy(tint)
    this.hot.color.copy(tint).lerp(new THREE.Color(0xffffff), 0.25)

    // Gaze: the pointer or hand when there is one; Andrew's typing pulls it
    // down toward the chat; left alone, he looks about on his own.
    this.wander -= dt
    if (this.wander <= 0) {
      this.wander = 1.5 + Math.random() * 3.5
      this.wanderAt.set((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 0.7)
    }
    if (look) this.gazeTarget.set(look.x, look.y)
    else if (sinceTyped < 2.5) this.gazeTarget.set(0, 0.8)
    else if (status === "thinking") this.gazeTarget.set(Math.sin(t * 0.9) * 0.5, -0.35)
    else this.gazeTarget.copy(this.wanderAt)
    this.gaze.lerp(this.gazeTarget, Math.min(1, dt * (look ? 7 : 4)))
    this.head.rotation.y = this.gaze.x * 0.5 + Math.sin(t * 0.37) * 0.04
    this.head.rotation.x = this.gaze.y * 0.28
    this.head.rotation.z = -this.gaze.x * 0.04

    const lit = 0.75 + energy * 0.4 + amp * 0.6
    for (const shell of this.shells) {
      shell.uniforms.tint.value.copy(tint)
      shell.uniforms.glow.value = lit
    }

    // Lids: narrow while Andrew types or talks (he is attending); blink now and then.
    this.blinkTimer -= dt
    if (this.blinkTimer <= 0) {
      this.blink = 1
      this.blinkTimer = 3 + Math.random() * 5
    }
    this.blink = Math.max(0, this.blink - dt * 7)
    const attending = sinceTyped < 2.5 || status === "listening"
    const close = Math.max(attending ? 0.45 : 0, this.blink)
    this.lidClose += (close - this.lidClose) * Math.min(1, dt * 12)
    for (const lid of this.lids) lid.position.y = -this.lidClose * 0.1
    for (const iris of this.irises) iris.scale.y = 1 - this.lidClose * 0.55

    const hot = 0.6 + energy * 0.5 + amp * 0.9 + (status === "thinking" ? 0.3 + 0.3 * Math.sin(t * 18) : 0)
    this.irisMaterial.color.copy(tint).lerp(new THREE.Color(0xffffff), 0.3 + Math.min(0.4, amp * 0.6))
    this.irisMaterial.opacity = (this.glitch > 0 && Math.random() < 0.5 ? 0.25 : 1) * (1 - this.blink * 0.8)
    for (const bloom of this.eyeGlows) {
      const material = bloom.material as THREE.SpriteMaterial
      material.color.copy(tint)
      material.opacity = Math.min(1, 0.4 + hot * 0.45) * (1 - this.blink * 0.8)
      bloom.scale.setScalar(0.4 + hot * 0.25)
    }

    // Jaw: with his voice; a slight part while thinking.
    const speaking = status === "speaking"
    const target = speaking ? Math.min(1, amp * 2.4) : status === "thinking" ? 0.08 : 0
    this.open += (target - this.open) * Math.min(1, dt * (speaking ? 18 : 6))
    const drop = this.open * 0.16
    this.jaw.position.y = -drop
    const mouth = this.mouthGlow.material as THREE.MeshBasicMaterial
    mouth.color.copy(tint)
    mouth.opacity = Math.min(0.9, this.open * 1.6)
    const rim = this.mouthGlow.geometry.getAttribute("position") as THREE.BufferAttribute
    for (let i = 0; i < rim.count; i += 1) {
      const y = this.mouthBase[i * 3 + 1]
      rim.setY(i, y < L.mouthY - 0.02 ? y - drop : y)
    }
    rim.needsUpdate = true

    // Thinking: a ring round the head, sweeping down it.
    const thinking = status === "thinking"
    this.scan.visible = thinking
    if (thinking) {
      const y = L.top - 0.15 - ((t * 0.9) % 1) * (L.top - L.chinY - 0.2)
      const ring = this.scan.geometry.getAttribute("position") as THREE.BufferAttribute
      for (let i = 0; i <= 64; i += 1) {
        const p = on(-Math.PI + (i / 64) * Math.PI * 2, y, 0.04)
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
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | undefined
      material?.dispose()
    })
  }
}
