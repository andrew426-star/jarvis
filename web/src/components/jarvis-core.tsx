"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Float, Html } from "@react-three/drei"
import { EffectComposer } from "@react-three/postprocessing"
import { BloomEffect } from "postprocessing"
import * as THREE from "three"

import { audioAmplitude } from "@/lib/audio-amplitude"

export type CoreState = "idle" | "thinking" | "speaking"

interface StateParams {
  rotationSpeed: number
  pulseFreq: number
  pulseAmp: number
}

const STATE_PARAMS: Record<CoreState, StateParams> = {
  idle: { rotationSpeed: 0.15, pulseFreq: 0.6, pulseAmp: 0.15 },
  thinking: { rotationSpeed: 0.4, pulseFreq: 2.5, pulseAmp: 0.35 },
  speaking: { rotationSpeed: 0.25, pulseFreq: 4.5, pulseAmp: 0.5 },
}

// K.I.V.'s HUD green palette (globals.css --kv-glow / --kv-mint) — untouched.
const SHELL_COLOR = "hsl(152, 76%, 46%)"
const CORE_COLOR = "hsl(162, 72%, 55%)"

// Bigger sphere within the same container box, via framing (radius +
// closer camera) rather than more geometry — ring/tick/mote counts below
// are untouched, keeping the perf budget exactly where it was.
const GLOBE_RADIUS = 1.45
const RING_COUNT = 32
const RING_TUBE = 0.0065
const DATA_TICK_COUNT = 110
const MOTE_COUNT = 40
const CAMERA_Z = 5.15

