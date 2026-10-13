"use client"

import * as THREE from "three"

// Jarvis's mind, at the console's centre (lib/core-cipher.ts): after the
// consciousness sphere in Avengers: Age of Ultron - not its colour but its
// make. It is woven, not scattered: every trace sits on one spherical grid
// whose pole faces you, so its latitudes read as concentric tracks of
// broken rings and its meridians as radial stitches between them. Seen
// edge-on at the rim the tracks crowd together and the stitches stand out
// as a fringe; the middle is kept dark and open, crossed by one crisp ring
// and a few chip modules on an inner shell; a ribbon of parallel strands
// sweeps through it on a tilted orbit; and at its heart is a small bright
// eye over a short tunnel of rings.
//
// It is meant to read as light, not geometry: every trace is drawn
// additively by a shader that dims the sphere's far side and brightens its
// rim, flickers each trace on its own and now and then drops one out,
// runs pulses of data along them, and sweeps a scan through while he
// thinks; a few out-of-focus specks hang round it, sized by how far they
// sit from the focal plane (a depth of field).
//
// The layout comes from a seeded generator, so it is the same mind on
// every load.

export interface MindInput {
  /** Overall activity, 0.. (rest about 0.2). */
  energy: number
  /** Voice level, 0..1. */
  amp: number
  /** How fast it turns (1 at rest). */
  spin: number
  /** A tool's burst: fragments flung out, 1 decaying to 0. */
  burst: number
  thinking: boolean
  tint: THREE.Color
}

// mulberry32: a small seeded generator.
let state = 0
const seed = (s: number) => {
  state = s >>> 0
}
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const rand = (a: number, b: number) => a + random() * (b - a)
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1))

/** A point on a sphere whose pole is +z (toward the camera): theta round
 *  the pole, phi down from it. */
function polar(r: number, theta: number, phi: number, out = new THREE.Vector3()) {
  return out.set(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi))
}

// --- the trace shader ----------------------------------------------------------

const TRACE_VERTEX = /* glsl */ `
  attribute float aBright;
  attribute float aSeed;
  attribute float aAlong;
  uniform float uTime, uEnergy, uScan, uFlow, uPulse;
  varying float vAlpha;
  varying float vHot;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Facing: +1 on the near side of the sphere, -1 on the far side, 0 at the rim.
    vec3 n = normalize(normalMatrix * normalize(position + 1e-5));
    float facing = n.z;
    // The near cap is lit but held back, so the middle stays dark and the
    // rim, where the tracks crowd edge-on, carries the light.
    float a = mix(0.3, 0.8, smoothstep(-0.6, 0.9, facing));
    a += pow(1.0 - abs(facing), 2.5) * 0.75;
    // Each trace flickers on its own; now and then one drops out.
    a *= 0.8 + 0.2 * sin(uTime * (2.0 + aSeed * 6.0) + aSeed * 40.0);
    a *= mix(1.0, 0.15, step(0.985 - uEnergy * 0.02, hash(floor(uTime * 6.0) + aSeed * 91.0)));
    // Data running along the trace.
    float p = fract(aAlong - uTime * uFlow * (0.2 + aSeed * 0.4));
    float head = smoothstep(0.9, 1.0, p);
    // The scan sweeping through while he thinks.
    float scan = exp(-pow(((modelMatrix * vec4(position, 1.0)).y - uScan) * 5.0, 2.0));
    vHot = head * (0.5 + uEnergy) + scan * 1.4 + uPulse * 0.5;
    vAlpha = a * aBright * (0.6 + uEnergy * 0.55) + vHot * 0.45 * aBright;
    gl_Position = projectionMatrix * mv;
  }
`

const TRACE_FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vHot;
  void main() {
    vec3 c = mix(uTint, vec3(1.0), clamp(vHot * 0.45, 0.0, 0.7));
    vec3 o = c * vAlpha * uOpacity;
    gl_FragColor = vec4(o, clamp(max(o.r, max(o.g, o.b)), 0.0, 1.0));
  }
