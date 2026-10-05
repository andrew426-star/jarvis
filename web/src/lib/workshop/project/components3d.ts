import * as THREE from "three"

import { PARTS, prop, type Part } from "@/lib/workshop/project/types"

// The catalog's components in 3D at their real size, in millimetres with z
// up - the frame OpenSCAD uses - so a printed mount and the part it holds
// line up in the assembly exactly as they will on the bench. Built from
// primitives: recognisable, not photographic. Sizes come from parts.json;
// the ones marked approx there are estimates to measure before a tight fit.
//
// What the simulation moves is tagged in userData: `glow` (an LED's
// materials, one per channel), and named groups "horn" (a servo's output)
// and "spin" (a motor shaft or a stepper's), turned about their z axis.

const mat = {
  pcbBlue: new THREE.MeshStandardMaterial({ color: 0x0f5e8c, roughness: 0.55, metalness: 0.1 }),
  pcbGreen: new THREE.MeshStandardMaterial({ color: 0x1d5a2c, roughness: 0.55, metalness: 0.1 }),
  pcbRed: new THREE.MeshStandardMaterial({ color: 0x8c1d1d, roughness: 0.55, metalness: 0.1 }),
  black: new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.6, metalness: 0.05 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.7, metalness: 0 }),
  blueCase: new THREE.MeshStandardMaterial({ color: 0x2556b8, roughness: 0.5, metalness: 0.05 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.3, metalness: 0.9 }),
  aluminum: new THREE.MeshStandardMaterial({ color: 0xc7ccd2, roughness: 0.35, metalness: 0.85 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.45, metalness: 0.6 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc9a13b, roughness: 0.3, metalness: 1 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0 }),
  tan: new THREE.MeshStandardMaterial({ color: 0xc8a97a, roughness: 0.7, metalness: 0 }),
  silver: new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.25, metalness: 1 }),
}

const LED_COLORS: Record<string, number> = { red: 0xff2a2a, green: 0x2aff5a, yellow: 0xffd02a, white: 0xffffff, blue: 0x3a7bff, ir: 0x6a2a8a }

function box(x: number, y: number, z: number, material: THREE.Material, at: [number, number, number] = [0, 0, z / 2]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), material)
  m.position.set(...at)
  m.castShadow = m.receiveShadow = true
  return m
}

/** A cylinder standing on z (three's are on y). */
function cyl(r: number, h: number, material: THREE.Material, at: [number, number, number] = [0, 0, h / 2], segments = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), material)
  m.rotation.x = Math.PI / 2
  m.position.set(...at)
  m.castShadow = m.receiveShadow = true
  return m
}

function header(pins: number, at: [number, number, number], horizontal = true) {
  const g = new THREE.Group()
  const len = pins * 2.54
  g.add(box(horizontal ? len : 2.5, horizontal ? 2.5 : len, 8.5, mat.black, [0, 0, 4.25]))
  g.position.set(...at)
  return g
}

function uno(): THREE.Group {
  const g = new THREE.Group()
  g.add(box(68.6, 53.4, 1.6, mat.pcbBlue, [0, 0, 0.8]))
  // USB-B and the barrel jack hang over the left edge.
  g.add(box(16, 12, 11, mat.metal, [-34.3 + 6.5, 53.4 / 2 - 12 - 6, 1.6 + 5.5]))
  g.add(box(14, 9, 11, mat.black, [-34.3 + 5.5, -53.4 / 2 + 8, 1.6 + 5.5]))
  g.add(header(10, [5, 53.4 / 2 - 2.5, 1.6]))
  g.add(header(8, [-14, 53.4 / 2 - 2.5, 1.6]))
  g.add(header(8, [-6, -53.4 / 2 + 2.5, 1.6]))
  g.add(header(6, [16, -53.4 / 2 + 2.5, 1.6]))
  g.add(box(35, 7.5, 3.5, mat.black, [8, -2, 1.6 + 1.75]))
  g.add(box(12, 12, 1.5, mat.black, [-10, 2, 1.6 + 0.75]))
  for (const [x, y] of [[-34.3 + 15.2, -53.4 / 2 + 2.5], [-34.3 + 66.1, -53.4 / 2 + 7.6], [-34.3 + 66.1, -53.4 / 2 + 35.5], [-34.3 + 13.9, -53.4 / 2 + 50.8]]) {
    g.add(cyl(1.6, 1.7, mat.gold, [x, y, 0.85], 16))
  }
  return g
}

function breadboard(x: number, y: number): THREE.Group {
  const g = new THREE.Group()
  g.add(box(x, y, 8.5, mat.white, [0, 0, 4.25]))
  g.add(box(x - 4, 2.5, 0.6, mat.dark, [0, 0, 8.6]))
  return g
}

