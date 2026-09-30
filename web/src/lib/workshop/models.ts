"use client"

import * as THREE from "three"
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"

// Iron Man-style workshop pieces, built from primitives in code: no model
// files to download or license, and every mesh is a clean surface the
// scene can derive a wireframe hologram from. Stylised, not replicas.

export interface ItemSpec {
  key: string
  name: string
  designation: string
  lines: string[]
}

export interface BuiltItem {
  object: THREE.Group
  spec: ItemSpec
}

// --- materials -----------------------------------------------------------

function metal(color: number, roughness = 0.3, metalness = 0.9) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

const mats = () => ({
  red: metal(0x8e1414, 0.28),
  gold: metal(0xc9a13b, 0.22, 1),
  steel: metal(0xa3acb6, 0.32),
  dark: metal(0x24282d, 0.55, 0.8),
  copper: metal(0xb8733a, 0.28, 1),
  glow: new THREE.MeshStandardMaterial({
    color: 0x0a1a22,
    emissive: 0x9fe8ff,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x9cc9ff,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.85,
    thickness: 0.4,
    transparent: true,
    opacity: 0.55,
  }),
})

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, setup?: (m: THREE.Mesh) => void) {
  const m = new THREE.Mesh(geometry, material)
  m.castShadow = true
  m.receiveShadow = true
  setup?.(m)
  return m
}

// A light that glows with the emissive parts, so metal around them
// catches it.
function coreLight(intensity = 2.5, distance = 3) {
  return new THREE.PointLight(0x9fe8ff, intensity * 0.5, distance * 0.7, 2)
}

// --- items ---------------------------------------------------------------

function arcReactor(): BuiltItem {
  const m = mats()
  const g = new THREE.Group()
  const face = new THREE.Group()
  face.rotation.x = Math.PI / 2 // cylinders stand on Y; turn them to face +Z
  g.add(face)

  face.add(mesh(new THREE.CylinderGeometry(1, 1, 0.14, 64), m.dark, (x) => (x.position.y = -0.08)))
  g.add(mesh(new THREE.TorusGeometry(0.96, 0.09, 24, 96), m.steel))

  // Ten copper coils, each a tangential spool wrapped in windings.
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2
    const coil = new THREE.Group()
    coil.position.set(Math.cos(angle) * 0.68, Math.sin(angle) * 0.68, 0.04)
    coil.rotation.z = angle
    coil.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 16), m.dark))
    for (let w = 0; w < 6; w += 1) {
      coil.add(
        mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 20), m.copper, (x) => {
          x.rotation.x = Math.PI / 2
          x.position.y = -0.125 + w * 0.05
        })
      )
    }
    g.add(coil)
  }

  g.add(mesh(new THREE.TorusGeometry(0.44, 0.05, 16, 64), m.steel, (x) => (x.position.z = 0.05)))
  face.add(mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 48), m.glow, (x) => (x.position.y = 0.06)))
  g.add(mesh(new THREE.TorusGeometry(0.32, 0.03, 12, 48), m.steel, (x) => (x.position.z = 0.1)))
  const light = coreLight(3, 3)
  light.position.z = 0.4
  g.add(light)

  g.position.y = 1.1
  return {
    object: g,
    spec: {
      key: "reactor",
      name: "Arc Reactor",
      designation: "MK II · PALLADIUM CORE",
      lines: ["OUTPUT 3 GJ/s SUSTAINED", "10-COIL TOROIDAL CONFINEMENT", "CORE TEMP NOMINAL", "SERVICE LIFE: 41 DAYS"],
    },
  }
}

