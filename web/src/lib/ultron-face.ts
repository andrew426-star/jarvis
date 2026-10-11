"use client"

import * as THREE from "three"

import type { AgentStatus } from "@/lib/store"

// Ultron's head, for the console's centre in serious mode (lib/core-cipher.ts
// swaps it in for Jarvis's cipher). Built to the Age of Ultron references -
// ILM's "Ultron cheek V2" sculpt and the Marvel Studios archive replica:
//
//   cranium   tall, swept back; a raised crest band from between the brows
//             over the top, an inset plate high on the forehead, plates
//             curving back across the skull, red light leaking from cracks
//   brow      heavy and furrowed, dipping at the centre
//   eyes      small round red irises deep in mechanical lid sockets
//   muzzle    the long nose plate, narrow at the bridge and widening to
//             the mouth, with grooves and a notch at its foot
//   cheeks    a ringed aperture each, wrapped by a C-shaped plate
//   fins      a curved blade from each temple, sweeping out and down past
//             the jaw, with a thinner one inside it
//   mouth     narrow, of segmented lip plates; a round disc on the chin
//   neck      segmented
//
// The head is a sculpted surface - P(theta, y) below: an elongated ellipsoid
// with the features pushed in and out of it - drawn as a hologram: a shell
// that glows at its edges (fresnel) and hides what is behind it, with every
// seam laid on the surface as a line. It pays attention: the head follows
// the pointer or a hand, the lids narrow when Andrew types, he looks about
// on his own, the jaw moves with his voice, a scan rings the head while he
// thinks, and it glitches now and then.

type XY = [number, number]

const Y_TOP = 2.55
const Y_CHIN = -1.75
const EYE: XY = [0.47, 0.42]
const CHEEK: XY = [0.8, -0.4]
const CHIN: XY = [0, -1.45]
const MOUTH_Y = -0.72

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const bump = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) =>
  Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2)

// --- the surface ---------------------------------------------------------------

/** Cross-section at height y: half-width, front and back depth, and how far the crown leans back. */
function section(y: number) {
  if (y >= 1) {
    const q = Math.min(1, (y - 1) / (Y_TOP - 1))
    const r = Math.sqrt(Math.max(0, 1 - q * q))
    return { w: 1.18 * r, d: 1.1 * r, db: 1.45 * r, zs: -0.32 * q * q }
  }
  if (y >= -0.4) return { w: 1.18 + (0.08 * (1 - y)) / 1.4, d: 1.1, db: 1.45, zs: 0 }
  const s = Math.min(1, (-0.4 - y) / 1.35)
  return { w: 1.26 - 0.78 * s ** 1.5, d: 1.1 - 0.3 * s ** 1.3, db: 1.45 - 0.6 * s, zs: 0 }
}

/** The features, as a push out of (or into) the face at x, y. */
function relief(x: number, y: number): number {
  const ax = Math.abs(x)
  // Muzzle: the nose plate, standing further out toward the mouth.
  const hw = 0.13 + (0.29 * (0.62 - y)) / 1.28
  const muzzle =
    (0.1 + (0.18 * (0.62 - y)) / 1.28) * smooth(-0.06, 0.05, hw - ax) * smooth(-0.7, -0.6, y) * smooth(0.72, 0.56, y)
  // Brow ridge, dipping at the centre.
  const browY = 0.7 + 0.3 * Math.min(1, ax / 0.9) - 0.4 * Math.max(0, ax - 0.9)
  const brow = 0.15 * Math.exp(-(((y - browY) / 0.09) ** 2)) * smooth(1.25, 1.0, ax)
  const socket = -0.17 * bump(ax, y, EYE[0], EYE[1], 0.26, 0.15)
  const cheek = 0.07 * bump(ax, y, CHEEK[0], CHEEK[1], 0.45, 0.45) - 0.06 * bump(ax, y, CHEEK[0], CHEEK[1], 0.2, 0.2)
  const chin = 0.12 * bump(x, y, CHIN[0], CHIN[1], 0.2, 0.17)
  const crest = y > 0.7 ? 0.06 * Math.exp(-((x / 0.24) ** 6)) * smooth(0.7, 0.95, y) : 0
  const mouth = -0.05 * Math.exp(-(((y - MOUTH_Y) / 0.035) ** 2)) * smooth(0.42, 0.3, ax)
  return muzzle + brow + socket + cheek + chin + crest + mouth
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
  const yy = Math.min(Y_TOP - 2 * e, Math.max(Y_CHIN + e, y))
  const p = P(theta, yy)
  const du = P(theta + e, yy).sub(P(theta - e, yy))
  const dv = P(theta, yy + e).sub(P(theta, yy - e))
  const n = du.cross(dv).normalize()
  return p.addScaledVector(n, lift)
}

