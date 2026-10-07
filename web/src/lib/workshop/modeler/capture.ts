import type { CapturedMesh } from "@/lib/workshop/modeler/design"

// A stage object's surface (scene.captureMesh: triangles, mm, z up) made
// into something a design can carry and OpenSCAD can compile: welded,
// thinned to at most MAX_FACES by vertex clustering (a project's printed
// part has to fit in 40 000 characters of OpenSCAD), centred on its
// footprint with its floor on z = 0, and wound the way polyhedron() wants.

export const MAX_FACES = 900

/** Weld and thin `positions` (xyz per corner, three corners a triangle)
 *  on a grid of `cells` across its largest side. */
function cluster(positions: Float32Array, min: number[], cell: number) {
  const index = new Map<string, number>()
  const sums: number[][] = []
  const corner = (i: number) => {
    const key = `${Math.floor((positions[i] - min[0]) / cell)},${Math.floor((positions[i + 1] - min[1]) / cell)},${Math.floor((positions[i + 2] - min[2]) / cell)}`
    let at = index.get(key)
    if (at === undefined) {
      at = sums.length
      index.set(key, at)
      sums.push([0, 0, 0, 0])
    }
    const s = sums[at]
    s[0] += positions[i]
    s[1] += positions[i + 1]
    s[2] += positions[i + 2]
    s[3] += 1
    return at
  }
  const faces: number[][] = []
  const seen = new Set<string>()
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const a = corner(i)
    const b = corner(i + 3)
    const c = corner(i + 6)
    if (a === b || b === c || a === c) continue
    const key = [a, b, c].sort((x, y) => x - y).join(",")
    if (seen.has(key)) continue
    seen.add(key)
    // OpenSCAD wants clockwise seen from outside; meshes come counter-clockwise.
    faces.push([a, c, b])
  }
  const points = sums.map(([x, y, z, n]) => [x / n, y / n, z / n])
  return { points, faces }
}

/** Drop points no face uses, renumbering the faces. */
function compact(points: number[][], faces: number[][]) {
  const remap = new Map<number, number>()
  const kept: number[][] = []
  const out = faces.map((face) =>
    face.map((i) => {
      let j = remap.get(i)
      if (j === undefined) {
        j = kept.length
        remap.set(i, j)
        kept.push(points[i])
      }
      return j
    })
  )
  return { points: kept, faces: out }
}

export function captureMesh(source: string, positions: Float32Array): CapturedMesh | null {
  if (positions.length < 9) return null
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], positions[i + k])
      max[k] = Math.max(max[k], positions[i + k])
    }
  }
  const largest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  if (!(largest > 0.01)) return null

  // As fine as fits: welded at 0.01 mm first (an STL's corners are
  // repeated per triangle), then coarser until it is under the cap.
  let mesh = cluster(positions, min, 0.01)
  for (let cells = 160; mesh.faces.length > MAX_FACES && cells >= 4; cells = Math.floor(cells * 0.8)) {
    mesh = cluster(positions, min, largest / cells)
  }
  if (mesh.faces.length < 4) return null
  const { points, faces } = compact(mesh.points, mesh.faces)

  // Centred on the footprint, floor on z = 0, to a hundredth of a mm -
  // where two points round to the same spot they become one, and faces
  // that collapse go.
  const cx = (min[0] + max[0]) / 2
  const cy = (min[1] + max[1]) / 2
  const r = (n: number) => Math.round(n * 100) / 100
  const at = new Map<string, number>()
  const rounded: number[][] = []
  const remap = points.map(([x, y, z]) => {
    const p = [r(x - cx), r(y - cy), r(z - min[2])]
    const key = p.join(",")
    let i = at.get(key)
    if (i === undefined) {
      i = rounded.length
      at.set(key, i)
      rounded.push(p)
    }
    return i
  })
  const kept = faces.map((face) => face.map((i) => remap[i])).filter(([a, b, c]) => a !== b && b !== c && a !== c)
  if (kept.length < 4) return null
  return {
    source,
    points: rounded,
    faces: kept,
    size: [r(max[0] - min[0]), r(max[1] - min[1]), r(max[2] - min[2])],
  }
}