`

// Glints: a soft bright dot at a trace's joints, sized by depth.
const GLINT_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime, uEnergy, uScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normalize(position + 1e-5));
    float a = mix(0.25, 0.8, smoothstep(-0.6, 0.9, n.z)) + pow(1.0 - abs(n.z), 2.5) * 0.5;
    a *= 0.4 + 0.6 * pow(0.5 + 0.5 * sin(uTime * (1.2 + aSeed * 4.0) + aSeed * 30.0), 3.0);
    vAlpha = a * (0.5 + uEnergy * 0.7);
    // World size 0.02-0.05, in pixels at its depth.
    gl_PointSize = uScale * 0.02 * (1.0 + aSeed * 1.6) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

const GLINT_FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = exp(-d * d * 6.0);
    vec3 c = mix(uTint, vec3(1.0), core * 0.6);
    vec3 o = c * core * vAlpha * uOpacity;
    gl_FragColor = vec4(o, clamp(max(o.r, max(o.g, o.b)), 0.0, 1.0));
  }
`

// Bokeh: specks out of the focal plane grow and soften (a circle of
// confusion), a soft disc with a brighter rim.
const BOKEH_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime, uFocus, uScale, uEnergy;
  varying float vAlpha;
  varying float vSharp;
  void main() {
    vec3 p = position;
    // A slow drift, each on its own.
    p += 0.06 * vec3(sin(uTime * 0.3 + aSeed * 20.0), cos(uTime * 0.25 + aSeed * 13.0), sin(uTime * 0.2 + aSeed * 7.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float coc = abs(-mv.z - uFocus);
    float size = aSize + coc * 0.07;
    gl_PointSize = uScale * size / -mv.z;
    vSharp = 1.0 / (1.0 + coc * 2.5);
    vAlpha = (0.2 + 0.8 * vSharp) * (0.25 + uEnergy * 0.25) * (0.6 + 0.4 * sin(uTime * 0.8 + aSeed * 50.0));
    gl_Position = projectionMatrix * mv;
  }
`

const BOKEH_FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vSharp;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    // In focus: a bright point; out of it: a flat disc with a lit edge.
    float disc = smoothstep(1.0, 0.82, d) * (0.55 + 0.45 * smoothstep(0.55, 0.95, d));
    float point = exp(-d * d * 8.0);
    float a = mix(disc * 0.5, point, vSharp);
    vec3 c = mix(uTint, vec3(1.0), point * vSharp * 0.5);
    vec3 o = c * a * vAlpha * uOpacity;
    gl_FragColor = vec4(o, clamp(max(o.r, max(o.g, o.b)), 0.0, 1.0));
  }
`

/** Line segments built up as traces: each with a brightness, a seed and
 *  its position along its trace (for the data pulses). */
class TraceBuilder {
  readonly positions: number[] = []
  readonly bright: number[] = []
  readonly seed: number[] = []
  readonly along: number[] = []
  readonly joints: number[] = []
  readonly jointSeed: number[] = []

  /** A polyline: consecutive points joined. */
  add(points: THREE.Vector3[], brightness: number, joints = false) {
    const s = random()
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i]
      const b = points[i + 1]
      this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      this.bright.push(brightness, brightness)
      this.seed.push(s, s)
      this.along.push(i / (points.length - 1), (i + 1) / (points.length - 1))
    }
    if (joints) for (const p of [points[0], points[points.length - 1]]) this.glint(p)
  }

  glint(p: THREE.Vector3) {
    this.joints.push(p.x, p.y, p.z)
    this.jointSeed.push(random())
  }

  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3))
    g.setAttribute("aBright", new THREE.Float32BufferAttribute(this.bright, 1))
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(this.seed, 1))
    g.setAttribute("aAlong", new THREE.Float32BufferAttribute(this.along, 1))
    return g
  }

  jointGeometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.joints, 3))
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(this.jointSeed, 1))
    return g
  }
}

