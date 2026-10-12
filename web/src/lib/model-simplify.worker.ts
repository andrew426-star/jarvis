/// <reference lib="webworker" />

// A model Andrew loads (Ultron's head, a workshop mesh), made ready off the main
// thread (lib/ultron-model.ts): an STL or a 3MF (a Bambu Studio project
// holds its mesh as hundreds of megabytes of XML) in, a binary STL out,
// simplified to a few hundred thousand triangles so the console stays
// smooth and the file stays small enough to keep in IndexedDB.

import { unzipSync } from "three/addons/libs/fflate.module.js"

export type ModelRequest = { name: string; data: ArrayBuffer }
export type ModelResponse =
  | { kind: "progress"; text: string }
  | { kind: "done"; data: ArrayBuffer; triangles: number; original: number }
  | { kind: "error"; error: string }

const TARGET = 450_000

const post = (message: ModelResponse, transfer: Transferable[] = []) => self.postMessage(message, { transfer })

interface Mesh {
  positions: Float32Array
  /** Three vertex indices per triangle. */
  triangles: Uint32Array
}

// --- reading ---------------------------------------------------------------------

function grow<T extends Float32Array | Uint32Array>(array: T, need: number): T {
  if (need <= array.length) return array
  const next = new (array.constructor as new (n: number) => T)(Math.max(need, array.length * 2))
  next.set(array)
  return next
}

/** The meshes in a 3MF's model files, merged. Read in slices, by pattern,
 *  since a whole Bambu model file as one string runs to gigabytes. */
function read3mf(data: ArrayBuffer): Mesh {
  const files = unzipSync(new Uint8Array(data), { filter: (file) => /^3D\/.*\.model$/i.test(file.name) })
  let positions = new Float32Array(1 << 20)
  let triangles = new Uint32Array(1 << 20)
  let vertexCount = 0
  let triangleCount = 0
  let base = 0
  const decoder = new TextDecoder()
  const tag = /<vertices>|<(vertex|triangle)\s([^>]*?)\/?>/g
  const attr = /(\w+)="([^"]*)"/g
  for (const bytes of Object.values(files)) {
    const SLICE = 8 << 20
    let carry = ""
    for (let at = 0; at < bytes.length; at += SLICE) {
      let text = carry + decoder.decode(bytes.subarray(at, Math.min(bytes.length, at + SLICE)), { stream: at + SLICE < bytes.length })
      // Hold back a cut-off tag for the next slice.
      const cut = text.lastIndexOf("<")
      if (at + SLICE < bytes.length && cut >= 0) {
        carry = text.slice(cut)
        text = text.slice(0, cut)
      } else {
        carry = ""
      }
      for (const match of text.matchAll(tag)) {
        if (!match[1]) {
          // A new mesh: its triangles count from its own first vertex.
          base = vertexCount
          continue
        }
        const values: Record<string, string> = {}
        for (const [, key, value] of match[2].matchAll(attr)) values[key] = value
        if (match[1] === "vertex") {
          positions = grow(positions, (vertexCount + 1) * 3)
          positions[vertexCount * 3] = +values.x
          positions[vertexCount * 3 + 1] = +values.y
          positions[vertexCount * 3 + 2] = +values.z
          vertexCount += 1
        } else {
          triangles = grow(triangles, (triangleCount + 1) * 3)
          triangles[triangleCount * 3] = base + +values.v1
          triangles[triangleCount * 3 + 1] = base + +values.v2
          triangles[triangleCount * 3 + 2] = base + +values.v3
          triangleCount += 1
        }
      }
      post({ kind: "progress", text: `Reading the model: ${Math.round(((at + SLICE) / bytes.length) * 100)}%` })
    }
  }
  return { positions: positions.subarray(0, vertexCount * 3), triangles: triangles.subarray(0, triangleCount * 3) }
}

/** An STL, binary or text, as one vertex per triangle corner. */
function readStl(data: ArrayBuffer): Mesh {
  const view = new DataView(data)
  const count = data.byteLength >= 84 ? view.getUint32(80, true) : 0
  if (count && 84 + count * 50 === data.byteLength) {
    const positions = new Float32Array(count * 9)
    for (let t = 0; t < count; t += 1) {
      for (let k = 0; k < 9; k += 1) positions[t * 9 + k] = view.getFloat32(84 + t * 50 + 12 + k * 4, true)
    }
    return { positions, triangles: Uint32Array.from({ length: count * 3 }, (_, i) => i) }
  }
  const text = new TextDecoder().decode(data)
  const values = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [+m[1], +m[2], +m[3]])
  const positions = Float32Array.from(values)
  return { positions, triangles: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) }
}

