"use client"

import * as THREE from "three"

import type { AgentStatus } from "@/lib/store"

// Ultron's face, for the console's centre in serious mode (lib/core-cipher.ts
// swaps it in for Jarvis's cipher). After Age of Ultron's Ultron Prime: a
// tall, angular faceplate - narrow crown, wide cheekbones, a pointed chin -
// with a heavy brow that dips at the centre, so the eyes always read as
// narrowed; glowing eyes slanted down toward the nose; plate seams down
// the cheeks; a wide mouth of segmented plates that opens when he speaks;
// a disc at each temple; shards orbiting.
//
// Where Jarvis's core is a calm instrument, this one pays attention: the
// head turns to follow the pointer or a tracked hand, the eyes narrow when
// Andrew types, he glances around on his own when left alone, the jaw moves
// with his voice, a scan runs down the face while he thinks, and the face
// glitches now and then. All wireframe in the live accent, built in 3D
// (the brow and nose stand forward of the temples) so turning shows depth.

type P = [number, number, number]

// The right half of the face (x >= 0, +y up, +z toward the viewer); the
// left is its mirror. Units: the face is about 4.2 tall, inside the
// cipher's 2.85 radius frame.
const OUTLINE: P[] = [
  [0, 2.05, 0.2], [0.5, 1.98, 0.05], [0.98, 1.66, -0.28], [1.24, 1.05, -0.48], [1.36, 0.3, -0.46],
  [1.26, -0.4, -0.36], [1.02, -1.12, -0.2], [0.66, -1.72, 0.0], [0.28, -2.04, 0.15], [0, -2.12, 0.2],
]
const BROW: P[] = [[0, 0.6, 0.68], [0.5, 0.84, 0.48], [1.12, 0.98, 0.0], [1.34, 0.86, -0.44]]
const SOCKET: P[] = [[0.1, 0.5, 0.58], [0.5, 0.74, 0.46], [1.06, 0.8, 0.12], [1.02, 0.34, 0.18], [0.55, 0.22, 0.42], [0.1, 0.5, 0.58]]
// The eye: inner corner low, outer high - the downward slant that makes him look intent.
const EYE: P[] = [[0.2, 0.44, 0.54], [0.58, 0.6, 0.46], [0.94, 0.64, 0.28], [0.62, 0.4, 0.46]]
const SEAMS: P[][] = [
  // forehead crest and its flanking plates
  [[0, 2.05, 0.2], [0, 0.98, 0.6]],
  [[0.26, 1.98, 0.14], [0.2, 1.06, 0.55], [0, 0.98, 0.6]],
  [[0.5, 1.98, 0.05], [0.62, 1.2, 0.3], [0.5, 0.84, 0.48]],
  // nose ridge
  [[0, 0.6, 0.68], [0, -0.38, 0.8]],
  [[0.1, 0.42, 0.64], [0.17, -0.42, 0.68], [0, -0.5, 0.74]],
  // cheek plates
  [[1.02, 0.34, 0.18], [0.62, -0.78, 0.4]],
  [[1.36, 0.3, -0.46], [0.9, -0.95, -0.02]],
  [[0.55, 0.22, 0.42], [0.36, -0.7, 0.55]],
  // jaw hinge
  [[1.26, -0.4, -0.36], [0.84, -0.86, 0.1]],
]
const UPPER_LIP: P[] = [[0, -0.86, 0.66], [0.34, -0.83, 0.58], [0.66, -0.94, 0.38]]
const LOWER_LIP: P[] = [[0, -1.04, 0.64], [0.34, -1.04, 0.56], [0.66, -0.94, 0.38]]
// The jaw below the lower lip: rides down with it.
const JAW: P[][] = [
  [[0.66, -0.94, 0.38], [0.6, -1.5, 0.18], [0.28, -1.86, 0.2], [0, -1.92, 0.24]],
  [[0.34, -1.04, 0.56], [0.24, -1.6, 0.3]],
]
const PLATES_X = [0.1, 0.22, 0.34, 0.46, 0.57]
const EAR_AT: P = [1.4, 0.55, -0.62]