/** An arc of a latitude ring, from cell c0 to c1 of `cells` round it. */
function latArc(r: number, phi: number, c0: number, c1: number, cells: number, offset = 0) {
  const pts: THREE.Vector3[] = []
  // Two points a cell keep a long arc on the sphere.
  for (let c = c0; c <= c1; c += 0.5) pts.push(polar(r, ((c + offset) / cells) * Math.PI * 2, phi))
  return pts
}

interface WeaveOptions {
  r: number
  /** Latitude step, radians. */
  step: number
  /** Cells round each ring. */
  cells: number
  /** 0..1: how much of the grid is drawn. */
  density: number
  brightness: number
  /** Radial spurs off the rim. */
  fringe: boolean
  /** Turned by half a cell, so shells nest without lining up. */
  offset: number
}

/** A shell of the weave: latitude rings broken into runs on whole cells,
 *  stitched by meridians on the cell lines - fullest toward the rim
 *  (phi near 90 degrees), sparse at the pole, so the middle stays open. */
function weave(b: TraceBuilder, o: WeaveOptions) {
  const { r, step, cells } = o
  // Near hemisphere first, then a lighter echo of the far one.
  const lats: number[] = []
  for (let phi = step; phi < Math.PI / 2 + 1e-6; phi += step) lats.push(phi)
  for (let phi = Math.PI / 2 + step; phi < Math.PI - step * 0.5; phi += step) if (random() < 0.45) lats.push(phi)
  const runs = new Map<number, boolean[]>()
  for (const phi of lats) {
    const edge = Math.pow(Math.sin(phi), 2.5)
    if (random() > (0.35 + 0.65 * edge) * o.density + 0.05) continue
    const on: boolean[] = new Array(cells).fill(false)
    let c = randInt(0, cells - 1)
    const start = c
    const brightness = o.brightness * rand(0.6, 1) * (0.7 + 0.3 * edge)
    while (c < start + cells) {
      const len = randInt(3, Math.round(6 + 14 * edge * o.density))
      const end = Math.min(c + len, start + cells - 1)
      if (end > c) {
        b.add(latArc(r, phi, c, end, cells, o.offset), brightness, random() < 0.2)
        for (let k = c; k <= end; k += 1) on[k % cells] = true
      }
      c = end + randInt(1, Math.round(2 + 4 * (1 - edge)))
    }
    runs.set(phi, on)
  }
  // Stitches: a meridian between neighbouring rings, on a cell line both
  // rings reach; near the rim they show as radial strokes.
  const sorted = [...runs.keys()].sort((a, b) => a - b)
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const p0 = sorted[i]
    const p1 = sorted[i + 1]
    if (p1 - p0 > step * 2.5) continue
    const a = runs.get(p0)!
    const z = runs.get(p1)!
    const edge = Math.pow(Math.sin((p0 + p1) / 2), 3)
    for (let c = 0; c < cells; c += 1) {
      if (!a[c] || !z[c] || random() > 0.06 + 0.3 * edge * o.density) continue
      const theta = ((c + o.offset) / cells) * Math.PI * 2
      b.add([polar(r, theta, p0), polar(r, theta, (p0 + p1) / 2), polar(r, theta, p1)], o.brightness * 0.8, random() < 0.3)
      // Now and then a pad: a small square across the stitch's end.
      if (random() < 0.12) {
        const h = 0.35
        b.add(
          [
            [c - h, p1 - step * 0.3],
            [c + h, p1 - step * 0.3],
            [c + h, p1 + step * 0.3],
            [c - h, p1 + step * 0.3],
            [c - h, p1 - step * 0.3],
          ].map(([cc, pp]) => polar(r, ((cc + o.offset) / cells) * Math.PI * 2, pp)),
          o.brightness * 1.1
        )
      }
    }
  }
  // The fringe: short radial spurs off the rim, on the cell lines, in
  // combs of a few at a time.
  if (o.fringe) {
    for (let c = 0; c < cells; ) {
      const comb = randInt(2, 6)
      for (let k = 0; k < comb && c < cells; k += 1, c += 1) {
        const theta = ((c + o.offset) / cells) * Math.PI * 2
        const phi = Math.PI / 2 + rand(-0.12, 0.12)
        const dir = polar(1, theta, phi)
        const len = k % 3 === 0 ? rand(0.14, 0.26) : rand(0.05, 0.12)
        b.add([dir.clone().multiplyScalar(r), dir.clone().multiplyScalar(r + len)], o.brightness * 0.9, k === 0)
      }
      c += randInt(1, 5)
    }
  }
}

