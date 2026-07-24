"use client"

import { useMemo, useRef } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { Float } from "@react-three/drei"
import { Bloom, EffectComposer } from "@react-three/postprocessing"
import * as THREE from "three"

export type CoreState = "idle" | "thinking" | "speaking"

interface StateParams {
  rotationSpeed: number
  pulseFreq: number
  pulseAmp: number
  baseIntensity: number
}

const STATE_PARAMS: Record<CoreState, StateParams> = {
  idle: { rotationSpeed: 0.15, pulseFreq: 0.6, pulseAmp: 0.15, baseIntensity: 0.7 },
  thinking: { rotationSpeed: 0.4, pulseFreq: 2.5, pulseAmp: 0.35, baseIntensity: 1.0 },
  speaking: { rotationSpeed: 0.25, pulseFreq: 4.5, pulseAmp: 0.5, baseIntensity: 1.2 },
}

// K.I.V.'s HUD green palette (globals.css --kv-glow / --kv-mint), passed
// as CSS color strings — three.js's Color constructor parses these directly.
const SHELL_COLOR = "hsl(152, 76%, 46%)"
const CORE_COLOR = "hsl(162, 72%, 55%)"

const GLOBE_RADIUS = 1.3
const RING_COUNT = 32
const RING_TUBE = 0.006
const CORE_POINT_COUNT = 10
const CORE_POINT_RADIUS = 0.12

// A uniformly-distributed random unit vector (Archimedes' hat-box method:
// uniform z in [-1,1] + uniform angle around it). This is the ring's plane
// normal — a circle is rotationally symmetric about its own normal, so
// "rotate a ring by a random axis+angle" reduces exactly to "give it a
// uniformly random normal direction." No separate angle-around-the-normal
// term is needed, and no Euler-angle composition (which is what the
// previous version used, and which is *not* uniformly distributed — three
// independent Euler rotations clump orientations near the poles).
function randomUnitVector(): THREE.Vector3 {
  const z = Math.random() * 2 - 1
  const angle = Math.random() * Math.PI * 2
  const r = Math.sqrt(1 - z * z)
  return new THREE.Vector3(r * Math.cos(angle), r * Math.sin(angle), z)
}

const RING_UP = new THREE.Vector3(0, 0, 1)

interface RingSpec {
  quaternion: THREE.Quaternion
  opacity: number
  tube: number
}

// True great-circle rings: each ring is a unit circle whose plane normal is
// uniformly random, all sharing the same radius. Equal radii is what makes
// the intersection math below exact — two same-radius circles centered on
// the origin, lying in different planes, cross the unit sphere at exactly
// two antipodal points; different-radius circles generally wouldn't
// intersect at all.
function useRings(count: number): RingSpec[] {
  return useMemo(
    () =>
      Array.from({ length: count }, () => ({
        quaternion: new THREE.Quaternion().setFromUnitVectors(RING_UP, randomUnitVector()),
        opacity: 0.78 + Math.random() * 0.14,
        tube: RING_TUBE * (0.85 + Math.random() * 0.3),
      })),
    [count]
  )
}

// Real ring-ring intersection points, not scattered random dots. Two great
// circles with plane normals n_i, n_j meet the sphere where a point lies on
// both planes *and* at distance R from the origin — that's the line
// through the origin in direction normalize(n_i × n_j), at ±R along it.
function useIntersectionNodes(rings: RingSpec[], radius: number) {
  return useMemo(() => {
    const normals = rings.map((ring) => RING_UP.clone().applyQuaternion(ring.quaternion))
    const positions: number[] = []

    for (let i = 0; i < normals.length; i++) {
      for (let j = i + 1; j < normals.length; j++) {
        const cross = normals[i].clone().cross(normals[j])
        const len = cross.length()
        if (len < 1e-4) continue // near-parallel ring planes — no distinct crossing
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

// A small tight cluster of points at the center, replacing the previous
// solid glowing sphere — hollow/wireframe all the way through, per the
// armillary-sphere reference, with just a subtle bright accent left where
// the core used to be.
function useCorePoints(count: number, radius: number) {
  return useMemo(() => {
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const point = randomUnitVector().multiplyScalar(Math.random() * radius)
      positions.set([point.x, point.y, point.z], i * 3)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    return geometry
  }, [count, radius])
}

function CoreMesh({ state }: { state: CoreState }) {
  const groupRef = useRef<THREE.Group>(null)
  const corePointsMaterialRef = useRef<THREE.PointsMaterial>(null)
  const params = STATE_PARAMS[state]
  const rings = useRings(RING_COUNT)
  const nodeGeometry = useIntersectionNodes(rings, GLOBE_RADIUS)
  const coreGeometry = useCorePoints(CORE_POINT_COUNT, CORE_POINT_RADIUS)

  // Single rotation applied to the whole group — the rings, intersection
  // nodes, and the sphere they describe all turn together as one rigid
  // object, rather than each ring animating independently.
  useFrame((three, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * params.rotationSpeed
      groupRef.current.rotation.x += delta * params.rotationSpeed * 0.35
    }
    if (corePointsMaterialRef.current) {
      const pulse = Math.sin(three.clock.elapsedTime * params.pulseFreq) * params.pulseAmp
      corePointsMaterialRef.current.size = 0.05 + (params.baseIntensity + pulse) * 0.04
    }
  })

  return (
    <Float speed={1.4} rotationIntensity={0.25} floatIntensity={0.4} floatingRange={[-0.08, 0.08]}>
      <group ref={groupRef}>
        {rings.map((ring, i) => (
          <mesh key={i} quaternion={ring.quaternion}>
            <torusGeometry args={[GLOBE_RADIUS, ring.tube, 6, 96]} />
            <meshBasicMaterial color={SHELL_COLOR} transparent opacity={ring.opacity} toneMapped={false} />
          </mesh>
        ))}
        <points geometry={nodeGeometry}>
          <pointsMaterial
            color={CORE_COLOR}
            size={0.035}
            sizeAttenuation
            transparent
            opacity={0.85}
            toneMapped={false}
          />
        </points>
      </group>
      <points geometry={coreGeometry}>
        <pointsMaterial
          ref={corePointsMaterialRef}
          color={CORE_COLOR}
          size={0.08}
          sizeAttenuation
          transparent
          opacity={0.95}
          toneMapped={false}
        />
      </points>
    </Float>
  )
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
      <ambientLight intensity={0.4} />
      <pointLight position={[2, 2, 2]} intensity={0.6} color={SHELL_COLOR} />
      <CoreMesh state={state} />
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
