"use client"

import { useRef } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { Sparkles } from "@react-three/drei"
import type * as THREE from "three"

export type CoreState = "idle" | "thinking" | "speaking"

interface StateParams {
  rotationSpeed: number
  pulseFreq: number
  pulseAmp: number
  baseIntensity: number
  sparkleSpeed: number
}

const STATE_PARAMS: Record<CoreState, StateParams> = {
  idle: { rotationSpeed: 0.15, pulseFreq: 0.6, pulseAmp: 0.15, baseIntensity: 0.7, sparkleSpeed: 0.2 },
  thinking: { rotationSpeed: 0.65, pulseFreq: 2.5, pulseAmp: 0.35, baseIntensity: 1.0, sparkleSpeed: 0.7 },
  speaking: { rotationSpeed: 0.35, pulseFreq: 4.5, pulseAmp: 0.5, baseIntensity: 1.2, sparkleSpeed: 1.1 },
}

// K.I.V.'s HUD green palette (globals.css --kv-glow / --kv-mint), passed
// as CSS color strings — three.js's Color constructor parses these directly.
const SHELL_COLOR = "hsl(152, 76%, 46%)"
const CORE_COLOR = "hsl(162, 72%, 55%)"

function CoreMesh({ state }: { state: CoreState }) {
  const shellRef = useRef<THREE.Mesh>(null)
  const coreRef = useRef<THREE.Mesh>(null)
  const coreMaterialRef = useRef<THREE.MeshStandardMaterial>(null)
  const params = STATE_PARAMS[state]

  useFrame((three, delta) => {
    if (shellRef.current) {
      shellRef.current.rotation.y += delta * params.rotationSpeed
      shellRef.current.rotation.x += delta * params.rotationSpeed * 0.35
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
    <group>
      <mesh ref={shellRef}>
        <icosahedronGeometry args={[1.3, 1]} />
        <meshStandardMaterial
          color={SHELL_COLOR}
          emissive={SHELL_COLOR}
          emissiveIntensity={0.5}
          wireframe
          transparent
          opacity={0.6}
        />
      </mesh>
      <mesh ref={coreRef}>
        <icosahedronGeometry args={[0.55, 2]} />
        <meshStandardMaterial
          ref={coreMaterialRef}
          color={CORE_COLOR}
          emissive={CORE_COLOR}
          emissiveIntensity={0.8}
          roughness={0.2}
          metalness={0.6}
        />
      </mesh>
    </group>
  )
}

interface JarvisCoreProps {
  state: CoreState
}

export default function JarvisCore({ state }: JarvisCoreProps) {
  const params = STATE_PARAMS[state]
  return (
    <Canvas
      camera={{ position: [0, 0, 3.4], fov: 45 }}
      gl={{ alpha: true, antialias: true }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[2, 2, 2]} intensity={0.6} color={SHELL_COLOR} />
      <CoreMesh state={state} />
      <Sparkles count={80} scale={2.6} size={2} speed={params.sparkleSpeed} color={CORE_COLOR} />
    </Canvas>
  )
}