// --- simplifying -----------------------------------------------------------------

/** Vertex clustering: every vertex snapped to a grid G cells across the
 *  model's longest side, each cell's vertices merged at their average,
 *  and triangles that collapse dropped. */
function cluster(mesh: Mesh, G: number): Mesh {
  const { positions, triangles } = mesh
  let min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], positions[i + k])
      max[k] = Math.max(max[k], positions[i + k])
    }
  }
  min = min.map((v) => v - 1e-6)
  const cell = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / G
  const cells = new Map<number, number>()
  const of = new Uint32Array(positions.length / 3)
  let sums = new Float64Array(1 << 16)
  let counts = new Uint32Array(1 << 15)
  for (let v = 0; v < positions.length / 3; v += 1) {
    const ix = Math.floor((positions[v * 3] - min[0]) / cell)
    const iy = Math.floor((positions[v * 3 + 1] - min[1]) / cell)
    const iz = Math.floor((positions[v * 3 + 2] - min[2]) / cell)
    const key = (ix * 1024 + iy) * 1024 + iz
    let c = cells.get(key)
    if (c === undefined) {
      c = cells.size
      cells.set(key, c)
      if ((c + 1) * 3 > sums.length) {
        const s = new Float64Array(sums.length * 2)
        s.set(sums)
        sums = s
        const n = new Uint32Array(counts.length * 2)
        n.set(counts)
        counts = n
      }
    }
    of[v] = c
    sums[c * 3] += positions[v * 3]
    sums[c * 3 + 1] += positions[v * 3 + 1]
    sums[c * 3 + 2] += positions[v * 3 + 2]
    counts[c] += 1
  }
  const out = new Float32Array(cells.size * 3)
  for (let c = 0; c < cells.size; c += 1) {
    for (let k = 0; k < 3; k += 1) out[c * 3 + k] = sums[c * 3 + k] / counts[c]
  }
  const kept: number[] = []
  for (let t = 0; t < triangles.length; t += 3) {
    const a = of[triangles[t]]
    const b = of[triangles[t + 1]]
    const c = of[triangles[t + 2]]
    if (a !== b && b !== c && a !== c) kept.push(a, b, c)
  }
  return { positions: out, triangles: Uint32Array.from(kept) }
}

function toStl(mesh: Mesh): ArrayBuffer {
  const { positions: p, triangles: t } = mesh
  const count = t.length / 3
  const buffer = new ArrayBuffer(84 + count * 50)
  const view = new DataView(buffer)
  view.setUint32(80, count, true)
  for (let i = 0; i < count; i += 1) {
    const [a, b, c] = [t[i * 3] * 3, t[i * 3 + 1] * 3, t[i * 3 + 2] * 3]
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    const o = 84 + i * 50
    view.setFloat32(o, nx, true)
    view.setFloat32(o + 4, ny, true)
    view.setFloat32(o + 8, nz, true)
    for (const [k, v] of [a, b, c].entries()) {
      view.setFloat32(o + 12 + k * 12, p[v], true)
      view.setFloat32(o + 16 + k * 12, p[v + 1], true)
      view.setFloat32(o + 20 + k * 12, p[v + 2], true)
    }
  }
  return buffer
}

self.onmessage = (event: MessageEvent<ModelRequest>) => {
  const { name, data } = event.data
  try {
    post({ kind: "progress", text: "Reading the model" })
    let mesh = /\.3mf$/i.test(name) ? read3mf(data) : readStl(data)
    const original = mesh.triangles.length / 3
    if (!original) throw new Error("No triangles found in that file.")
    // Coarser until it is light enough: about 220 cells across to start.
    let G = 220
    let simple = mesh
    while (simple.triangles.length / 3 > TARGET && G > 40) {
      post({ kind: "progress", text: `Simplifying ${original.toLocaleString()} triangles` })
      simple = cluster(mesh, G)
      G = Math.floor(G * 0.8)
    }
    mesh = simple
    const stl = toStl(mesh)
    post({ kind: "done", data: stl, triangles: mesh.triangles.length / 3, original }, [stl])
  } catch (err) {
    post({ kind: "error", error: err instanceof Error ? err.message : "Could not read that model." })
  }
}
