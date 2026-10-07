"use client"

import * as THREE from "three"
import { STLLoader } from "three/addons/loaders/STLLoader.js"

import type { BuiltItem } from "@/lib/workshop/models"
import { designBox, ghostCode, partCode, pieceBox, printedName, type Design } from "@/lib/workshop/modeler/design"
import { filament } from "@/lib/workshop/project/materials"

// The design on the stage: each part compiled and drawn in its own
// filament, the ghosts (what it is built round) as glass, and the selected
// piece boxed - one item, rebuilt in place as the design changes. Parts
// carry their STL and source, so the toolbar's STL export takes them as
// they are.

const MM = 0.01
/** Largest it is drawn, in stage units, before it is scaled down. */
const MAX_UNITS = 4

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "part"

export const designItemName = (design: Design) => `DESIGN · ${design.name}`

function parse(stl: Uint8Array) {
  const geometry = new STLLoader().parse(stl.slice().buffer)
  geometry.computeVertexNormals()
  return geometry
}

export async function buildDesignItem(
  design: Design,
  selected: string | null,
  compile: (code: string) => Promise<Uint8Array>
): Promise<{ item: BuiltItem | null; failures: { part: string; error: string }[] }> {
  const zUp = new THREE.Group()
  const failures: { part: string; error: string }[] = []
  const solids: THREE.Mesh[] = []

  const jobs = design.parts.map(async (part) => {
    const code = partCode(design, part)
    if (!code) return
    try {
      const stl = await compile(code)
      const mesh = new THREE.Mesh(parse(stl), filament(part.material, part.color, { color2: part.color2, texture: part.texture }))
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.name = part.name
      mesh.userData.printPart = slug(printedName(design, part))
      mesh.userData.stl = stl
      mesh.userData.scad = code
      zUp.add(mesh)
      solids.push(mesh)
    } catch (err) {
      failures.push({ part: part.name, error: err instanceof Error ? err.message : String(err) })
    }
  })
  const ghost = ghostCode(design)
  const ghostJob = ghost
    ? compile(ghost)
        .then((stl) => {
          const mesh = new THREE.Mesh(
            parse(stl),
            new THREE.MeshPhysicalMaterial({ color: 0x9fe8ff, roughness: 0.15, transparent: true, opacity: 0.22, depthWrite: false })
          )
          // Shown, never printed, exported or captured.
          mesh.userData.helper = true
          mesh.userData.noEdges = true
          mesh.renderOrder = 2
          zUp.add(mesh)
        })
        .catch((err) => failures.push({ part: "Fit ghosts", error: err instanceof Error ? err.message : String(err) }))
    : null
  await Promise.all([...jobs, ghostJob])

  const piece = selected ? design.pieces.find((p) => p.id === selected) : undefined
  if (piece) {
    const box = new THREE.Box3Helper(pieceBox(piece), piece.op === "cut" ? 0xff7a45 : 0x9fe8ff)
    box.userData.helper = true
    ;(box.material as THREE.LineBasicMaterial).depthTest = false
    box.renderOrder = 3
    zUp.add(box)
  }
  if (!zUp.children.length) return { item: null, failures }

  // OpenSCAD's z up into the stage's y up. The design's own origin stays
  // put across edits (so it does not slide about as pieces change); only
  // its floor is lifted onto the stage's.
  zUp.rotation.x = -Math.PI / 2
  const turned = new THREE.Group()
  turned.add(zUp)
  turned.updateMatrixWorld(true)
  const bounds = new THREE.Box3()
  for (const mesh of solids) bounds.expandByObject(mesh)
  if (bounds.isEmpty()) bounds.setFromObject(turned)
  turned.position.y = -bounds.min.y
  const size = designBox(design).getSize(new THREE.Vector3())
  const largest = Math.max(size.x, size.y, size.z, 1) * MM
  const fit = Math.min(1, MAX_UNITS / largest)

  const g = new THREE.Group()
  g.add(turned)
  g.scale.setScalar(MM * fit)
  g.position.y = 0.02
  g.userData.mm = true

  const counts = design.parts.filter((p) => solids.some((m) => m.name === p.name))
  return {
    item: {
      object: g,
      spec: {
        key: "design",
        name: designItemName(design),
        designation: `MODELED · ${design.pieces.length} PIECES · ${size.x.toFixed(0)}×${size.y.toFixed(0)}×${size.z.toFixed(0)} MM${fit < 1 ? ` · SHOWN 1:${(1 / fit).toFixed(1)}` : ""}`,
        lines: [
          ...(failures.length ? [`${failures.length} PART(S) DID NOT COMPILE`] : []),
          ...counts.map((p) => `${p.name.toUpperCase()} · ${p.material.toUpperCase()}`),
        ].slice(0, 4),
      },
    },
    failures,
  }
}