function led(part: Part): THREE.Group {
  const g = new THREE.Group()
  const rgb = part.type === "rgb_led"
  const color = rgb ? 0xffffff : LED_COLORS[String(prop(part, "color", "red"))] ?? 0xff2a2a
  const body = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0,
    transparent: true,
    opacity: 0.8,
    roughness: 0.2,
  })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), body)
  dome.rotation.x = Math.PI / 2
  dome.position.z = 8.6 - 2.5 + 0.0
  g.add(cyl(2.5, 6.1, body, [0, 0, 3.05 + 0.5]))
  g.add(dome)
  g.add(cyl(2.9, 1, body, [0, 0, 0.5]))
  for (const x of [-1.27, 1.27]) g.add(box(0.5, 0.5, 6, mat.metal, [x, 0, -3]))
  g.userData.glow = rgb ? [body, body, body] : [body]
  g.userData.rgb = rgb
  return g
}

function resistor(): THREE.Group {
  const g = new THREE.Group()
  const body = cyl(1.2, 6, mat.tan, [0, 0, 1.2])
  body.rotation.set(0, Math.PI / 2, 0)
  g.add(body)
  const lead = box(10, 0.5, 0.5, mat.metal, [0, 0, 1.2])
  g.add(lead)
  return g
}

function servo(): THREE.Group {
  const g = new THREE.Group()
  g.add(box(23.2, 12.5, 22, mat.blueCase, [0, 0, 11]))
  g.add(box(32.3, 12.5, 2.5, mat.blueCase, [0, 0, 16]))
  g.add(cyl(5.9, 4, mat.blueCase, [23.2 / 2 - 6, 0, 22 + 2]))
  const horn = new THREE.Group()
  horn.name = "horn"
  horn.position.set(23.2 / 2 - 6, 0, 26)
  horn.add(cyl(3.5, 2, mat.white, [0, 0, 1]))
  horn.add(box(18, 5, 1.5, mat.white, [6, 0, 1.6]))
  g.add(horn)
  return g
}

function n20(): THREE.Group {
  const g = new THREE.Group()
  // Lying down along x: motor can, gearbox, shaft.
  g.add(box(15, 10, 12, mat.silver, [-4.5, 0, 6]))
  g.add(box(9, 10, 12, mat.gold, [7.5, 0, 6]))
  const spin = new THREE.Group()
  spin.name = "spin"
  spin.position.set(12, 0, 6)
  spin.rotation.y = Math.PI / 2
  spin.add(cyl(1.5, 10, mat.metal, [0, 0, 5], 12))
  spin.add(box(1, 3, 10, mat.metal, [1, 0, 5]))
  g.add(spin)
  return g
}

function nema17(): THREE.Group {
  const g = new THREE.Group()
  g.add(box(42.3, 42.3, 8, mat.dark, [0, 0, 4]))
  g.add(box(42.3, 42.3, 24, mat.black, [0, 0, 20]))
  g.add(box(42.3, 42.3, 8, mat.dark, [0, 0, 36]))
  g.add(cyl(11, 2, mat.dark, [0, 0, 41]))
  const spin = new THREE.Group()
  spin.name = "spin"
  spin.position.set(0, 0, 42)
  spin.add(cyl(2.5, 24, mat.metal, [0, 0, 12], 16))
  spin.add(box(4, 1, 15, mat.metal, [0, 2.2, 16]))
  g.add(spin)
  for (const [x, y] of [[-15.5, -15.5], [15.5, -15.5], [15.5, 15.5], [-15.5, 15.5]]) g.add(cyl(1.6, 0.5, mat.metal, [x, y, 40.2], 12))
  return g
}

function module(x: number, y: number, z: number, board: THREE.Material, top?: (g: THREE.Group) => void): THREE.Group {
  const g = new THREE.Group()
  g.add(box(x, y, 1.6, board, [0, 0, 0.8]))
  top?.(g)
  if (!top) g.add(box(x * 0.4, y * 0.4, z - 1.6, mat.black, [0, 0, 1.6 + (z - 1.6) / 2]))
  return g
}

function l298n(): THREE.Group {
  return module(43, 43, 27, mat.pcbRed, (g) => {
    g.add(box(23, 16, 25, mat.black, [0, 6, 1.6 + 12.5]))
    for (let i = 0; i < 6; i += 1) g.add(box(23, 1, 6, mat.black, [0, 1 + i * 2.5, 1.6 + 25]))
    g.add(box(15, 7, 10, mat.blueCase, [-12, -16, 6.6]))
    g.add(box(15, 7, 10, mat.blueCase, [12, -16, 6.6]))
    g.add(cyl(4, 12, mat.dark, [-14, -4, 7.6]))
  })
}

function ping(): THREE.Group {
  return module(45.7, 21.3, 16, mat.pcbGreen, (g) => {
    for (const x of [-12.5, 12.5]) {
      g.add(cyl(8, 12, mat.silver, [x, 0, 1.6 + 6]))
      g.add(cyl(6.5, 0.4, mat.black, [x, 0, 1.6 + 12.2]))
    }
    g.add(header(3, [0, -9, -8.5]))
  })
}

function piezo(): THREE.Group {
  const g = new THREE.Group()
  g.add(cyl(6, 9.5, mat.black, [0, 0, 4.75]))
  g.add(cyl(1, 0.4, mat.dark, [0, 0, 9.7], 12))
  return g
}

