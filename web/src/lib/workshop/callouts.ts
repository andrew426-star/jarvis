import * as THREE from "three"
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js"

// Callouts: a leader line from a part out to a floating label - its name,
// what it is, what it costs and where it comes from - and, for a printed
// part, its dimensions drawn on it in millimetres. Shown for the part under
// the pointer, and for every part while the design is exploded. Labels are
// DOM (CSS2DRenderer), so they stay crisp and readable at any zoom.

/** What a part's label says (set by assembly.ts on the part's node). */
export interface CalloutData {
  /** Part id or printed part name: how its cost is looked up. */
  id: string
  title: string
  spec: string
  printed?: boolean
}

/** Cost and source for a part, from the project's bill of materials. */
export type CostLookup = (id: string) => string | null

interface Shown {
  node: THREE.Object3D
  label: CSS2DObject
  leader: THREE.Line
}

const LEADER = 0.55

/** The id at the front of a spec line ("R4 · 100 Ω"), dropped when a
 *  label stands for several identical parts. */
const withoutId = (spec: string) => spec.replace(/^[^·]+·\s*/, "")

function labelElement(data: CalloutData, cost: string | null, count = 1): HTMLDivElement {
  const el = document.createElement("div")
  el.className = "workshop-callout"
  const title = document.createElement("div")
  title.className = "workshop-callout-title"
  title.textContent = count > 1 ? `${data.title} ×${count}` : data.title
  el.appendChild(title)
  const specText = count > 1 ? withoutId(data.spec) : data.spec
  if (specText) {
    const spec = document.createElement("div")
    spec.className = "workshop-callout-spec"
    spec.textContent = specText
    el.appendChild(spec)
  }
  if (cost) {
    const price = document.createElement("div")
    price.className = "workshop-callout-cost"
    price.textContent = cost
    el.appendChild(price)
  }
  return el
}

export class Callouts {
  private readonly renderer = new CSS2DRenderer()
  private readonly group = new THREE.Group()
  private readonly dims = new THREE.Group()
  private readonly lineMaterial: THREE.LineBasicMaterial
  private shown = new Map<THREE.Object3D, Shown>()
  private dimFor: THREE.Object3D | null = null
  private cost: CostLookup = () => null
  private width = 1
  private height = 1

  constructor(container: HTMLElement, private readonly scene: THREE.Scene, color: number) {
    const el = this.renderer.domElement
    el.style.position = "absolute"
    el.style.inset = "0"
    el.style.pointerEvents = "none"
    el.style.overflow = "hidden"
    container.appendChild(el)
    this.lineMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    this.group.name = "callouts"
    this.dims.name = "dimensions"
    scene.add(this.group, this.dims)
  }

  setCost(lookup: CostLookup) {
    this.cost = lookup
    // Re-label what is up, with the new prices.
    for (const node of [...this.shown.keys()]) this.hide(node)
  }

  /** Hide them all (a clean snapshot). */
  setVisible(on: boolean) {
    this.group.visible = on
    this.dims.visible = on
    this.renderer.domElement.style.display = on ? "" : "none"
  }

  setColor(hex: number) {
    this.lineMaterial.color.setHex(hex)
  }

  setSize(width: number, height: number) {
    this.width = width
    this.height = height
    this.renderer.setSize(width, height)
  }

  private hide(node: THREE.Object3D) {
    const shown = this.shown.get(node)
    if (!shown) return
    shown.label.element.remove()
    shown.label.removeFromParent()
    shown.leader.removeFromParent()
    shown.leader.geometry.dispose()
    this.shown.delete(node)
  }

