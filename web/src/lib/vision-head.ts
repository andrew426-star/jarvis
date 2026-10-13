"use client"

import * as THREE from "three"

import type { Mouth } from "@/lib/speech-track"

// Vision's head inside Ultron's helmet (lib/ultron-face.ts): Andrew's own
// sculpt of the MCU Vision (the workshop mesh "vision-head": upright, z up,
// facing -y, in mm), rigged here to speak.
//
// The rig is found on the sculpt itself, from a depth render of its face
// (as the helmet's slots are): the nose tip, the lip line between the lips
// (traced across the mouth, column by column), the mouth's corners, the
// chin, and each eye (the pits either side of the nose's bridge). Every
// vertex of the face gets weights from those - how much it belongs to the
// jaw, the upper lip, the lower lip, the mouth's surroundings, an eyeball
// - and a vertex shader moves the sculpt by them each frame from a mouth
// shape (lib/speech-track.ts, the sound being made): the jaw turns on its
// hinge below the ears, the lips part, widen, round and push forward,
// press together for m, b and p, and the lower lip tucks under the teeth
// for f and v; the eyes turn with his gaze.
//
// The sculpt's lips are one closed surface, so they are cut apart: across
// the mouth, every triangle is the upper lip's or the lower's by which side
// of the lip line it lies, and the two sides move apart - a slit that
// opens down the lip line and closes off at the corners. Behind it, a dark
// mouth and two rows of teeth (the lower on the jaw), each a sheet shaped
// to his own face just behind the lips, so they never show anywhere else.
//
// Drawn in the console's cel style: toon bands, the crimson of Vision's
// skin (vertex colour, darker in the creases), his pale eyes painted on
// the sculpted ones.

export interface VisionLandmarks {
  /** All in the head's own frame (y up, face toward +z), model units. */
  nose: THREE.Vector3
  /** The lip line's middle. */
  lip: THREE.Vector3
  chin: THREE.Vector3
  /** His right eye, then his left: the front of each eyeball. */
  eyes: [THREE.Vector3, THREE.Vector3]
  mouthHalf: number
  eyeRadius: number
  /** The Mind Stone on his forehead (its front), and its size. */
  stone: THREE.Vector3
  stoneRadius: number
  /** The head's height (crown to the cut) and width, for proportions. */
  height: number
  width: number
  /** The lip line's height across the mouth. */
  lipY: (x: number) => number
}

// After What If...?'s Infinity Ultron: Vision's face a deep crimson that
// falls to near-black in shadow and in every crease, his eyes Ultron's
// (red, white-hot at the middle), the Mind Stone gold in its silver setting.
const SKIN = new THREE.Color(0xa3243a)
const SKIN_LIGHT = new THREE.Color(0xc8394f)
const SKIN_SHADE = new THREE.Color(0x3c0a14)
const EYE = new THREE.Color(0xff2a2a)
const STONE = new THREE.Color(0xffd36a)
const SETTING = new THREE.Color(0xb9b7bd)
const MOUTH = new THREE.Color(0x14030a)
/** How far the jaw turns, wide open (radians). */
const JAW = 0.2

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const gauss = (x: number) => Math.exp(-x * x)

/** The face seen from the front: how far forward the surface comes at each
 *  point (16-bit depth, N x N), and the mapping to the head's coordinates. */
