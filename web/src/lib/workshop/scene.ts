"use client"

import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"

import { accentHex } from "@/lib/core-events"
import { toViewport, type HandPointer } from "@/lib/hand-tracking"
import { CATALOGUE, type BuiltItem, type ItemSpec } from "@/lib/workshop/models"

// The workshop: a lit stage where items can be grabbed, thrown into a spin,
// resized with two hands, and switched between a wireframe hologram and
// real materials. Hands (lib/hand-tracking.ts) and the mouse drive the
// same four calls - down, move, up, hover - with a pointer id each, so
// two hands are simply two pointers.
//
// Switching an item to materials is a scan: a clipping plane rises
// through it, solid below, hologram above, with a bright ring at the cut.

export type ItemMode = "wire" | "solid"

interface Item {
  id: string
  spec: ItemSpec
  root: THREE.Group
  model: THREE.Group
  solids: THREE.Mesh[]
  wires: THREE.LineSegments[]
  /** Dense hologram-only lines (the helmet's contours), hidden when solid. */
  contours: THREE.LineSegments[]
  wireMaterial: THREE.LineBasicMaterial
  lights: THREE.PointLight[]
  clip: THREE.Plane
  scanRing: THREE.LineLoop
  mode: ItemMode
  /** 0 = all hologram, 1 = all solid; animates toward the mode. */
  solidity: number
  bounds: THREE.Box3
  spin: number
  scale: number
  born: number
  /** Held over the bin: outlined red, discarded if let go. */
  armed: boolean
  /** Clock time the discard began, while it breaks apart. */
  dying: number | null
}

type Grip =
  | {
      kind: "item"
      item: Item
      offset: THREE.Vector3
      lastX: number
      lastY: number
      vx: number
      /** Camera distance and hand size at the grab, for depth by hand. */
      distance: number
      size: number | null
    }
  | { kind: "orbit"; lastX: number; lastY: number }

const TARGET = new THREE.Vector3(0, 1.1, 0)
const SLOTS: [number, number][] = [
  [0, 0], [-2.5, 0.3], [2.5, 0.3], [-1.3, -2.2], [1.3, -2.2], [-3.8, -1.8], [3.8, -1.8], [0, -3.6],
]
const BASE_SPIN = 0.25

// Hands in the scene. Apparent hand size in the camera image stands in for
// depth: a hand moving toward the webcam (toward the screen) grows, and
// goes further into the workshop.
const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]
const HAND_NEAR = 4.5
const HAND_FAR = 9.5
/** How far a held item travels per doubling of apparent hand size. */
const DEPTH_GAIN = 5
/** Scene units per unit of MediaPipe's per-joint z (relative to the wrist). */
const JOINT_DEPTH = 4

interface HandRig {
  group: THREE.Group
  joints: THREE.InstancedMesh
  bones: THREE.LineSegments
}

export interface WorkshopCallbacks {
  /** Which item the label should describe, or null. */
  onFocus: (spec: (ItemSpec & { id: string; mode: ItemMode }) | null) => void
  /** Is this viewport point over the discard bin? */
  binAt?: (x: number, y: number) => boolean
  /** The bin's state changed: an item is over it, or one was discarded. */
  onBin?: (state: "idle" | "armed" | "discarded") => void
}

const DISCARD_SECONDS = 0.55
const ARMED_COLOR = 0xff3355