function pot(): THREE.Group {
  const g = new THREE.Group()
  g.add(box(16, 16, 7, mat.blueCase, [0, 0, 3.5]))
  const knob = new THREE.Group()
  knob.name = "horn"
  knob.position.set(0, 0, 7)
  knob.add(cyl(3, 13, mat.metal, [0, 0, 6.5]))
  knob.add(box(0.8, 6, 2, mat.dark, [0, 0, 12.6]))
  g.add(knob)
  return g
}

function extrusion(length: number, width: number): THREE.Group {
  const g = new THREE.Group()
  // Lying along x, slots implied by a darker core.
  g.add(box(length, width, 20, mat.aluminum, [0, 0, 10]))
  g.add(box(length + 0.2, 6, 21, mat.dark, [0, 0, 10]))
  if (width > 20) g.add(box(length + 0.2, width - 8, 6.2, mat.dark, [0, 0, 10]))
  return g
}

function wheel(part: Part): THREE.Group {
  const d = Number(prop(part, "diameter", 60))
  const w = Number(prop(part, "width", 8))
  const g = new THREE.Group()
  const spin = new THREE.Group()
  spin.name = "spin"
  spin.position.set(0, 0, d / 2)
  spin.rotation.x = Math.PI / 2
  spin.add(cyl(d / 2, w, mat.rubber, [0, 0, 0], 40))
  spin.add(cyl(d / 2 - 5, w + 0.4, mat.white, [0, 0, 0], 40))
  g.add(spin)
  return g
}

function rodLike(length: number, d: number, material: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  const rod = cyl(d / 2, length, material, [0, 0, d / 2], 20)
  rod.rotation.set(0, Math.PI / 2, 0)
  g.add(rod)
  return g
}

function generic(part: Part): THREE.Group {
  const [x = 10, y = 10, z = 5] = (PARTS[part.type]?.size as number[] | undefined) ?? []
  const kind = PARTS[part.type]?.kind
  const material = kind === "power" ? mat.black : kind === "mech" ? mat.aluminum : mat.dark
  const g = new THREE.Group()
  g.add(box(x, y, z, material))
  return g
}

/** One part's 3D model, millimetres, z up, sitting on z = 0. */
export function componentModel(part: Part): THREE.Group {
  let g: THREE.Group
  switch (part.type) {
    case "uno": g = uno(); break
    case "breadboard_170": g = breadboard(47, 35); break
    case "breadboard_400": g = breadboard(82, 55); break
    case "breadboard_830": g = breadboard(165, 55); break
    case "led":
    case "rgb_led": g = led(part); break
    case "resistor": g = resistor(); break
    case "servo": g = servo(); break
    case "dc_motor": g = n20(); break
    case "stepper": g = nema17(); break
    case "l298n": g = l298n(); break
    case "a4988": g = module(20.3, 15.2, 12, mat.pcbGreen, (m) => { m.add(box(5, 5, 1, mat.black, [0, 0, 2.1])); m.add(box(9, 9, 6, mat.metal, [0, 0, 5.6])) }); break
    case "ping": g = ping(); break
    case "piezo": g = piezo(); break
    case "pot": g = pot(); break
    case "button": g = (() => { const b = new THREE.Group(); b.add(box(6, 6, 3.5, mat.black)); b.add(cyl(1.7, 1.5, mat.dark, [0, 0, 4.25])); return b })(); break
    case "adxl335": g = module(20, 20, 3, mat.pcbRed, (m) => m.add(box(4, 4, 1.5, mat.black, [0, 0, 2.35]))); break
    case "extrusion_2020": g = extrusion(Number(prop(part, "length", 500)), 20); break
    case "extrusion_2040": g = extrusion(Number(prop(part, "length", 500)), 40); break
    case "rod_8mm": g = rodLike(Number(prop(part, "length", 300)), 8, mat.silver); break
    case "lead_screw": g = rodLike(Number(prop(part, "length", 300)), 8, mat.gold); break
    case "wheel": g = wheel(part); break
    case "bearing_608": g = (() => { const b = new THREE.Group(); b.add(cyl(11, 7, mat.silver)); b.add(cyl(4, 7.2, mat.dark, [0, 0, 3.5])); return b })(); break
    case "lm8uu": g = (() => { const b = new THREE.Group(); const c = cyl(7.5, 24, mat.silver, [0, 0, 7.5]); c.rotation.set(0, Math.PI / 2, 0); b.add(c); return b })(); break
    default: g = generic(part)
  }
  // The stage gives every item its own clipping plane on its materials,
  // so each model needs materials of its own.
  const copies = new Map<THREE.Material, THREE.Material>()
  g.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const material = mesh.material as THREE.Material
    if (!copies.has(material)) copies.set(material, material.clone())
    mesh.material = copies.get(material)!
  })
  if (g.userData.glow) g.userData.glow = (g.userData.glow as THREE.Material[]).map((m) => copies.get(m) ?? m)
  g.userData.partId = part.id
  return g
}