function element(): BuiltItem {
  const m = mats()
  const g = new THREE.Group()
  const node = new THREE.SphereGeometry(0.07, 16, 12)
  const rod = (a: THREE.Vector3, b: THREE.Vector3) => {
    const length = a.distanceTo(b)
    const r = mesh(new THREE.CylinderGeometry(0.018, 0.018, length, 8), m.steel)
    r.position.copy(a).add(b).multiplyScalar(0.5)
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    return r
  }

  g.add(mesh(new THREE.SphereGeometry(0.2, 32, 24), m.glow))
  // Nested triangles in two perpendicular planes: the lattice from the
  // "new element" scene, turned into a solid you can walk around.
  for (const plane of [0, Math.PI / 2]) {
    const layer = new THREE.Group()
    layer.rotation.y = plane
    ;[0.55, 0.95, 1.35].forEach((size, level) => {
      const corners = [0, 1, 2].map((k) => {
        const angle = (k / 3) * Math.PI * 2 + Math.PI / 2 + (level % 2) * Math.PI
        return new THREE.Vector3(Math.cos(angle) * size, Math.sin(angle) * size, 0)
      })
      corners.forEach((corner, k) => {
        const next = corners[(k + 1) % 3]
        layer.add(rod(corner, next))
        // Nodes along each edge.
        for (let s = 0; s < 3; s += 1) {
          const p = corner.clone().lerp(next, s / 3)
          layer.add(mesh(node, s === 0 ? m.glow : m.steel, (x) => x.position.copy(p)))
        }
        if (level === 0) layer.add(rod(new THREE.Vector3(), corner))
      })
    })
    g.add(layer)
  }
  g.add(coreLight(2, 3))
  g.position.y = 1.4
  return {
    object: g,
    spec: {
      key: "element",
      name: "Synthesized Element",
      designation: "LATTICE · UNNAMED",
      lines: ["TRIANGULAR NUCLEAR LATTICE", "STABLE AT ROOM TEMPERATURE", "REPLACES PALLADIUM CORE", "TOXICITY: NONE DETECTED"],
    },
  }
}

// --- helmet: one sculpted surface, cut into panels -------------------------
//
// Primitives cannot make this face, so the helmet is a single parametric
// head surface cut into layers by masks drawn over the face: a gold
// faceplate, a red shell, silver ear discs, and a dark inner skin set a
// little inside, which shows through every gap as a panel line. The eyes
// are a glowing layer behind their slits.
//
// Masks are signed functions over (u, y) - positive inside - so panel
// edges can be snapped exactly onto the outline instead of stepping along
// the mesh grid. In the hologram, each layer's open border is an edge, so
// the wireframe draws the panel lines; contour lines add the silhouette.

const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// u: angle around the vertical axis, 0 facing the viewer (+z).
// v: angle down from the crown. A superellipsoid - boxier than a sphere
// across the skull and flatter on top - then shaped into a helmet.
function headPoint(u: number, v: number, scale: number): THREE.Vector3 {
  const dx = Math.sin(v) * Math.sin(u)
  const dy = Math.cos(v)
  const dz = Math.sin(v) * Math.cos(u)
  const n = 2.9
  const m = 2.4
  const horizontal = Math.pow(Math.pow(Math.abs(dx), n) + Math.pow(Math.abs(dz), n), m / n)
  const r = 1 / Math.pow(horizontal + Math.pow(Math.abs(dy), m), 1 / m)
  let x = dx * r * 0.78
  const y = dy * r * 1.05
  let z = dz * r * 0.9

  // A broad jaw: only a slight taper toward the chin.
  const lower = smoothstep(-0.2, -1.05, y)
  x *= 1 - 0.14 * lower
  const front = Math.max(0, Math.cos(u))
  const back = Math.max(0, -Math.cos(u))
  // The back of the skull tucks in toward the neck.
  z *= 1 - 0.22 * lower * back
  // A flatter face with the chin pushed forward and squared off.
  z = z * (1 - 0.1 * front * front) + 0.06 * front * front * lower
  // Brow shelf over the eyes.
  z += 0.03 * front * front * Math.exp(-((y - 0.36) ** 2) / 0.004)
  return new THREE.Vector3(x * scale, y * scale, z * scale)
}

const au = (u: number) => Math.abs(u)
const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax
  const dy = by - ay
  const t = THREE.MathUtils.clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// Signed masks: > 0 inside.
type Mask = (u: number, y: number) => number
const and = (...masks: Mask[]): Mask => (u, y) => Math.min(...masks.map((f) => f(u, y)))
const not = (mask: Mask): Mask => (u, y) => -mask(u, y)

