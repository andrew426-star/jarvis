import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"

import { accentHex } from "@/lib/core-events"
import { compileScadCached } from "@/lib/workshop/openscad"
import { buildAssembly } from "@/lib/workshop/project/assembly"
import { fitTo, hologram } from "@/lib/workshop/project/holo"
import { emptyProject, type GalleryProject } from "@/lib/workshop/project/types"

// The project gallery: every project on a pedestal around a ring, its
// finished product projected above it as a hologram - the components and
// printed parts assembled as its layout places them. The ring turns to
// bring the selected project to the front; drag, wheel or arrows turn it.

const SLOT_SPACING = 2.6
const HOLO_SIZE = 1.5
const TURN_RATE = 6

interface Slot {
  project: GalleryProject
  root: THREE.Group
  holo: THREE.Group
  pedestal: THREE.Mesh
  beam: THREE.Mesh
  materials: { fill?: THREE.Material; line?: THREE.LineBasicMaterial; ring: THREE.MeshBasicMaterial; beam: THREE.MeshBasicMaterial }
  loading: THREE.Mesh | null
  angle: number
}

export class GalleryScene {
  private readonly renderer: THREE.WebGLRenderer
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
  private readonly ring = new THREE.Group()
  private readonly clock = new THREE.Clock()
  private readonly raycaster = new THREE.Raycaster()
  private readonly observer: ResizeObserver
  private slots: Slot[] = []
  private radius = 3
  private selected = 0
  /** Ring angle now and where it is heading, radians. */
  private turn = 0
  private target = 0
  private dragging: { x: number; start: number } | null = null
  private raf = 0
  private disposed = false
  private readonly color = accentHex()

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelect: (index: number) => void
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.domElement.style.display = "block"
    this.renderer.domElement.style.width = "100%"
    this.renderer.domElement.style.height = "100%"
    container.appendChild(this.renderer.domElement)
    this.scene.background = new THREE.Color(0x02050a)
    this.scene.fog = new THREE.Fog(0x02050a, 9, 22)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    this.scene.add(this.ring)

