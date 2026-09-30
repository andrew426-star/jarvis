"use client"

import * as THREE from "three"

// Iron Man-style workshop pieces, built from primitives in code: no model
// files to download or license, and every mesh is a clean surface the
// scene can derive a wireframe hologram from. Stylised, not replicas.

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

// --- items ---------------------------------------------------------------

function arcReactor(): BuiltItem {
  const m = mats()
  const g = new THREE.Group()
  const face = new THREE.Group()
  face.rotation.x = Math.PI / 2 // cylinders stand on Y; turn them to face +Z
  g.add(face)

  face.add(mesh(new THREE.CylinderGeometry(1, 1, 0.14, 64), m.dark, (x) => (x.position.y = -0.08)))
  g.add(mesh(new THREE.TorusGeometry(0.96, 0.09, 24, 96), m.steel))

  // Ten copper coils, each a tangential spool wrapped in windings.
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2
    const coil = new THREE.Group()
    coil.position.set(Math.cos(angle) * 0.68, Math.sin(angle) * 0.68, 0.04)
    coil.rotation.z = angle
    coil.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 16), m.dark))
    for (let w = 0; w < 6; w += 1) {
      coil.add(
        mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 20), m.copper, (x) => {
          x.rotation.x = Math.PI / 2
          x.position.y = -0.125 + w * 0.05
        })
      )
    }
    g.add(coil)
  }

  g.add(mesh(new THREE.TorusGeometry(0.44, 0.05, 16, 64), m.steel, (x) => (x.position.z = 0.05)))
  face.add(mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 48), m.glow, (x) => (x.position.y = 0.06)))
  g.add(mesh(new THREE.TorusGeometry(0.32, 0.03, 12, 48), m.steel, (x) => (x.position.z = 0.1)))
  const light = coreLight(3, 3)
  light.position.z = 0.4
  g.add(light)

  g.position.y = 1.1
  return {
    object: g,
    spec: {
      key: "reactor",
      name: "Arc Reactor",
      designation: "MK II · PALLADIUM CORE",
      lines: ["OUTPUT 3 GJ/s SUSTAINED", "10-COIL TOROIDAL CONFINEMENT", "CORE TEMP NOMINAL", "SERVICE LIFE: 41 DAYS"],
    },
  }
}

function element(): BuiltItem {
  const m = mats()
  const g = new THREE.Group()
  const node = new THREE.SphereGeometry(0.07, 16, 12)
  const rod = (a: THREE.Vector3, b: THREE.Vector3) => {
    const length = a.distanceTo(b)
    const r = mesh(new THREE.CylinderGeometry(0.018, 0.018, length, 8), m.steel)
    r.position.copy(a).add(b).multiplyScalar(0.5)
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    return r
  }

  g.add(mesh(new THREE.SphereGeometry(0.2, 32, 24), m.glow))
  // Nested triangles in two perpendicular planes: the lattice from the
  // "new element" scene, turned into a solid you can walk around.
  for (const plane of [0, Math.PI / 2]) {
    const layer = new THREE.Group()
    layer.rotation.y = plane
    ;[0.55, 0.95, 1.35].forEach((size, level) => {
      const corners = [0, 1, 2].map((k) => {
        const angle = (k / 3) * Math.PI * 2 + Math.PI / 2 + (level % 2) * Math.PI
        return new THREE.Vector3(Math.cos(angle) * size, Math.sin(angle) * size, 0)
      })
      corners.forEach((corner, k) => {
        const next = corners[(k + 1) % 3]
        layer.add(rod(corner, next))
        // Nodes along each edge.
        for (let s = 0; s < 3; s += 1) {
          const p = corner.clone().lerp(next, s / 3)
          layer.add(mesh(node, s === 0 ? m.glow : m.steel, (x) => x.position.copy(p)))
        }
        if (level === 0) layer.add(rod(new THREE.Vector3(), corner))
      })
    })
    g.add(layer)
  }
  g.add(coreLight(2, 3))
  g.position.y = 1.4
  return {
    object: g,
    spec: {
      key: "element",
      name: "Synthesized Element",
      designation: "LATTICE · UNNAMED",
      lines: ["TRIANGULAR NUCLEAR LATTICE", "STABLE AT ROOM TEMPERATURE", "REPLACES PALLADIUM CORE", "TOXICITY: NONE DETECTED"],
    },
  }
}