// The neck opening sits higher at the back than under the chin.
const inHead: Mask = (u, y) => y + 0.98 - 0.2 * smoothstep(1.1, 1.7, au(u))
// Faceplate outline: a widow's peak at the forehead, cheeks that keep their
// width past the eyes, then a taper to the chin.
const faceTop = (u: number) => 0.62 - 0.17 * Math.min(1, au(u) / 0.8)
const faceHalfWidth = (y: number) => (y > 0.02 ? 0.82 : 0.82 - (0.02 - y) * 0.36)
const face = (pad: number): Mask => (u, y) =>
  Math.min(faceTop(u) - pad - y, faceHalfWidth(y) - pad - au(u), y + 0.97 - pad)
// The eyes angle down toward the nose: the familiar scowl.
const eye: Mask = (u, y) => {
  const a = au(u)
  const centre = 0.19 + 0.22 * (a - 0.13)
  const half = 0.044 - 0.036 * THREE.MathUtils.clamp(a - 0.13, 0, 0.4)
  return Math.min(half - Math.abs(y - centre), a - 0.13, 0.5 - a)
}
const mouth: Mask = (u, y) =>
  Math.max(
    Math.min(0.26 - au(u), 0.013 - Math.abs(y + 0.55)),
    Math.min(0.013 - Math.abs(au(u) - 0.26), -0.54 - y, y + 0.7)
  )
const cheekSeam: Mask = (u, y) => 0.02 - segDist(au(u), y, 0.52, 0.1, 0.3, -0.44)
const crest: Mask = (u, y) => Math.min(0.018 - au(u), y - faceTop(u))
const ear = (radius: number): Mask => (u, y) => radius - Math.hypot(au(u) - Math.PI / 2, y - 0.02)

const faceplateMask = and(inHead, face(0.028), not(eye), not(mouth), not(cheekSeam))
const shellMask = and(inHead, not(face(0)), not(crest), not(ear(0.215)))
const earMask = and(inHead, ear(0.19))
const eyeMask = and(inHead, eye)

function gradient(mask: Mask, u: number, y: number): [number, number] {
  const e = 1e-4
  return [(mask(u + e, y) - mask(u - e, y)) / (2 * e), (mask(u, y + e) - mask(u, y - e)) / (2 * e)]
}

// Pull a point that fell just outside the mask onto its edge.
function snap(mask: Mask, u: number, y: number): [number, number] {
  for (let step = 0; step < 4; step += 1) {
    const f = mask(u, y)
    if (f >= 0) break
    const [gu, gy] = gradient(mask, u, y)
    const g2 = gu * gu + gy * gy
    if (g2 < 1e-9) break
    u -= (f * gu) / g2
    y -= (f * gy) / g2
  }
  return [u, THREE.MathUtils.clamp(y, -1, 1)]
}

const HEAD_U = 300
const HEAD_V = 220