function frontDepth(geometry: THREE.BufferGeometry, renderer: THREE.WebGLRenderer, N: number) {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!.clone()
  const range = box.max.z - box.min.z + 0.2
  const camera = new THREE.OrthographicCamera(box.min.x, box.max.x, box.max.y, box.min.y, 0, range)
  camera.position.set(0, 0, box.max.z + 0.1)
  const material = new THREE.ShaderMaterial({
    vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "void main() { float d = gl_FragCoord.z * 255.0; gl_FragColor = vec4(floor(d) / 255.0, fract(d), 0.0, 1.0); }",
    side: THREE.DoubleSide,
  })
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(geometry, material))
  const target = new THREE.WebGLRenderTarget(N, N)
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
  /** How far forward the surface comes there (z; -Infinity where none). */
  const front = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= N || py >= N) return -Infinity
    const i = (py * N + px) * 4
    const d = pixels[i] / 255 + pixels[i + 1] / 65025
    return d > 0.995 ? -Infinity : box.max.z + 0.1 - d * range
  }
  const toX = (px: number) => box.min.x + ((px + 0.5) / N) * (box.max.x - box.min.x)
  const toY = (py: number) => box.min.y + ((py + 0.5) / N) * (box.max.y - box.min.y)
  const toPx = (x: number) => Math.round(((x - box.min.x) / (box.max.x - box.min.x)) * N - 0.5)
  const toPy = (y: number) => Math.round(((y - box.min.y) / (box.max.y - box.min.y)) * N - 0.5)
  /** The surface's z at a point of the head (x, y). */
  const at = (x: number, y: number) => front(toPx(x), toPy(y))
  return { box, N, front, at, toX, toY, toPx, toPy }
}

type Depth = ReturnType<typeof frontDepth>