const SHARDS = 9

const mirror = (points: P[]): P[] => points.map(([x, y, z]) => [-x, y, z])

function segments(lines: P[][]): THREE.BufferGeometry {
  const out: number[] = []
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i += 1) out.push(...line[i], ...line[i + 1])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(out, 3))
  return geometry
}

function both(lines: P[][]): P[][] {
  return [...lines, ...lines.map(mirror)]
}

/** On the lip at x (0..0.66): the lip's y and z there, linearly. */
function along(lip: P[], x: number): [number, number] {
  const ax = Math.abs(x)
  for (let i = 0; i < lip.length - 1; i += 1) {
    const [x0, y0, z0] = lip[i]
    const [x1, y1, z1] = lip[i + 1]
    if (ax <= x1) {
      const k = (ax - x0) / (x1 - x0)
      return [y0 + (y1 - y0) * k, z0 + (z1 - z0) * k]
    }
  }
  const last = lip[lip.length - 1]
  return [last[1], last[2]]
}

interface Shard {
  mesh: THREE.LineLoop
  axis: THREE.Vector3
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
  private readonly lines: THREE.LineBasicMaterial[] = []
  private readonly eyeMaterial: THREE.MeshBasicMaterial
  private readonly eyeGlows: THREE.Sprite[] = []
  private readonly eyes: THREE.Mesh[] = []
  private readonly mouthGlow: THREE.Mesh
  private readonly plates: THREE.LineSegments
  private readonly scan: THREE.Line
  private readonly shards: Shard[] = []
  private readonly gaze = new THREE.Vector2()
  private readonly gazeTarget = new THREE.Vector2()
  private wander = 0
  private wanderAt = new THREE.Vector2()
  private glitch = 0
  private glitchTimer = 3
  private blink = 0
  private blinkTimer = 4
  private open = 0
  private readonly mouthBase: Float32Array