function headLayer(scale: number, mask: Mask, material: THREE.Material): THREE.Mesh {
  const vertexCount = (HEAD_U + 1) * (HEAD_V + 1)
  const params: [number, number][] = []
  for (let j = 0; j <= HEAD_V; j += 1) {
    const y = Math.cos((j / HEAD_V) * Math.PI)
    for (let i = 0; i <= HEAD_U; i += 1) params.push([-Math.PI + (i / HEAD_U) * Math.PI * 2, y])
  }
  const used = new Uint8Array(vertexCount)
  const index: number[] = []
  for (let j = 0; j < HEAD_V; j += 1) {
    const yc = Math.cos(((j + 0.5) / HEAD_V) * Math.PI)
    for (let i = 0; i < HEAD_U; i += 1) {
      const uc = -Math.PI + ((i + 0.5) / HEAD_U) * Math.PI * 2
      if (mask(uc, yc) <= 0) continue
      const a = j * (HEAD_U + 1) + i
      const b = a + HEAD_U + 1
      index.push(a, b, a + 1, a + 1, b, b + 1)
      used[a] = used[a + 1] = used[b] = used[b + 1] = 1
    }
  }
  const positions = new Float32Array(vertexCount * 3)
  params.forEach(([u, y], k) => {
    // Corners of an included cell that sit outside the mask are moved onto
    // its edge, which turns a stair-stepped outline into a clean one.
    const [su, sy] = used[k] ? snap(mask, u, y) : [u, y]
    const p = headPoint(su, Math.acos(sy), scale)
    positions.set([p.x, p.y, p.z], k * 3)
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return mesh(geometry, material)
}

// Contour lines over the outer panels, for the hologram's silhouette.
function headContours(scale: number, mask: Mask): THREE.LineSegments {
  const points: number[] = []
  const push = (u0: number, y0: number, u1: number, y1: number) => {
    if (mask(u0, y0) <= 0 || mask(u1, y1) <= 0) return
    const a = headPoint(u0, Math.acos(y0), scale)
    const b = headPoint(u1, Math.acos(y1), scale)
    points.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }
  const STEPS = 90
  for (let k = 0; k < 20; k += 1) {
    const u = -Math.PI + (k / 20) * Math.PI * 2
    for (let s = 0; s < STEPS; s += 1) push(u, 1 - (2 * s) / STEPS, u, 1 - (2 * (s + 1)) / STEPS)
  }
  for (let k = 1; k < 12; k += 1) {
    const y = 1 - (2 * k) / 12
    for (let s = 0; s < STEPS * 2; s += 1) {
      const u0 = -Math.PI + (s / (STEPS * 2)) * Math.PI * 2
      const u1 = -Math.PI + ((s + 1) / (STEPS * 2)) * Math.PI * 2
      push(u0, y, u1, y)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3))
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial())
  // The workshop swaps in its hologram material and hides these in solid
  // mode (lib/workshop/scene.ts).
  lines.userData.holoLines = true
  return lines
}

function helmet(): BuiltItem {
  const m = mats()
  const g = new THREE.Group()
  const head = new THREE.Group()

  head.add(headLayer(0.968, inHead, m.dark))
  head.add(headLayer(0.985, eyeMask, m.glow))
  head.add(headLayer(1.014, faceplateMask, m.gold))
  head.add(headLayer(1, shellMask, m.red))
  head.add(headLayer(1.012, earMask, m.steel))
  head.add(headContours(1.02, and(inHead, (u, y) => Math.max(faceplateMask(u, y), shellMask(u, y)))))
  head.scale.setScalar(0.64)
  g.add(head)

  g.position.y = 1.25
  return {
    object: g,
    spec: {
      key: "helmet",
      name: "Helmet",
      designation: "MK III · HEAD UNIT",
      lines: ["GOLD-TITANIUM ALLOY SHELL", "HUD: DUAL RETINAL PROJECTION", "FACEPLATE SERVO 0.18s", "J.A.R.V.I.S. UPLINK ACTIVE"],
    },
  }
}

// --- gauntlet: armour plates over a jointed frame --------------------------
//
// Fingers splayed and curled a little toward the palm, the repulsor set in
// the palm, red plates over gunmetal joint barrels, and a plated forearm
// cuff. Turned three-quarters so both the red back and the palm read.

function plate(w: number, h: number, d: number, radius: number, material: THREE.Material) {
  const p = mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material)
  // Rounded corners are gentle curves; a finer edge angle keeps the plate
  // outlines in the hologram.
  p.userData.edgeAngle = 10
  return p
}

