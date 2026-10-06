// Shared by the model build scripts (build-uno-model.mjs,
// build-part-models.mjs): KiCad's STEP models, fetched once and cached,
// meshed with OpenCascade (occt-import-js), sorted into materials by
// their face colours, and written out as a GLB by hand.

import fs from "node:fs"
import path from "node:path"

export const KICAD = "https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/"

let cache = null

/** Where downloads are kept between runs. */
export function useCache(dir) {
  cache = dir
  fs.mkdirSync(dir, { recursive: true })
}

export async function fetchCached(url, name) {
  const file = path.join(cache, name)
  if (fs.existsSync(file)) return fs.readFileSync(file)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(file, buf)
  return buf
}

// --- STEP -> triangles by material ------------------------------------------------------

export /** What a STEP face colour is made of, by its colour. */
function materialFor([r, g, b]) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const sat = max ? (max - min) / max : 0
  const gold = r > 0.6 && g > 0.45 && b < 0.4 && r > b * 1.6
  if (gold) return { color: [r, g, b], metal: 1, rough: 0.25, key: "gold" }
  if (sat < 0.12 && max > 0.6) return { color: [r, g, b], metal: 1, rough: 0.32, key: `metal-${max.toFixed(1)}` }
  return { color: [r, g, b], metal: 0, rough: max < 0.2 ? 0.55 : 0.45, key: `plastic-${r.toFixed(2)}-${g.toFixed(2)}-${b.toFixed(2)}` }
}

export async function loadStep(occt, file) {
  const buf = await fetchCached(KICAD + file, file.replace(/[/.]/g, "_"))
  const res = occt.ReadStepFile(new Uint8Array(buf), { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.002, angularDeflection: 0.6 })
  if (!res.success) throw new Error(`could not read ${file}`)
  // Triangles by colour, in the model's own frame.
  const pieces = []
  for (const mesh of res.meshes) {
    const pos = mesh.attributes.position.array
    const nor = mesh.attributes.normal?.array
    const idx = mesh.index.array
    const faces = mesh.brep_faces?.length ? mesh.brep_faces : [{ first: 0, last: idx.length / 3 - 1, color: mesh.color }]
    for (const face of faces) {
      const color = face.color ?? mesh.color ?? [0.2, 0.2, 0.2]
      const tri = []
      for (let t = face.first; t <= face.last; t += 1) tri.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2])
      pieces.push({ color, pos, nor, tri })
    }
  }
  return pieces
}

export function bounds(pieces) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const p of pieces) for (const i of p.tri) for (let k = 0; k < 3; k += 1) {
    min[k] = Math.min(min[k], p.pos[i * 3 + k])
    max[k] = Math.max(max[k], p.pos[i * 3 + k])
  }
  return { min, max }
}

// --- a GLB, written by hand -----------------------------------------------------------------

const UNO_META = { generator: "jarvis build-uno-model", copyright: "Board: Arduino A000066 CAD files, CC BY-SA 4.0. Parts: KiCad 3D library, CC-BY-SA 4.0." }

export function writeGlb(groups, meta = UNO_META) {
  const views = []
  const accessors = []
  const meshes = []
  const materials = []
  const chunks = []
  let offset = 0
  const push = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
    const pad = (4 - (bytes.length % 4)) % 4
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target })
    chunks.push(bytes, Buffer.alloc(pad))
    offset += bytes.length + pad
    return views.length - 1
  }
  for (const [key, g] of groups) {
    const pos = new Float32Array(g.pos)
    const nor = new Float32Array(g.nor)
    const idx = new Uint32Array(g.idx)
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], pos[i + k])
      max[k] = Math.max(max[k], pos[i + k])
    }
    const pv = push(pos, 34962)
    const nv = push(nor, 34962)
    const iv = push(idx, 34963)
    accessors.push({ bufferView: pv, componentType: 5126, count: pos.length / 3, type: "VEC3", min, max })
    accessors.push({ bufferView: nv, componentType: 5126, count: nor.length / 3, type: "VEC3" })
    accessors.push({ bufferView: iv, componentType: 5125, count: idx.length, type: "SCALAR" })
    const a = accessors.length - 3
    materials.push({ name: key, pbrMetallicRoughness: { baseColorFactor: [...g.mat.color, 1], metallicFactor: g.mat.metal, roughnessFactor: g.mat.rough } })
    meshes.push({ name: key, primitives: [{ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2, material: materials.length - 1 }] })
  }
  const nodes = meshes.map((m, i) => ({ mesh: i, name: m.name }))
  const json = {
    asset: { version: "2.0", ...meta },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  }
  let jsonBuf = Buffer.from(JSON.stringify(json))
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)])
  const bin = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8)
  const jh = Buffer.alloc(8)
  jh.writeUInt32LE(jsonBuf.length, 0)
  jh.writeUInt32LE(0x4e4f534a, 4)
  const bh = Buffer.alloc(8)
  bh.writeUInt32LE(bin.length, 0)
  bh.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jh, jsonBuf, bh, bin])
}