export class WorkshopScene {
  private readonly renderer: THREE.WebGLRenderer
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200)
  private readonly clock = new THREE.Clock()
  private readonly raycaster = new THREE.Raycaster()
  private readonly items: Item[] = []
  private readonly grips = new Map<string, Grip>()
  private readonly accentMaterials: (THREE.Material & { color: THREE.Color })[] = []
  private readonly rim: THREE.DirectionalLight
  private readonly floorRings = new THREE.Group()
  private floor!: THREE.Mesh
  private readonly hands: HandRig[] = []
  private passthrough: THREE.VideoTexture | null = null
  private raf = 0
  private observer: ResizeObserver

  private azimuth = 0.25
  private elevation = 0.32
  private radius = 8.5
  private twoHand: { a: string; b: string; start: number; startValue: number; item: Item | null } | null = null
  private hovered: Item | null = null
  private accent = accentHex()
  private focused: Item | null = null
  private accentTimer = 0

  constructor(
    private readonly container: HTMLElement,
    private readonly label: HTMLElement,
    private readonly callbacks: WorkshopCallbacks
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.9
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.localClippingEnabled = true
    this.renderer.domElement.style.display = "block"
    this.renderer.domElement.style.width = "100%"
    this.renderer.domElement.style.height = "100%"
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(0x02050a)
    this.scene.fog = new THREE.Fog(0x02050a, 14, 34)

    // Reflections for the metals, from a neutral studio room.
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.55
    pmrem.dispose()

    this.scene.add(new THREE.HemisphereLight(0x9cc8ff, 0x050505, 0.45))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(4, 8, 5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = key.shadow.camera.bottom = -8
    key.shadow.camera.right = key.shadow.camera.top = 8
    this.scene.add(key)
    this.rim = new THREE.DirectionalLight(accentHex(), 1.6)
    this.rim.position.set(-5, 4, -6)
    this.scene.add(this.rim)

    this.buildFloor()

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.35, 0.85)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)
    this.resize()
    this.raf = requestAnimationFrame(this.frame)
  }

  // --- public API --------------------------------------------------------

  spawn(key: string) {
    const entry = CATALOGUE.find((c) => c.key === key)
    if (entry) this.spawnBuilt(entry.build())
  }

  /** Put any built model on the stage - a catalogue piece or one Jarvis designed. */
  spawnBuilt({ object, spec }: BuiltItem) {
    const root = new THREE.Group()
    const [x, z] = SLOTS[this.items.length % SLOTS.length]
    root.position.set(x, 0, z)
    root.add(object)
    this.scene.add(root)

    const wireMaterial = this.accentLine(0.9)
    const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
    const solids: THREE.Mesh[] = []
    const wires: THREE.LineSegments[] = []
    const contours: THREE.LineSegments[] = []
    const lights: THREE.PointLight[] = []
    object.traverse((node) => {
      if ((node as THREE.PointLight).isPointLight) {
        const light = node as THREE.PointLight
        light.userData.intensity = light.intensity
        lights.push(light)
      }
      // Model-supplied hologram lines (the helmet's contours) take the
      // item's wire material like everything else.
      if (node.userData.holoLines) {
        ;(node as THREE.LineSegments).material = wireMaterial
        contours.push(node as THREE.LineSegments)
        return
      }
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      solids.push(mesh)
      const material = mesh.material as THREE.Material
      material.clippingPlanes = [clip]
      // Otherwise the hidden part of a half-scanned item still casts a
      // full shadow.
      material.clipShadows = true
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, mesh.userData.edgeAngle ?? 22), wireMaterial)
      mesh.add(wire)
      wires.push(wire)
    })

    const scanRing = new THREE.LineLoop(this.circle(1, 96), this.accentLine(0))
    scanRing.rotation.x = Math.PI / 2
    root.add(scanRing)

    const item: Item = {
      id: crypto.randomUUID(),
      spec,
      root,
      model: object,
      solids,
      wires,
      contours,
      wireMaterial,
      lights,
      clip,
      scanRing,
      mode: "wire",
      solidity: 0,
      bounds: new THREE.Box3(),
      spin: BASE_SPIN * 4,
      scale: 1,
      born: this.clock.elapsedTime,
      armed: false,
      dying: null,
    }
    this.items.push(item)
    this.focus(item)
  }

  /** What is on the stage, oldest first, for Jarvis's view of the console. */
  listItems(): { name: string; mode: ItemMode }[] {
    return this.live().map((item) => ({ name: item.spec.name, mode: item.mode }))
  }

  /** Discard by name (most recent match), "last", or "all". Returns how many went. */
  discardWhere(target: string): number {
    const matches = this.select(target)
    matches.forEach((item) => this.discard(item))
    return matches.length
  }

  setModeWhere(target: string, mode: ItemMode): number {
    const matches = this.select(target)
    matches.forEach((item) => (item.mode = mode))
    if (this.focused && matches.includes(this.focused)) this.focus(this.focused)
    return matches.length
  }

  private live() {
    return this.items.filter((item) => item.dying === null)
  }

  private select(target: string): Item[] {
    const live = this.live()
    const wanted = target.trim().toLowerCase()
    if (wanted === "all") return live
    if (wanted === "last" || !wanted) return live.slice(-1)
    const named = live.filter((item) => item.spec.name.toLowerCase() === wanted)
    const loose = named.length ? named : live.filter((item) => item.spec.name.toLowerCase().includes(wanted))
    return loose.slice(-1)
  }

  setAllModes(mode: ItemMode) {
    this.items.forEach((item) => (item.mode = mode))
    if (this.focused) this.focus(this.focused)
  }

  clear() {
    for (const item of this.items) this.disposeItem(item)
    this.items.length = 0
    this.grips.clear()
    this.twoHand = null
    this.hovered = null
    this.focus(null)
  }

  /** Pointer pressed (mouse button or pinch). Always claims: empty space orbits. */
  down(id: string, x: number, y: number, size?: number): boolean {
    const item = this.pick(x, y)
    if (item) {
      const point = this.planeHit(x, y, item.root.position)
      this.grips.set(id, {
        kind: "item",
        item,
        offset: point ? item.root.position.clone().sub(point) : new THREE.Vector3(),
        lastX: x,
        lastY: y,
        vx: 0,
        distance: point ? point.distanceTo(this.camera.position) : this.radius,
        size: size ?? null,
      })
      this.focus(item)
    } else {
      this.grips.set(id, { kind: "orbit", lastX: x, lastY: y })
    }
    this.checkTwoHand()
    return true
  }

  move(id: string, x: number, y: number, size?: number) {
    const grip = this.grips.get(id)
    if (!grip) return
    if (this.twoHand && (this.twoHand.a === id || this.twoHand.b === id)) {
      this.applyTwoHand(id, x, y)
      grip.lastX = x
      grip.lastY = y
      return
    }
    if (grip.kind === "item") {
      // A hand also carries depth: the item keeps its distance from the
      // camera, pushed or pulled by how much the hand has grown or shrunk
      // since the grab. The mouse has no depth and slides on a plane.
      let point: THREE.Vector3 | null
      if (size && grip.size) {
        const distance = THREE.MathUtils.clamp(
          grip.distance + Math.log2(size / grip.size) * DEPTH_GAIN,
          2.5,
          22
        )
        this.raycaster.setFromCamera(this.ndc(x, y), this.camera)
        point = this.raycaster.ray.at(distance, new THREE.Vector3())
      } else {
        point = this.planeHit(x, y, grip.item.root.position)
      }
      if (point) {
        const next = point.add(grip.offset)
        next.y = Math.max(-0.3, Math.min(4, next.y))
        grip.item.root.position.copy(next)
      }
      const armed = !!this.callbacks.binAt?.(x, y)
      if (armed !== grip.item.armed) {
        grip.item.armed = armed
        this.callbacks.onBin?.(armed ? "armed" : "idle")
      }
      grip.vx = grip.vx * 0.6 + (x - grip.lastX) * 0.4
    } else {
      this.azimuth -= (x - grip.lastX) * 0.006
      this.elevation = THREE.MathUtils.clamp(this.elevation + (y - grip.lastY) * 0.004, 0.02, 1.25)
    }
    grip.lastX = x
    grip.lastY = y
  }

  up(id: string, _x: number, _y: number, tap: boolean) {
    const grip = this.grips.get(id)
    this.grips.delete(id)
    if (this.twoHand && (this.twoHand.a === id || this.twoHand.b === id)) this.twoHand = null
    if (!grip || grip.kind !== "item") return
    if (grip.item.armed) {
      this.discard(grip.item)
      return
    }
    if (tap) {
      grip.item.mode = grip.item.mode === "wire" ? "solid" : "wire"
      this.focus(grip.item)
    } else {
      // Thrown: the release speed becomes spin, then friction takes over.
      grip.item.spin += grip.vx * 0.06
    }
  }

  hover(x: number | null, y: number | null) {
    this.hovered = x === null || y === null ? null : this.pick(x, y)
  }

  private discard(item: Item) {
    item.armed = false
    item.dying = this.clock.elapsedTime
    for (const [id, grip] of this.grips) if (grip.kind === "item" && grip.item === item) this.grips.delete(id)
    if (this.twoHand?.item === item) this.twoHand = null
    if (this.focused === item) this.focus(null)
    if (this.hovered === item) this.hovered = null
    this.callbacks.onBin?.("discarded")
  }

  /** Draw the tracked hands inside the scene, or none. */
  setHands(pointers: HandPointer[]) {
    while (this.hands.length < pointers.length) this.hands.push(this.buildHand())
    const matrix = new THREE.Matrix4()
    this.hands.forEach((rig, index) => {
      const pointer = pointers[index]
      rig.group.visible = !!pointer
      if (!pointer) return
      const reach = THREE.MathUtils.clamp(
        THREE.MathUtils.mapLinear(pointer.size, 0.08, 0.3, HAND_NEAR, HAND_FAR),
        HAND_NEAR,
        HAND_FAR
      )
      const joints = pointer.landmarks.map((landmark) => {
        const screen = toViewport(landmark)
        this.raycaster.setFromCamera(this.ndc(screen.x, screen.y), this.camera)
        // MediaPipe's z is negative for joints nearer the webcam, which
        // puts them further into the scene.
        return this.raycaster.ray.at(reach - landmark.z * JOINT_DEPTH, new THREE.Vector3())
      })
      joints.forEach((joint, i) => {
        const tip = i === 4 || i === 8
        const scale = tip ? 1 + pointer.pinchAmount * 0.9 : i === 0 ? 1.4 : 0.8
        matrix.makeScale(scale, scale, scale).setPosition(joint)
        rig.joints.setMatrixAt(i, matrix)
      })
      rig.joints.instanceMatrix.needsUpdate = true
      const positions = rig.bones.geometry.getAttribute("position") as THREE.BufferAttribute
      HAND_BONES.forEach(([a, b], i) => {
        positions.setXYZ(i * 2, joints[a].x, joints[a].y, joints[a].z)
        positions.setXYZ(i * 2 + 1, joints[b].x, joints[b].y, joints[b].z)
      })
      positions.needsUpdate = true
      ;(rig.bones.material as THREE.LineBasicMaterial).opacity = pointer.pinching ? 1 : 0.7
    })
  }

  /** Show the live camera, mirrored and dimmed, behind the workshop. */
  setPassthrough(video: HTMLVideoElement | null) {
    this.passthrough?.dispose()
    this.passthrough = null
    const floorMaterial = this.floor.material as THREE.MeshStandardMaterial
    if (video) {
      const texture = new THREE.VideoTexture(video)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.RepeatWrapping
      texture.repeat.x = -1 // selfie view, matching the camera preview
      this.passthrough = texture
      this.scene.background = texture
      this.scene.backgroundIntensity = 0.4
      this.scene.fog = null
      floorMaterial.transparent = true
      floorMaterial.opacity = 0.35
    } else {
      this.scene.background = new THREE.Color(0x02050a)
      this.scene.backgroundIntensity = 1
      this.scene.fog = new THREE.Fog(0x02050a, 14, 34)
      floorMaterial.transparent = false
      floorMaterial.opacity = 1
    }
    floorMaterial.needsUpdate = true
  }

  zoom(factor: number) {
    this.radius = THREE.MathUtils.clamp(this.radius * factor, 3.5, 18)
  }

  toggle(id: string) {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    item.mode = item.mode === "wire" ? "solid" : "wire"
    this.focus(item)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.passthrough?.dispose()
    this.observer.disconnect()
    this.clear()
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | undefined
      material?.dispose?.()
    })
    this.scene.environment?.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // --- internals -----------------------------------------------------------

  private accentLine(opacity: number) {
    const material = new THREE.LineBasicMaterial({
      color: accentHex(),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.accentMaterials.push(material)
    return material
  }

  private circle(radius: number, segments: number) {
    const points: number[] = []
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2
      points.push(Math.cos(a) * radius, Math.sin(a) * radius, 0)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3))
    return geometry
  }

  private buildHand(): HandRig {
    const joints = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.05, 12, 8),
      new THREE.MeshBasicMaterial({
        color: accentHex(),
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      21
    )
    this.accentMaterials.push(joints.material as THREE.MeshBasicMaterial)
    const bonesGeometry = new THREE.BufferGeometry()
    bonesGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array(HAND_BONES.length * 6), 3)
    )
    const bones = new THREE.LineSegments(bonesGeometry, this.accentLine(0.7))
    // Positions are written in world space every frame, so the default
    // bounds would cull the hand the moment it left its first spot.
    joints.frustumCulled = false
    bones.frustumCulled = false
    const group = new THREE.Group()
    group.add(joints, bones)
    group.visible = false
    this.scene.add(group)
    return { group, joints, bones }
  }

  private buildFloor() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(9, 96),
      // Matte and nearly unlit by the studio reflections: a shiny floor
      // mirrored the environment and bloom turned it into a cyan haze.
      new THREE.MeshStandardMaterial({ color: 0x04070b, roughness: 0.85, metalness: 0.3, envMapIntensity: 0.12 })
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.floor = floor
    this.scene.add(floor)

    const grid = new THREE.GridHelper(18, 36, accentHex(), accentHex())
    const gridMaterial = grid.material as THREE.LineBasicMaterial
    gridMaterial.transparent = true
    gridMaterial.opacity = 0.12
    gridMaterial.depthWrite = false
    this.accentMaterials.push(gridMaterial)
    grid.position.y = 0.002
    this.scene.add(grid)

    for (const [radius, opacity] of [[2, 0.5], [4.2, 0.3], [7, 0.2]]) {
      const ring = new THREE.LineLoop(this.circle(radius, 128), this.accentLine(opacity))
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.01
      this.floorRings.add(ring)
    }
    // Radial ticks on the inner ring.
    const ticks: number[] = []
    for (let i = 0; i < 72; i += 1) {
      const a = (i / 72) * Math.PI * 2
      const inner = i % 6 === 0 ? 1.7 : 1.85
      ticks.push(Math.cos(a) * inner, Math.sin(a) * inner, 0, Math.cos(a) * 2, Math.sin(a) * 2, 0)
    }
    const tickGeometry = new THREE.BufferGeometry()
    tickGeometry.setAttribute("position", new THREE.Float32BufferAttribute(ticks, 3))
    const tickLines = new THREE.LineSegments(tickGeometry, this.accentLine(0.6))
    tickLines.rotation.x = -Math.PI / 2
    tickLines.position.y = 0.01
    this.floorRings.add(tickLines)
    this.scene.add(this.floorRings)
  }

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.container
    if (!width || !height) return
    this.renderer.setSize(width, height, false)
    this.composer.setSize(width, height)
    this.bloom.resolution.set(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private ndc(x: number, y: number) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
  }

  private pick(x: number, y: number): Item | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera)
    // Against whole items' bounds first (cheap and forgiving to aim at with
    // a hand), then nearest.
    let best: Item | null = null
    let bestDistance = Infinity
    for (const item of this.items) {
      if (item.dying !== null) continue
      const hit = this.raycaster.ray.intersectBox(item.bounds, new THREE.Vector3())
      if (hit) {
        const distance = hit.distanceTo(this.camera.position)
        if (distance < bestDistance) {
          bestDistance = distance
          best = item
        }
      }
    }
    return best
  }

  private planeHit(x: number, y: number, through: THREE.Vector3): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera)
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, through)
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3())
  }

  // Two pointers down at once: both on one item resizes it, both on empty
  // space zooms the camera.
  private checkTwoHand() {
    const entries = [...this.grips.entries()]
    if (entries.length !== 2) return
    const [[a, ga], [b, gb]] = entries
    const distance = Math.hypot(ga.lastX - gb.lastX, ga.lastY - gb.lastY) || 1
    if (ga.kind === "item" && gb.kind === "item" && ga.item === gb.item) {
      this.twoHand = { a, b, start: distance, startValue: ga.item.scale, item: ga.item }
    } else if (ga.kind === "orbit" && gb.kind === "orbit") {
      this.twoHand = { a, b, start: distance, startValue: this.radius, item: null }
    }
  }

  private applyTwoHand(id: string, x: number, y: number) {
    const pair = this.twoHand!
    const other = this.grips.get(pair.a === id ? pair.b : pair.a)
    if (!other) return
    const ratio = Math.hypot(x - other.lastX, y - other.lastY) / pair.start
    if (pair.item) pair.item.scale = THREE.MathUtils.clamp(pair.startValue * ratio, 0.35, 3)
    else this.radius = THREE.MathUtils.clamp(pair.startValue / ratio, 3.5, 18)
  }

  private focus(item: Item | null) {
    this.focused = item
    this.callbacks.onFocus(item ? { ...item.spec, id: item.id, mode: item.mode } : null)
  }

  private disposeItem(item: Item) {
    this.scene.remove(item.root)
    item.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
      if (mesh.material && mesh.material !== item.wireMaterial) (mesh.material as THREE.Material).dispose()
    })
    item.wireMaterial.dispose()
  }

  private frame = () => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(this.clock.getDelta(), 0.05)
    const t = this.clock.elapsedTime

    // Accent follows the console's mode.
    this.accentTimer -= dt
    if (this.accentTimer <= 0) {
      this.accentTimer = 0.25
      const hex = accentHex()
      this.accent = hex
      this.accentMaterials.forEach((m) => m.color.setHex(hex))
      this.rim.color.setHex(hex)
    }

    this.floorRings.rotation.y += dt * 0.05

    const held = new Set(
      [...this.grips.values()].filter((g) => g.kind === "item").map((g) => (g as { item: Item }).item)
    )

    for (const item of [...this.items]) {
      // Discarded: flares red, spins up, collapses and is gone.
      if (item.dying !== null) {
        const p = (t - item.dying) / DISCARD_SECONDS
        if (p >= 1) {
          this.items.splice(this.items.indexOf(item), 1)
          this.disposeItem(item)
          continue
        }
        const shrink = item.scale * (1 - p) * (1 - p)
        item.root.scale.setScalar(Math.max(0.001, shrink))
        item.model.rotation.y += dt * (6 + 30 * p)
        item.root.position.y += dt * 1.5
        item.solidity = Math.max(0, item.solidity - dt * 4)
        item.clip.constant = item.bounds.min.y - 1 + (item.bounds.max.y - item.bounds.min.y + 2) * item.solidity
        item.wireMaterial.color.setHex(ARMED_COLOR)
        item.wireMaterial.opacity = 1 - p * 0.6
        continue
      }
      item.wireMaterial.color.setHex(item.armed ? ARMED_COLOR : this.accent)

      const age = t - item.born
      // Spawn: grows in over half a second with an overshoot.
      const grow = Math.min(1, age / 0.5)
      const pop = grow < 1 ? 1 - Math.pow(1 - grow, 3) * Math.cos(grow * 6) : 1
      const target = item.scale * pop * (item === this.hovered && !held.has(item) ? 1.04 : 1)
      item.root.scale.lerp(new THREE.Vector3(target, target, target), Math.min(1, dt * 10))

      // Spin decays toward a slow idle turn; held items stop turning.
      if (held.has(item)) item.spin *= 0.8
      else item.spin += (BASE_SPIN - item.spin) * Math.min(1, dt * 0.6)
      item.model.rotation.y += item.spin * dt
      item.model.position.y = (item.model.userData.baseY ??= item.model.position.y) + Math.sin(t * 1.3 + item.born) * 0.05

      // Hologram <-> materials scan.
      item.solidity += ((item.mode === "solid" ? 1 : 0) - item.solidity) * Math.min(1, dt * 1.6)
      if (Math.abs(item.solidity - (item.mode === "solid" ? 1 : 0)) < 0.002) item.solidity = item.mode === "solid" ? 1 : 0
      item.bounds.setFromObject(item.model)
      const { min, max } = item.bounds
      const cut = min.y + (max.y - min.y) * item.solidity
      item.clip.constant = item.solidity >= 1 ? max.y + 1 : item.solidity <= 0 ? min.y - 1 : cut
      for (const mesh of item.solids) mesh.visible = true
      const hologram = 1 - item.solidity
      for (const lines of item.contours) lines.visible = hologram > 0.05
      const lit = item === this.hovered || held.has(item) || item === this.focused
      item.wireMaterial.opacity = (0.1 + hologram * 0.55) * (lit ? 1.25 : 1) * (0.92 + Math.sin(t * 20) * 0.04)
      for (const light of item.lights) light.intensity = (light.userData.intensity as number) * (0.25 + item.solidity * 0.75)

      // The scan ring sits at the cut while it is moving.
      const scanning = item.solidity > 0.01 && item.solidity < 0.99
      const ringMaterial = item.scanRing.material as THREE.LineBasicMaterial
      ringMaterial.opacity += ((scanning ? 1 : 0) - ringMaterial.opacity) * Math.min(1, dt * 8)
      const span = Math.max(max.x - min.x, max.z - min.z) / item.root.scale.x
      item.scanRing.scale.setScalar(span * 0.62)
      item.scanRing.position.y = (cut - item.root.position.y) / item.root.scale.y
    }

    // Camera orbit.
    const horizontal = Math.cos(this.elevation) * this.radius
    this.camera.position.set(
      TARGET.x + Math.sin(this.azimuth) * horizontal,
      TARGET.y + Math.sin(this.elevation) * this.radius,
      TARGET.z + Math.cos(this.azimuth) * horizontal
    )
    this.camera.lookAt(TARGET)

    // Label above the focused item.
    if (this.focused) {
      const top = new THREE.Vector3(
        (this.focused.bounds.min.x + this.focused.bounds.max.x) / 2,
        this.focused.bounds.max.y + 0.25,
        (this.focused.bounds.min.z + this.focused.bounds.max.z) / 2
      ).project(this.camera)
      const rect = this.renderer.domElement.getBoundingClientRect()
      const lx = (top.x * 0.5 + 0.5) * rect.width
      const ly = (-top.y * 0.5 + 0.5) * rect.height
      this.label.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -100%)`
      this.label.style.opacity = top.z < 1 ? "1" : "0"
    } else {
      this.label.style.opacity = "0"
    }

    this.composer.render()
  }
}
