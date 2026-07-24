"use client"

import { useMemo, useRef, type ComponentRef } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { Float, MeshDistortMaterial, Sparkles } from "@react-three/drei"
import { Bloom, EffectComposer } from "@react-three/postprocessing"
import * as THREE from "three"

type DistortMaterialRef = ComponentRef<typeof MeshDistortMaterial>

export type CoreState = "idle" | "thinking" | "speaking"

interface StateParams {
  rotationSpeed: number
  pulseFreq: number
  pulseAmp: number
  baseIntensity: number
  sparkleSpeed: number
  distortSpeed: number
  distortAmount: number
}

const STATE_PARAMS: Record<CoreState, StateParams> = {
  idle: {
    rotationSpeed: 0.15,
    pulseFreq: 0.6,
    pulseAmp: 0.15,
    baseIntensity: 0.7,
    sparkleSpeed: 0.2,
    distortSpeed: 1,
    distortAmount: 0.3,
  },
  thinking: {
    rotationSpeed: 0.65,
    pulseFreq: 2.5,
    pulseAmp: 0.35,
    baseIntensity: 1.0,
    sparkleSpeed: 0.7,
    distortSpeed: 2.5,
    distortAmount: 0.5,
  },
  speaking: {
    rotationSpeed: 0.35,
    pulseFreq: 4.5,
    pulseAmp: 0.5,
    baseIntensity: 1.2,
    sparkleSpeed: 1.1,
    distortSpeed: 4,
    distortAmount: 0.65,
  },
}

// K.I.V.'s HUD green palette (globals.css --kv-glow / --kv-mint), passed
// as CSS color strings — three.js's Color constructor parses these directly.
const SHELL_COLOR = "hsl(152, 76%, 46%)"
const CORE_COLOR = "hsl(162, 72%, 55%)"

const GLOBE_RADIUS = 1.3
const RING_COUNT = 14
const SPOKE_COUNT = 30

// Many overlapping ring circles at random orientations and radii, tangled
// together — the "wireframe globe" look (Stark's holographic map/globe
// interfaces), rather than a single clean platonic-solid wireframe. Radius
// varies per ring so the overall envelope reads as an organic tangled
// ball instead of a perfectly round sphere.
function useRings(count: number, baseRadius: number) {
  return useMemo(
    () =>
      Array.from({ length: count }, () => ({
        rotation: [Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2] as [
          number,
          number,
          number,
        ],
        radius: baseRadius * (0.82 + Math.random() * 0.36),
      })),
    [count, baseRadius]
  )
}

// Thin lines bursting outward from near the center past the globe's
// surface — the radiating-spoke quality in the reference. Built as one
// BufferGeometry (one draw call) rather than many <Line> components.
function useSpokeGeometry(count: number, radius: number) {
  return useMemo(() => {
    const positions = new Float32Array(count * 2 * 3)
    for (let i = 0; i < count; i++) {
      const direction = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize()
      const start = direction.clone().multiplyScalar(radius * 0.3)
      const end = direction.clone().multiplyScalar(radius * (1.15 + Math.random() * 0.4))
      positions.set([start.x, start.y, start.z, end.x, end.y, end.z], i * 6)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    return geometry
  }, [count, radius])
}

function CoreMesh({ state }: { state: CoreState }) {
  const groupRef = useRef<THREE.Group>(null)
  const coreRef = useRef<THREE.Mesh>(null)
  const coreMaterialRef = useRef<DistortMaterialRef>(null)
  const params = STATE_PARAMS[state]
  const rings = useRings(RING_COUNT, GLOBE_RADIUS)
  const spokeGeometry = useSpokeGeometry(SPOKE_COUNT, GLOBE_RADIUS)

  useFrame((three, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * params.rotationSpeed
      groupRef.current.rotation.x += delta * params.rotationSpeed * 0.35
    }
    if (coreRef.current) {
      coreRef.current.rotation.y -= delta * params.rotationSpeed * 1.5
    }
    if (coreMaterialRef.current) {
      const pulse = Math.sin(three.clock.elapsedTime * params.pulseFreq) * params.pulseAmp
      coreMaterialRef.current.emissiveIntensity = params.baseIntensity + pulse
    }
  })

  return (
    <Float speed={1.4} rotationIntensity={0.25} floatIntensity={0.4} floatingRange={[-0.08, 0.08]}>
      <group ref={groupRef}>
        {rings.map((ring, i) => (
          <mesh key={i} rotation={ring.rotation}>
            <torusGeometry args={[ring.radius, 0.006, 8, 80]} />
            <meshBasicMaterial color={SHELL_COLOR} transparent opacity={0.9} toneMapped={false} />
          </mesh>
        ))}
        <mesh>
          <icosahedronGeometry args={[GLOBE_RADIUS * 0.98, 2]} />
          <meshStandardMaterial
            color={SHELL_COLOR}
            emissive={SHELL_COLOR}
            emissiveIntensity={0.4}
            wireframe
            transparent
            opacity={0.3}
          />
        </mesh>
        <lineSegments geometry={spokeGeometry}>
          <lineBasicMaterial color={SHELL_COLOR} transparent opacity={0.7} toneMapped={false} />
        </lineSegments>
      </group>
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.5, 64, 64]} />
        <MeshDistortMaterial
          ref={coreMaterialRef}
          color={CORE_COLOR}
          emissive={CORE_COLOR}
          emissiveIntensity={0.9}
          roughness={0.15}
          metalness={0.4}
          distort={params.distortAmount}
          speed={params.distortSpeed}
        />
      </mesh>
    </Float>
  )
}

interface JarvisCoreProps {
  state: CoreState
}

export default function JarvisCore({ state }: JarvisCoreProps) {
  const params = STATE_PARAMS[state]
  return (
    <Canvas
      camera={{ position: [0, 0, 5.6], fov: 45 }}
      gl={{ alpha: true, antialias: true }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[2, 2, 2]} intensity={0.6} color={SHELL_COLOR} />
      <CoreMesh state={state} />
      <Sparkles count={100} scale={2.8} size={2} speed={params.sparkleSpeed} color={CORE_COLOR} />
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