function gauntlet(): BuiltItem {
  const m = mats()
  const gunmetal = metal(0x3a3f46, 0.45, 0.85)
  const g = new THREE.Group()
  const hand = new THREE.Group()
  g.add(hand)

  // Palm, and the armoured back of the hand.
  hand.add(plate(0.84, 0.9, 0.18, 0.08, gunmetal))
  hand.add(plate(0.9, 0.78, 0.12, 0.06, m.red).translateZ(-0.12).translateY(-0.03))
  hand.add(plate(0.94, 0.2, 0.16, 0.06, m.red).translateZ(-0.1).translateY(0.4))
  hand.add(plate(0.36, 0.46, 0.05, 0.02, m.gold).translateZ(-0.2).translateY(-0.08))

  // Repulsor, set into the palm.
  const repulsor = new THREE.Group()
  repulsor.position.z = 0.092
  repulsor.add(mesh(new THREE.CircleGeometry(0.15, 40), m.glow).translateZ(0.004))
  repulsor.add(mesh(new THREE.TorusGeometry(0.17, 0.026, 12, 48), m.steel))
  repulsor.add(mesh(new THREE.TorusGeometry(0.25, 0.01, 8, 48), gunmetal))
  hand.add(repulsor)

  // Fingers: [x at the knuckle, segment lengths, splay].
  const fingers: [number, number[], number][] = [
    [-0.31, [0.22, 0.16, 0.13], 0.14],
    [-0.1, [0.27, 0.19, 0.15], 0.05],
    [0.11, [0.28, 0.2, 0.16], -0.03],
    [0.31, [0.24, 0.18, 0.14], -0.12],
  ]
  for (const [x0, lengths, splay] of fingers) {
    let parent: THREE.Object3D = hand
    let offset = 0.48
    lengths.forEach((length, k) => {
      const width = 0.16 - k * 0.018
      const joint = new THREE.Group()
      joint.position.set(k === 0 ? x0 : 0, offset, 0)
      joint.rotation.set(0.16 + k * 0.06, 0, k === 0 ? splay : 0)
      joint.add(
        mesh(new THREE.CylinderGeometry(0.045, 0.045, width, 20), gunmetal, (x) => (x.rotation.z = Math.PI / 2))
      )
      const tip = k === lengths.length - 1
      joint.add(plate(width, length, 0.13, tip ? 0.055 : 0.03, m.red).translateY(length / 2 + 0.035).translateZ(-0.012))
      joint.add(plate(width * 0.7, length * 0.5, 0.035, 0.012, m.red).translateY(length / 2 + 0.035).translateZ(-0.085))
      parent.add(joint)
      parent = joint
      offset = length + 0.06
    })
  }

  // Thumb, swung out from the side of the palm.
  const thumbBase = new THREE.Group()
  thumbBase.position.set(-0.44, -0.1, 0.05)
  thumbBase.rotation.set(0.1, 0.45, 0.9)
  let thumbParent: THREE.Object3D = thumbBase
  let thumbOffset = 0
  ;[0.2, 0.16, 0.13].forEach((length, k) => {
    const width = 0.17 - k * 0.018
    const joint = new THREE.Group()
    joint.position.y = thumbOffset
    joint.rotation.x = 0.12
    joint.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, width, 20), gunmetal, (x) => (x.rotation.z = Math.PI / 2)))
    joint.add(plate(width, length, 0.15, k === 2 ? 0.055 : 0.03, m.red).translateY(length / 2 + 0.035))
    thumbParent.add(joint)
    thumbParent = joint
    thumbOffset = length + 0.06
  })
  hand.add(thumbBase)

  // Wrist joint and forearm cuff.
  hand.add(mesh(new THREE.CylinderGeometry(0.27, 0.29, 0.12, 32), gunmetal).translateY(-0.53))
  const cuffProfile = [
    [0.29, 0], [0.33, -0.08], [0.35, -0.5], [0.39, -0.9], [0.4, -1.05], [0.35, -1.08],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  hand.add(mesh(new THREE.LatheGeometry(cuffProfile, 48), m.red).translateY(-0.58))
  hand.add(
    mesh(new THREE.TorusGeometry(0.345, 0.02, 10, 48), m.gold, (x) => (x.rotation.x = Math.PI / 2)).translateY(-0.7)
  )
  hand.add(plate(0.2, 0.6, 0.05, 0.02, m.gold).translateY(-1.02).translateZ(0.36))
  for (const side of [-1, 1]) {
    hand.add(plate(0.06, 0.32, 0.24, 0.02, m.red).translateX(side * 0.37).translateY(-0.7).rotateZ(side * 0.12))
  }

  const light = coreLight(1.2, 1.6)
  light.position.z = 0.6
  g.add(light)

  hand.scale.setScalar(0.85)
  g.position.y = 1.55
  g.rotation.set(0.08, -0.6, 0)
  return {
    object: g,
    spec: {
      key: "gauntlet",
      name: "Repulsor Gauntlet",
      designation: "MK III · RIGHT HAND",
      lines: ["REPULSOR: 12 kN PULSE", "STABILISER + WEAPON MODES", "27 ARTICULATED SEGMENTS", "THERMAL LOAD 38%"],
    },
  }
}

