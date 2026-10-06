"use client"

import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

import { real } from "@/lib/workshop/project/materials"

// The genuine Arduino UNO R3, built by scripts/build-uno-model.mjs from
// Arduino's own board file (A000066 CAD files, CC BY-SA 4.0) and KiCad's
// 3D library (CC-BY-SA 4.0); see public/models/ATTRIBUTION.md. The parts
// come as one GLB, placed where the board file puts them; the board is
// drawn here from its data - the real outline and mounting holes, its
// copper under the blue solder mask, tinned pads and vias, the white
// silkscreen and its labels. Loaded once, on the first project with an
// UNO; until then (or offline) components3d.ts's own model stands in.
//
// Millimetres, z up, centred on the board, the board's underside at z = 0
// - the same frame as the stand-in, so layouts, wires (wires3d.ts) and
// printed mounts fit either.

const GLB = "/models/uno-r3.glb"
const BOARD = "/models/uno-r3-board.json"
const THICK = 1.6
/** Board centre in the board file's frame (origin at its lower-left). */
const CX = 34.29
const CY = 26.67

interface BoardData {
  outline: [number, number][][]
  copper: [number, number, number, number, number][]
  pours: [number, number][][]
  pads: { x: number; y: number; drill?: number; d?: number; shape?: string; w?: number; h?: number; rot?: number; round?: number }[]
  vias: [number, number, number][]
  silk: [number, number, number, number, number][]
  text: { x: number; y: number; size: number; rot: number; align: string; text: string }[]
  holes: [number, number, number][]
}

let built: THREE.Group | null = null
let loading: Promise<void> | null = null

/** Chain the outline's segments end to end into one loop. */
function outlineLoop(segments: [number, number][][]): THREE.Vector2[] {
  const left = segments.map((s) => s.slice())
  const loop = left.shift()!.map(([x, y]) => new THREE.Vector2(x, y))
  const near = (a: THREE.Vector2, [x, y]: [number, number]) => Math.hypot(a.x - x, a.y - y) < 0.05
  while (left.length) {
    const end = loop[loop.length - 1]
    const i = left.findIndex((s) => near(end, s[0]) || near(end, s[s.length - 1]))
    if (i < 0) break
    const seg = left.splice(i, 1)[0]
    const ordered = near(end, seg[0]) ? seg : seg.reverse()
    for (const p of ordered.slice(1)) loop.push(new THREE.Vector2(p[0], p[1]))
  }
  return loop
}