function helmet(): BuiltItem {
  const m = mats()
  const g = new THREE.Group()

  const profile = [
    [0, -0.95], [0.38, -0.9], [0.58, -0.62], [0.68, -0.2], [0.7, 0.15],
    [0.64, 0.5], [0.5, 0.8], [0.28, 0.98], [0, 1.02],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  g.add(mesh(new THREE.LatheGeometry(profile, 64), m.red, (x) => x.scale.set(0.95, 1.12, 1.05)))

  // Faceplate: a front patch of a slightly larger sphere, stretched to the
  // face's proportions.
  g.add(
    mesh(
      new THREE.SphereGeometry(0.72, 48, 32, Math.PI / 2 - 0.72, 1.44, 0.62, 1.72),
      m.gold,
      (x) => {
        x.scale.set(1, 1.3, 1.08)
        x.position.set(0, -0.05, 0.03)
      }
    )
  )
  for (const side of [-1, 1]) {
    g.add(
      mesh(new THREE.BoxGeometry(0.24, 0.045, 0.06), m.glow, (x) => {
        x.position.set(side * 0.2, 0.22, 0.74)
        x.rotation.set(0, side * 0.35, side * -0.12)
      })
    )
    g.add(
      mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 32), m.steel, (x) => {
        x.position.set(side * 0.66, 0.05, 0)
        x.rotation.z = Math.PI / 2
      })
    )
  }
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.02, 0.04), m.dark, (x) => x.position.set(0, -0.48, 0.74)))
  const light = coreLight(1.2, 1.5)
  light.position.set(0, 0.22, 1)
  g.add(light)

  g.position.y = 1.3
  return {
    object: g,
    spec: {
      key: "helmet",
      name: "Helmet",
      designation: "MK VII · HEAD UNIT",
      lines: ["GOLD-TITANIUM ALLOY SHELL", "HUD: DUAL RETINAL PROJECTION", "FACEPLATE SERVO 0.18s", "J.A.R.V.I.S. UPLINK ACTIVE"],
    },
  }
}

function gauntlet(): BuiltItem {
  const m = mats()
  const g = new THREE.Group()
  g.add(mesh(new THREE.BoxGeometry(0.9, 1, 0.28), m.red))
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 40), m.glow, (x) => {
    x.rotation.x = Math.PI / 2
    x.position.z = 0.15
  }))
  g.add(mesh(new THREE.TorusGeometry(0.23, 0.035, 12, 40), m.steel, (x) => (x.position.z = 0.16)))

  const fingers: [number, number[]][] = [
    [-0.33, [0.24, 0.2, 0.16]],
    [-0.11, [0.3, 0.24, 0.19]],
    [0.11, [0.3, 0.25, 0.2]],
    [0.33, [0.26, 0.21, 0.17]],
  ]
  for (const [x0, lengths] of fingers) {
    let parent: THREE.Object3D = g
    let y = 0.52
    lengths.forEach((length, k) => {
      const joint = new THREE.Group()
      joint.position.set(k === 0 ? x0 : 0, y, 0)
      joint.rotation.x = k === 0 ? 0.15 : 0.3 // a relaxed curl
      joint.add(mesh(new THREE.CapsuleGeometry(0.075, length, 6, 12), k % 2 ? m.gold : m.red, (x) => (x.position.y = length / 2 + 0.05)))
      parent.add(joint)
      parent = joint
      y = length + 0.12
    })
  }
  const thumb = new THREE.Group()
  thumb.position.set(-0.47, 0.05, 0.08)
  thumb.rotation.z = 0.9
  thumb.add(mesh(new THREE.CapsuleGeometry(0.08, 0.28, 6, 12), m.red, (x) => (x.position.y = 0.2)))
  g.add(thumb)

  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.55, 32), m.red, (x) => (x.position.y = -0.78)))
  g.add(mesh(new THREE.TorusGeometry(0.34, 0.03, 12, 40), m.gold, (x) => {
    x.rotation.x = Math.PI / 2
    x.position.y = -0.52
  }))
  const light = coreLight(2, 2)
  light.position.z = 0.6
  g.add(light)

  g.position.y = 1.3
  g.rotation.set(-0.15, 0.3, 0)
  return {
    object: g,
    spec: {
      key: "gauntlet",
      name: "Repulsor Gauntlet",
      designation: "MK III · RIGHT HAND",
      lines: ["REPULSOR: 12 kN PULSE", "STABILISER + WEAPON MODES", "27 ARTICULATED SEGMENTS", "THERMAL LOAD 38%"],
    },
  }
}