/** The face's landmarks, from its depth. */
function findLandmarks(d: Depth): VisionLandmarks {
  const { box, N, front, toX, toY, toPx, toPy } = d
  const H = box.max.y - box.min.y
  const W = box.max.x - box.min.x
  const cx = toPx(0)
  const rowPx = N / H
  const colPx = N / W
  /** A column's forward reach at a row (a few columns averaged). */
  const reach = (px: number, py: number) => {
    let s = 0
    let n = 0
    for (let dx = -2; dx <= 2; dx += 1) {
      const f = front(px + dx, py)
      if (Number.isFinite(f)) {
        s += f
        n += 1
      }
    }
    return n ? s / n : -Infinity
  }
  // Nose tip: the most forward point on the centre line, mid-face.
  let noseRow = toPy(box.min.y + H * 0.5)
  let best = -Infinity
  for (let py = toPy(box.min.y + H * 0.3); py <= toPy(box.min.y + H * 0.75); py += 1) {
    const f = reach(cx, py)
    if (f > best) {
      best = f
      noseRow = py
    }
  }
  const nose = new THREE.Vector3(0, toY(noseRow), best)
  // The lip line: below the nose, the deepest dip between the two lips -
  // the row furthest behind the higher ground just above and below it.
  const lo = Math.max(0, noseRow - Math.round(0.2 * H * rowPx))
  const hi = noseRow - Math.round(0.045 * H * rowPx)
  const span = Math.max(2, Math.round(0.018 * H * rowPx))
  const dipAt = (px: number, py: number) => {
    let above = -Infinity
    let below = -Infinity
    for (let k = 1; k <= span; k += 1) {
      above = Math.max(above, reach(px, py + k))
      below = Math.max(below, reach(px, py - k))
    }
    return Math.min(above, below) - reach(px, py)
  }
  let lipRow = Math.round((lo + hi) / 2)
  let dip = 0
  for (let py = lo + span; py <= hi - span; py += 1) {
    const dd = dipAt(cx, py)
    // Prefer the upper dip a little: the groove under the lower lip dips too.
    const score = dd * (1 + 0.6 * ((py - lo) / Math.max(1, hi - lo)))
    if (Number.isFinite(dd) && score > dip) {
      dip = score
      lipRow = py
    }
  }
  const lip = new THREE.Vector3(0, toY(lipRow), reach(cx, lipRow))
  // Across the mouth, column by column: the lip line's row (near the last
  // one), until the groove gives out - the corner.
  const lineRows = new Map<number, number>([[cx, lipRow]])
  let mouthHalf = 0.11 * W
  for (const side of [1, -1]) {
    let row = lipRow
    for (let px = cx + side; Math.abs(px - cx) < N * 0.3; px += side) {
      let bestRow = row
      let bestDip = -Infinity
      for (let py = row - 2; py <= row + 2; py += 1) {
        const dd = dipAt(px, py)
        if (dd > bestDip) {
          bestDip = dd
          bestRow = py
        }
      }
      if (!(bestDip > 0.0025 * H)) {
        if (side > 0) mouthHalf = Math.max(0.06 * W, toX(px))
        break
      }
      row = bestRow
      lineRows.set(px, row)
    }
  }
  const lipY = (x: number) => {
    const px = Math.round(toPx(x))
    const xs = [...lineRows.keys()]
    const nearest = xs.reduce((a, b) => (Math.abs(b - px) < Math.abs(a - px) ? b : a), cx)
    return toY(lineRows.get(nearest)!)
  }
  // The chin: the most forward point well below the lips.
  let chinRow = lipRow - Math.round(0.12 * H * rowPx)
  best = -Infinity
  for (let py = Math.max(0, lipRow - Math.round(0.22 * H * rowPx)); py <= lipRow - Math.round(0.07 * H * rowPx); py += 1) {
    const f = reach(cx, py)
    if (f > best) {
      best = f
      chinRow = py
    }
  }
  const chin = new THREE.Vector3(0, toY(chinRow), best)
  // Eyes: either side of the nose's bridge, the pit - the point most
  // sunk below the surface all round it (above, below, inside, outside);
  // the face's edge, curving away, is low on one side only.
  const eyes: THREE.Vector3[] = []
  const r = Math.round(0.07 * W * colPx)
  const rise = (px: number, py: number, dx: number, dy: number) => {
    let m = -Infinity
    for (let k = 2; k <= r; k += 1) m = Math.max(m, front(px + dx * k, py + dy * k))
    return m
  }
  for (const side of [1, -1]) {
    let bestPit = 0
    let ex = side * 0.17 * W
    let ey = nose.y + 0.1 * H
    for (let py = toPy(nose.y + 0.04 * H); py <= toPy(nose.y + 0.2 * H); py += 1) {
      for (let px = toPx(side * 0.07 * W); side > 0 ? px <= toPx(0.3 * W) : px >= toPx(-0.3 * W); px += side) {
        const f = front(px, py)
        if (!Number.isFinite(f)) continue
        const pit = Math.min(rise(px, py, 1, 0), rise(px, py, -1, 0), rise(px, py, 0, 1), rise(px, py, 0, -1)) - f
        if (pit > bestPit) {
          bestPit = pit
          ex = toX(px)
          ey = toY(py)
        }
      }
    }
    eyes.push(new THREE.Vector3(ex, ey, d.at(ex, ey)))
  }
  // The pit is where the eyeball meets the lids; the eyeball's front is a
  // little above it, and the eye about a fifth of the eyes' spacing wide.
  const spacing = Math.abs(eyes[0].x - eyes[1].x)
  // The Mind Stone: on the centre line of his forehead, the point standing
  // furthest proud of the forehead round it (a ring a little way out).
  const eyeY = (eyes[0].y + eyes[1].y) / 2
  const ring = Math.max(3, Math.round(0.035 * W * colPx))
  let stone = new THREE.Vector3(0, eyeY + 0.17 * H, 0)
  let proud = -Infinity
  for (let py = toPy(eyeY + 0.06 * H); py <= toPy(eyeY + 0.36 * H); py += 1) {
    const f = reach(cx, py)
    if (!Number.isFinite(f)) continue
    let sum = 0
    let n = 0
    for (let k = 0; k < 16; k += 1) {
      const a = (k / 16) * Math.PI * 2
      const g = front(cx + Math.round(Math.cos(a) * ring), py + Math.round(Math.sin(a) * ring))
      if (Number.isFinite(g)) {
        sum += g
        n += 1
      }
    }
    const above = n ? f - sum / n : -Infinity
    if (above > proud) {
      proud = above
      stone = new THREE.Vector3(0, toY(py), f)
    }
  }
  return {
    nose,
    lip,
    chin,
    eyes: [eyes[0], eyes[1]],
    mouthHalf,
    eyeRadius: spacing * 0.2,
    stone,
    stoneRadius: 0.022 * H,
    height: H,
    width: W,
    lipY,
  }
}