function tower(): BuiltItem {
  const m = mats()
  const g = new THREE.Group()
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.52, 2.6, 6), m.glass, (x) => (x.position.y = 1.3)))
  g.add(mesh(new THREE.BoxGeometry(0.12, 2.8, 0.12), m.steel, (x) => x.position.set(0, 1.4, 0.38)))
  g.add(mesh(new THREE.CylinderGeometry(0.62, 0.5, 0.22, 6), m.steel, (x) => (x.position.y = 2.7)))
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 32), m.dark, (x) => x.position.set(0.72, 2.55, 0)))
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.04, 0.12), m.steel, (x) => x.position.set(0.42, 2.55, 0)))
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 24), m.glow, (x) => (x.position.y = 2.84)))
  for (let i = 0; i < 6; i += 1) {
    g.add(mesh(new THREE.TorusGeometry(0.45 - i * 0.02, 0.012, 6, 6), m.steel, (x) => {
      x.rotation.x = Math.PI / 2
      x.position.y = 0.4 + i * 0.36
    }))
  }
  const light = coreLight(2, 2)
  light.position.y = 3
  g.add(light)
  g.scale.setScalar(0.72)
  return {
    object: g,
    spec: {
      key: "tower",
      name: "Stark Tower",
      designation: "MIDTOWN · ARCHITECTURAL",
      lines: ["93 FLOORS", "SELF-SUSTAINING ARC POWER", "ROOFTOP LANDING PLATFORM", "SUIT DEPLOYMENT GANTRY"],
    },
  }
}

function missile(): BuiltItem {
  const m = mats()
  const g = new THREE.Group()
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 2.1, 40), m.steel))
  g.add(mesh(new THREE.ConeGeometry(0.17, 0.55, 40), m.dark, (x) => (x.position.y = 1.32)))
  for (const y of [0.55, 0.62]) {
    g.add(mesh(new THREE.TorusGeometry(0.172, 0.02, 8, 40), m.red, (x) => {
      x.rotation.x = Math.PI / 2
      x.position.y = y
    }))
  }
  // Sub-munition bays around the waist.
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.34, 0.02), m.dark, (x) => {
      x.position.set(Math.cos(a) * 0.175, 0.1, Math.sin(a) * 0.175)
      x.rotation.y = -a + Math.PI / 2
    }))
  }
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2
    g.add(mesh(new THREE.BoxGeometry(0.025, 0.42, 0.36), m.dark, (x) => {
      x.position.set(Math.cos(a) * 0.3, -0.85, Math.sin(a) * 0.3)
      x.rotation.y = -a
    }))
  }
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.2, 32, 1, true), m.dark, (x) => (x.position.y = -1.15)))
  g.add(mesh(new THREE.CircleGeometry(0.12, 32), m.glow, (x) => {
    x.rotation.x = Math.PI / 2
    x.position.y = -1.16
  }))
  const light = coreLight(2, 2)
  light.position.y = -1.4
  g.add(light)
  g.position.y = 1.4
  g.rotation.z = 0.55
  return {
    object: g,
    spec: {
      key: "missile",
      name: "Jericho",
      designation: "STARK INDUSTRIES · DEMO UNIT",
      lines: ["CLUSTER-DEPLOYED SUB-MUNITIONS", "INERT DEMONSTRATION ROUND", "ONE LAUNCH, MULTIPLE TARGETS", "STATUS: DECOMMISSIONED"],
    },
  }
}

export const CATALOGUE: { key: string; label: string; build: () => BuiltItem }[] = [
  { key: "reactor", label: "Arc Reactor", build: arcReactor },
  { key: "helmet", label: "Helmet", build: helmet },
  { key: "gauntlet", label: "Gauntlet", build: gauntlet },
  { key: "element", label: "Element", build: element },
  { key: "tower", label: "Tower", build: tower },
  { key: "missile", label: "Jericho", build: missile },
]
