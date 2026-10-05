"use client"

import * as THREE from "three"
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"

// Models Jarvis designs from primitives (the workshop tool's "build"): no
// model files to download or license, and every mesh is a clean surface
// the scene can derive a wireframe hologram from.

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

// --- generated models ------------------------------------------------------
//
// Jarvis designs these himself (the workshop tool's "build" action): a list
// of primitive parts, each with a size, position, rotation and one of the
// workshop's materials. The server has already clamped every number; this
// turns the list into meshes, lifts the result onto the stage and scales
// it to fit.

export interface GeneratedPart {
  shape: "box" | "rounded_box" | "sphere" | "cylinder" | "cone" | "torus" | "capsule"
  size: number[]
  position: number[]
  rotation: number[]
  material: "red" | "gold" | "steel" | "dark" | "copper" | "glow" | "glass"
}

export interface GeneratedModel {
  name: string
  designation: string
  notes: string[]
  parts: GeneratedPart[]
}

function partGeometry(part: GeneratedPart): THREE.BufferGeometry {
  const [a = 0.2, b = 0.2, c = 0.2] = part.size ?? []
  switch (part.shape) {
    case "box":
      return new THREE.BoxGeometry(a, b, c)
    case "rounded_box":
      return new RoundedBoxGeometry(a, b, c, 3, Math.min(a, b, c) * 0.2)
    case "sphere":
      return new THREE.SphereGeometry(a, 32, 20)
    case "cylinder":
      return new THREE.CylinderGeometry(a, b, c, 32)
    case "cone":
      return new THREE.ConeGeometry(a, b, 32)
    case "torus":
      return new THREE.TorusGeometry(a, Math.min(b, a * 0.9), 16, 48)
    case "capsule":
      return new THREE.CapsuleGeometry(a, b, 8, 16)
  }
}

export function buildGenerated(model: GeneratedModel): BuiltItem {
  const m = mats()
  const design = new THREE.Group()
  const glowSpots: THREE.Vector3[] = []
  const deg = THREE.MathUtils.degToRad
  for (const part of model.parts ?? []) {
    const piece = mesh(partGeometry(part), m[part.material] ?? m.steel)
    // The server fills these in, but a design is never trusted to be complete.
    const [x = 0, y = 0, z = 0] = part.position ?? []
    const [rx = 0, ry = 0, rz = 0] = part.rotation ?? []
    piece.position.set(x, y, z)
    piece.rotation.set(deg(rx), deg(ry), deg(rz))
    if (part.shape === "rounded_box") piece.userData.edgeAngle = 10
    design.add(piece)
    if (part.material === "glow") glowSpots.push(piece.position.clone())
  }

  // One light for the glowing parts, at their centre, so metal near them
  // picks the glow up.
  if (glowSpots.length) {
    const light = coreLight(2, 2.5)
    light.position.copy(glowSpots.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(glowSpots.length))
    design.add(light)
  }

  // Fit to the stage: no wider or taller than the catalogue pieces, and
  // floating just above the floor like them.
  const bounds = new THREE.Box3().setFromObject(design)
  const size = bounds.getSize(new THREE.Vector3())
  const fit = Math.min(1, 2.4 / Math.max(size.x, size.y, size.z, 0.001))
  const centre = bounds.getCenter(new THREE.Vector3())
  design.position.set(-centre.x, -bounds.min.y, -centre.z)
  const g = new THREE.Group()
  g.add(design)
  g.scale.setScalar(fit)
  g.position.y = 0.35

  return {
    object: g,
    spec: {
      key: "generated",
      name: model.name,
      designation: model.designation || "WORKSHOP PROTOTYPE",
      lines: model.notes?.length ? model.notes : [`${model.parts?.length ?? 0} PARTS`, "DESIGNED BY J.A.R.V.I.S."],
    },
  }
}