/** A toon material with the rig in its vertex shader. */
function rigMaterial(bands: THREE.Texture, lm: VisionLandmarks) {
  // Both sides: the reduction flips the odd triangle, which would show as a hole.
  const material = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: bands, side: THREE.DoubleSide })
  const uniforms = {
    uEyeHeat: { value: 1 },
    uStoneHeat: { value: 1 },
    uOpen: { value: 0 },
    uWide: { value: 0.5 },
    uRound: { value: 0 },
    uPress: { value: 0 },
    uTuck: { value: 0 },
    uGaze: { value: new THREE.Vector2() },
    uHinge: { value: new THREE.Vector2(lm.lip.y + 0.07 * lm.height, lm.lip.z - 0.55 * lm.height) },
    uLip: { value: lm.lip.clone() },
    uH: { value: lm.height },
    uEyeL: { value: lm.eyes[1].clone().add(new THREE.Vector3(0, 0, -lm.eyeRadius)) },
    uEyeR: { value: lm.eyes[0].clone().add(new THREE.Vector3(0, 0, -lm.eyeRadius)) },
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec4 aRig;   // jaw, upper lip, lower lip, mouth area
        attribute float aEye;  // +1 his right eyeball, -1 his left, 0 neither
        attribute vec2 aGlow;  // how much of an eye's light, of the stone's
        varying vec2 vGlow;
        uniform float uOpen, uWide, uRound, uPress, uTuck, uH;
        uniform vec2 uGaze, uHinge;
        uniform vec3 uLip, uEyeL, uEyeR;
        vec3 rigMove(vec3 p, inout vec3 n) {
          float jaw = aRig.x, up = aRig.y, low = aRig.z, area = aRig.w;
          // Lips: wider (or narrower), rounded and pushed out, around the mouth.
          float dx = p.x - uLip.x;
          p.x += area * dx * ((uWide - 0.5) * 0.3 - uRound * 0.28);
          p.z += area * uRound * 0.02 * uH;
          // Upper lip: lifts off the teeth as he opens, down to press.
          p.y += up * (uOpen * 0.01 - uPress * 0.003) * uH;
          // Lower lip: up and back under the teeth for f / v, up to press.
          p.y += low * (uTuck * 0.014 + uPress * 0.003) * uH;
          p.z -= low * uTuck * 0.01 * uH;
          // The jaw turns on its hinge (an axis across the head, below the
          // ears); positive turns the chin down and back.
          float a = uOpen * ${JAW.toFixed(3)} * (1.0 - uPress) * jaw;
          vec2 q = vec2(p.y, p.z) - uHinge;
          float c = cos(a), s = sin(a);
          vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
          p.y = uHinge.x + r.x;
          p.z = uHinge.y + r.y;
          vec2 nr = vec2(n.y * c - n.z * s, n.y * s + n.z * c);
          n.y = nr.x;
          n.z = nr.y;
          // Eyes: the eyeball turns about its centre with the gaze.
          if (aEye != 0.0) {
            vec3 centre = aEye > 0.0 ? uEyeR : uEyeL;
            vec3 e = p - centre;
            float yaw = uGaze.x * 0.35, pitch = -uGaze.y * 0.25;
            e = vec3(e.x * cos(yaw) + e.z * sin(yaw), e.y, -e.x * sin(yaw) + e.z * cos(yaw));
            e = vec3(e.x, e.y * cos(pitch) - e.z * sin(pitch), e.y * sin(pitch) + e.z * cos(pitch));
            p = centre + e;
          }
          return p;
        }`
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        vGlow = aGlow;
        vec3 rigNormal = objectNormal;
        vec3 rigPos = rigMove(position, rigNormal);
        objectNormal = rigNormal;`
      )
      .replace("#include <begin_vertex>", "vec3 transformed = rigPos;")
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec2 vGlow;
        uniform float uEyeHeat, uStoneHeat;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // Ultron's eyes burn in Vision's face, white at the heart; the stone glows.
        totalEmissiveRadiance += mix(vec3(1.0, 0.1, 0.12), vec3(1.0, 0.85, 0.85), vGlow.x * vGlow.x) * vGlow.x * uEyeHeat * 1.6;
        totalEmissiveRadiance += vec3(1.0, 0.82, 0.42) * vGlow.y * uStoneHeat * 1.4;`
      )
  }
  return { material, uniforms }
}

/** A sheet over part of the face, just behind its surface: the mouth's
 *  dark, a row of teeth. Model units; `inset` behind the face. */
function faceSheet(d: Depth, x0: number, x1: number, yAt: (x: number, t: number) => number, inset: number, material: THREE.Material) {
  const C = 40
  const R = 8
  const verts: number[] = []
  const index: number[] = []
  for (let j = 0; j <= R; j += 1) {
    for (let i = 0; i <= C; i += 1) {
      const x = x0 + ((x1 - x0) * i) / C
      const y = yAt(x, j / R)
      const z = d.at(x, y)
      verts.push(x, y, (Number.isFinite(z) ? z : 0) - inset)
    }
  }
  for (let j = 0; j < R; j += 1) {
    for (let i = 0; i < C; i += 1) {
      const a = j * (C + 1) + i
      index.push(a, a + 1, a + C + 1, a + C + 1, a + 1, a + C + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return new THREE.Mesh(g, material)
}

/**
 * How sunk each corner is below the surface around it (+: a crease or
 * groove, -: a ridge), from a soup of triangles: corners are welded where
 * they meet, each vertex's neighbours averaged, and the offset to that
 * average taken along the normal, in units of the local edge length - then
 * smoothed once, so it reads as line work rather than noise.
 */
function curvature(geometry: THREE.BufferGeometry): Float32Array {
  const position = geometry.getAttribute("position")
  const count = position.count
  const ids = new Int32Array(count)
  const index = new Map<number, number>()
  let unique = 0
  const Q = 40 // per unit: corners within 0.025 are one
  for (let i = 0; i < count; i += 1) {
    const key = (Math.round(position.getX(i) * Q) + 4096) * 67108864 + (Math.round(position.getY(i) * Q) + 4096) * 8192 + (Math.round(position.getZ(i) * Q) + 4096)
    let id = index.get(key)
    if (id === undefined) {
      id = unique++
      index.set(key, id)
    }
    ids[i] = id
  }
  const pos = new Float32Array(unique * 3)
  const nrm = new Float32Array(unique * 3)
  const sum = new Float32Array(unique * 3)
  const deg = new Float32Array(unique)
  const edge = new Float32Array(unique)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (let t = 0; t < count; t += 3) {
    a.fromBufferAttribute(position, t)
    b.fromBufferAttribute(position, t + 1)
    c.fromBufferAttribute(position, t + 2)
    n.crossVectors(b.clone().sub(a), c.clone().sub(a))
    const corners = [a, b, c]
    for (let k = 0; k < 3; k += 1) {
      const id = ids[t + k]
      const p = corners[k]
      pos.set([p.x, p.y, p.z], id * 3)
      nrm[id * 3] += n.x
      nrm[id * 3 + 1] += n.y
      nrm[id * 3 + 2] += n.z
      for (const q of [corners[(k + 1) % 3], corners[(k + 2) % 3]]) {
        sum[id * 3] += q.x
        sum[id * 3 + 1] += q.y
        sum[id * 3 + 2] += q.z
        deg[id] += 1
        edge[id] += p.distanceTo(q)
      }
    }
  }
  let curv = new Float32Array(unique)
  for (let id = 0; id < unique; id += 1) {
    if (!deg[id]) continue
    const len = Math.hypot(nrm[id * 3], nrm[id * 3 + 1], nrm[id * 3 + 2]) || 1
    const dx = sum[id * 3] / deg[id] - pos[id * 3]
    const dy = sum[id * 3 + 1] / deg[id] - pos[id * 3 + 1]
    const dz = sum[id * 3 + 2] / deg[id] - pos[id * 3 + 2]
    const along = (dx * nrm[id * 3] + dy * nrm[id * 3 + 1] + dz * nrm[id * 3 + 2]) / len
    curv[id] = (along / (edge[id] / deg[id] || 1)) * 4
  }
  // Smooth once over the same neighbours (by the triangles).
  const next = new Float32Array(unique)
  const w = new Float32Array(unique)
  for (let t = 0; t < count; t += 3) {
    for (let k = 0; k < 3; k += 1) {
      const id = ids[t + k]
      for (let j = 0; j < 3; j += 1) {
        next[id] += curv[ids[t + j]]
        w[id] += 1
      }
    }
  }
  for (let id = 0; id < unique; id += 1) next[id] = w[id] ? next[id] / w[id] : 0
  curv = next
  const out = new Float32Array(count)
  for (let i = 0; i < count; i += 1) out[i] = curv[ids[i]]
  return out
}

/** The triangles whose three corners all pass `keep` (y, z). */
function cropTriangles(geometry: THREE.BufferGeometry, keep: (y: number, z: number) => boolean) {
  const position = geometry.getAttribute("position")
  const out: number[] = []
  for (let t = 0; t < position.count; t += 3) {
    let ok = true
    for (let k = 0; k < 3 && ok; k += 1) ok = keep(position.getY(t + k), position.getZ(t + k))
    if (!ok) continue
    for (let k = 0; k < 3; k += 1) out.push(position.getX(t + k), position.getY(t + k), position.getZ(t + k))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3))
  return g
}

export class VisionHead {
  readonly group = new THREE.Group()
  readonly landmarks: VisionLandmarks
  private readonly uniforms: ReturnType<typeof rigMaterial>["uniforms"]
  /** On the jaw: the lower teeth. */
  private readonly jaw = new THREE.Group()
  private readonly materials: THREE.Material[] = []

  private readonly glows: { sprite: THREE.Sprite; base: number; stone: boolean }[] = []

  constructor(stl: THREE.BufferGeometry, bands: THREE.Texture, renderer: THREE.WebGLRenderer, glowMap?: THREE.Texture) {
    // Upright in the console's frame: y up, the face toward +z.
    const whole = stl.index ? stl.toNonIndexed() : stl
    whole.rotateX(-Math.PI / 2)
    whole.computeBoundingBox()
    const box = whole.boundingBox!
    whole.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
    const depth = frontDepth(whole, renderer, 384)
    const lm = findLandmarks(depth)
    this.landmarks = lm
    // Only his face shows through the helmet's opening: the crown, the back
    // of the skull and the neck would push out through the shell, so they
    // go - the head is kept from ear to ear, brow to just under the chin.
    // Further back than the cheeks, nothing below the lips (the jaw's
    // angle and the neck there would hang under the helmet's sides).
    const geometry = cropTriangles(
      whole,
      (y, z) =>
        z > lm.nose.z - 0.5 * lm.height &&
        y > lm.chin.y - 0.04 * lm.height &&
        y < lm.stone.y + 0.07 * lm.height &&
        (z > lm.nose.z - 0.28 * lm.height || y > lm.lip.y - 0.02 * lm.height)
    )
    whole.dispose()
    geometry.computeVertexNormals()
    this.paintAndWeigh(geometry, lm, depth)
    const rig = rigMaterial(bands, lm)
    this.uniforms = rig.uniforms
    this.materials.push(rig.material)
    this.group.add(new THREE.Mesh(geometry, rig.material))

    // The sculpt is hollow and cropped behind the face, so its openings
    // (nostrils, the parted lips) would show straight through to the
    // background. A dark backing inside the head fills them with shadow.
    {
      const shade = new THREE.MeshBasicMaterial({ color: 0x5e1428, side: THREE.DoubleSide })
      this.materials.push(shade)
      const backing = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), shade)
      backing.scale.set(lm.width * 0.36, lm.height * 0.34, lm.height * 0.08)
      backing.position.set(0, (lm.chin.y + lm.stone.y) / 2, lm.nose.z - 0.3 * lm.height)
      this.group.add(backing)
    }

    // Light off the eyes and the stone.
    if (glowMap) {
      const add = (at: THREE.Vector3, color: number, size: number, stone: boolean) => {
        const m = new THREE.SpriteMaterial({ map: glowMap, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
        this.materials.push(m)
        const sprite = new THREE.Sprite(m)
        sprite.position.copy(at).add(new THREE.Vector3(0, 0, size * 0.25))
        sprite.scale.setScalar(size)
        this.group.add(sprite)
        this.glows.push({ sprite, base: size, stone })
      }
      for (const e of lm.eyes) add(e, 0xff2030, lm.eyeRadius * 4.2, false)
      add(lm.stone, 0xffd36a, lm.stoneRadius * 7, true)
    }

    // Behind the lips, the teeth: the upper on the skull, the lower on the jaw.
    const h = lm.height
    const w = lm.mouthHalf
    const teeth = new THREE.MeshToonMaterial({ color: 0xece4d8, gradientMap: bands, side: THREE.DoubleSide })
    this.materials.push(teeth)
    const across = (x: number) => Math.max(0, 1 - (x / w) ** 2)
    this.group.add(faceSheet(depth, -w * 0.72, w * 0.72, (x, t) => lm.lipY(x) - 0.002 * h + 0.016 * t * h * across(x), 0.006 * h, teeth))
    this.jaw.add(faceSheet(depth, -w * 0.66, w * 0.66, (x, t) => lm.lipY(x) - 0.003 * h - 0.012 * t * h * across(x), 0.007 * h, teeth))
    // The jaw group turns about the hinge, like the jaw in the shader.
    const hinge = this.uniforms.uHinge.value
    const pivot = new THREE.Group()
    pivot.position.set(0, hinge.x, hinge.y)
    this.jaw.position.set(0, -hinge.x, -hinge.y)
    pivot.add(this.jaw)
    this.group.add(pivot)
    this.pivot = pivot
  }

  private readonly pivot: THREE.Group

  /** Vertex colours (skin, his eyes) and the rig's weights. */
  private paintAndWeigh(geometry: THREE.BufferGeometry, lm: VisionLandmarks, depth: Depth) {
    const position = geometry.getAttribute("position")
    const normal = geometry.getAttribute("normal")
    const count = position.count
    const colors = new Float32Array(count * 3)
    const rig = new Float32Array(count * 4)
    const eye = new Float32Array(count)
    const glow = new Float32Array(count * 2)
    const cavity = curvature(geometry)
    const h = lm.height
    const mw = lm.mouthHalf
    const er = lm.eyeRadius
    const p = new THREE.Vector3()
    const centroid = new THREE.Vector3()
    const c = new THREE.Color()
    const unit = 0.04 * h
    for (let t = 0; t < count; t += 3) {
      // The triangle's side of the lip line, across the mouth: its corners
      // all go with it, so the lips come apart along the line.
      centroid.set(0, 0, 0)
      for (let k = 0; k < 3; k += 1) centroid.add(p.fromBufferAttribute(position, t + k))
      centroid.multiplyScalar(1 / 3)
      const side = centroid.y >= lm.lipY(centroid.x) ? 1 : -1
      const facing = (normal.getZ(t) + normal.getZ(t + 1) + normal.getZ(t + 2)) / 3
      for (let k = 0; k < 3; k += 1) {
        const i = t + k
        p.fromBufferAttribute(position, i)
        // Only the face's outside moves: the front, facing out.
        const outward = facing > -0.3 && p.z > lm.chin.z - 0.3 * h ? 1 : 0
        const u = p.x / mw
        // In the mouth, each side is held clear of the line by its own
        // triangle's side (tapering off at the corners, where the lips meet).
        const inMouth = smooth(1.2, 0.8, Math.abs(u))
        const v = (p.y - lm.lipY(p.x)) / unit + side * 0.6 * inMouth
        const below = smooth(0.15, -0.6, v)
        const acrossJaw = gauss(p.x / (0.3 * h))
        const aboveNeck = smooth(lm.chin.y - 0.14 * h, lm.chin.y - 0.04 * h, p.y)
        // Along the lips, the parting is widest in the middle and closes to
        // nothing at the corners (an almond, not a slot).
        const almond = 1 - gauss(v / 2.2) * (1 - Math.max(0, 1 - u * u))
        const jaw = outward * below * acrossJaw * aboveNeck * almond
        const upper = outward * (v > 0 ? gauss(v / 1.1) : 0) * gauss(u / 1.15)
        const lower = outward * (v <= 0 ? gauss(v / 1.1) : 0) * gauss(u / 1.15)
        const area = outward * gauss(u / 1.35) * gauss(v / 2)
        rig.set([jaw, upper, lower, area], i * 4)
        // Colour: his skin, darker in the creases (facing away from the
        // light from the front), and his eyes on the eyeballs. What lies
        // behind the face - the hollow's inside, seen only through his
        // open mouth - is the mouth's dark.
        const surface = depth.at(p.x, p.y)
        // (Deeper than the face's own folds: the groove under the lower
        // lip, the panel lines.)
        // Only round the mouth: the nostrils are deep too, but not a hole.
        const nearMouth = Math.abs(p.x) < mw * 1.6 && p.y < lm.lip.y + 0.03 * h && p.y > lm.chin.y - 0.02 * h
        if (nearMouth && Number.isFinite(surface) && p.z < surface - 0.035 * h) {
          colors.set([MOUTH.r, MOUTH.g, MOUTH.b], i * 3)
          continue
        }
        // The sculpt's detail as ink and light: every crease, wrinkle and
        // panel seam darkened by how far it is sunk below its surroundings,
        // every ridge lifted - the cel-shaded film's line work, from the
        // sculpt itself.
        // The hollow print's inside (seen up a nostril): all concave, so the
        // crease shading would make it black. Plain shadowed skin instead.
        const inside = Number.isFinite(surface) && p.z < surface - 0.012 * h
        const sunk = inside ? 0.45 : cavity[i]
        c.copy(SKIN)
        // (Never all the way to black: a deep nostril is shadow, not a hole.)
        if (sunk > 0) c.lerp(SKIN_SHADE, Math.min(0.82, sunk * 1.15))
        else c.lerp(SKIN_LIGHT, Math.min(0.6, -sunk * 0.8))
        for (let e = 0; e < 2; e += 1) {
          const at = lm.eyes[e]
          const r = Math.hypot(p.x - at.x, (p.y - at.y - er * 0.1) * 1.5)
          // On the eyeball's front only, not the lids round it.
          if (r < er && p.z > at.z - er * 0.35) {
            eye[i] = e === 0 ? 1 : -1
            c.copy(EYE)
            glow[i * 2] = Math.max(glow[i * 2], 1 - r / er)
          }
        }
        // The stone, and the silver setting round it.
        const sr = lm.stoneRadius
        const ds = Math.hypot(p.x - lm.stone.x, (p.y - lm.stone.y) * 0.8)
        if (ds < sr * 2.1 && p.z > lm.stone.z - sr * 1.6) {
          if (ds < sr) {
            c.copy(STONE)
            glow[i * 2 + 1] = 1 - (ds / sr) * 0.5
          } else c.copy(SETTING).lerp(SKIN_SHADE, Math.max(0, sunk) * 0.8)
        }
        colors.set([c.r, c.g, c.b], i * 3)
      }
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute("aRig", new THREE.BufferAttribute(rig, 4))
    geometry.setAttribute("aEye", new THREE.BufferAttribute(eye, 1))
    geometry.setAttribute("aGlow", new THREE.BufferAttribute(glow, 2))
  }

  /** How hot his eyes burn (0..), and the stone (its flare on top). */
  setHeat(eyes: number, stone: number) {
    this.uniforms.uEyeHeat.value = eyes
    this.uniforms.uStoneHeat.value = stone
    for (const g of this.glows) {
      const heat = g.stone ? stone : eyes
      ;(g.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.35 + heat * 0.4)
      g.sprite.scale.setScalar(g.base * (0.8 + heat * 0.3))
    }
  }

  /** The mouth shape now (lib/speech-track.ts) and where he looks (-1..1). */
  set(mouth: Mouth, gaze: THREE.Vector2) {
    const u = this.uniforms
    u.uOpen.value = mouth.open
    u.uWide.value = mouth.wide
    u.uRound.value = mouth.round
    u.uPress.value = mouth.press
    u.uTuck.value = mouth.tuck
    u.uGaze.value.copy(gaze)
    // The lower teeth and the mouth's floor ride the jaw.
    this.pivot.rotation.x = mouth.open * JAW * (1 - mouth.press)
  }

  dispose() {
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    for (const m of this.materials) m.dispose()
  }
}