// Boot/materialize sequence timing — fires once per session (JarvisCore
// mounts once via dynamic(...,{ssr:false}) in jarvis-stage.tsx and never
// unmounts as panels toggle). Whole-lattice spin stays frozen until this
// finishes — "coming online," not "already spinning while parts fly in."
const BOOT_RING_STAGGER = 0.55
const BOOT_RING_DURATION = 0.9
const BOOT_TAIL = 0.5
const BOOT_TOTAL = BOOT_RING_STAGGER + BOOT_RING_DURATION + BOOT_TAIL

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3)
}
function easeOutBack(x: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

// A depth-faded, additively-blended line/ring material shared by the main
// lattice and the secondary data-texture layer. `sphereDir` (the vertex
// position normalized) stands in for "this point's direction on the
// conceptual sphere" — for a thin torus that's a very close approximation
// of the great circle it lies on. Transforming that direction (not the
// position — w=0 keeps it a pure direction) into view space and comparing
// it to the camera's forward axis gives a camera/rotation-robust "is this
// the near or far side" factor with no hardcoded camera distance.
//
// uPulse (0 = idle) displaces each vertex radially — a real geometric
// swell, not just an opacity change. Driven by CoreMesh's per-ring
// ring.uniforms.uPulse, itself blended toward real narration amplitude
// while speaking (see audio-amplitude.ts) — this is the actual "brought
// to life" moment, not a fixed sine wave.
const DEPTH_VERTEX_SHADER = `
  uniform float uPulse;
  varying float vFacing;
  void main() {
    vec3 sphereDir = normalize(position);
    vec3 displaced = position * (1.0 + uPulse * 0.05);
    vec3 viewDir = normalize((modelViewMatrix * vec4(sphereDir, 0.0)).xyz);
    vFacing = viewDir.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`

const DEPTH_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFacing;
  void main() {
    // Far side (vFacing near -1) is dimmed toward a floor, never fully
    // gone; near side (vFacing near +1) reads at full strength. Dimming
    // alone sells "thinner" too at this scale — a genuine per-fragment
    // width reduction on a thin torus doesn't read reliably on screen and
    // isn't worth the added shader complexity.
    float depthFactor = smoothstep(-1.0, 1.0, vFacing) * 0.72 + 0.28;
    gl_FragColor = vec4(uColor * depthFactor, uOpacity * depthFactor);
  }
`

// Uniform-random unit vector via Archimedes' hat-box method (uniform z +
// uniform angle around it) — a ring's plane normal, since a circle is
// rotationally symmetric about its own normal. `zPower` biases the
// distribution: <1 clusters toward the poles (|z| pushed toward 1), >1
// clusters toward the equator (|z| pushed toward 0), 1 is unbiased.
function randomUnitVector(zPower = 1): THREE.Vector3 {
  let z = Math.random() * 2 - 1
  if (zPower !== 1) z = Math.sign(z) * Math.pow(Math.abs(z), zPower)
  const angle = Math.random() * Math.PI * 2
  const r = Math.sqrt(Math.max(0, 1 - z * z))
  return new THREE.Vector3(r * Math.cos(angle), r * Math.sin(angle), z)
}

const RING_UP = new THREE.Vector3(0, 0, 1)

interface RingSpec {
  quaternion: THREE.Quaternion
  scatterQuaternion: THREE.Quaternion // wide random tumble — the ring's boot starting orientation
  bootDelay: number // seconds, per-ring stagger within BOOT_RING_STAGGER
  baseOpacity: number
  tube: number
  uniforms: {
    uColor: { value: THREE.Color }
    uOpacity: { value: number }
    uPulse: { value: number }
  }
}

// True great-circle rings, all sharing one radius (a slight bias toward
// polar clustering, per the reference) — equal radii is what makes the
// intersection math below exact: two same-radius circles centered on the
// origin, in different planes, cross the sphere at exactly two antipodal
// points; different-radius circles generally wouldn't intersect at all.
function useRings(count: number): RingSpec[] {
  return useMemo(
    () =>
      Array.from({ length: count }, () => {
        const baseOpacity = 0.4 + Math.random() * 0.1
        const finalQuaternion = new THREE.Quaternion().setFromUnitVectors(RING_UP, randomUnitVector(0.75))
        const scatterAxis = randomUnitVector()
        const scatterAngle = Math.PI * (0.6 + Math.random() * 0.8)
        const scatterQuaternion = finalQuaternion
          .clone()
          .premultiply(new THREE.Quaternion().setFromAxisAngle(scatterAxis, scatterAngle))
        return {
          quaternion: finalQuaternion,
          scatterQuaternion,
          bootDelay: Math.random() * BOOT_RING_STAGGER,
          baseOpacity,
          tube: RING_TUBE * (0.85 + Math.random() * 0.3),
          uniforms: {
            uColor: { value: new THREE.Color(SHELL_COLOR) },
            uOpacity: { value: baseOpacity },
            uPulse: { value: 0 },
          },
        }
      }),
    [count]
  )
}

// Real ring-ring intersection points, not scattered random dots. Two great
// circles with plane normals n_i, n_j meet the sphere where a point lies on
// both planes *and* at distance R from the origin — the line through the
// origin in direction normalize(n_i × n_j), at ±R along it.
function useIntersectionNodes(rings: RingSpec[], radius: number) {
  return useMemo(() => {
    const normals = rings.map((ring) => RING_UP.clone().applyQuaternion(ring.quaternion))
    const positions: number[] = []

    for (let i = 0; i < normals.length; i++) {
      for (let j = i + 1; j < normals.length; j++) {
        const cross = normals[i].clone().cross(normals[j])
        const len = cross.length()
        if (len < 1e-4) continue
        const direction = cross.multiplyScalar(1 / len)
        positions.push(
          direction.x * radius,
          direction.y * radius,
          direction.z * radius,
          -direction.x * radius,
          -direction.y * radius,
          -direction.z * radius
        )
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3))
    return geometry
  }, [rings, radius])
}

// Secondary "schematic clutter" layer: small tick segments and tiny
// rectangle outlines tangent to the sphere surface, denser near the
// equatorial band (zPower > 1 biases toward the equator — the opposite
// bias from the main rings above).
function useDataTexture(count: number, radius: number) {
  return useMemo(() => {
    const positions: number[] = []
    for (let i = 0; i < count; i++) {
      const normal = randomUnitVector(2.5)
      const center = normal.clone().multiplyScalar(radius * (0.985 + Math.random() * 0.02))
      const arbitrary = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
      const tangentU = new THREE.Vector3().crossVectors(arbitrary, normal).normalize()
      const tangentV = new THREE.Vector3().crossVectors(normal, tangentU).normalize()
      const size = 0.02 + Math.random() * 0.035

      if (Math.random() < 0.35) {
        // tiny rectangle outline
        const hw = size * (0.5 + Math.random() * 0.5)
        const hh = size * (0.3 + Math.random() * 0.4)
        const corners = [
          [-hw, -hh],
          [hw, -hh],
          [hw, hh],
          [-hw, hh],
        ].map(([u, v]) =>
          center.clone().add(tangentU.clone().multiplyScalar(u)).add(tangentV.clone().multiplyScalar(v))
        )
        for (let c = 0; c < 4; c++) {
          const a = corners[c]
          const b = corners[(c + 1) % 4]
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
        }
      } else {
        // short tick segment, random tangent-plane direction
        const dirAngle = Math.random() * Math.PI * 2
        const dir = tangentU
          .clone()
          .multiplyScalar(Math.cos(dirAngle))
          .add(tangentV.clone().multiplyScalar(Math.sin(dirAngle)))
          .multiplyScalar(size / 2)
        const a = center.clone().sub(dir)
        const b = center.clone().add(dir)
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3))
    return geometry
  }, [count, radius])
}

// Free-floating ambient motes — biased (cube of a uniform variable) toward
// sitting close to the shell, with a long sparse tail drifting further out.
function useMotes(count: number, radius: number) {
  return useMemo(() => {
    const positions = new Float32Array(count * 3)
    const opacities = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const distance = radius * (1.02 + Math.pow(Math.random(), 3) * 1.1)
      const point = randomUnitVector().multiplyScalar(distance)
      positions.set([point.x, point.y, point.z], i * 3)
      opacities[i] = 1 - Math.min(1, (distance / radius - 1) / 1.1)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute("aOpacity", new THREE.BufferAttribute(opacities, 1))
    return geometry
  }, [count, radius])
}

const MOTE_VERTEX_SHADER = `
  attribute float aOpacity;
  varying float vOpacity;
  void main() {
    vOpacity = aOpacity;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (8.0 + 10.0 * aOpacity) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const MOTE_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uBootFade;
  varying float vOpacity;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    gl_FragColor = vec4(uColor, vOpacity * 0.3 * uBootFade);
  }
`

interface CoreMeshProps {
  state: CoreState
  bootProgressRef: React.RefObject<number>
}

function CoreMesh({ state, bootProgressRef }: CoreMeshProps) {
  const groupRef = useRef<THREE.Group>(null)
  const echoGroupRefs = useRef<(THREE.Group | null)[]>([])
  const ringMeshRefs = useRef<(THREE.Mesh | null)[]>([])
  const moteGroupRef = useRef<THREE.Group>(null)
  const nodeMaterialRef = useRef<THREE.PointsMaterial>(null)
  const rotationRef = useRef({ x: 0, y: 0 })
  const nextFlickerAtRef = useRef(2 + Math.random() * 4)
  const flickerEndRef = useRef(0)
  const flickerIndicesRef = useRef<Set<number>>(new Set())
  const bootStartRef = useRef<number | null>(null)
  const bootDoneRef = useRef(false)
  const smoothedAudioRef = useRef(0)

  const params = STATE_PARAMS[state]
  const rings = useRings(RING_COUNT)
  const nodeGeometry = useIntersectionNodes(rings, GLOBE_RADIUS)
  const dataTextureGeometry = useDataTexture(DATA_TICK_COUNT, GLOBE_RADIUS)
  const moteGeometry = useMotes(MOTE_COUNT, GLOBE_RADIUS)
  const dataTextureUniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color(SHELL_COLOR) }, uOpacity: { value: 0.16 } }),
    []
  )
  const moteUniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color(CORE_COLOR) }, uBootFade: { value: 1 } }),
    []
  )

  useFrame((three, delta) => {
    const t = three.clock.elapsedTime
    if (bootStartRef.current === null) bootStartRef.current = t
    const elapsed = t - bootStartRef.current

    if (!bootDoneRef.current) {
      const bootProgress = THREE.MathUtils.clamp(elapsed / BOOT_TOTAL, 0, 1)
      bootProgressRef.current = bootProgress

      rings.forEach((ring, i) => {
        const ringT = THREE.MathUtils.clamp((elapsed - ring.bootDelay) / BOOT_RING_DURATION, 0, 1)
        const mesh = ringMeshRefs.current[i]
        if (mesh) {
          mesh.quaternion.slerpQuaternions(ring.scatterQuaternion, ring.quaternion, easeOutCubic(ringT))
          mesh.scale.setScalar(THREE.MathUtils.clamp(0.3 + 0.7 * easeOutBack(ringT), 0, 1.08))
        }
        ring.uniforms.uOpacity.value = ring.baseOpacity * easeOutCubic(ringT)
      })

      const tailT = THREE.MathUtils.clamp(
        (elapsed - BOOT_RING_STAGGER - BOOT_RING_DURATION) / BOOT_TAIL,
        0,
        1
      )
      dataTextureUniforms.uOpacity.value = 0.16 * tailT
      if (nodeMaterialRef.current) nodeMaterialRef.current.opacity = 0.55 * tailT
      moteUniforms.uBootFade.value = tailT

      if (bootProgress >= 1) bootDoneRef.current = true
      // Whole-lattice spin stays frozen while assembling — "coming online"
      // reads better than "already spinning while parts fly in."
      return
    }

    // Rigid-body rotation, plus a slow bounded precession wobble layered
    // on top (not accumulated) — an "unstable projection" rather than a
    // perfectly stable CAD-model spin.
    rotationRef.current.y += delta * params.rotationSpeed
    rotationRef.current.x += delta * params.rotationSpeed * 0.35
    if (groupRef.current) {
      groupRef.current.rotation.y = rotationRef.current.y
      groupRef.current.rotation.x = rotationRef.current.x + Math.sin(t * 0.23) * 0.025
      groupRef.current.rotation.z = Math.sin(t * 0.17) * 0.05
    }
    // Trailing echoes approximate a motion-blur streak from the spin —
    // a cheap stand-in for true velocity-buffer motion blur, which isn't
    // practical to wire up reliably in this pipeline.
    echoGroupRefs.current.forEach((echo, i) => {
      if (!echo) return
      const lag = (i + 1) * 0.05
      echo.rotation.y = rotationRef.current.y - lag
      echo.rotation.x = rotationRef.current.x + Math.sin(t * 0.23) * 0.025
      echo.rotation.z = Math.sin(t * 0.17) * 0.05
    })
    if (moteGroupRef.current) {
      moteGroupRef.current.rotation.y += delta * 0.03
    }

    // Occasional brief flicker on a random subset of rings.
    if (t >= flickerEndRef.current && t >= nextFlickerAtRef.current) {
      const indices = new Set<number>()
      const count = 4 + Math.floor(Math.random() * 4)
      while (indices.size < count) indices.add(Math.floor(Math.random() * RING_COUNT))
      flickerIndicesRef.current = indices
      flickerEndRef.current = t + 0.06
      nextFlickerAtRef.current = t + 4 + Math.random() * 5
    }
    const flickering = t < flickerEndRef.current

    // Real narration amplitude (see audio-amplitude.ts) dominates the
    // fixed sine pulse while speaking — smoothed so individual audio
    // frames don't read as jitter. Outside "speaking," rawAudio is 0 and
    // this collapses back to the original fixed pulse exactly.
    const rawAudio = state === "speaking" ? audioAmplitude.current : 0
    smoothedAudioRef.current = THREE.MathUtils.damp(smoothedAudioRef.current, rawAudio, 6, delta)
    const basePulse = Math.sin(t * params.pulseFreq) * params.pulseAmp
    const pulse =
      state === "speaking" ? THREE.MathUtils.lerp(basePulse, smoothedAudioRef.current, 0.75) : basePulse

    rings.forEach((ring, i) => {
      const dip = flickering && flickerIndicesRef.current.has(i) ? 0.82 : 1
      ring.uniforms.uOpacity.value = ring.baseOpacity * dip * (1 + Math.max(0, pulse) * 0.25)
      ring.uniforms.uPulse.value = pulse
    })

    if (groupRef.current) groupRef.current.scale.setScalar(1 + Math.max(0, pulse) * 0.015)
    dataTextureUniforms.uOpacity.value = 0.16 + pulse * 0.05
  })

  return (
    <Float speed={1.4} rotationIntensity={0.25} floatIntensity={0.4} floatingRange={[-0.08, 0.08]}>
      {/* trailing echoes render first / underneath, very faint */}
      {[0, 1].map((i) => (
        <group key={i} ref={(el) => (echoGroupRefs.current[i] = el)}>
          {rings.map((ring, ringIndex) => (
            <mesh key={ringIndex} quaternion={ring.quaternion}>
              <torusGeometry args={[GLOBE_RADIUS, ring.tube, 6, 64]} />
              <meshBasicMaterial
                color={SHELL_COLOR}
                transparent
                opacity={0.035 / (i + 1)}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          ))}
        </group>
      ))}

      <group ref={groupRef}>
        {rings.map((ring, i) => (
          <mesh
            key={i}
            ref={(el) => (ringMeshRefs.current[i] = el)}
            quaternion={ring.scatterQuaternion}
          >
            <torusGeometry args={[GLOBE_RADIUS, ring.tube, 6, 96]} />
            <shaderMaterial
              vertexShader={DEPTH_VERTEX_SHADER}
              fragmentShader={DEPTH_FRAGMENT_SHADER}
              uniforms={ring.uniforms}
              transparent
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        ))}

        <lineSegments geometry={dataTextureGeometry}>
          <shaderMaterial
            vertexShader={DEPTH_VERTEX_SHADER}
            fragmentShader={DEPTH_FRAGMENT_SHADER}
            uniforms={dataTextureUniforms}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>

        <points geometry={nodeGeometry}>
          <pointsMaterial
            ref={nodeMaterialRef}
            color={CORE_COLOR}
            size={0.028}
            sizeAttenuation
            transparent
            opacity={0.55}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </points>
      </group>

      <group ref={moteGroupRef}>
        <points geometry={moteGeometry}>
          <shaderMaterial
            vertexShader={MOTE_VERTEX_SHADER}
            fragmentShader={MOTE_FRAGMENT_SHADER}
            uniforms={moteUniforms}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </points>
      </group>
    </Float>
  )
}

// A faint projector beam connecting the sphere to an implied origin point
// below it. ConeGeometry's apex sits at +Y and its base at -Y by default —
// flipped 180° here so the wide end faces up toward the sphere and the
// point faces down toward the projector origin.
function ProjectorBeam() {
  return (
    <mesh position={[0, -GLOBE_RADIUS - 0.95, 0]} rotation={[Math.PI, 0, 0]}>
      <coneGeometry args={[GLOBE_RADIUS * 0.5, 1.9, 24, 1, true]} />
      <meshBasicMaterial
        color={SHELL_COLOR}
        transparent
        opacity={0.02}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

// Preserves canvas transparency through the post-processing pipeline — the
// composer's render targets otherwise clear to opaque, which (combined
// with additive bloom) tinted the whole canvas rectangle a faint uniform
// shade rather than truly showing the page through it.
function TransparentBackground() {
  const { gl } = useThree()
  useEffect(() => {
    gl.setClearAlpha(0)
  }, [gl])
  return null
}

// Bloom intensity per state, driven imperatively so it costs zero extra
// re-renders — matches how the file already mutates ring.uniforms.
//
// Constructs the real BloomEffect instance directly (from the underlying
// `postprocessing` package, not @react-three/postprocessing's <Bloom>
// wrapper) and mounts it via <primitive>, rather than driving it through
// a ref on <Bloom>. Confirmed live why: <Bloom ref={...}> does forward to
// the real instance (verified against the installed source), but that
// wrapper's own internal wrapEffect implementation separately does
// JSON.stringify(props) as a useMemo dependency, and — since it never
// explicitly excludes `ref` from that — once the ref's `.current` holds
// a real BloomEffect (which has the ordinary circular parent/children
// structure any Three.js-adjacent object does), ANY re-render of that
// component crashes with "Converting circular structure to JSON." This
// isn't avoidable by memoizing the driver component either: the crash
// needs to be survived specifically on the re-renders that matter most —
// real idle/thinking/speaking transitions. Owning the instance directly
// sidesteps that library internal entirely; mutating bloomEffect.intensity
// in useFrame is the same pattern already used everywhere else here.
const BLOOM_INTENSITY: Record<CoreState, number> = { idle: 1.3, thinking: 1.75, speaking: 2.05 }
const BOOT_FLASH_PEAK = 2.6

function BloomDriver({ state, bootProgressRef }: { state: CoreState; bootProgressRef: React.RefObject<number> }) {
  const bloomEffect = useMemo(
    () =>
      new BloomEffect({
        luminanceThreshold: 0.1,
        luminanceSmoothing: 0.9,
        intensity: BLOOM_INTENSITY.idle,
        radius: 0.65,
        mipmapBlur: true,
      }),
    []
  )

  useFrame((_three, delta) => {
    const boot = bootProgressRef.current
    const target = boot < 1 ? THREE.MathUtils.lerp(0, BOOT_FLASH_PEAK, boot) : BLOOM_INTENSITY[state]
    bloomEffect.intensity = THREE.MathUtils.damp(bloomEffect.intensity, target, 4, delta)
  })

  return <primitive object={bloomEffect} />
}

// Small, continuous, non-interactive drift — not OrbitControls, nothing
// user-driven. camera.lookAt(0,0,0) every frame is mandatory: moving
// position without re-aiming would push the core visually off-center,
// contradicting "more centered."
function CameraDrift() {
  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime
    camera.position.x = Math.sin(t * 0.11) * 0.18
    camera.position.y = Math.cos(t * 0.08) * 0.12 + 0.02
    camera.position.z = CAMERA_Z + Math.sin(t * 0.05) * 0.15
    camera.lookAt(0, 0, 0)
  })
  return null
}

// Small technical-flavor HUD text drifting near the core — capped at 5,
// desktop-only (below lg the core itself is smaller and text would just
// be clutter). Text cycles every 5s via a plain React re-render — the one
// place that's the right tool in this file, since it's a ~5s cadence
// touching 5 tiny DOM nodes, not a per-frame path.
const HUD_FRAGMENT_POOL = [
  ["SYNC 0.998", "LINK STABLE", "UPLINK OK"],
  ["NODE 0x7F3A", "NODE 0x291C", "NODE 0xE60D"],
  ["Δ 12.4Hz", "Δ 8.1Hz", "Δ 15.7Hz"],
  ["LAT 41.9N", "LON 87.6W", "ALT 612M"],
  ["REL 004", "REL 005", "REL 006"],
] as const

// Confirmed live these need real margin from the container edge, not
// just the sphere edge — drei's Html (no `transform` prop) positions
// relative to the Canvas's own DOM wrapper, which is only as big as the
// core's own size-* box (448px at lg), not the open space a "sphere
// floating in a scene" assumption would suggest. A fragment whose
// projected point sits within ~15px of that edge gets its text clipped
// (confirmed: "NODE 0x7F3A" rendered as "'F3A"). Kept well inside.
const HUD_FRAGMENT_POSITIONS: [number, number, number][] = [
  [1.25, 0.45, 0.3],
  [-1.2, -0.3, 0.6],
  [0.2, 1.2, -0.5],
  [-0.4, -1.25, 0.4],
  [1.1, -0.75, -0.6],
]

function HudReadouts() {
  const groupRef = useRef<THREE.Group>(null)
  const [cycle, setCycle] = useState(0)

  useFrame((_three, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.025
  })

  useEffect(() => {
    const id = setInterval(() => setCycle((c) => c + 1), 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <group ref={groupRef}>
      {HUD_FRAGMENT_POSITIONS.map((position, i) => (
        <Html
          key={i}
          position={position}
          center
          occlude={false}
          className="hidden lg:block"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.1em",
            color: "hsl(162 72% 55% / 0.5)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {HUD_FRAGMENT_POOL[i][cycle % HUD_FRAGMENT_POOL[i].length]}
        </Html>
      ))}
    </group>
  )
}

interface JarvisCoreProps {
  state: CoreState
}

export default function JarvisCore({ state }: JarvisCoreProps) {
  const bootProgressRef = useRef(0)

  return (
    <Canvas
      camera={{ position: [0, 0, CAMERA_Z], fov: 45 }}
      gl={{ alpha: true, antialias: true }}
      style={{ background: "transparent" }}
    >
      <TransparentBackground />
      <ambientLight intensity={0.4} />
      <pointLight position={[2, 2, 2]} intensity={0.6} color={SHELL_COLOR} />
      <CoreMesh state={state} bootProgressRef={bootProgressRef} />
      <ProjectorBeam />
      <HudReadouts />
      <CameraDrift />
      <EffectComposer>
        <BloomDriver state={state} bootProgressRef={bootProgressRef} />
      </EffectComposer>
    </Canvas>
  )
}
