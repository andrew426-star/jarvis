import * as THREE from "three"

import { accentHex } from "@/lib/core-events"
import { sfx } from "@/lib/sfx"
import { StagePost } from "@/lib/workshop/post"
import { Atmosphere, radialGrid } from "@/lib/workshop/stage-fx"
import { useVisuals, visuals } from "@/lib/workshop/visuals"
import { compileScadCached } from "@/lib/workshop/openscad"
import { buildAssembly } from "@/lib/workshop/project/assembly"
import { setHoloOpacity } from "@/lib/workshop/holo-material"
import { fitTo, hologram } from "@/lib/workshop/project/holo"
import { emptyProject, type GalleryProject } from "@/lib/workshop/project/types"

// The project gallery: every project on a pedestal around a ring, its
// finished product projected above it as a hologram - the components and
// printed parts assembled as its layout places them. The ring turns to
// bring the selected project to the front; drag, wheel or arrows turn it.
//
// The front one is presented: projected in afresh with a scan rising up
// through it, in the projector's beam with dust hanging in it, inside two
// counter-turning instrument rings, while the camera drifts a little as a
// person looking at it would. Bloom on the light only (post.ts).
//
// Everything answers the pointer: the ring carries on from a flick and
// settles, the camera leans toward the pointer, a pedestal under it rises
// to meet it, and the front design can be grabbed and spun - left alone,
// it slowly opens out into its parts and closes again.

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
  /** The instrument rings round its pedestal, turning both ways. */
  hud: THREE.Group
  hudMaterial: THREE.LineBasicMaterial
  /** Its projection's cut, and the bright ring that rises with it. */
  clip: THREE.Plane
  scan: THREE.LineLoop
  /** Clock time it was last projected in (selected), or -1. */
  revealAt: number
  /** Its parts, for the breathing explode: each one's place and the way
   *  out from the middle; and the cables, hidden while it is apart. */
  parts: { node: THREE.Object3D; base: THREE.Vector3; out: THREE.Vector3 }[]
  cables: THREE.Object3D[]
  /** How far apart it is now (0-1), and how far it rises to the pointer. */
  apart: number
  lift: number
  /** Spin from a grab, radians a second, decaying back to the idle turn. */
  spin: number
}

const REVEAL_SECONDS = 1.1
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)

export class GalleryScene {
  private readonly renderer: THREE.WebGLRenderer
  private readonly post: StagePost
  private readonly grid: THREE.Mesh
  private readonly atmosphere: Atmosphere
  private readonly unsubscribeVisuals: () => void
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
  /** A drag turning the ring, or spinning the front design. */
  private dragging: { x: number; start: number; lastX: number; lastT: number; velocity: number; spin: boolean } | null = null
  private hovered = -1
  /** The pointer over the view, -1..1, and the camera's eased lean toward it. */
  private readonly pointer = new THREE.Vector2()
  private readonly lean = new THREE.Vector2()
  /** When the front design was last handled: it breathes only left alone. */
  private touchedAt = 0
  private wheelAt = 0
  private raf = 0
  private disposed = false
  private readonly color = accentHex()

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelect: (index: number) => void
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    // The projections are cut by their scan as they come in.
    this.renderer.localClippingEnabled = true
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
    // A faint floor grid, fading out from the middle of the ring - only
    // when the grid is switched on (FX), as on the stage.
    this.grid = radialGrid(this.color, 30, 0.6)
    this.scene.add(this.grid)

    // The projector over the front pedestal: beam and dust.
    this.atmosphere = new Atmosphere(this.color, { count: 260, radius: 1.8, height: 6 })
    this.atmosphere.group.scale.setScalar(0.5)
    this.scene.add(this.atmosphere.group)