function tower(): BuiltItem {
  const m = mats()
  const g = new THREE.Group()
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.52, 2.6, 6), m.glass, (x) => (x.position.y = 1.3)))
  g.add(mesh(new THREE.BoxGeometry(0.12, 2.8, 0.12), m.steel, (x) => x.position.set(0, 1.4, 0.38)))
  g.add(mesh(new THREE.CylinderGeometry(0.62, 0.5, 0.22, 6), m.steel, (x) => (x.position.y = 2.7)))
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 32), m.dark, (x) => x.position.set(0.72, 2.55, 0)))
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.04, 0.12), m.steel, (x) => x.position.set(0.42, 2.55, 0)))
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 24), m.glow, (x) => (x.position.y = 2.84)))
  for (let i = 0; i < 6; i += 1) {
    g.add(mesh(new THREE.TorusGeometry(0.45 - i * 0.02, 0.012, 6, 6), m.steel, (x) => {
      x.rotation.x = Math.PI / 2
      x.position.y = 0.4 + i * 0.36
    }))
  }
  const light = coreLight(2, 2)
  light.position.y = 3
  g.add(light)
  g.scale.setScalar(0.72)
  return {
    object: g,
    spec: {
      key: "tower",
      name: "Stark Tower",
      designation: "MIDTOWN · ARCHITECTURAL",
      lines: ["93 FLOORS", "SELF-SUSTAINING ARC POWER", "ROOFTOP LANDING PLATFORM", "SUIT DEPLOYMENT GANTRY"],
    },
  }
}

function missile(): BuiltItem {
  const m = mats()
  const g = new THREE.Group()
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 2.1, 40), m.steel))
  g.add(mesh(new THREE.ConeGeometry(0.17, 0.55, 40), m.dark, (x) => (x.position.y = 1.32)))
  for (const y of [0.55, 0.62]) {
    g.add(mesh(new THREE.TorusGeometry(0.172, 0.02, 8, 40), m.red, (x) => {
      x.rotation.x = Math.PI / 2
      x.position.y = y
    }))
  }
  // Sub-munition bays around the waist.
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.34, 0.02), m.dark, (x) => {
      x.position.set(Math.cos(a) * 0.175, 0.1, Math.sin(a) * 0.175)
      x.rotation.y = -a + Math.PI / 2
    }))
  }
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2
    g.add(mesh(new THREE.BoxGeometry(0.025, 0.42, 0.36), m.dark, (x) => {
      x.position.set(Math.cos(a) * 0.3, -0.85, Math.sin(a) * 0.3)
      x.rotation.y = -a
    }))
  }
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.2, 32, 1, true), m.dark, (x) => (x.position.y = -1.15)))
  g.add(mesh(new THREE.CircleGeometry(0.12, 32), m.glow, (x) => {
    x.rotation.x = Math.PI / 2
    x.position.y = -1.16
  }))
  const light = coreLight(2, 2)
  light.position.y = -1.4
  g.add(light)
  g.position.y = 1.4
  g.rotation.z = 0.55
  return {
    object: g,
    spec: {
      key: "missile",
      name: "Jericho",
      designation: "STARK INDUSTRIES · DEMO UNIT",
      lines: ["CLUSTER-DEPLOYED SUB-MUNITIONS", "INERT DEMONSTRATION ROUND", "ONE LAUNCH, MULTIPLE TARGETS", "STATUS: DECOMMISSIONED"],
    },
  }
}

export const CATALOGUE: { key: string; label: string; build: () => BuiltItem }[] = [
  { key: "reactor", label: "Arc Reactor", build: arcReactor },
  { key: "helmet", label: "Helmet", build: helmet },
  { key: "gauntlet", label: "Gauntlet", build: gauntlet },
  { key: "element", label: "Element", build: element },
  { key: "tower", label: "Tower", build: tower },
  { key: "missile", label: "Jericho", build: missile },
]