    const floor = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 14, 96, 1),
      new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.025, side: THREE.DoubleSide })
    )
    floor.rotation.x = -Math.PI / 2
    this.scene.add(floor)
    const grid = new THREE.PolarGridHelper(14, 24, 12, 96, this.color, this.color)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.08
    this.scene.add(grid)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // Soft: a glow on the brightest edges, not a haze over everything.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.35, 0.6)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)
    this.resize()
    this.raf = requestAnimationFrame(this.frame)
  }

  setProjects(projects: GalleryProject[], selected = 0) {
    for (const slot of this.slots) this.ring.remove(slot.root)
    this.slots = []
    const n = projects.length
    this.radius = Math.max(3, (n * SLOT_SPACING) / (Math.PI * 2))
    projects.forEach((project, i) => {
      const angle = n > 1 ? (i / n) * Math.PI * 2 : 0
      const root = new THREE.Group()
      root.position.set(Math.sin(angle) * this.radius, 0, Math.cos(angle) * this.radius)
      root.rotation.y = angle
      const ringMat = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      const pedestal = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.78, 64), ringMat)
      pedestal.rotation.x = -Math.PI / 2
      pedestal.position.y = 0.02
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.12, 48), new THREE.MeshStandardMaterial({ color: 0x0b1118, metalness: 0.7, roughness: 0.4 }))
      disc.position.y = -0.06
      const beamMat = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.7, 2.2, 48, 1, true), beamMat)
      beam.position.y = 1.1
      const holo = new THREE.Group()
      holo.position.y = 0.25
      const loading = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.015, 8, 48, Math.PI * 1.4), ringMat)
      loading.position.y = 0.9
      root.add(disc, pedestal, beam, holo, loading)
      this.ring.add(root)
      const slot: Slot = { project, root, holo, pedestal, beam, materials: { ring: ringMat, beam: beamMat }, loading, angle }
      this.slots.push(slot)
      void this.loadHologram(slot)
    })
    this.select(Math.min(selected, Math.max(0, n - 1)), true)
  }

  /** Build a project's hologram: its assembly, every surface in light. */
  private async loadHologram(slot: Slot) {
    const p = slot.project
    const project = { ...emptyProject(p.name), id: p.id, goal: p.goal, status: p.status, parts: p.parts, printed: p.printed, layout: p.layout, segments: p.segments }
    if (!p.parts.length && !p.printed.length) {
      this.placeholder(slot)
      return
    }
    try {
      const { item } = await buildAssembly(project, compileScadCached, { bind: false })
      if (this.disposed) return
      const { fill, line } = hologram(item.object, this.color)
      slot.materials.fill = fill
      slot.materials.line = line
      slot.holo.add(fitTo(item.object, HOLO_SIZE))
    } catch {
      this.placeholder(slot)
    }
    if (slot.loading) {
      slot.root.remove(slot.loading)
      slot.loading = null
    }
  }

  /** A project with nothing designed yet: a wireframe sketch of a box. */
  private placeholder(slot: Slot) {
    const line = new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending })
    const cube = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.8, 0.8, 0.8)), line)
    cube.position.y = 0.6
    slot.materials.line = line
    slot.holo.add(cube)
    if (slot.loading) {
      slot.root.remove(slot.loading)
      slot.loading = null
    }
  }

  select(index: number, instant = false) {
    const n = this.slots.length
    if (!n) return
    this.selected = ((index % n) + n) % n
    // The shortest way round to the slot's angle facing the camera.
    const want = -this.slots[this.selected].angle
    let delta = (want - this.target) % (Math.PI * 2)
    if (delta > Math.PI) delta -= Math.PI * 2
    if (delta < -Math.PI) delta += Math.PI * 2
    this.target += delta
    if (instant) this.turn = this.target
    this.onSelect(this.selected)
  }

  next() {
    this.select(this.selected + 1)
  }

  previous() {
    this.select(this.selected - 1)
  }

  /** The slot under a viewport point, or -1. */
  pick(x: number, y: number): number {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.raycaster.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), this.camera)
    const hits = this.raycaster.intersectObjects(this.slots.map((s) => s.root), true)
    if (!hits.length) return -1
    let node: THREE.Object3D | null = hits[0].object
    while (node && !this.slots.some((s) => s.root === node)) node = node.parent
    return this.slots.findIndex((s) => s.root === node)
  }

  dragStart(x: number) {
    this.dragging = { x, start: this.target }
  }

  dragMove(x: number) {
    if (!this.dragging) return
    const width = this.container.clientWidth || 1
    this.target = this.dragging.start + ((x - this.dragging.x) / width) * Math.PI * 1.2
    this.turn = this.target
  }

  /** Let go: settle on the slot nearest the front. Returns whether it moved. */
  dragEnd(): boolean {
    if (!this.dragging) return false
    const moved = Math.abs(this.target - this.dragging.start) > 0.02
    this.dragging = null
    const n = this.slots.length
    if (!n || !moved) return moved
    const step = (Math.PI * 2) / n
    const index = Math.round(-this.target / step)
    this.select(index)
    return true
  }

  private resize() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.bloom.resolution.set(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private frame = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(this.clock.getDelta(), 0.05)
    const t = this.clock.elapsedTime
    this.turn += (this.target - this.turn) * Math.min(1, dt * TURN_RATE)
    this.ring.rotation.y = this.turn
    // The camera stands back from the front slot, a little above it.
    const distance = this.radius + 4.2
    this.camera.position.set(0, 1.7, distance)
    this.camera.lookAt(0, 0.85, this.radius - 0.5)

    this.slots.forEach((slot, i) => {
      const front = i === this.selected
      const focus = front ? 1 : 0.35
      slot.holo.rotation.y += dt * (front ? 0.5 : 0.2)
      slot.holo.position.y = 0.25 + Math.sin(t * 1.4 + i) * 0.04
      const scale = slot.root.scale.x + ((front ? 1 : 0.78) - slot.root.scale.x) * Math.min(1, dt * 6)
      slot.root.scale.setScalar(scale)
      const flicker = 0.95 + Math.sin(t * 23 + i * 3) * 0.025 + Math.sin(t * 7.3) * 0.025
      if (slot.materials.line) slot.materials.line.opacity = 0.5 * focus * flicker
      if (slot.materials.fill) (slot.materials.fill as THREE.MeshBasicMaterial).opacity = 0.035 * focus
      slot.materials.ring.opacity = (front ? 0.5 : 0.18) * flicker
      slot.materials.beam.opacity = front ? 0.03 : 0.012
      if (slot.loading) slot.loading.rotation.z -= dt * 4
    })
    this.composer.render()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.observer.disconnect()
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material?.dispose()
    })
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