    // Bloom on what is light, nothing else; no AO (there is no solid here).
    this.post = new StagePost(this.renderer, this.scene, this.camera)
    const flags = () => ({ ao: false, bloom: visuals().bloom, lens: visuals().lens })
    this.post.configure(flags())
    this.unsubscribeVisuals = useVisuals.subscribe(() => this.post.configure(flags()))
    this.post.glow(this.atmosphere.emitter)

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
      const hudMaterial = new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
      const hud = this.instrumentRings(hudMaterial)
      const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6)
      const scan = new THREE.LineLoop(this.circle(1, 96), new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
      scan.rotation.x = Math.PI / 2
      root.add(disc, pedestal, beam, holo, loading, hud, scan)
      this.ring.add(root)
      for (const glowing of [pedestal, loading, scan, ...hud.children]) this.post.glow(glowing)
      const slot: Slot = {
        project, root, holo, pedestal, beam, materials: { ring: ringMat, beam: beamMat }, loading, angle, hud, hudMaterial, clip, scan,
        revealAt: -1, parts: [], cables: [], apart: 0, lift: 0, spin: 0,
      }
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
      fill.clippingPlanes = [slot.clip]
      line.clippingPlanes = [slot.clip]
      slot.materials.fill = fill
      slot.materials.line = line
      slot.holo.add(fitTo(item.object, HOLO_SIZE))
      this.findParts(slot, item.object)
      // Its edges glow; the fill does not (it would wash the form out).
      item.object.traverse((node) => (node as THREE.LineSegments).isLineSegments && this.post.glow(node))
      // The one at the front, arriving: projected in.
      if (this.slots[this.selected] === slot) slot.revealAt = this.clock.elapsedTime
    } catch {
      this.placeholder(slot)
    }
    if (slot.loading) {
      slot.root.remove(slot.loading)
      slot.loading = null
    }
  }

  /** The design's parts, found as the stage finds them for its explode:
   *  down through single wrappers to the first level with several. */
  private findParts(slot: Slot, object: THREE.Object3D) {
    const isPart = (node: THREE.Object3D) =>
      !(node as THREE.Light).isLight &&
      !node.userData.cables &&
      !node.userData.helper &&
      !(node as THREE.LineSegments).isLineSegments &&
      ((node as THREE.Mesh).isMesh || (node as THREE.Group).isGroup)
    object.traverse((node) => node.userData.cables && slot.cables.push(node))
    let level = object
    for (let depth = 0; depth < 4; depth += 1) {
      const children = level.children.filter(isPart)
      if (children.length !== 1) break
      level = children[0]
    }
    const children = level.children.filter(isPart)
    if (children.length < 2) return
    object.updateMatrixWorld(true)
    const whole = new THREE.Box3().setFromObject(level)
    const middle = level.worldToLocal(whole.getCenter(new THREE.Vector3()))
    // A seventh of the design's size, in the level's own units.
    const reach = (whole.getSize(new THREE.Vector3()).length() * 0.14) / (level.getWorldScale(new THREE.Vector3()).x || 1)
    for (const node of children) {
      const out = level.worldToLocal(new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3())).sub(middle)
      // Outward and a little up, so a flat layout still opens.
      out.y = Math.max(out.y, 0) + out.length() * 0.35
      if (out.lengthSq() < 1e-10) out.set(0, 1, 0)
      slot.parts.push({ node, base: node.position.clone(), out: out.normalize().multiplyScalar(reach) })
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
    const was = this.selected
    this.selected = ((index % n) + n) % n
    this.touchedAt = this.clock.elapsedTime
    // A new one at the front is projected in afresh.
    if (instant || was !== this.selected) {
      this.slots[this.selected].revealAt = this.clock.elapsedTime
      if (!instant) {
        sfx.select()
        sfx.materialize()
      }
    }
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

  /** A press: on the front design it grabs that, to spin; anywhere else
   *  it takes hold of the ring. */
  dragStart(x: number, y: number) {
    const spin = this.pick(x, y) === this.selected && (this.slots[this.selected]?.holo.children.length ?? 0) > 0
    this.dragging = { x, start: this.target, lastX: x, lastT: performance.now(), velocity: 0, spin }
    this.touchedAt = this.clock.elapsedTime
  }

  dragMove(x: number) {
    const drag = this.dragging
    if (!drag) return
    const width = this.container.clientWidth || 1
    const now = performance.now()
    const dx = ((x - drag.lastX) / width) * Math.PI * 1.2
    drag.velocity = drag.velocity * 0.6 + (dx / Math.max(0.001, (now - drag.lastT) / 1000)) * 0.4
    drag.lastX = x
    drag.lastT = now
    this.touchedAt = this.clock.elapsedTime
    if (drag.spin) {
      const slot = this.slots[this.selected]
      slot.holo.rotation.y += dx * 2.2
      slot.spin = 0
      return
    }
    this.target = drag.start + ((x - drag.x) / width) * Math.PI * 1.2
    this.turn = this.target
  }

  /** Let go: a spun design keeps turning and slows; the ring carries on
   *  as far as the flick sends it and settles on the slot nearest the
   *  front. Returns whether it moved (a press that did not is a click). */
  dragEnd(): boolean {
    const drag = this.dragging
    if (!drag) return false
    this.dragging = null
    // Held still before letting go: no flick.
    const velocity = performance.now() - drag.lastT > 90 ? 0 : drag.velocity
    if (drag.spin) {
      const moved = Math.abs(drag.lastX - drag.x) > 6
      if (moved) this.slots[this.selected].spin = THREE.MathUtils.clamp(velocity * 2.2, -12, 12)
      return moved
    }
    const moved = Math.abs(this.target - drag.start) > 0.02
    const n = this.slots.length
    if (!n || !moved) return moved
    const step = (Math.PI * 2) / n
    this.select(Math.round(-(this.target + velocity * 0.22) / step))
    return true
  }

  /** The wheel, one project a notch: a trackpad sends a stream of small
   *  deltas, which would otherwise race round the whole ring. */
  wheel(delta: number) {
    const now = performance.now()
    if (Math.abs(delta) < 4 || now - this.wheelAt < 180) return
    this.wheelAt = now
    if (delta > 0) this.next()
    else this.previous()
  }

  /** The pointer over the view (null when it leaves): the camera leans to
   *  it and the pedestal under it rises. Returns the slot under it, or -1. */
  hover(x: number | null, y: number | null): number {
    if (x === null || y === null) {
      this.pointer.set(0, 0)
      this.hovered = -1
      return -1
    }
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
    this.hovered = this.dragging ? -1 : this.pick(x, y)
    return this.hovered
  }

  /** Two instrument rings for a pedestal: a segmented outer arc and a
   *  ticked inner one, turned opposite ways in the frame loop. */
  private instrumentRings(material: THREE.LineBasicMaterial): THREE.Group {
    const group = new THREE.Group()
    group.position.y = 0.04
    const arcs: number[] = []
    // Outer: five arcs of differing length with gaps between.
    const spans = [0.9, 0.35, 0.6, 0.2, 1.1]
    let a = 0
    for (const span of spans) {
      for (let k = 0; k < 24; k += 1) {
        const a0 = a + (span * k) / 24
        const a1 = a + (span * (k + 1)) / 24
        arcs.push(Math.cos(a0) * 1.28, 0, Math.sin(a0) * 1.28, Math.cos(a1) * 1.28, 0, Math.sin(a1) * 1.28)
      }
      a += span + 0.38
    }
    const outer = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(arcs, 3)), material)
    const ticks: number[] = []
    for (let i = 0; i < 90; i += 1) {
      const t = (i / 90) * Math.PI * 2
      const inner = i % 15 === 0 ? 1.0 : 1.06
      ticks.push(Math.cos(t) * inner, 0, Math.sin(t) * inner, Math.cos(t) * 1.12, 0, Math.sin(t) * 1.12)
    }
    const inner = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(ticks, 3)), material)
    group.add(outer, inner)
    return group
  }

  private circle(radius: number, segments: number) {
    const points: number[] = []
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2
      points.push(Math.cos(a) * radius, Math.sin(a) * radius, 0)
    }
    return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(points, 3))
  }

  private resize() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.post.setSize(w, h)
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
    // The camera stands back from the front slot, a little above it,
    // drifting slightly as someone looking at it would.
    // And leaning toward the pointer, as if stepping to look round it.
    this.lean.lerp(this.pointer, Math.min(1, dt * 2.5))
    const distance = this.radius + 4.2
    this.camera.position.set(
      Math.sin(t * 0.21) * 0.35 + this.lean.x * 0.9,
      1.7 + Math.sin(t * 0.33) * 0.08 + this.lean.y * 0.45,
      distance
    )
    this.camera.lookAt(this.lean.x * 0.25, 0.85 + this.lean.y * 0.1, this.radius - 0.5)
    // The projector stands over whichever pedestal is at the front.
    this.atmosphere.group.position.set(0, 0, this.radius)
    if (visuals().atmosphere) this.atmosphere.update(t, this.color)
    this.atmosphere.group.visible = visuals().atmosphere
    this.grid.visible = visuals().grid

    this.slots.forEach((slot, i) => {
      const front = i === this.selected
      const hovered = i === this.hovered && !front
      const focus = front ? 1 : hovered ? 0.7 : 0.35
      // A grab's spin, easing back to the idle turn.
      slot.spin *= Math.exp(-dt * 1.6)
      if (!(front && this.dragging?.spin)) slot.holo.rotation.y += dt * ((front ? 0.5 : 0.2) + slot.spin)
      slot.lift += ((hovered ? 1 : 0) - slot.lift) * Math.min(1, dt * 8)
      slot.holo.position.y = 0.25 + Math.sin(t * 1.4 + i) * 0.04 + slot.lift * 0.18
      const scale = slot.root.scale.x + ((front ? 1 : hovered ? 0.86 : 0.78) - slot.root.scale.x) * Math.min(1, dt * 6)
      slot.root.scale.setScalar(scale)
      const flicker = 0.95 + Math.sin(t * 23 + i * 3) * 0.025 + Math.sin(t * 7.3) * 0.025
      if (slot.materials.line) slot.materials.line.opacity = 0.5 * focus * flicker
      if (slot.materials.fill) setHoloOpacity(slot.materials.fill, 0.5 * focus)
      slot.materials.ring.opacity = (front ? 0.5 : 0.18 + slot.lift * 0.25) * flicker

      // Breathing: the front design, left alone, opens out into its parts
      // and closes again; handled or turned away, it closes.
      if (slot.parts.length) {
        const idle = t - this.touchedAt
        const want = front && idle > 2.5 && !this.dragging ? (1 - Math.cos((idle - 2.5) * 0.9)) / 2 : 0
        slot.apart += (want - slot.apart) * Math.min(1, dt * 3)
        for (const part of slot.parts) part.node.position.copy(part.base).addScaledVector(part.out, easeOut(slot.apart))
        for (const cable of slot.cables) cable.visible = slot.apart < 0.03
      }
      slot.materials.beam.opacity = front ? 0.03 : 0.012
      if (slot.loading) slot.loading.rotation.z -= dt * 4

      // Instrument rings: out for the front one, turning both ways.
      slot.hudMaterial.opacity += ((front ? 0.75 : 0) - slot.hudMaterial.opacity) * Math.min(1, dt * 4)
      slot.hud.children[0].rotation.y += dt * 0.35
      slot.hud.children[1].rotation.y -= dt * 0.12
      const pulse = slot.revealAt >= 0 ? Math.max(0, 1 - (t - slot.revealAt) / 0.6) : 0
      slot.pedestal.scale.setScalar(1 + pulse * 0.18)

      // Projected in: a cut rising through it, a bright ring at the cut.
      const since = slot.revealAt >= 0 ? (t - slot.revealAt) / REVEAL_SECONDS : 1
      const scanMaterial = slot.scan.material as THREE.LineBasicMaterial
      if (since < 1 && slot.holo.children.length) {
        const box = new THREE.Box3().setFromObject(slot.holo)
        const cut = box.min.y + (box.max.y - box.min.y) * easeOut(Math.max(0, since))
        slot.clip.constant = cut
        const local = slot.root.worldToLocal(new THREE.Vector3(0, cut, 0))
        slot.scan.position.y = local.y
        slot.scan.scale.setScalar(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.55 / slot.root.scale.x)
        scanMaterial.opacity = 0.9 * Math.sin(Math.PI * Math.min(1, since))
      } else {
        slot.clip.constant = 1e6
        scanMaterial.opacity = 0
      }
    })
    this.post.draw(dt)
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
    this.unsubscribeVisuals()
    this.post.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