const thetaAt = (x: number, y: number) => Math.asin(Math.max(-0.995, Math.min(0.995, x / Math.max(1e-3, section(y).w))))

/** Face coordinates (x, y as seen from the front) onto the surface. */
const face = (x: number, y: number, lift?: number) => on(thetaAt(x, y), y, lift)

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
      while (y < Y_TOP) {
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
  const NT = 112
  const NY = 100
  const positions: number[] = []
  for (let j = 0; j <= NY; j += 1) {
    const y = Y_CHIN + ((Y_TOP - 0.002 - Y_CHIN) * j) / NY
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

// The temple fin: a crescent blade from behind the eye, out and down past the jaw.
function finCurve(scale: number): THREE.CatmullRomCurve3 {
  const pts: [number, number, number][] = [
    [1.02, 1.22, -0.55], [1.55, 0.95, -0.42], [1.86, 0.15, -0.2], [1.78, -0.78, 0.04], [1.36, -1.42, 0.3],
  ]
  return new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x * scale, y, z)))
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
    const w = (0.025 + width * Math.sin(Math.PI * s) ** 0.8) / 2
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

    // The shell.
    const shell = shellMaterial(color)
    this.shells.push(shell)
    const skull = new THREE.Mesh(headGeometry(), shell)
    skull.renderOrder = -10
    this.head.add(skull)

    const dim = new Lines()
    const main = new Lines()
    const hot = new Lines()

    // Cranium: the crest band, its forehead plate, and the plates curving back.
    main.meridian(() => 0.2, 0.86, 0.3)
    dim.meridian(() => 0.32, 0.95, 0.5)
    main.path([[0, 1.97], [0.13, 1.95], [0.13, 1.72], [0.07, 1.66], [0, 1.66]])
    dim.path([[0, 1.55], [0.1, 1.5], [0.1, 1.2]])
    main.meridian((y) => 0.5 + 0.1 * (y - 1), 1.08, 0.7)
    dim.meridian((y) => 0.68 + 0.16 * (y - 1), 1.08, 0.85)
    main.meridian((y) => 0.88 + 0.12 * (y - 1), 1.0, 0.95)
    dim.meridian((y) => 1.04 + 0.06 * (y - 1), 0.9, 1.1)
    // Seams across the skull's side and back.
    for (const [yy, from, to] of [[1.55, 0.7, 2.6], [1.15, 1.05, 2.4], [2.05, 0.4, 2.7]] as [number, number, number][]) {
      const ty: XY[] = []
      for (let t = from; t <= to; t += 0.04) ty.push([t, yy + 0.08 * Math.sin(t * 3)])
      dim.surface(ty)
    }
    // Red light from the cracks between plates.
    const random = rng(7)
    for (let k = 0; k < 5; k += 1) {
      const ty: XY[] = []
      let t = 0.55 + random() * 1.6
      let y = 1.0 + random() * 1.1
      for (let i = 0; i < 6; i += 1) {
        ty.push([t, y])
        t += 0.06 + random() * 0.1
        y += (random() - 0.6) * 0.14
      }
      ;(k < 2 ? hot : main).surface(ty, k % 2 === 0)
    }

    // Brow: the ridge and the furrows above it.
    main.path([[0.03, 0.7], [0.3, 0.79], [0.6, 0.9], [0.9, 0.99], [1.08, 0.9], [1.15, 0.7]])
    main.path([[0.05, 0.74], [0.3, 0.84], [0.6, 0.95], [0.88, 1.04]], true, false, 0.03)
    dim.path([[0.08, 0.86], [0.36, 0.98], [0.7, 1.1], [1.0, 1.12]])
    dim.path([[0.22, 1.02], [0.52, 1.16], [0.86, 1.24]])
    dim.path([[0.3, 0.88], [0.42, 0.95], [0.5, 1.04]])

    // Eyes: the socket, its mechanical plates, and the lids (which move).
    main.path([[0.12, 0.5], [0.3, 0.66], [0.6, 0.72], [0.88, 0.62], [0.96, 0.42], [0.84, 0.24], [0.56, 0.17], [0.3, 0.23], [0.12, 0.38]], true, true)
    dim.path([[0.56, 0.17], [0.62, 0.02], [0.96, 0.06]])
    dim.path([[0.84, 0.24], [1.0, 0.18]])
    dim.path([[0.3, 0.23], [0.26, 0.05]])
    for (const side of [1, -1]) {
      const lid = new Lines()
      lid.path([[0.2, 0.42], [0.33, 0.53], [0.5, 0.57], [0.66, 0.54], [0.78, 0.46]].map(([x, y]) => [x * side, y] as XY), false, false, 0.03)
      const lower = new Lines()
      lower.path([[0.2, 0.42], [0.35, 0.33], [0.52, 0.3], [0.68, 0.35], [0.78, 0.46]].map(([x, y]) => [x * side, y] as XY), false, false, 0.03)
      const group = new THREE.Group()
      group.add(lid.build(this.main))
      this.lids.push(group)
      this.head.add(group, lower.build(this.main))
    }
    // Irises: a glowing ring with a dark pupil, rings around it, and a bloom.
    this.irisMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    for (const side of [1, -1]) {
      const at = face(EYE[0] * side, EYE[1], 0.02)
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

    // Muzzle: the nose plate, its grooves and the notch at its foot.
    main.path([[0.12, 0.64], [0.17, 0.3], [0.26, -0.1], [0.36, -0.45], [0.42, -0.66]])
    main.path([[0, -0.645], [0.2, -0.652], [0.42, -0.66]])
    dim.path([[0.06, 0.58], [0.07, -0.3]])
    dim.path([[0.17, 0.12], [0.24, -0.5]])
    main.path([[0, -0.42], [0.075, -0.42], [0.075, -0.6], [0, -0.6]])
    dim.path([[0, -0.02], [0.08, -0.16], [0.16, -0.02]])
    dim.path([[0.12, 0.64], [0.03, 0.7]])

    // Cheeks: the ringed aperture, its blades, and the C-shaped plate around it.
    const [cx, cy] = CHEEK
    main.ellipse(cx, cy, 0.42, 0.42)
    dim.ellipse(cx, cy, 0.33, 0.33)
    main.ellipse(cx, cy, 0.23, 0.23)
    dim.ellipse(cx, cy, 0.14, 0.14)
    hot.ellipse(cx, cy, 0.055, 0.055)
    for (let k = 0; k < 9; k += 1) {
      const a = (k / 9) * Math.PI * 2
      const xy: XY[] = []
      for (let i = 0; i <= 6; i += 1) {
        const r = 0.14 + (0.19 * i) / 6
        const b = a + (0.7 * i) / 6
        xy.push([cx + Math.cos(b) * r, cy + Math.sin(b) * r])
      }
      dim.path(xy)
    }
    main.ellipse(cx - 0.02, cy - 0.02, 0.5, 0.62, -2.15, 1.95)
    dim.ellipse(cx - 0.02, cy - 0.02, 0.57, 0.71, -2.05, 1.85)
    dim.path([[0.96, 0.06], [1.08, -0.1]])

    // Temple vents behind the eyes.
    for (let k = 0; k < 5; k += 1) dim.path([[1.0, 0.12 + k * 0.07], [1.15, 0.14 + k * 0.07]])
    main.ellipse(1.1, 0.78, 0.07, 0.1)

    // Mouth: upper lip plates (fixed); the lower lip, its plates, the chin
    // and jaw (on the jaw, which drops when he speaks).
    main.path([[0, MOUTH_Y], [0.2, MOUTH_Y + 0.002], [0.38, MOUTH_Y + 0.03]])
    for (const x of [0.07, 0.15, 0.23, 0.31]) dim.path([[x, -0.655], [x, MOUTH_Y]])
    const jaw = new Lines()
    const jawHot = new Lines()
    jaw.path([[0, -0.87], [0.2, -0.86], [0.38, MOUTH_Y + 0.03]])
    for (const x of [0.07, 0.15, 0.23, 0.31]) jaw.path([[x, MOUTH_Y - 0.01], [x, -0.86 + x * 0.25]])
    jaw.path([[0.12, -0.9], [0.13, -1.26]])
    jaw.path([[0.38, -0.9], [0.42, -1.3], [0.3, -1.62]])
    jaw.path([[0.66, -1.12], [0.6, -1.42], [0.42, -1.7]])
    jaw.ellipse(CHIN[0], CHIN[1], 0.17, 0.17, 0, Math.PI * 2, false)
    jaw.ellipse(CHIN[0], CHIN[1], 0.1, 0.1, 0, Math.PI * 2, false)
    jawHot.path([[-0.05, -1.36], [0.05, -1.36]], false)
    this.jaw.add(jaw.build(this.main), jawHot.build(this.hot))
    this.head.add(this.jaw)

    // The glow between the lips: its lower edge rides down with the jaw.
    const rim: XY[] = [[-0.38, MOUTH_Y + 0.03], [-0.2, MOUTH_Y], [0, MOUTH_Y], [0.2, MOUTH_Y], [0.38, MOUTH_Y + 0.03], [0.2, -0.86], [0, -0.87], [-0.2, -0.86]]
    this.mouthGlow = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape(rim.map(([x, y]) => new THREE.Vector2(x, y)))),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    this.mouthGlow.position.z = face(0, -0.8).z - 0.01
    this.mouthGlow.renderOrder = 2
    this.mouthBase = Float32Array.from(this.mouthGlow.geometry.getAttribute("position").array)
    this.head.add(this.mouthGlow)

    // Fins: the blade and a thinner one inside it, each side.
    const finShell = shellMaterial(color, 0.02, THREE.DoubleSide)
    this.shells.push(finShell)
    for (const side of [1, -1]) {
      const outline = new Lines()
      const blade = new THREE.Mesh(finRibbon(finCurve(1), 0.3, side, outline), finShell)
      const inner = new THREE.Mesh(finRibbon(finCurve(0.88), 0.08, side, outline), finShell)
      blade.renderOrder = -10
      inner.renderOrder = -10
      this.head.add(blade, inner, outline.build(this.main))
    }

    // Neck: a segmented column.
    const neckShell = shellMaterial(color, 0.008)
    this.shells.push(neckShell)
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.52, 1.5, 48, 1, true), neckShell)
    neck.position.set(0, -2.45, -0.22)
    neck.renderOrder = -10
    this.head.add(neck)
    const neckLines = new Lines()
    for (const [y, r] of [[-1.92, 0.455], [-2.25, 0.475], [-2.6, 0.495], [-2.95, 0.515]] as [number, number][]) {
      const ring: THREE.Vector3[] = []
      for (let i = 0; i <= 48; i += 1) {
        const a = (i / 48) * Math.PI * 2
        ring.push(new THREE.Vector3(Math.sin(a) * (r + 0.012), y, Math.cos(a) * (r + 0.012) - 0.22))
      }
      neckLines.strip(ring)
    }
    for (const a of [-0.35, 0.35]) {
      neckLines.strip([new THREE.Vector3(Math.sin(a) * 0.455, -1.92, Math.cos(a) * 0.455 - 0.22), new THREE.Vector3(Math.sin(a) * 0.53, -3.2, Math.cos(a) * 0.53 - 0.22)])
    }
    this.head.add(neckLines.build(this.dim))

    this.head.add(dim.build(this.dim), main.build(this.main), hot.build(this.hot))

    // Thinking: a ring around the head, sweeping down.
    this.scan = new THREE.Line(new THREE.BufferGeometry(), this.hot)
    this.scan.geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(65 * 3), 3))
    this.scan.visible = false
    this.scan.renderOrder = 1
    this.head.add(this.scan)

    // Shards orbiting, tumbling.
    for (let i = 0; i < SHARDS; i += 1) {
      const s = 0.08 + Math.random() * 0.1
      const pts = [new THREE.Vector3(0, s, 0), new THREE.Vector3(s * 0.8, -s * 0.6, 0), new THREE.Vector3(-s * 0.5, -s * 0.4, 0)]
      const mesh = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), this.main)
      this.shards.push({ mesh, radius: 2.3 + Math.random() * 0.4, speed: 0.2 + Math.random() * 0.3, phase: (i / SHARDS) * Math.PI * 2, tilt: (Math.random() - 0.5) * 1.2 })
      this.group.add(mesh)
    }

    // Sized to sit inside the cipher's frame, the eyes a little above centre.
    this.head.scale.setScalar(0.86)
    this.head.position.y = -0.05
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

    // Shell: brighter edges with energy and voice.
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

    // Irises: hotter with energy and voice; flicker while thinking.
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
      rim.setY(i, y < MOUTH_Y - 0.01 ? y - drop : y)
    }
    rim.needsUpdate = true

    // Thinking: a ring round the head, sweeping down it.
    const thinking = status === "thinking"
    this.scan.visible = thinking
    if (thinking) {
      const y = Y_TOP - 0.15 - ((t * 0.9) % 1) * (Y_TOP - Y_CHIN - 0.2)
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
      this.head.position.y = -0.05 + (Math.random() - 0.5) * 0.05
    } else {
      this.head.position.set(0, -0.05, 0)
    }

    // Shards: faster with energy.
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