  /** Show callouts for `nodes` (each carries userData.callout), placed
   *  outward from `centre`, and dimensions on `dimension`. Identical parts
   *  share one label ("Resistor ×10"); labels are laid out on screen so
   *  none covers another - one that cannot be fitted is left out. */
  update(
    nodes: THREE.Object3D[],
    centre: THREE.Vector3,
    dimension: THREE.Object3D | null,
    camera: THREE.PerspectiveCamera,
    /** Panels over the stage, in its pixels: no label goes under one. */
    keepOut: { x0: number; y0: number; x1: number; y1: number }[] = []
  ) {
    // One label per kind of part: the first of each, with how many.
    const kinds = new Map<string, { node: THREE.Object3D; count: number }>()
    for (const node of nodes) {
      const data = node.userData.callout as CalloutData
      const key = data.printed ? `printed:${data.id}` : `${data.title}|${withoutId(data.spec)}`
      const kind = kinds.get(key)
      if (kind) kind.count += 1
      else kinds.set(key, { node, count: 1 })
    }
    const wanted = new Map([...kinds.values()].map((k) => [k.node, k.count]))
    for (const node of [...this.shown.keys()]) {
      if (wanted.get(node) !== this.shown.get(node)!.label.userData.count) this.hide(node)
    }

    const box = new THREE.Box3()
    const up = new THREE.Vector3(0, 1, 0)
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    const placed = [...keepOut]
    const middle = centre.clone().project(camera)
    // Printed parts first, then the biggest groups: they keep their spot.
    const order = [...wanted.entries()].sort(
      (a, b) => Number(!!(b[0].userData.callout as CalloutData).printed) - Number(!!(a[0].userData.callout as CalloutData).printed) || b[1] - a[1]
    )
    for (const [node, count] of order) {
      let shown = this.shown.get(node)
      if (!shown) {
        const data = node.userData.callout as CalloutData
        const label = new CSS2DObject(labelElement(data, this.cost(data.id), count))
        label.userData.count = count
        label.center.set(0, 1)
        const leader = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.lineMaterial)
        leader.frustumCulled = false
        this.group.add(label, leader)
        shown = { node, label, leader }
        this.shown.set(node, shown)
      }
      // From the top of the part, out and up, away from the middle.
      box.setFromObject(node)
      const top = box.getCenter(new THREE.Vector3())
      top.y = box.max.y
      const out = top.clone().sub(centre).setY(0)
      if (out.lengthSq() < 1e-6) out.set(1, 0, 0)
      out.normalize().multiplyScalar(LEADER * 0.7).addScaledVector(up, LEADER)
      const end = top.clone().add(out)
      // Labels left of the middle hang to the left of their line.
      const screen = end.clone().project(camera)
      const left = screen.x < middle.x
      shown.label.center.set(left ? 1 : 0, 1)

      // Find it a free spot: where it wants to be, else slid up or down
      // along the screen a label's height at a time.
      // Measured once, when it has first been laid out: reading sizes every
      // frame would force the page's layout in the middle of rendering.
      const el = shown.label.element
      if (!shown.label.userData.w && el.offsetWidth) {
        shown.label.userData.w = el.offsetWidth
        shown.label.userData.h = el.offsetHeight
      }
      const w = (shown.label.userData.w as number) || 170
      const h = (shown.label.userData.h as number) || 52
      const px = (screen.x * 0.5 + 0.5) * this.width
      const py = (-screen.y * 0.5 + 0.5) * this.height
      const perPixel = (2 * camera.position.distanceTo(end) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / this.height
      let fitted: number | null = null
      for (const step of [0, -1, 1, -2, 2, -3, 3]) {
        const y1 = py + step * (h + 8)
        const rect = { x0: left ? px - w : px, x1: left ? px : px + w, y0: y1 - h, y1 }
        const inside = rect.x0 >= 4 && rect.x1 <= this.width - 4 && rect.y0 >= 4 && rect.y1 <= this.height - 4
        const clear = placed.every((o) => rect.x1 + 6 < o.x0 || rect.x0 > o.x1 + 6 || rect.y1 + 6 < o.y0 || rect.y0 > o.y1 + 6)
        if (inside && clear) {
          placed.push(rect)
          fitted = step * (h + 8)
          break
        }
      }
      shown.label.visible = fitted !== null
      shown.leader.visible = fitted !== null
      if (fitted === null) continue
      end.addScaledVector(screenUp, -fitted * perPixel)
      shown.label.position.copy(end)
      const pos = shown.leader.geometry.getAttribute("position") as THREE.BufferAttribute
      pos.setXYZ(0, top.x, top.y, top.z)
      pos.setXYZ(1, end.x, end.y, end.z)
      pos.needsUpdate = true
    }
    this.dimension(dimension)
    this.layoutDimensions(camera, placed)
  }

