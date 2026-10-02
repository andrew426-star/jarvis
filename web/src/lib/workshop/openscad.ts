"use client"

import * as THREE from "three"
import { STLLoader } from "three/addons/loaders/STLLoader.js"

import type { BuiltItem } from "@/lib/workshop/models"
import type { ScadRequest, ScadResponse } from "@/lib/workshop/scad.worker"

// Printable parts as OpenSCAD. Jarvis (or the templates menu) writes an
// OpenSCAD program, usually built from jarvis.scad (lib/workshop/
// jarvis-scad.ts); the worker compiles it with the Manifold backend into a
// watertight STL in millimetres; this turns that STL into a workshop item
// that keeps both the exact STL and its source for download.

const MM = 0.01 // scene units per millimetre

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, (response: ScadResponse) => void>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./scad.worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = (event: MessageEvent<ScadResponse>) => {
      waiting.get(event.data.id)?.(event.data)
      waiting.delete(event.data.id)
    }
  }
  return worker
}

export class ScadError extends Error {}

/** Compile OpenSCAD source to binary STL bytes (millimetres, Z-up). */
export function compileScad(code: string): Promise<Uint8Array> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, (response) => (response.ok ? resolve(response.stl) : reject(new ScadError(response.error))))
    getWorker().postMessage({ id, code } satisfies ScadRequest)
  })
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "part"

/** A compiled part as a workshop item. */
export function scadItem(name: string, code: string, stl: Uint8Array, notes: string[] = []): BuiltItem {
  const geometry = new STLLoader().parse(stl.slice().buffer)
  // OpenSCAD is Z-up; the workshop is Y-up.
  geometry.rotateX(-Math.PI / 2)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const size = box.getSize(new THREE.Vector3())

  const material = new THREE.MeshStandardMaterial({ color: 0x3b4450, roughness: 0.62, metalness: 0.08, flatShading: true })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  // printPart marks it printable (feature-edge hologram, STL export); the
  // exact compiler output and source travel with it for download.
  mesh.userData.printPart = slug(name)
  mesh.userData.stl = stl
  mesh.userData.scad = code
  const centre = box.getCenter(new THREE.Vector3())
  mesh.position.set(-centre.x, -box.min.y, -centre.z)

  const g = new THREE.Group()
  g.add(mesh)
  g.scale.setScalar(MM)
  g.position.y = 0.02
  return {
    object: g,
    spec: {
      key: "scad",
      name,
      designation: `PRINTABLE · ${size.x.toFixed(0)}×${size.z.toFixed(0)}×${size.y.toFixed(0)} MM · OPENSCAD`,
      lines: notes.length ? notes.slice(0, 4) : ["WATERTIGHT (MANIFOLD)", "EXPORT: STL + .SCAD SOURCE"],
    },
  }
}

/** Starting points for the templates menu: the jarvis.scad modules at their defaults. */
export const SCAD_TEMPLATES: { key: string; label: string; blurb: string; code: string }[] = [
  {
    key: "enclosure",
    label: "Enclosure",
    blurb: "Box, board posts, cut-outs, lid",
    code: `include <jarvis.scad>
// Body and lid. Size inner to the hardware plus ~5 mm clearance.
enclosure(inner = [120, 80, 45],
          boards = [["arduino_uno", [-20, 0]]],
          cutouts = [["front", "rect", [13, 11], [-35, 8]]]);`,
  },
  { key: "servo_mount", label: "Servo Mount", blurb: "Drop-in plate for a servo", code: `include <jarvis.scad>\nservo_mount("mg996r");` },
  { key: "arm_link", label: "Arm Link", blurb: "Flat link, servo-horn end", code: `include <jarvis.scad>\narm_link(length = 100);` },
  { key: "base_plate", label: "Base Plate", blurb: "Turntable disc, NEMA 17 mount", code: `include <jarvis.scad>\nbase_plate(d = 140, nema17 = true);` },
  { key: "l_bracket", label: "L-Bracket", blurb: "Gusseted corner bracket", code: `include <jarvis.scad>\nl_bracket();` },
]
