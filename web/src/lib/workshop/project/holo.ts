import * as THREE from "three"

// Turning a built assembly into a hologram: every surface becomes a faint
// additive fill with its edges drawn in light, the workshop's projection
// look. `solid` keeps the real materials and only adds the edges, for the
// folder's view of the finished product.

export function hologram(object: THREE.Object3D, color: number, { solid = false, opacity = 1 } = {}) {
  const fill = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.07 * opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const line = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: (solid ? 0.35 : 0.85) * opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const meshes: THREE.Mesh[] = []
  object.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (mesh.isMesh) meshes.push(mesh)
    if ((node as THREE.PointLight).isPointLight) node.visible = false
  })
  for (const mesh of meshes) {
    // Printed parts are dense triangle soups: only their sharp edges.
    const edges = new THREE.EdgesGeometry(mesh.geometry, mesh.userData.printPart ? 30 : 20)
    mesh.add(new THREE.LineSegments(edges, line))
    if (!solid) mesh.material = fill
    mesh.castShadow = false
  }
  return { fill, line }
}

/** Scale and centre an object to fit a cube `size` wide, base on y = 0. */
export function fitTo(object: THREE.Object3D, size: number) {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  const dims = box.getSize(new THREE.Vector3())
  const scale = size / Math.max(dims.x, dims.y, dims.z, 1e-6)
  const holder = new THREE.Group()
  holder.add(object)
  const centre = box.getCenter(new THREE.Vector3())
  object.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z))
  holder.scale.setScalar(scale)
  return holder
}