/** The board's face: solder mask over copper, tinned pads, silkscreen. */
function boardTexture(b: BoardData, width: number, height: number): THREE.CanvasTexture {
  const px = 30 // pixels per mm
  const canvas = document.createElement("canvas")
  canvas.width = Math.ceil(width * px)
  canvas.height = Math.ceil(height * px)
  const ctx = canvas.getContext("2d")!
  // Board y runs up; the canvas's down.
  ctx.setTransform(px, 0, 0, -px, 0, canvas.height)
  const mask = "#064a6e"
  ctx.fillStyle = mask
  ctx.fillRect(0, 0, width, height)
  // Copper under the mask reads as a lighter blue.
  const copper = "#16628d"
  ctx.fillStyle = copper
  for (const poly of b.pours) {
    ctx.beginPath()
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.globalAlpha = 0.35
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.strokeStyle = copper
  ctx.lineCap = "round"
  for (const [x1, y1, x2, y2, w] of b.copper) {
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  // Pads and vias: bare tinned copper through the mask.
  const tin = "#cfcac0"
  for (const p of b.pads) {
    ctx.fillStyle = tin
    if (p.w !== undefined && p.h !== undefined) {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(((p.rot ?? 0) * Math.PI) / 180)
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    } else {
      const d = p.d || (p.drill ?? 0.8) * 1.9
      ctx.beginPath()
      if (p.shape === "square") ctx.rect(p.x - d / 2, p.y - d / 2, d, d)
      else ctx.arc(p.x, p.y, d / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#1b1b1b"
      ctx.beginPath()
      ctx.arc(p.x, p.y, (p.drill ?? 0.8) / 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  for (const [x, y, drill] of b.vias) {
    ctx.fillStyle = tin
    ctx.beginPath()
    ctx.arc(x, y, drill * 0.95, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#1b1b1b"
    ctx.beginPath()
    ctx.arc(x, y, drill / 2, 0, Math.PI * 2)
    ctx.fill()
  }
  // Silkscreen.
  ctx.strokeStyle = "#f2f2ee"
  for (const [x1, y1, x2, y2, w] of b.silk) {
    ctx.lineWidth = Math.max(0.12, w)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  ctx.fillStyle = "#f2f2ee"
  for (const t of b.text) {
    ctx.save()
    ctx.translate(t.x, t.y)
    ctx.rotate((t.rot * Math.PI) / 180)
    ctx.scale(1, -1)
    ctx.font = `600 ${t.size}px Arial, sans-serif`
    ctx.textAlign = t.align.endsWith("right") ? "right" : t.align.endsWith("center") ? "center" : "left"
    ctx.textBaseline = t.align.startsWith("top") ? "top" : t.align.startsWith("center") ? "middle" : "alphabetic"
    ctx.fillText(t.text, 0, 0)
    ctx.restore()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/** The USB-B socket (KiCad has no model of it): a tinned steel shell, its
 *  square mouth and the white tongue inside. Board frame, mm. */
function usbB(): THREE.Group {
  const g = new THREE.Group()
  const shell = real.metal(0xc9cdd1, 0.3, { brushedScale: 2 })
  const L = 16.3
  const W = 12
  const H = 10.9
  const wall = 0.35
  const plate = (x: number, y: number, z: number, at: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), shell)
    m.position.set(...at)
    g.add(m)
  }
  // Four walls and a back, open toward -x.
  plate(L, W, wall, [0, 0, H - wall / 2])
  plate(L, W, wall, [0, 0, wall / 2])
  plate(L, wall, H, [0, W / 2 - wall / 2, H / 2])
  plate(L, wall, H, [0, -W / 2 + wall / 2, H / 2])
  plate(wall, W, H, [L / 2 - wall / 2, 0, H / 2])
  const inside = new THREE.Mesh(new THREE.BoxGeometry(L - 1, W - 1, H - 1), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 }))
  inside.position.set(0.5, 0, H / 2)
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(L - 4, 5.4, 3.2), real.plastic(0xeeeeea, 0.5))
  tongue.position.set(1.5, 0, H / 2)
  g.add(inside, tongue)
  return g
}

async function build(): Promise<THREE.Group> {
  const [gltf, b] = await Promise.all([new GLTFLoader().loadAsync(GLB), fetch(BOARD).then((r) => r.json() as Promise<BoardData>)])
  const g = new THREE.Group()
  g.name = "uno-r3"

  // The board: its real outline and holes, 1.6 mm FR-4 with the face drawn on.
  const loop = outlineLoop(b.outline)
  const xs = loop.map((p) => p.x)
  const ys = loop.map((p) => p.y)
  const width = Math.max(...xs)
  const height = Math.max(...ys)
  const shape = new THREE.Shape(loop)
  for (const [x, y, d] of b.holes) shape.holes.push(new THREE.Path().absarc(x, y, d / 2, 0, Math.PI * 2, true))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false, curveSegments: 24 })
  const face = boardTexture(b, width, height)
  // The caps' UVs are board millimetres: scale them onto the texture.
  face.repeat.set(1 / width, 1 / height)
  const top = real.pcb(0x064a6e)
  top.map = face
  top.roughnessMap = null
  const edge = new THREE.MeshPhysicalMaterial({ color: 0xc8c09a, roughness: 0.7 })
  const pcb = new THREE.Mesh(geometry, [top, edge])
  g.add(pcb)

  // The parts, as placed by the build.
  const parts = gltf.scene
  parts.traverse((n) => {
    const mesh = n as THREE.Mesh
    if (!mesh.isMesh) return
    const m = mesh.material as THREE.MeshStandardMaterial
    // glTF materials are Standard; upgrade gloss where the STEP colour says plastic.
    mesh.material = new THREE.MeshPhysicalMaterial({ color: m.color, metalness: m.metalness, roughness: m.roughness, clearcoat: m.metalness ? 0 : 0.15 })
  })
  g.add(parts)

  // What KiCad has no model of: the USB-B socket (X2) and the polyfuse (F1).
  const usb = usbB()
  usb.position.set(3.81 + 1.8, 38.1, THICK)
  g.add(usb)
  const fuse = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.5, 1.6), real.ceramic(0x8a7a3a))
  fuse.position.set(4.064, 26.543, THICK + 0.8)
  g.add(fuse)

  // Centre it like the stand-in.
  for (const child of g.children) child.position.x -= CX
  for (const child of g.children) child.position.y -= CY
  g.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) n.castShadow = n.receiveShadow = true
  })
  return g
}

/** Load the genuine UNO (once); resolves when it is ready or has failed. */
export function loadGenuine(): Promise<void> {
  loading ??= build()
    .then((g) => {
      built = g
    })
    .catch((err) => {
      // Offline or missing: the stand-in serves.
      console.warn("Genuine UNO model unavailable, using the stand-in:", err)
    })
  return loading
}

/** A copy of the genuine UNO, or null while it is not loaded. */
export function genuineUno(): THREE.Group | null {
  return built ? built.clone(true) : null
}