  /** Dimension labels clear of each other and of the callouts: each one
   *  pushed further out along its own side until it is. */
  private layoutDimensions(camera: THREE.Camera, placed: { x0: number; y0: number; x1: number; y1: number }[]) {
    this.dims.updateMatrixWorld(true)
    const taken = [...placed]
    for (const child of this.dims.children) {
      if (!(child instanceof CSS2DObject)) continue
      const [hx, hy] = child.userData.hang as [number, number]
      const el = child.element
      if (!child.userData.w && el.offsetWidth) {
        child.userData.w = el.offsetWidth
        child.userData.h = el.offsetHeight
      }
      const w = (child.userData.w as number) || 64
      const h = (child.userData.h as number) || 18
      const at = child.getWorldPosition(new THREE.Vector3()).project(camera)
      const px = (at.x * 0.5 + 0.5) * this.width
      const py = (-at.y * 0.5 + 0.5) * this.height
      // Further out along the side it hangs from: down, right or left.
      const away = hy < 0 ? [0, -1] : hx < 0 ? [-1, 0] : [1, 0]
      for (let push = 0; push < 5; push += 1) {
        const cx = hx + away[0] * push * 1.1
        const cy = hy + away[1] * push * 1.1
        const x0 = px - cx * w
        const y0 = py - cy * h
        const rect = { x0, y0, x1: x0 + w, y1: y0 + h }
        const clear = taken.every((o) => rect.x1 + 4 < o.x0 || rect.x0 > o.x1 + 4 || rect.y1 + 4 < o.y0 || rect.y0 > o.y1 + 4)
        if (clear || push === 4) {
          child.center.set(cx, cy)
          taken.push(rect)
          break
        }
      }
    }
  }

  /** Dimension lines along a printed part's three extents, in mm (its
   *  geometry is millimetres, z up: the OpenSCAD frame). */
  private dimension(node: THREE.Object3D | null) {
    if (node !== this.dimFor) {
      for (const child of [...this.dims.children]) {
        if (child instanceof CSS2DObject) child.element.remove()
        ;(child as THREE.Line).geometry?.dispose()
        child.removeFromParent()
      }
      this.dimFor = node
      const mesh = node as THREE.Mesh | null
      if (!mesh?.isMesh) return
      mesh.geometry.computeBoundingBox()
      const b = mesh.geometry.boundingBox!
      const size = b.getSize(new THREE.Vector3())
      const off = Math.max(size.x, size.y, size.z) * 0.08
      // Each extent: along one axis at the box's near corner, set off a
      // little from the part, with ticks at both ends.
      // Each label hangs off a different side of its line (below, right,
      // left), so on a small part the three do not land on one another.
      const runs: [THREE.Vector3, THREE.Vector3, number, [number, number]][] = [
        [new THREE.Vector3(b.min.x, b.min.y - off, b.min.z), new THREE.Vector3(b.max.x, b.min.y - off, b.min.z), size.x, [0.5, -0.25]],
        [new THREE.Vector3(b.max.x + off, b.min.y, b.min.z), new THREE.Vector3(b.max.x + off, b.max.y, b.min.z), size.y, [-0.12, 0.5]],
        [new THREE.Vector3(b.min.x - off, b.min.y - off, b.min.z), new THREE.Vector3(b.min.x - off, b.min.y - off, b.max.z), size.z, [1.12, 0.5]],
      ]
      for (const [a, z, mm, hang] of runs) {
        if (mm < 0.5) continue
        const along = z.clone().sub(a).normalize()
        const tick = Math.abs(along.z) > 0.9 ? new THREE.Vector3(off * 0.5, 0, 0) : new THREE.Vector3(0, 0, off * 0.5)
        const points = [a, z, a.clone().sub(tick), a.clone().add(tick), z.clone().sub(tick), z.clone().add(tick)]
        const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), this.lineMaterial)
        lines.userData.local = true
        this.dims.add(lines)
        const el = document.createElement("div")
        el.className = "workshop-dimension"
        el.textContent = `${mm.toFixed(1)} mm`
        const text = new CSS2DObject(el)
        text.center.set(hang[0], hang[1])
        text.userData.hang = hang
        text.position.copy(a).add(z).multiplyScalar(0.5)
        text.userData.local = true
        this.dims.add(text)
      }
    }
    // The dimensions ride on the part, wherever it is now.
    if (node) {
      node.updateWorldMatrix(true, false)
      this.dims.matrixAutoUpdate = false
      this.dims.matrix.copy(node.matrixWorld)
      this.dims.matrixWorldNeedsUpdate = true
    }
  }

  render(camera: THREE.Camera) {
    this.renderer.render(this.scene, camera)
  }

  dispose() {
    for (const node of [...this.shown.keys()]) this.hide(node)
    this.dimension(null)
    this.renderer.domElement.remove()
    this.lineMaterial.dispose()
    this.group.removeFromParent()
    this.dims.removeFromParent()
  }
}
