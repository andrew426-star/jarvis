"use client"

import * as THREE from "three"

// Jarvis's mind, at the console's centre (lib/core-cipher.ts): after the
// consciousness sphere in Avengers: Age of Ultron - not its colour but its
// make. A sphere that is not a surface but thousands of broken circuit
// traces and chip pads, two shells deep, densest where you see them
// edge-on at the rim; a thick tilted band of debris round it; long chords
// cut straight through; fragments splintering off the rim and drifting
// away; a tunnel of rings at its heart, receding into depth; and the space
// in and around it full of out-of-focus specks, like light seen through a
// lens.
//
// It is meant to read as light, not geometry: every trace is drawn
// additively by a shader that dims the sphere's far side and brightens its
// rim, flickers each trace on its own and now and then drops one out,
// runs pulses of data along them, and sweeps a scan through while he
// thinks; the specks are sized by how far they sit from the focal plane
// (a depth of field), soft discs with a brighter edge, as real bokeh is.

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

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** A point on the sphere at (theta around y, phi from the pole). */
function onSphere(r: number, theta: number, phi: number, out = new THREE.Vector3()) {
  return out.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta))
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
    float a = mix(0.28, 1.0, smoothstep(-0.7, 0.85, facing));
    // Seen edge-on at the rim, a shell crowds together: brighter there.
    a += pow(1.0 - abs(facing), 3.0) * 0.55;
    // Each trace flickers on its own; now and then one drops out.
    a *= 0.72 + 0.28 * sin(uTime * (2.5 + aSeed * 7.0) + aSeed * 40.0);
    a *= mix(1.0, 0.15, step(0.975 - uEnergy * 0.02, hash(floor(uTime * 7.0) + aSeed * 91.0)));
    // Data running along the trace.
    float p = fract(aAlong - uTime * uFlow * (0.25 + aSeed * 0.6));
    float head = smoothstep(0.86, 1.0, p);
    // The scan sweeping through while he thinks.
    float scan = exp(-pow((position.y - uScan) * 5.0, 2.0));
    vHot = head * (0.6 + uEnergy) + scan * 1.4 + uPulse * 0.6;
    vAlpha = a * aBright * (0.55 + uEnergy * 0.6) + vHot * 0.5;
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
    float a = mix(0.25, 1.0, smoothstep(-0.6, 0.9, n.z));
    a *= 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 5.0) + aSeed * 30.0);
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
    vAlpha = (0.2 + 0.8 * vSharp) * (0.35 + uEnergy * 0.3) * (0.6 + 0.4 * sin(uTime * 0.8 + aSeed * 50.0));
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
  add(points: THREE.Vector3[], brightness: number, joints = true) {
    const s = Math.random()
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i]
      const b = points[i + 1]
      this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      this.bright.push(brightness, brightness)
      this.seed.push(s, s)
      this.along.push(i / (points.length - 1), (i + 1) / (points.length - 1))
    }
    if (joints) {
      for (const p of [points[0], points[points.length - 1]]) {
        this.joints.push(p.x, p.y, p.z)
        this.jointSeed.push(Math.random())
      }
    }
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

/** A circuit trace across a sphere: steps along a latitude or a meridian,
 *  turning at right angles, as a board's traces do - with a pad at the end
 *  now and then. */