  constructor(glow: THREE.Texture, color: number) {
    const line = (opacity: number) => {
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
      this.lines.push(material)
      return material
    }

    this.head.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints([...OUTLINE, ...mirror(OUTLINE).reverse()].map((p) => new THREE.Vector3(...p))), line(0.95)),
      new THREE.LineSegments(segments(both([BROW])), line(1)),
      new THREE.LineSegments(segments(both([SOCKET])), line(0.55)),
      new THREE.LineSegments(segments(both(SEAMS)), line(0.4)),
      new THREE.LineSegments(segments(both([UPPER_LIP])), line(0.9)),
    )
    // Brow doubled a hair forward, so the heaviest line on the face is the brow.
    const browShadow = new THREE.LineSegments(segments(both([BROW])), line(0.6))
    browShadow.position.set(0, -0.025, 0.02)
    this.head.add(browShadow)

    // Temple discs: two rings and a fin, facing out to the side.
    for (const side of [1, -1]) {
      const ear = new THREE.Group()
      const ring = (r: number, opacity: number) => {
        const points = Array.from({ length: 33 }, (_, i) => {
          const a = (i / 32) * Math.PI * 2
          return new THREE.Vector3(0, Math.cos(a) * r, Math.sin(a) * r)
        })
        return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), line(opacity))
      }
      ear.add(ring(0.34, 0.8), ring(0.2, 0.5))
      ear.add(new THREE.LineSegments(segments([[[0, 0.34, 0], [0, 0.78, -0.2], [0, 0.5, -0.3]]]), line(0.6)))
      ear.position.set(EAR_AT[0] * side, EAR_AT[1], EAR_AT[2])
      ear.rotation.y = side * 0.35
      this.head.add(ear)
    }

    // Eyes: a filled glowing almond each, and a bloom.
    this.eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    for (const side of [1, -1]) {
      const shape = new THREE.Shape(EYE.map(([x, y]) => new THREE.Vector2(x * side, y)))
      const eye = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.eyeMaterial)
      eye.position.z = 0.5
      this.eyes.push(eye)
      const bloom = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      bloom.position.set(0.58 * side, 0.52, 0.6)
      bloom.scale.set(1.3, 0.75, 1)
      this.eyeGlows.push(bloom)
      this.head.add(eye, bloom)
    }

    // Mouth: the lower lip and jaw ride down as he speaks; plates stretch
    // between the lips; a glow fills the gap.
    this.jaw.add(
      new THREE.LineSegments(segments(both([LOWER_LIP])), line(0.9)),
      new THREE.LineSegments(segments(both(JAW)), line(0.55)),
    )
    this.head.add(this.jaw)
    this.plates = new THREE.LineSegments(new THREE.BufferGeometry(), line(0.7))
    this.plates.geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(PLATES_X.length * 2 * 6), 3))
    this.head.add(this.plates)
    // The gap between the lips, shaped like them: its lower-lip vertices
    // ride down with the jaw.
    // Left corner, along the upper lip to the right corner, back along the lower.
    const rim = [...mirror(UPPER_LIP).reverse(), ...UPPER_LIP.slice(1), ...LOWER_LIP.slice(0, -1).reverse(), ...mirror(LOWER_LIP).slice(1, -1)]
      .map(([x, y]) => new THREE.Vector2(x, y))
    this.mouthGlow = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape(rim)),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    this.mouthGlow.position.z = 0.55
    this.mouthBase = Float32Array.from(this.mouthGlow.geometry.getAttribute("position").array)
    this.head.add(this.mouthGlow)

    // Thinking: a scan line across the face, top to bottom.
    this.scan = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.45, 0, 0.7), new THREE.Vector3(1.45, 0, 0.7)]),
      line(0),
    )
    this.head.add(this.scan)

    // Shards: small triangles orbiting, tumbling.
    for (let i = 0; i < SHARDS; i += 1) {
      const s = 0.09 + Math.random() * 0.12
      const points = [new THREE.Vector3(0, s, 0), new THREE.Vector3(s * 0.8, -s * 0.6, 0), new THREE.Vector3(-s * 0.5, -s * 0.4, 0)]
      const mesh = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), line(0.8))
      this.shards.push({
        mesh,
        axis: new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(),
        radius: 2.1 + Math.random() * 0.55,
        speed: 0.25 + Math.random() * 0.35,
        phase: (i / SHARDS) * Math.PI * 2,
        tilt: (Math.random() - 0.5) * 0.9,
      })
      this.group.add(mesh)
    }

    this.group.add(this.head)
  }

  update(dt: number, t: number, input: FaceInput) {
    const { status, amp, energy, look, sinceTyped, tint } = input
    for (const material of this.lines) material.color.copy(tint)

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
    // Snappy, not floaty: he looks, he does not drift.
    this.gaze.lerp(this.gazeTarget, Math.min(1, dt * (look ? 7 : 4)))
    this.head.rotation.y = this.gaze.x * 0.45 + Math.sin(t * 0.37) * 0.04
    this.head.rotation.x = this.gaze.y * 0.28
    this.head.rotation.z = -this.gaze.x * 0.05

    // Eyes: brighter with energy and voice; narrow while Andrew types (he
    // is reading); a blink now and then that is more of a flicker.
    this.blinkTimer -= dt
    if (this.blinkTimer <= 0) {
      this.blink = 1
      this.blinkTimer = 3 + Math.random() * 5
    }
    this.blink = Math.max(0, this.blink - dt * 7)
    const attending = sinceTyped < 2.5 || status === "listening"
    const narrow = (attending ? 0.55 : 1) * (1 - this.blink * 0.85)
    for (const eye of this.eyes) {
      eye.scale.y += (narrow - eye.scale.y) * Math.min(1, dt * 12)
      eye.position.y = (1 - eye.scale.y) * 0.5
    }
    const hot = 0.55 + energy * 0.5 + amp * 0.9 + (status === "thinking" ? 0.25 + 0.25 * Math.sin(t * 18) : 0)
    this.eyeMaterial.color.copy(tint).lerp(new THREE.Color(0xffffff), 0.35 + Math.min(0.4, amp * 0.6))
    this.eyeMaterial.opacity = Math.min(1, 0.7 + hot * 0.3) * (this.glitch > 0 && Math.random() < 0.5 ? 0.2 : 1)
    for (const bloom of this.eyeGlows) {
      ;(bloom.material as THREE.SpriteMaterial).color.copy(tint)
      ;(bloom.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.35 + hot * 0.45)
      bloom.scale.set(1.1 + hot * 0.5, 0.6 + hot * 0.2, 1)
    }

    // Jaw: with his voice when he speaks; a slight part when thinking.
    const speaking = status === "speaking"
    const target = speaking ? Math.min(1, amp * 2.4) : status === "thinking" ? 0.08 : 0
    this.open += (target - this.open) * Math.min(1, dt * (speaking ? 18 : 6))
    const drop = this.open * 0.26
    this.jaw.position.y = -drop
    const plates = this.plates.geometry.getAttribute("position") as THREE.BufferAttribute
    let k = 0
    for (const x of PLATES_X) {
      for (const side of [1, -1]) {
        const [uy, uz] = along(UPPER_LIP, x)
        const [ly, lz] = along(LOWER_LIP, x)
        plates.setXYZ(k++, x * side, uy, uz)
        plates.setXYZ(k++, x * side, ly - drop, lz)
      }
    }
    plates.needsUpdate = true
    const mouth = this.mouthGlow.material as THREE.MeshBasicMaterial
    mouth.color.copy(tint)
    mouth.opacity = Math.min(0.85, this.open * 1.4)
    const rim = this.mouthGlow.geometry.getAttribute("position") as THREE.BufferAttribute
    for (let i = 0; i < rim.count; i += 1) {
      const y = this.mouthBase[i * 3 + 1]
      // Below the corners (-0.94) is the lower lip.
      rim.setY(i, y < -0.95 ? y - drop : y)
    }
    rim.needsUpdate = true

    // Thinking scan.
    const scanMaterial = this.scan.material as THREE.LineBasicMaterial
    scanMaterial.opacity += ((status === "thinking" ? 0.9 : 0) - scanMaterial.opacity) * Math.min(1, dt * 6)
    this.scan.position.y = 1.9 - ((t * 1.4) % 1) * 3.9

    // Glitch: now and then (more often while he thinks) the face jumps
    // sideways for a few frames and the eyes stutter.
    this.glitchTimer -= dt
    if (this.glitchTimer <= 0) {
      this.glitch = 0.12 + Math.random() * 0.15
      this.glitchTimer = status === "thinking" ? 0.8 + Math.random() * 1.5 : 4 + Math.random() * 7
    }
    this.glitch = Math.max(0, this.glitch - dt)
    if (this.glitch > 0) {
      this.head.position.x = (Math.random() - 0.5) * 0.18
      this.head.position.y = (Math.random() - 0.5) * 0.05
      this.head.scale.x = 1 + (Math.random() - 0.5) * 0.06
    } else {
      this.head.position.set(0, 0, 0)
      this.head.scale.set(1, 1, 1)
    }

    // Shards: faster with energy, tumbling.
    const spin = status === "thinking" ? 2.4 : 1
    const point = new THREE.Vector3()
    for (const shard of this.shards) {
      shard.phase += dt * shard.speed * spin * (1 + energy)
      point.set(Math.cos(shard.phase) * shard.radius, Math.sin(shard.phase * 2) * 0.25 + shard.tilt, Math.sin(shard.phase) * shard.radius * 0.45)
      shard.mesh.position.copy(point)
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
