"use client"

import { useEffect, useMemo, useRef } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Float } from "@react-three/drei"
import { Bloom, EffectComposer } from "@react-three/postprocessing"
import * as THREE from "three"

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

const GLOBE_RADIUS = 1.3
const RING_COUNT = 32
const RING_TUBE = 0.006
const DATA_TICK_COUNT = 110
const MOTE_COUNT = 40

// A depth-faded, additively-blended line/ring material shared by the main
// lattice and the secondary data-texture layer. `sphereDir` (the vertex
// position normalized) stands in for "this point's direction on the
// conceptual sphere" — for a thin torus that's a very close approximation
// of the great circle it lies on. Transforming that direction (not the
// position — w=0 keeps it a pure direction) into view space and comparing
// it to the camera's forward axis gives a camera/rotation-robust "is this
// the near or far side" factor with no hardcoded camera distance.
const DEPTH_VERTEX_SHADER = `
  varying float vFacing;
  void main() {
    vec3 sphereDir = normalize(position);
    vec3 viewDir = normalize((modelViewMatrix * vec4(sphereDir, 0.0)).xyz);
    vFacing = viewDir.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
  baseOpacity: number
  tube: number
  uniforms: { uColor: { value: THREE.Color }; uOpacity: { value: number } }
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
        return {
          quaternion: new THREE.Quaternion().setFromUnitVectors(RING_UP, randomUnitVector(0.75)),
          baseOpacity,
          tube: RING_TUBE * (0.85 + Math.random() * 0.3),
          uniforms: {
            uColor: { value: new THREE.Color(SHELL_COLOR) },
            uOpacity: { value: baseOpacity },
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
  varying float vOpacity;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    gl_FragColor = vec4(uColor, vOpacity * 0.3);
  }
`

function CoreMesh({ state }: { state: CoreState }) {
  const groupRef = useRef<THREE.Group>(null)
  const echoGroupRefs = useRef<(THREE.Group | null)[]>([])
  const moteGroupRef = useRef<THREE.Group>(null)
  const rotationRef = useRef({ x: 0, y: 0 })
  const nextFlickerAtRef = useRef(2 + Math.random() * 4)
  const flickerEndRef = useRef(0)
  const flickerIndicesRef = useRef<Set<number>>(new Set())

  const params = STATE_PARAMS[state]
  const rings = useRings(RING_COUNT)
  const nodeGeometry = useIntersectionNodes(rings, GLOBE_RADIUS)
  const dataTextureGeometry = useDataTexture(DATA_TICK_COUNT, GLOBE_RADIUS)
  const moteGeometry = useMotes(MOTE_COUNT, GLOBE_RADIUS)
  const dataTextureUniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color(SHELL_COLOR) }, uOpacity: { value: 0.16 } }),
    []
  )
  const moteUniforms = useMemo(() => ({ uColor: { value: new THREE.Color(CORE_COLOR) } }), [])

  useFrame((three, delta) => {
    const t = three.clock.elapsedTime

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
    rings.forEach((ring, i) => {
      const dip = flickering && flickerIndicesRef.current.has(i) ? 0.82 : 1
      ring.uniforms.uOpacity.value = ring.baseOpacity * dip
    })

    const pulse = Math.sin(t * params.pulseFreq) * params.pulseAmp
    dataTextureUniforms.uOpacity.value = 0.16 + pulse * 0.03
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
          <mesh key={i} quaternion={ring.quaternion}>
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

interface JarvisCoreProps {
  state: CoreState
}

export default function JarvisCore({ state }: JarvisCoreProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 5.6], fov: 45 }}
      gl={{ alpha: true, antialias: true }}
      style={{ background: "transparent" }}
    >
      <TransparentBackground />
      <ambientLight intensity={0.4} />
      <pointLight position={[2, 2, 2]} intensity={0.6} color={SHELL_COLOR} />
      <CoreMesh state={state} />
      <ProjectorBeam />
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.1}
          luminanceSmoothing={0.9}
          intensity={1.6}
          radius={0.65}
          mipmapBlur
        />
      </EffectComposer>
    </Canvas>
  )
}
