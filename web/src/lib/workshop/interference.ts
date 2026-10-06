import * as THREE from "three"
import { MeshBVH } from "three-mesh-bvh"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

// Fit and interference: which parts of a design run into each other, and
// how far. Each part (a component's model, a printed part) is merged into
// one triangle soup in the design frame (millimetres) with a BVH over it;
// pairs whose boxes overlap are tested triangle against triangle, and a
// pair that intersects is then measured: how deep the furthest point of
// either lies inside the other. Parts that only touch - a board resting on
// its posts, a lid on its lip - are not clashes: the depth must pass a
// tolerance. Runs a pair at a time, yielding between, so the console stays
// responsive on a big assembly.

export interface Clash {
  a: THREE.Object3D
  b: THREE.Object3D
  /** How far one is inside the other, mm. */
  depth: number
  /** Where, in the design frame (mm). */
  at: THREE.Vector3
}

interface Solid {
  node: THREE.Object3D
  geometry: THREE.BufferGeometry
  bvh: MeshBVH
  box: THREE.Box3
}

/** A node's meshes as one geometry in `frame`'s coordinates. */
function soup(node: THREE.Object3D, frame: THREE.Object3D): THREE.BufferGeometry | null {
  const pieces: THREE.BufferGeometry[] = []
  const m = new THREE.Matrix4()
  node.updateWorldMatrix(true, true)
  const toFrame = new THREE.Matrix4().copy(frame.matrixWorld).invert()
  node.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || child.userData.ghost || (mesh as THREE.InstancedMesh).isInstancedMesh || child.userData.cap) return
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", (mesh.geometry.getAttribute("position") as THREE.BufferAttribute).clone())
    if (mesh.geometry.index) g.setIndex(mesh.geometry.index.clone())
    g.applyMatrix4(m.multiplyMatrices(toFrame, mesh.matrixWorld))
    pieces.push(g.index ? g.toNonIndexed() : g)
  })
  if (!pieces.length) return null
  const merged = mergeGeometries(pieces)
  pieces.forEach((p) => p.dispose())
  return merged
}

/** Is `p` inside the closed surface `bvh`? Odd crossings along a ray. */
function inside(bvh: MeshBVH, p: THREE.Vector3, ray: THREE.Ray): boolean {
  ray.origin.copy(p)
  return bvh.raycast(ray, THREE.DoubleSide).length % 2 === 1
}

/** The deepest of `from`'s vertices inside `into`, and where. */
function deepest(from: Solid, into: Solid, limit = 600): { depth: number; at: THREE.Vector3 } {
  const position = from.geometry.getAttribute("position") as THREE.BufferAttribute
  const step = Math.max(1, Math.floor(position.count / limit))
  const p = new THREE.Vector3()
  // A slightly skewed direction, so a ray does not run along an edge.
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0.577, 0.5771, 0.5773).normalize())
  let best = { depth: 0, at: new THREE.Vector3() }
  for (let i = 0; i < position.count; i += step) {
    p.fromBufferAttribute(position, i)
    if (!into.box.containsPoint(p) || !inside(into.bvh, p, ray)) continue
    const hit = into.bvh.closestPointToPoint(p)
    const depth = hit ? hit.distance : 0
    if (depth > best.depth) best = { depth, at: p.clone() }
  }
  return best
}

/**
 * Every clash between `parts` (each carries userData.callout), in the
 * design `frame`. `tolerance` (mm): shallower contact is a fit, not a clash.
 */
export async function findInterference(parts: THREE.Object3D[], frame: THREE.Object3D, tolerance = 0.25): Promise<Clash[]> {
  frame.updateWorldMatrix(true, false)
  const solids: Solid[] = []
  for (const node of parts) {
    const geometry = soup(node, frame)
    if (!geometry) continue
    geometry.computeBoundingBox()
    const bvh = new MeshBVH(geometry)
    // On the geometry too: a pair test then walks both trees, instead of
    // every triangle of one against the other's tree.
    ;(geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = bvh
    solids.push({ node, geometry, bvh, box: geometry.boundingBox!.clone() })
  }
  const clashes: Clash[] = []
  const identity = new THREE.Matrix4()
  let breath = performance.now()
  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      const [a, b] = [solids[i], solids[j]]
      if (!a.box.clone().expandByScalar(-tolerance).intersectsBox(b.box)) continue
      // The console stays live: a breath for it every dozen milliseconds of
      // work (not every pair, which costs a frame each).
      if (performance.now() - breath > 12) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        breath = performance.now()
      }
      if (!a.bvh.intersectsGeometry(b.geometry, identity)) continue
      const ab = deepest(b, a)
      const ba = deepest(a, b)
      const worst = ab.depth >= ba.depth ? ab : ba
      if (worst.depth > tolerance) clashes.push({ a: a.node, b: b.node, depth: worst.depth, at: worst.at })
    }
  }
  solids.forEach((s) => s.geometry.dispose())
  return clashes.sort((x, y) => y.depth - x.depth)
}