export class JarvisMind {
  /** Stage groups, revealed in turn at boot (core-cipher.ts). */
  readonly core = new THREE.Group()
  readonly shells = new THREE.Group()
  readonly band = new THREE.Group()
  readonly outer = new THREE.Group()

  private readonly uniforms = {
    uTint: { value: new THREE.Color(0x00d4ff) },
    uTime: { value: 0 },
    uEnergy: { value: 0.2 },
    uScan: { value: -10 },
    uFlow: { value: 0.35 },
    uPulse: { value: 0 },
    uOpacity: { value: 1 },
    uFocus: { value: 9 },
    uScale: { value: 300 },
  }
  private readonly outerShell: THREE.Group
  private readonly midShell: THREE.Group
  private readonly innerShell: THREE.Group
  private readonly ribbon: THREE.Group
  private readonly vortex: THREE.Group
  private readonly vortexRings: THREE.LineLoop[] = []
  private readonly shards: { line: THREE.Line; dir: THREE.Vector3; r: number; speed: number }[] = []
  private readonly materials: THREE.Material[] = []
  private scanPhase = 0

  constructor(private readonly pixelRatio: number) {
    seed(0x1a2b3c)
    const shaderMaterial = (vertexShader: string, fragmentShader: string) => {
      const m = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        // Light only adds (ONE, ONE): over the page, a dim speck must not
        // cover what is behind the canvas.
        premultipliedAlpha: true,
      })
      this.materials.push(m)
      return m
    }
    const traceMaterial = () => shaderMaterial(TRACE_VERTEX, TRACE_FRAGMENT)
    const draw = (b: TraceBuilder) => {
      const group = new THREE.Group()
      group.add(new THREE.LineSegments(b.geometry(), traceMaterial()))
      if (b.joints.length) group.add(new THREE.Points(b.jointGeometry(), shaderMaterial(GLINT_VERTEX, GLINT_FRAGMENT)))
      return group
    }

    // The weave: an outer shell with the fringe, and a sparser one just
    // inside it on a finer grid, turned half a cell, turning the other way.
    {
      const b = new TraceBuilder()
      weave(b, { r: 1.62, step: THREE.MathUtils.degToRad(6), cells: 96, density: 1, brightness: 0.9, fringe: true, offset: 0 })
      this.outerShell = draw(b)
    }
    {
      const b = new TraceBuilder()
      weave(b, { r: 1.38, step: THREE.MathUtils.degToRad(9), cells: 72, density: 0.65, brightness: 0.7, fringe: false, offset: 0.5 })
      this.midShell = draw(b)
    }

    // The inner shell: one unbroken ring, the crisp circle round the
    // heart, with a hairline beside it; and chip modules - small grids of
    // cells laid on the sphere - spaced round it.
    {
      const b = new TraceBuilder()
      const r = 0.92
      weave(b, { r, step: THREE.MathUtils.degToRad(8), cells: 64, density: 0.75, brightness: 0.75, fringe: false, offset: 0.25 })
      b.add(latArc(r, Math.PI / 2, 0, 128, 128), 1.25)
      b.add(latArc(r * 0.97, Math.PI / 2, 0, 128, 128), 0.45)
      const modules = 9
      for (let m = 0; m < modules; m += 1) {
        const theta0 = (m / modules) * Math.PI * 2 + rand(-0.15, 0.15)
        const phi0 = rand(0.55, 1.05) * (m % 2 ? 1 : -1) + Math.PI / 2
        const cols = randInt(2, 4)
        const rows = randInt(2, 3)
        const cw = 0.07
        const rh = 0.06
        const brightness = rand(0.5, 0.8)
        for (let i = 0; i <= rows; i += 1) {
          const phi = phi0 + i * rh
          b.add(
            Array.from({ length: cols * 2 + 1 }, (_, k) => polar(r, theta0 + (k / 2) * cw, phi)),
            brightness
          )
        }
        for (let k = 0; k <= cols; k += 1) {
          const theta = theta0 + k * cw
          b.add([polar(r, theta, phi0), polar(r, theta, phi0 + rows * rh)], brightness * 0.8, k === 0)
        }
      }
      this.innerShell = draw(b)
    }
    this.shells.add(this.outerShell, this.midShell, this.innerShell)

    // The ribbon: four parallel strands on a tilted orbit, sweeping across
    // the sphere in front and behind it - the one long curve in it.
    this.ribbon = new THREE.Group()
    {
      const b = new TraceBuilder()
      const strands = 6
      const cells = 160
      for (let s = 0; s < strands; s += 1) {
        const r = 1.22 + s * 0.04
        // Each strand broken in a few places, at its own points.
        let c = randInt(0, 12)
        while (c < cells - 4) {
          const len = randInt(14, 46)
          const end = Math.min(c + len, cells)
          b.add(latArc(r, Math.PI / 2, c, end, cells), s === 2 ? 1.6 : 0.9, true)
          c = end + randInt(2, 7)
        }
      }
      const orbit = draw(b)
      // Steeply tilted, so it shows as a long ellipse crossing the face.
      orbit.rotation.set(0.95, 0.55, 0)
      this.ribbon.add(orbit)
    }
    this.band.add(this.ribbon)

    // The heart: a small bright eye - three rings, the inner two tight -
    // over a short tunnel of rings going away from you.
    this.vortex = new THREE.Group()
    {
      const ringMaterial = traceMaterial()
      const ring = (r: number, z: number, brightness: number, k: number) => {
        const pts: number[] = []
        const n = 72
        for (let i = 0; i < n; i += 1) {
          const a = (i / n) * Math.PI * 2
          pts.push(Math.cos(a) * r, Math.sin(a) * r, z)
        }
        const g = new THREE.BufferGeometry()
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))
        g.setAttribute("aBright", new THREE.Float32BufferAttribute(new Array(n).fill(brightness), 1))
        g.setAttribute("aSeed", new THREE.Float32BufferAttribute(new Array(n).fill(k / 10), 1))
        g.setAttribute("aAlong", new THREE.Float32BufferAttribute(Array.from({ length: n }, (_, i) => i / n), 1))
        const loop = new THREE.LineLoop(g, ringMaterial)
        this.vortexRings.push(loop)
        this.vortex.add(loop)
      }
      ring(0.2, 0.02, 2.6, 0)
      ring(0.13, 0.01, 3.0, 1)
      ring(0.07, 0, 3.4, 2)
      for (let k = 0; k < 6; k += 1) ring(0.2 * Math.pow(0.8, k + 1), -0.1 - k * 0.09, 1.6 - k * 0.2, k + 3)
      // Six spokes from the eye's rim back down the tunnel.
      const b = new TraceBuilder()
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2
        const r1 = 0.2 * Math.pow(0.8, 6)
        b.add([new THREE.Vector3(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.02), new THREE.Vector3(Math.cos(a) * r1, Math.sin(a) * r1, -0.55)], 1, false)
      }
      this.vortex.add(new THREE.LineSegments(b.geometry(), ringMaterial))
    }
    this.core.add(this.vortex)

    // Shards: splinters off the rim, radial, drifting outward and fading,
    // then reborn at the rim.
    {
      const shardMaterial = traceMaterial()
      for (let i = 0; i < 48; i += 1) {
        const dir = polar(1, rand(0, Math.PI * 2), Math.PI / 2 + rand(-0.35, 0.35))
        const b = new TraceBuilder()
        b.add([new THREE.Vector3(), dir.clone().multiplyScalar(rand(0.04, 0.12))], rand(0.5, 0.9))
        const line = new THREE.LineSegments(b.geometry(), shardMaterial)
        const shard = { line, dir, r: rand(1.8, 2.7), speed: rand(0.04, 0.12) }
        line.position.copy(dir).multiplyScalar(shard.r)
        this.shards.push(shard)
        this.outer.add(line)
      }
    }

    // Bokeh: a few specks round the sphere.
    {
      const N = 140
      const pos: number[] = []
      const size: number[] = []
      const seeds: number[] = []
      for (let i = 0; i < N; i += 1) {
        const p = polar(Math.cbrt(random()) * 3.2 + 0.5, rand(0, Math.PI * 2), Math.acos(rand(-1, 1)))
        pos.push(p.x, p.y, p.z)
        size.push(rand(0.02, 0.06))
        seeds.push(random())
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1))
      g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1))
      this.outer.add(new THREE.Points(g, shaderMaterial(BOKEH_VERTEX, BOKEH_FRAGMENT)))
    }
  }

  /** Point sizes are world sizes projected to pixels: the canvas's height
   *  over the camera's view (38 degrees, core-cipher.ts). */
  setViewport(heightPx: number, fovDeg = 38) {
    this.uniforms.uScale.value = (heightPx * this.pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2))
  }

  update(dt: number, t: number, input: MindInput) {
    const u = this.uniforms
    const { energy: e, amp, spin } = input
    u.uTime.value = t
    u.uEnergy.value = e
    u.uTint.value.copy(input.tint)
    u.uPulse.value = amp
    u.uFlow.value = 0.25 + e * 0.6 + (input.thinking ? 0.6 : 0)
    // While he thinks, a scan sweeps up and down through it.
    this.scanPhase += dt * 2.2
    u.uScan.value = input.thinking ? Math.sin(this.scanPhase) * 1.6 : -10

    // The shells turn about the pole that faces you (so the weave stays
    // concentric), each leaning a little and slowly, so they never sit
    // exactly on one another.
    this.outerShell.rotation.z += dt * 0.05 * spin
    this.outerShell.rotation.x = Math.sin(t * 0.13) * 0.12
    this.outerShell.rotation.y = Math.cos(t * 0.11) * 0.1
    this.midShell.rotation.z -= dt * 0.08 * spin
    this.midShell.rotation.x = Math.sin(t * 0.17 + 1) * 0.16
    this.midShell.rotation.y = Math.cos(t * 0.15 + 2) * 0.14
    this.innerShell.rotation.z += dt * 0.12 * spin
    this.innerShell.rotation.x = Math.sin(t * 0.21 + 3) * 0.2
    // The ribbon runs round its own orbit and the orbit precesses.
    this.ribbon.children[0].rotation.z += dt * 0.2 * spin
    this.ribbon.rotation.z = t * 0.04 * spin
    // The shells breathe with his voice.
    this.shells.scale.setScalar(1 + amp * 0.05 + Math.sin(t * 1.4) * 0.006)

    // The eye: its rings turning against each other, the tunnel pulled
    // toward you as he speaks.
    this.vortexRings.forEach((ring, k) => {
      ring.rotation.z += dt * (0.3 + k * 0.05) * spin * (k % 2 ? -1 : 1)
    })
    this.vortex.position.z = 0.3 + amp * 0.15
    this.vortex.scale.setScalar(1 + amp * 0.35 + e * 0.1)

    // Shards drift outward and are reborn at the rim; a burst flings them.
    for (const s of this.shards) {
      s.r += dt * s.speed * (1 + input.burst * 6 + e)
      if (s.r > 3.0) s.r = 1.75
      s.line.position.copy(s.dir).multiplyScalar(s.r)
    }
  }

  dispose() {
    for (const g of [this.core, this.shells, this.band, this.outer]) {
      g.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    }
    for (const m of this.materials) m.dispose()
  }
}