function circuit(b: TraceBuilder, r: number, brightness: number) {
  let theta = rand(0, Math.PI * 2)
  // Fewer at the poles: pick phi by the area it covers.
  let phi = Math.acos(rand(-0.92, 0.92))
  const pts = [onSphere(r, theta, phi)]
  const steps = 2 + Math.floor(Math.random() * 5)
  let along = Math.random() < 0.5
  for (let k = 0; k < steps; k += 1) {
    const len = rand(0.04, 0.22)
    // A few intermediate points so a long step follows the curve.
    const n = 3
    const dTheta = along ? (Math.random() < 0.5 ? -1 : 1) * (len / Math.max(0.2, Math.sin(phi))) / r : 0
    const dPhi = along ? 0 : (Math.random() < 0.5 ? -1 : 1) * (len / r)
    for (let j = 1; j <= n; j += 1) pts.push(onSphere(r, theta + (dTheta * j) / n, phi + (dPhi * j) / n))
    theta += dTheta
    phi = THREE.MathUtils.clamp(phi + dPhi, 0.2, Math.PI - 0.2)
    along = !along
  }
  b.add(pts, brightness)
  // A chip pad: a small square on the sphere, at the trace's end.
  if (Math.random() < 0.25) {
    const s = rand(0.015, 0.04)
    const corners = [
      [-s, -s],
      [s, -s],
      [s, s],
      [-s, s],
      [-s, -s],
    ].map(([u, v]) => onSphere(r, theta + u / Math.max(0.2, Math.sin(phi)) / r, phi + v / r))
    b.add(corners, brightness * 1.2, false)
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
  private readonly innerShell: THREE.Group
  private readonly vortex: THREE.Group
  private readonly vortexRings: THREE.LineLoop[] = []
  private readonly shards: { line: THREE.Line; dir: THREE.Vector3; r: number; speed: number }[] = []
  private readonly materials: THREE.Material[] = []
  private scanPhase = 0

  constructor(private readonly pixelRatio: number) {
    const traceMaterial = () => {
      const m = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: TRACE_VERTEX,
        fragmentShader: TRACE_FRAGMENT,
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
    const glintMaterial = () => {
      const m = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: GLINT_VERTEX,
        fragmentShader: GLINT_FRAGMENT,
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

    // Two shells of circuitry, a little thickness to each.
    const shell = (r0: number, r1: number, count: number, brightness: number) => {
      const b = new TraceBuilder()
      for (let i = 0; i < count; i += 1) circuit(b, rand(r0, r1), brightness * rand(0.5, 1.2))
      const group = new THREE.Group()
      group.add(new THREE.LineSegments(b.geometry(), traceMaterial()))
      group.add(new THREE.Points(b.jointGeometry(), glintMaterial()))
      return group
    }
    this.outerShell = shell(1.5, 1.68, 1500, 0.8)
    this.innerShell = shell(0.85, 1.0, 520, 0.6)
    this.innerShell.rotation.set(0.6, 0.3, 0.2)
    this.shells.add(this.outerShell, this.innerShell)

    // Chords straight through the sphere, rim to rim, near its middle.
    {
      const b = new TraceBuilder()
      for (let i = 0; i < 16; i += 1) {
        const a = onSphere(1.62, rand(0, Math.PI * 2), Math.acos(rand(-0.9, 0.9)))
        const offset = new THREE.Vector3(rand(-0.25, 0.25), rand(-0.25, 0.25), rand(-0.25, 0.25))
        const c = a.clone().negate().add(offset).setLength(1.62)
        b.add([a, a.clone().lerp(c, 0.5), c], rand(0.45, 0.8), false)
      }
      this.shells.add(new THREE.LineSegments(b.geometry(), traceMaterial()))
    }

    // The band: a thick tilted ring of debris - fragments running round it,
    // at a spread of radii and heights, densest at its middle.
    {
      const b = new TraceBuilder()
      for (let i = 0; i < 1400; i += 1) {
        const r = 1.85 + Math.abs(rand(-1, 1) * rand(0, 1)) * 0.65
        const y = rand(-1, 1) * rand(0, 1) * 0.22
        const a = rand(0, Math.PI * 2)
        const len = rand(0.02, 0.16)
        const pts = [new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)]
        // Mostly along the ring; some kinked across it, like broken traces.
        const a2 = a + len / r
        pts.push(new THREE.Vector3(Math.cos(a2) * r, y, Math.sin(a2) * r))
        if (Math.random() < 0.35) {
          const r2 = r + rand(-0.06, 0.06)
          pts.push(new THREE.Vector3(Math.cos(a2) * r2, y + rand(-0.04, 0.04), Math.sin(a2) * r2))
        }
        b.add(pts, rand(0.4, 1.1))
      }
      const ring = new THREE.Group()
      ring.add(new THREE.LineSegments(b.geometry(), traceMaterial()))
      ring.add(new THREE.Points(b.jointGeometry(), glintMaterial()))
      // Oblique, so it crosses in front of the sphere and behind it, as in the film.
      ring.rotation.set(0.42, 0, 0.3)
      this.band.add(ring)
    }

    // The heart: a tunnel of rings going away from you, twisting as it
    // goes, with spokes; a white-hot point at its end.
    this.vortex = new THREE.Group()
    {
      const ringMaterial = traceMaterial()
      for (let k = 0; k < 16; k += 1) {
        const r = 0.56 * Math.pow(0.85, k)
        const pts: number[] = []
        const n = 64
        for (let i = 0; i < n; i += 1) {
          const a = (i / n) * Math.PI * 2
          // A little wobble, so the rings read as made, not drawn.
          const w = 1 + 0.04 * Math.sin(a * 5 + k)
          pts.push(Math.cos(a) * r * w, Math.sin(a) * r * w, -k * 0.07)
        }
        const g = new THREE.BufferGeometry()
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))
        const count = pts.length / 3
        g.setAttribute("aBright", new THREE.Float32BufferAttribute(new Array(count).fill(2.4 - k * 0.1), 1))
        g.setAttribute("aSeed", new THREE.Float32BufferAttribute(new Array(count).fill(k / 16), 1))
        g.setAttribute("aAlong", new THREE.Float32BufferAttribute(Array.from({ length: count }, (_, i) => i / count), 1))
        const ring = new THREE.LineLoop(g, ringMaterial)
        ring.rotation.z = k * 0.25
        this.vortexRings.push(ring)
        this.vortex.add(ring)
      }
      const b = new TraceBuilder()
      for (let i = 0; i < 24; i += 1) {
        const a = (i / 24) * Math.PI * 2
        const r0 = 0.56 * Math.pow(0.85, 12)
        b.add([new THREE.Vector3(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.02), new THREE.Vector3(Math.cos(a) * r0, Math.sin(a) * r0, -0.84)], 0.8, false)
      }
      this.vortex.add(new THREE.LineSegments(b.geometry(), ringMaterial))
    }
    this.core.add(this.vortex)

    // Shards: fragments off the rim, drifting outward and fading, then
    // reborn at the rim.
    const shardMaterial = traceMaterial()
    for (let i = 0; i < 140; i += 1) {
      const dir = onSphere(1, rand(0, Math.PI * 2), Math.acos(rand(-0.95, 0.95)))
      const b = new TraceBuilder()
      const len = rand(0.04, 0.14)
      const side = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).cross(dir).normalize()
      b.add([new THREE.Vector3(), dir.clone().multiplyScalar(len), dir.clone().multiplyScalar(len).addScaledVector(side, len * 0.4)], rand(0.5, 1), false)
      const line = new THREE.LineSegments(b.geometry(), shardMaterial)
      const shard = { line, dir, r: rand(1.65, 2.8), speed: rand(0.04, 0.16) }
      line.position.copy(dir).multiplyScalar(shard.r)
      this.shards.push(shard)
      this.outer.add(line)
    }

    // Bokeh: specks through and round the sphere.
    {
      const N = 520
      const pos: number[] = []
      const size: number[] = []
      const seed: number[] = []
      for (let i = 0; i < N; i += 1) {
        const p = onSphere(Math.cbrt(Math.random()) * 3.4 + 0.2, rand(0, Math.PI * 2), Math.acos(rand(-1, 1)))
        pos.push(p.x, p.y, p.z)
        size.push(rand(0.02, 0.07))
        seed.push(Math.random())
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1))
      g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1))
      const m = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: BOKEH_VERTEX,
        fragmentShader: BOKEH_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        // Light only adds (ONE, ONE): over the page, a dim speck must not
        // cover what is behind the canvas.
        premultipliedAlpha: true,
      })
      this.materials.push(m)
      this.outer.add(new THREE.Points(g, m))
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

    this.outerShell.rotation.y += dt * 0.09 * spin
    this.outerShell.rotation.x = Math.sin(t * 0.15) * 0.15
    this.innerShell.rotation.y -= dt * 0.16 * spin
    this.innerShell.rotation.z += dt * 0.05 * spin
    this.band.children[0].rotation.y += dt * 0.12 * spin
    // The shells breathe with his voice.
    this.shells.scale.setScalar(1 + amp * 0.06 + Math.sin(t * 1.4) * 0.008)

    // The tunnel: each ring turning, the whole pulled toward you as it
    // pulses, faster when he is busy.
    this.vortexRings.forEach((ring, k) => {
      ring.rotation.z += dt * (0.3 + k * 0.05) * spin * (k % 2 ? -1 : 1)
    })
    this.vortex.position.z = 0.25 + amp * 0.15
    this.vortex.scale.setScalar(1 + amp * 0.35 + e * 0.1)

    // Shards drift outward and are reborn at the rim; a burst flings them.
    for (const s of this.shards) {
      s.r += dt * s.speed * (1 + input.burst * 6 + e)
      // (Each is built along its own direction, so it stays radial.)
      if (s.r > 3.1) s.r = 1.65
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
