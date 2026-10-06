"use client"

import * as THREE from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { STLExporter } from "three/addons/exporters/STLExporter.js"

import { accentHex } from "@/lib/core-events"
import { sfx } from "@/lib/sfx"
import { holoMaterial } from "@/lib/workshop/holo-material"
import { Callouts, type CostLookup } from "@/lib/workshop/callouts"
import { findInterference, type Clash } from "@/lib/workshop/interference"
import { StagePost } from "@/lib/workshop/post"
import { Atmosphere, CASTER_LAYER, ContactShadows, loadStudio, radialGrid } from "@/lib/workshop/stage-fx"
import { useVisuals, visuals } from "@/lib/workshop/visuals"
import { toViewport, type HandPointer } from "@/lib/hand-tracking"
import type { BuiltItem, ItemSpec } from "@/lib/workshop/models"

// The workshop: a lit stage where items can be grabbed, thrown into a spin,
// resized with two hands, and switched between a wireframe hologram and
// real materials. Hands (lib/hand-tracking.ts) and the mouse drive the
// same four calls - down, move, up, hover - with a pointer id each, so
// two hands are simply two pointers.
//
// Switching an item to materials is a scan: a clipping plane rises
// through it, solid below, hologram above, with a bright ring at the cut.
//
// For CAD work on top of that: an exploded view (an item's parts drawn
// apart along the line from its centre), rotating a part in place (a
// rotated part stops its idle turn and stays as set), and snapping - to a
// grid and 15-degree steps while moving, and flush against a neighbour's
// face when set down close to it.

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
  /** Its ghosts (every solid's hologram twin; see Unit). */
  ghosts: THREE.Mesh[]
  /** The pieces it materializes in, in assembly order. */
  units: Unit[]
  /** Seconds into a materialize, while one runs - counted in frame time,
   *  so a stall (the build compiling its shaders) pauses it, not skips it. */
  materializing: number | null
  /** What it lit with bloom: its edges and lit LEDs. */
  glowing: THREE.Object3D[]
  /** Its parts that carry a callout, found once. */
  labelled?: THREE.Object3D[]
  lights: THREE.PointLight[]
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
  /** Its parts, where each goes in the exploded view, and how long after
   *  the explode starts it sets off. */
  parts: { node: THREE.Object3D; base: THREE.Vector3; offset: THREE.Vector3; delay: number }[]
  /** Rotated by hand or mouse: no idle turn, it stays as set. */
  posed: boolean
}

/**
 * One piece of an item as it materializes: a part of an assembly (or the
 * whole of a simple model), with its own scan. Its solids are clipped by
 * `clip` (solid below the cut) and their ghosts - the hologram surface
 * (holo-material.ts) - by `ghostClip`, the other side of the same cut;
 * its edges have their own material so they can be drawn in on its turn.
 */
interface Unit {
  root: THREE.Object3D
  solids: THREE.Mesh[]
  ghosts: THREE.Mesh[]
  clip: THREE.Plane
  ghostClip: THREE.Plane
  holo: THREE.ShaderMaterial
  wire: THREE.LineBasicMaterial
  /** Seconds into a materialize before its turn. */
  delay: number
  /** 0 = hologram, 1 = solid; its own while materializing. */
  solidity: number
  /** Its edges drawn in, 0-1. */
  reveal: number
  bounds: THREE.Box3
  printed: boolean
}

type Grip =
  | {
      kind: "item"
      item: Item
      lastX: number
      lastY: number
      vx: number
      /** Pointer velocity, px per second, for a flick. */
      speedX: number
      speedY: number
      lastT: number
      /** The horizontal plane the item slides on (y at its centre), and
       *  where the pointer last met it. */
      height: number
      lastHit: THREE.Vector3 | null
      /** Unsnapped position; the item shows it rounded to the grid. */
      rawX: number
      rawZ: number
    }
  | { kind: "orbit"; lastX: number; lastY: number }
  | { kind: "rotate"; item: Item; lastX: number; lastY: number; yaw: number; tilt: number }
  | { kind: "axis"; axis: 0 | 1 | 2; target: GizmoTarget; lastX: number; lastY: number }
  | { kind: "section"; lastX: number; lastY: number }

/** What the move gizmo is on: a segment of a project (rig.ts), moved in
 *  its design frame, or else the selected item, moved on the stage.
 *  `object` is where the handles sit, `frame` the frame whose x, y, z
 *  they point along and whose scale turns stage units into mm. */
export interface GizmoTarget {
  object: THREE.Object3D
  frame: THREE.Object3D
  /** Dragged `mm` along a design axis. */
  onDrag: (axis: 0 | 1 | 2, mm: number) => void
  onEnd: () => void
}

const GIZMO_COLORS = [0xff5a5a, 0x5aff8c, 0x5aa8ff]
/** The gizmo's size, as a share of its distance from the camera. */
const GIZMO_SCALE = 0.11

const TARGET = new THREE.Vector3(0, 1.1, 0)
const SLOTS: [number, number][] = [
  [0, 0], [-2.5, 0.3], [2.5, 0.3], [-1.3, -2.2], [1.3, -2.2], [-3.8, -1.8], [3.8, -1.8], [0, -3.6],
]
const BASE_SPIN = 0.25

const VIEW = { azimuth: 0.25, elevation: 0.55, radius: 8.5 }
/** Snapping: grid step (1 unit = 100 mm, so 25 mm), angle step, and how
 *  close a face must be set down to another to be pulled flush. */
const SNAP_GRID = 0.25
const SNAP_ANGLE = THREE.MathUtils.degToRad(15)
const SNAP_FACE = 0.35
/** Radians of rotation per pixel of drag. */
const ROTATE_RATE = 0.01
/** Exploded view: how far parts travel, as a share of the item's size;
 *  how long each takes; the most the last one waits behind the first. */
const EXPLODE_SPREAD = 0.55
const EXPLODE_SECONDS = 0.85
const EXPLODE_STAGGER = 0.6
/** A new design materializing: each part's edges draw in, then it scans
 *  solid; parts start this far apart at most, all within MATERIALIZE_SPAN. */
const MATERIALIZE_DRAW = 0.45
const MATERIALIZE_SCAN = 0.9
const MATERIALIZE_STEP = 0.16
const MATERIALIZE_SPAN = 2.2

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

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
/** How far from the centre of the stage an item may be slid. */
const STAGE_RADIUS = 8
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
  /** Where the bin is on screen, for a part flicked at it. */
  binCentre?: () => { x: number; y: number } | null
  /** The bin's state changed: an item is over it, or one was discarded. */
  onBin?: (state: "idle" | "armed" | "discarded") => void
  /** What is on the stage changed (added, removed, switched mode). */
  onItems?: (items: { id: string; name: string; mode: ItemMode }[]) => void
  /** A tap on an item. Return true to take it; otherwise it toggles
   *  hologram/solid. `pointer` is the hand or mouse id. */
  onTap?: (itemId: string, pointer: string) => boolean
}

const DISCARD_SECONDS = 0.55
/** The section plane: which way it faces, how far through, which side is
 *  kept. Axes are the design's: x, y across the floor, z up. */
export interface SectionState {
  on: boolean
  axis: 0 | 1 | 2
  /** 0-1 through the item, along the axis. */
  offset: number
  flip: boolean
}

/** Design axis -> stage axis (the stage is y up). */
const STAGE_AXIS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)]
const SECTION_CAP = 0xff6a3d
const CLASH_COLOR = new THREE.Color(0xff2a3a)

/** A flick at the bin: this fast (px/s), within about 25 degrees of it. */
const FLICK_SPEED = 1400
const FLICK_AIM = 0.9

/** Edges where two faces meet at more than `angle` degrees - and only
 *  those. Boolean-cut parts are full of T-junctions (a vertex sitting in the
 *  middle of a neighbour's edge), which leaves edges unpaired: EdgesGeometry
 *  then draws every one of them, fanning lines across flat faces, and a
 *  naive pairing loses real corners instead. So unpaired edges are split at
 *  any vertex lying along them, and pairing is done on the pieces. */
function featureEdges(geometry: THREE.BufferGeometry, angle: number): THREE.BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const position = source.getAttribute("position")
  const round = (v: number) => Math.round(v * 1000) / 1000

  // Unique vertices, and each triangle's corners as indices into them.
  const vertices: THREE.Vector3[] = []
  const lookup = new Map<string, number>()
  const vertexId = (i: number) => {
    const x = round(position.getX(i))
    const y = round(position.getY(i))
    const z = round(position.getZ(i))
    const k = `${x},${y},${z}`
    let id = lookup.get(k)
    if (id === undefined) {
      id = vertices.length
      vertices.push(new THREE.Vector3(x, y, z))
      lookup.set(k, id)
    }
    return id
  }

  type Edge = { a: number; b: number; normals: THREE.Vector3[] }
  const edges = new Map<string, Edge>()
  const addEdge = (a: number, b: number, normal: THREE.Vector3) => {
    const id = a < b ? `${a}|${b}` : `${b}|${a}`
    const edge = edges.get(id) ?? { a, b, normals: [] }
    edge.normals.push(normal)
    edges.set(id, edge)
  }
  const triangle = new THREE.Triangle()
  for (let i = 0; i < position.count; i += 3) {
    const ids = [vertexId(i), vertexId(i + 1), vertexId(i + 2)]
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue
    triangle.set(vertices[ids[0]], vertices[ids[1]], vertices[ids[2]])
    // Sliver triangles from the boolean cuts have unreliable normals and
    // would draw false creases; the drawing ignores them (the solid keeps
    // them - see templates.ts).
    if (triangle.getArea() < 1e-3) continue
    const normal = triangle.getNormal(new THREE.Vector3())
    for (let k = 0; k < 3; k += 1) addEdge(ids[k], ids[(k + 1) % 3], normal)
  }

  // Split each unpaired edge at the vertices lying along it.
  const direction = new THREE.Vector3()
  const offset = new THREE.Vector3()
  for (const [id, edge] of [...edges]) {
    if (edge.normals.length !== 1) continue
    const start = vertices[edge.a]
    direction.subVectors(vertices[edge.b], start)
    const length = direction.length()
    if (length < 1e-6) continue
    direction.divideScalar(length)
    const stops: [number, number][] = []
    vertices.forEach((v, index) => {
      if (index === edge.a || index === edge.b) return
      offset.subVectors(v, start)
      const t = offset.dot(direction)
      if (t <= 1e-4 || t >= length - 1e-4) return
      if (offset.addScaledVector(direction, -t).lengthSq() < 1e-6) stops.push([t, index])
    })
    if (!stops.length) continue
    edges.delete(id)
    stops.sort((x, y) => x[0] - y[0])
    let from = edge.a
    for (const [, index] of stops) {
      addEdge(from, index, edge.normals[0])
      from = index
    }
    addEdge(from, edge.b, edge.normals[0])
  }

  const threshold = Math.cos(THREE.MathUtils.degToRad(angle))
  const points: number[] = []
  for (const { a, b, normals } of edges.values()) {
    if (normals.length !== 2 || normals[0].dot(normals[1]) > threshold) continue
    points.push(vertices[a].x, vertices[a].y, vertices[a].z, vertices[b].x, vertices[b].y, vertices[b].z)
  }
  const lines = new THREE.BufferGeometry()
  lines.setAttribute("position", new THREE.Float32BufferAttribute(points, 3))
  return lines
}

const ARMED_COLOR = 0xff3355

export class WorkshopScene {
  private readonly renderer: THREE.WebGLRenderer
  private readonly post: StagePost
  private readonly unsubscribeVisuals: () => void
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
  private floorGrid!: THREE.Mesh
  private readonly contact = new ContactShadows()
  private atmosphere!: Atmosphere
  /** The generated room, and the studio HDRI once it has loaded. */
  private roomEnv!: THREE.Texture
  private studioEnv: THREE.Texture | null = null
  private frameNo = 0
  private readonly hands: HandRig[] = []
  private raf = 0
  /** The window the loop is scheduled on: the one showing the canvas. */
  private rafView: Window = window
  private observer: ResizeObserver

  private azimuth = VIEW.azimuth
  private elevation = VIEW.elevation
  private radius = VIEW.radius
  private exploded = false
  private explodeT = 0
  private snap = false
  private twoHand: { a: string; b: string; start: number; startValue: number; item: Item | null } | null = null
  private hovered: Item | null = null
  /** The part of the hovered item under the pointer (its callout). */
  private hoverPart: THREE.Object3D | null = null
  private lastPartPick = 0
  private callouts!: Callouts
  private keepOut: { x0: number; y0: number; x1: number; y1: number }[] = []
  private keepOutAt = -1
  /** The stage's size in CSS pixels, kept by resize(). */
  private view = { width: 1, height: 1 }
  /** The focus readout's size, re-measured only when what it shows changes. */
  private labelSize = { for: "", w: 0, h: 0 }
  // Cross-section: the plane, the item it cuts, the widget to drag it by.
  private section: SectionState = { on: false, axis: 0, offset: 0.5, flip: false }
  private readonly sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)
  private sectionItem: Item | null = null
  private sectionWidget!: THREE.Group
  private onSectionMove: ((offset: number) => void) | null = null
  // Fit check: what clashes, lit red, with a marker where.
  private clashes: Clash[] = []
  private clashMarkers = new THREE.Group()
  private accent = accentHex()
  private focused: Item | null = null
  private accentTimer = 0
  private axesShown = true
  private readonly gizmo = new THREE.Group()
  private readonly gizmoHandles: THREE.Mesh[] = []
  private gizmoTarget: GizmoTarget | null = null
  /** The arrows on the selected item when no segment has them: X and Y
   *  across the stage, Z straight up - lifting a part off the floor or
   *  setting it on top of another, which a tabletop drag cannot. */
  private itemArrows = true
  /** Z up like the layout and OpenSCAD, 100 mm to a stage unit. */
  private readonly itemFrame = new THREE.Object3D()
  /** At the selected item's middle, where its arrows sit. */
  private readonly itemAnchor = new THREE.Object3D()
  /** The selected item's unsnapped place during an arrow drag. */
  private itemRaw: THREE.Vector3 | null = null

  constructor(
    private readonly container: HTMLElement,
    private readonly label: HTMLElement,
    private readonly callbacks: WorkshopCallbacks
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    // Counted per frame (every pass of it), not per render call.
    this.renderer.info.autoReset = false
    // Tone mapping is the post chain's (post.ts), on the HDR buffer.
    this.renderer.toneMapping = THREE.NoToneMapping
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
    this.roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environment = this.roomEnv
    this.scene.environmentIntensity = 0.55
    // The studio HDRI replaces it when it arrives (and the flag is on).
    void loadStudio(this.renderer).then((env) => (this.studioEnv = env))
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
    this.buildGizmo()
    this.itemFrame.rotation.x = -Math.PI / 2
    this.itemFrame.scale.setScalar(0.01)
    this.scene.add(this.itemFrame, this.itemAnchor)

    this.scene.add(this.contact.group)
    this.atmosphere = new Atmosphere(this.accent)
    this.scene.add(this.atmosphere.group)
    this.post = new StagePost(this.renderer, this.scene, this.camera)
    this.post.glow(this.atmosphere.emitter)
    this.callouts = new Callouts(container, this.scene, this.accent)
    this.sectionWidget = this.buildSectionWidget()
    this.scene.add(this.sectionWidget)
    this.post.configure(visuals())
    this.unsubscribeVisuals = useVisuals.subscribe((flags) => this.post.configure(flags))
    this.floorRings.traverse((node) => node !== this.floorRings && this.post.glow(node))

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)
    this.resize()
    this.schedule()
  }

  /** Next frame, from whichever window the canvas is in now: the stage can
   *  leave the console for a window of its own, and a minimised console
   *  would otherwise stop the loop that window depends on. */
  private schedule() {
    this.rafView = this.container.ownerDocument.defaultView ?? window
    this.raf = this.rafView.requestAnimationFrame(this.frame)
  }

  /** The stage moved to another window (or back): restart the loop there,
   *  since one scheduled on a closing window never fires. */
  rehost() {
    this.rafView.cancelAnimationFrame(this.raf)
    this.resize()
    this.schedule()
  }

  // --- public API --------------------------------------------------------

  /** Put any built model on the stage - a catalogue piece or one Jarvis
   *  designed. A new one materializes (Visuals.materialize); `retained`
   *  (a rebuild taking an old one's place) appears as it was. */
  spawnBuilt({ object, spec }: BuiltItem, retained = false) {
    const root = new THREE.Group()
    const [x, z] = SLOTS[this.items.length % SLOTS.length]
    root.position.set(x, 0, z)
    root.add(object)
    this.scene.add(root)

    const parts = this.explodeParts(object)
    // Units: each part the explode moves, and one for whatever is not in
    // one (a project's cables) - in assembly order: printed parts first,
    // then from the bottom up, the rest last.
    const units: Unit[] = []
    const unitOf = new Map<THREE.Object3D, Unit>()
    const makeUnit = (unitRoot: THREE.Object3D): Unit => {
      const ghostClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6)
      const holo = holoMaterial(this.accent)
      holo.clippingPlanes = [ghostClip]
      const unit: Unit = {
        root: unitRoot,
        solids: [],
        ghosts: [],
        clip: new THREE.Plane(new THREE.Vector3(0, -1, 0), -1e6),
        ghostClip,
        holo,
        wire: this.accentLine(0.9),
        delay: 0,
        solidity: 0,
        reveal: 1,
        bounds: new THREE.Box3(),
        printed: false,
      }
      units.push(unit)
      return unit
    }
    if (parts.length > 1) for (const part of parts) unitOf.set(part.node, makeUnit(part.node))
    let rest: Unit | null = null
    const unitFor = (node: THREE.Object3D): Unit => {
      for (let up: THREE.Object3D | null = node; up && up !== object; up = up.parent) {
        const unit = unitOf.get(up)
        if (unit) return unit
      }
      return (rest ??= makeUnit(object))
    }

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
      // Model-supplied hologram lines (the helmet's contours) take their
      // unit's edge material like everything else.
      if (node.userData.holoLines) {
        ;(node as THREE.LineSegments).material = unitFor(node).wire
        contours.push(node as THREE.LineSegments)
        return
      }
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const unit = unitFor(mesh)
      solids.push(mesh)
      unit.solids.push(mesh)
      if (mesh.userData.printPart) unit.printed = true
      // One material or several (the genuine UNO board's face and edge).
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        material.clippingPlanes = [unit.clip]
        // Otherwise the hidden part of a half-scanned item still casts a
        // full shadow.
        material.clipShadows = true
      }
      // Instanced (a cable's plugs): one outline at the origin would be
      // wrong, and they are too small to need their own.
      if ((mesh as THREE.InstancedMesh).isInstancedMesh || mesh.userData.noEdges) return
      const edges = mesh.userData.printPart
        ? featureEdges(mesh.geometry, 30)
        : new THREE.EdgesGeometry(mesh.geometry, mesh.userData.edgeAngle ?? 22)
      const wire = new THREE.LineSegments(edges, unit.wire)
      mesh.add(wire)
      wires.push(wire)
    })

    // The ghosts, added once the walk is done (not while it runs).
    const ghosts: THREE.Mesh[] = []
    for (const unit of units) {
      for (const mesh of unit.solids) {
        const instanced = mesh as THREE.InstancedMesh
        let ghost: THREE.Mesh
        if (instanced.isInstancedMesh) {
          const copy = new THREE.InstancedMesh(mesh.geometry, unit.holo, instanced.count)
          copy.instanceMatrix = instanced.instanceMatrix
          copy.frustumCulled = false
          ghost = copy
        } else ghost = new THREE.Mesh(mesh.geometry, unit.holo)
        ghost.userData.ghost = true
        ghost.raycast = () => {}
        mesh.add(ghost)
        unit.ghosts.push(ghost)
        ghosts.push(ghost)
      }
    }

    // Assembly order, and each unit's turn in it.
    const floor = (unit: Unit) => (unit === rest ? Infinity : new THREE.Box3().setFromObject(unit.root).min.y)
    const order = [...units].sort(
      (a, b) => Number(a === rest) - Number(b === rest) || Number(b.printed) - Number(a.printed) || floor(a) - floor(b)
    )
    const step = Math.min(MATERIALIZE_STEP, MATERIALIZE_SPAN / Math.max(1, order.length))
    order.forEach((unit, i) => (unit.delay = i * step))
    const materialize = visuals().materialize && !retained
    if (materialize) units.forEach((unit) => (unit.reveal = 0))

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
      ghosts,
      units,
      materializing: materialize ? 0 : null,
      lights,
      scanRing,
      glowing: [],
      mode: "wire",
      solidity: 0,
      bounds: new THREE.Box3(),
      spin: BASE_SPIN * 4,
      scale: 1,
      born: this.clock.elapsedTime,
      armed: false,
      dying: null,
      parts,
      posed: false,
    }
    // Bloom on its edges and on the LEDs that light (their epoxy).
    const lit = new Set<THREE.Material>()
    object.traverse((node) => (node.userData.glow as THREE.Material[] | undefined)?.forEach((m) => lit.add(m)))
    object.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (mesh.isMesh && !node.userData.ghost && lit.has(mesh.material as THREE.Material)) item.glowing.push(mesh)
    })
    item.glowing.push(...wires, ...contours, scanRing)
    item.glowing.forEach((node) => this.post.glow(node))
    this.items.push(item)
    this.showAxes(item)
    this.focus(item)
    this.emitItems()
  }

  /** Swap the item named `name` for a rebuilt one in the same spot, pose
   *  and mode, with no break-apart - a project's assembly when the project
   *  changes. With nothing by that name it is simply spawned. */
  replaceBuilt(name: string | null, built: BuiltItem) {
    const old = name ? this.live().find((item) => item.spec.name === name) : undefined
    this.spawnBuilt(built, !!old)
    if (!old) return
    const fresh = this.items[this.items.length - 1]
    fresh.root.position.copy(old.root.position)
    fresh.model.rotation.copy(old.model.rotation)
    fresh.posed = old.posed
    fresh.spin = old.spin
    fresh.scale = old.scale
    fresh.mode = old.mode
    fresh.solidity = old.solidity
    // A rebuild arriving mid-materialize carries on from where it was.
    fresh.materializing = old.materializing
    fresh.born = old.born
    this.removeItem(old)
  }

  /** The design axes on projects (assembly.ts) shown or hidden; toggled
   *  when `on` is left out. */
  setAxes(on = !this.axesShown): boolean {
    this.axesShown = on
    for (const item of this.items) this.showAxes(item)
    return on
  }

  private showAxes(item: Item) {
    item.model.traverse((node) => {
      if (node.name === "axes" && node.userData.helper) node.visible = this.axesShown
    })
  }

  /** Put the move gizmo on a segment, or take it off (null: back on
   *  the selected item, if item arrows are on). */
  setGizmo(target: GizmoTarget | null) {
    for (const [id, grip] of this.grips) if (grip.kind === "axis") this.grips.delete(id)
    this.gizmoTarget = target
  }

  /** Move arrows on the selected item on or off (toggled when `on` is
   *  left out). */
  setItemArrows(on = !this.itemArrows): boolean {
    this.itemArrows = on
    return on
  }

  /** The segment the panel is editing, else the selected item. */
  private activeTarget(): GizmoTarget | null {
    if (this.gizmoTarget) return this.gizmoTarget
    const item = this.focused
    if (!this.itemArrows || !item || item.dying !== null) return null
    return {
      object: this.itemAnchor,
      frame: this.itemFrame,
      onDrag: (axis, mm) => this.moveItemAlong(item, axis, mm),
      onEnd: () => {
        this.itemRaw = null
        if (this.snap) this.snapToNeighbours(item)
      },
    }
  }

  /** An arrow drag on an item: along the stage (X, Y) or up and down (Z),
   *  never below the floor, never off the stage, on the grid with snapping. */
  private moveItemAlong(item: Item, axis: 0 | 1 | 2, mm: number) {
    const raw = (this.itemRaw ??= item.root.position.clone())
    const units = mm * 0.01
    if (axis === 0) raw.x += units
    else if (axis === 1) raw.z -= units
    else raw.y = THREE.MathUtils.clamp(raw.y + units, 0, 6)
    const reach = Math.hypot(raw.x, raw.z)
    if (reach > STAGE_RADIUS) {
      raw.x *= STAGE_RADIUS / reach
      raw.z *= STAGE_RADIUS / reach
    }
    const step = (v: number) => (this.snap ? Math.round(v / SNAP_GRID) * SNAP_GRID : v)
    item.root.position.set(step(raw.x), step(raw.y), step(raw.z))
    item.spin = 0
  }


  /** Three arrows, X red, Y green, Z blue, each with a fat invisible
   *  handle that is easy to catch with a hand. Drawn over everything. */
  private buildGizmo() {
    const up = new THREE.Vector3(0, 1, 0)
    for (let axis = 0; axis < 3; axis += 1) {
      const dir = new THREE.Vector3().setComponent(axis, 1)
      const color = GIZMO_COLORS[axis]
      const material = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 })
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.8, 8), material)
      shaft.position.copy(dir).multiplyScalar(0.4)
      shaft.quaternion.setFromUnitVectors(up, dir)
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 16), material)
      head.position.copy(dir).multiplyScalar(0.9)
      head.quaternion.setFromUnitVectors(up, dir)
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.05, 8), new THREE.MeshBasicMaterial({ visible: false }))
      handle.position.copy(dir).multiplyScalar(0.55)
      handle.quaternion.setFromUnitVectors(up, dir)
      handle.userData.axis = axis
      handle.userData.material = material
      for (const m of [shaft, head]) m.renderOrder = 40
      this.gizmo.add(shaft, head, handle)
      this.gizmoHandles.push(handle)
    }
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }))
    hub.renderOrder = 40
    this.gizmo.add(hub)
    this.gizmo.visible = false
    this.scene.add(this.gizmo)
  }

  /** The gizmo axis under the pointer, if it is showing. */
  private pickGizmo(x: number, y: number): 0 | 1 | 2 | null {
    if (!this.activeTarget() || !this.gizmo.visible) return null
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera)
    const hit = this.raycaster.intersectObjects(this.gizmoHandles, false)[0]
    return hit ? (hit.object.userData.axis as 0 | 1 | 2) : null
  }

  /** Pixels of pointer travel to millimetres along a design axis: the
   *  travel along the axis as it appears on screen, through the design
   *  frame's scale on the stage. */
  private dragAlong(target: GizmoTarget, axis: 0 | 1 | 2, dx: number, dy: number): number {
    const origin = target.object.getWorldPosition(new THREE.Vector3())
    const q = target.frame.getWorldQuaternion(new THREE.Quaternion())
    const dir = new THREE.Vector3().setComponent(axis, 1).applyQuaternion(q)
    const reach = this.gizmo.scale.x
    const rect = this.renderer.domElement.getBoundingClientRect()
    const toScreen = (p: THREE.Vector3) => {
      const n = p.clone().project(this.camera)
      return new THREE.Vector2((n.x * 0.5 + 0.5) * rect.width, (-n.y * 0.5 + 0.5) * rect.height)
    }
    const a = toScreen(origin)
    const along = toScreen(origin.clone().addScaledVector(dir, reach)).sub(a)
    const pixels = along.length()
    // Pointing straight at the camera: no sensible way to drag along it.
    if (pixels < 8) return 0
    const world = ((dx * along.x + dy * along.y) / pixels / pixels) * reach
    const mmPerWorld = 1 / (target.frame.getWorldScale(new THREE.Vector3()).x || 1)
    return world * mmPerWorld
  }

  private placeGizmo() {
    const target = this.activeTarget()
    this.gizmo.visible = !!target
    if (!target) return
    if (target.object === this.itemAnchor && this.focused) {
      this.focused.bounds.getCenter(this.itemAnchor.position)
      this.itemAnchor.updateMatrixWorld()
    }
    target.object.getWorldPosition(this.gizmo.position)
    target.frame.getWorldQuaternion(this.gizmo.quaternion)
    this.gizmo.scale.setScalar(this.gizmo.position.distanceTo(this.camera.position) * GIZMO_SCALE)
    const held = new Set([...this.grips.values()].flatMap((g) => (g.kind === "axis" ? [g.axis] : [])))
    for (const handle of this.gizmoHandles) {
      const material = handle.userData.material as THREE.MeshBasicMaterial
      material.opacity = held.size ? (held.has(handle.userData.axis) ? 1 : 0.3) : 0.9
    }
  }

  /** Take an item off the stage at once, without the discard effect. */
  removeWhere(name: string) {
    const old = this.live().find((item) => item.spec.name === name)
    if (old) this.removeItem(old)
  }

  private removeItem(item: Item) {
    for (const [id, grip] of this.grips) if ((grip.kind === "item" || grip.kind === "rotate") && grip.item === item) this.grips.delete(id)
    if (this.twoHand?.item === item) this.twoHand = null
    if (this.hovered === item) this.hovered = null
    if (this.focused === item) this.focus(null)
    this.items.splice(this.items.indexOf(item), 1)
    this.disposeItem(item)
    this.emitItems()
  }

  private emitItems() {
    this.callbacks.onItems?.(this.live().map((item) => ({ id: item.id, name: item.spec.name, mode: item.mode })))
  }

  /** Select an item (label, STL export target) by id. */
  focusId(id: string) {
    const item = this.live().find((i) => i.id === id)
    if (item) this.focus(item)
  }

  /** Discard an item by id, with the same break-apart as the bin. */
  discardId(id: string) {
    const item = this.live().find((i) => i.id === id)
    if (item) this.discard(item)
  }

  /** What is on the stage, oldest first, for Jarvis's view of the console. */
  listItems(): { name: string; mode: ItemMode }[] {
    return this.live().map((item) => ({ name: item.spec.name, mode: item.mode }))
  }

  /** STL files for items (by name, "last", or "all"; default the focused
   *  one), in millimetres. A printable template exports each part as its
   *  own file at its true size; a display model exports whole, at the
   *  workshop's scale of one unit to 100mm. */
  exportStl(target?: string): { name: string; blob: Blob }[] {
    const items = target ? this.select(target) : this.focused ? [this.focused] : this.live().slice(-1)
    const exporter = new STLExporter()
    const files: { name: string; blob: Blob }[] = []
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    const save = (name: string, object: THREE.Object3D) => {
      // The workshop is Y-up; slicers are Z-up. Turning the part a quarter
      // about X puts its floor on the print bed instead of its side.
      const upright = new THREE.Group()
      upright.rotation.x = Math.PI / 2
      upright.add(object)
      upright.updateMatrixWorld(true)
      const data = exporter.parse(upright, { binary: true }) as DataView
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
      files.push({ name: `${name}.stl`, blob: new Blob([bytes], { type: "model/stl" }) })
    }
    for (const item of items) {
      const parts: THREE.Mesh[] = []
      item.model.traverse((node) => {
        if ((node as THREE.Mesh).isMesh && node.userData.printPart) parts.push(node as THREE.Mesh)
      })
      if (parts.length) {
        for (const part of parts) {
          if (part.userData.stl) {
            // An OpenSCAD part: hand over the compiler's own STL untouched
            // (already Z-up, millimetres, watertight) and its source.
            const stl = part.userData.stl as Uint8Array
            files.push({ name: `${part.userData.printPart}.stl`, blob: new Blob([stl.slice()], { type: "model/stl" }) })
            files.push({ name: `${part.userData.printPart}.scad`, blob: new Blob([part.userData.scad as string], { type: "text/plain" }) })
          } else {
            // Part geometry is in millimetres with its floor at y = 0.
            save(part.userData.printPart, new THREE.Mesh(part.geometry))
          }
        }
      } else {
        const copy = item.model.clone(true)
        const ghosts: THREE.Object3D[] = []
        copy.traverse((node) => node.userData.ghost && ghosts.push(node))
        ghosts.forEach((ghost) => ghost.removeFromParent())
        copy.position.set(0, 0, 0)
        copy.rotation.set(0, 0, 0)
        copy.scale.setScalar(100)
        copy.updateMatrixWorld(true)
        save(slug(item.spec.name) || "model", copy)
      }
    }
    return files
  }

  /** The current view as a PNG data URL, re-rendered at 2x without the
   *  hands. `clean` is for an AI renderer's input: every item shown fully
   *  solid, on a plain studio background, with no floor, grid or rings -
   *  so the model restyles the part, not the HUD around it.
   *
   *  Read synchronously straight after rendering: the canvas does not
   *  preserve its drawing buffer, so an async read (toBlob) can come back
   *  blank. */
  snapshot(clean = false): string {
    const restore: (() => void)[] = []
    const hide = (object: THREE.Object3D) => {
      const was = object.visible
      object.visible = false
      restore.push(() => (object.visible = was))
    }
    this.hands.forEach((rig) => hide(rig.group))
    hide(this.gizmo)
    if (clean) {
      for (const item of this.live()) item.model.traverse((node) => node.userData.helper && hide(node))
      ;[this.floor, this.floorGrid, this.floorRings, this.atmosphere.group, this.contact.group].forEach(hide)
      this.callouts.setVisible(false)
      restore.push(() => this.callouts.setVisible(true))
      const background = this.scene.background
      const fog = this.scene.fog
      this.scene.background = new THREE.Color(0xb8bec6)
      this.scene.fog = null
      restore.push(() => {
        this.scene.background = background
        this.scene.fog = fog
      })
      for (const item of this.live()) {
        for (const unit of item.units) {
          const [constant, ghostConstant, opacity] = [unit.clip.constant, unit.ghostClip.constant, unit.wire.opacity]
          unit.clip.constant = 1e6
          unit.ghostClip.constant = -1e6
          unit.wire.opacity = 0
          restore.push(() => {
            unit.clip.constant = constant
            unit.ghostClip.constant = ghostConstant
            unit.wire.opacity = opacity
          })
        }
        item.contours.forEach(hide)
        hide(item.scanRing)
      }
    }
    const ratio = this.renderer.getPixelRatio()
    this.renderer.setPixelRatio(2)
    this.resize()
    this.post.draw(0)
    const url = this.renderer.domElement.toDataURL("image/png")
    restore.reverse().forEach((undo) => undo())
    this.renderer.setPixelRatio(ratio)
    this.resize()
    return url
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
    this.emitItems()
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
    this.emitItems()
  }

  clear() {
    for (const item of this.items) this.disposeItem(item)
    this.items.length = 0
    this.grips.clear()
    this.twoHand = null
    this.hovered = null
    this.focus(null)
    this.emitItems()
  }

  /** Pointer pressed (mouse button or pinch). Always claims: empty space orbits. */
  down(id: string, x: number, y: number): boolean {
    if (this.section.on && this.sectionWidget.visible) {
      this.raycaster.setFromCamera(this.ndc(x, y), this.camera)
      if (this.raycaster.intersectObject(this.sectionWidget.children[0], false).length) {
        this.grips.set(id, { kind: "section", lastX: x, lastY: y })
        return true
      }
    }
    const axis = this.pickGizmo(x, y)
    const target = this.activeTarget()
    if (axis !== null && target) {
      this.grips.set(id, { kind: "axis", axis, target, lastX: x, lastY: y })
      return true
    }
    const item = this.pick(x, y)
    if (item) {
      const height = item.bounds.getCenter(new THREE.Vector3()).y
      this.grips.set(id, {
        kind: "item",
        item,
        lastX: x,
        lastY: y,
        vx: 0,
        speedX: 0,
        speedY: 0,
        lastT: performance.now(),
        height,
        lastHit: this.floorHit(x, y, height),
        rawX: item.root.position.x,
        rawZ: item.root.position.z,
      })
      this.focus(item)
    } else {
      this.grips.set(id, { kind: "orbit", lastX: x, lastY: y })
    }
    this.checkTwoHand()
    return true
  }

  move(id: string, x: number, y: number) {
    const grip = this.grips.get(id)
    if (!grip) return
    if (this.twoHand && (this.twoHand.a === id || this.twoHand.b === id)) {
      this.applyTwoHand(id, x, y)
      grip.lastX = x
      grip.lastY = y
      return
    }
    if (grip.kind === "section") {
      this.dragSection(x - grip.lastX, y - grip.lastY)
      grip.lastX = x
      grip.lastY = y
      return
    }
    if (grip.kind === "axis") {
      const mm = this.dragAlong(grip.target, grip.axis, x - grip.lastX, y - grip.lastY)
      if (mm) grip.target.onDrag(grip.axis, mm)
    } else if (grip.kind === "rotate") {
      grip.yaw += (x - grip.lastX) * ROTATE_RATE
      grip.tilt = THREE.MathUtils.clamp(grip.tilt + (y - grip.lastY) * ROTATE_RATE, -Math.PI / 2, Math.PI / 2)
      const step = (angle: number) => (this.snap ? Math.round(angle / SNAP_ANGLE) * SNAP_ANGLE : angle)
      grip.item.model.rotation.y = step(grip.yaw)
      grip.item.model.rotation.x = step(grip.tilt)
    } else if (grip.kind === "item") {
      // Tabletop drag: a held item slides across a horizontal plane at its
      // own height, so pointer up the screen pushes it back and down pulls
      // it forward - hand or mouse alike. Depth used to come from the
      // hand's apparent size, which meant reaching toward the webcam to
      // push something away, with the hand growing, speeding up and
      // leaving the frame as it went.
      const hit = this.floorHit(x, y, grip.height)
      if (hit && grip.lastHit) {
        grip.rawX += hit.x - grip.lastHit.x
        grip.rawZ += hit.z - grip.lastHit.z
        const reach = Math.hypot(grip.rawX, grip.rawZ)
        if (reach > STAGE_RADIUS) {
          grip.rawX *= STAGE_RADIUS / reach
          grip.rawZ *= STAGE_RADIUS / reach
        }
        const position = grip.item.root.position
        position.x = this.snap ? Math.round(grip.rawX / SNAP_GRID) * SNAP_GRID : grip.rawX
        position.z = this.snap ? Math.round(grip.rawZ / SNAP_GRID) * SNAP_GRID : grip.rawZ
      }
      if (hit) grip.lastHit = hit
      const armed = !!this.callbacks.binAt?.(x, y)
      if (armed !== grip.item.armed) {
        grip.item.armed = armed
        this.callbacks.onBin?.(armed ? "armed" : "idle")
      }
      grip.vx = grip.vx * 0.6 + (x - grip.lastX) * 0.4
      const now = performance.now()
      const span = Math.max(1, now - grip.lastT) / 1000
      grip.speedX = grip.speedX * 0.5 + ((x - grip.lastX) / span) * 0.5
      grip.speedY = grip.speedY * 0.5 + ((y - grip.lastY) / span) * 0.5
      grip.lastT = now
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
    if (grip?.kind === "axis") {
      grip.target.onEnd()
      return
    }
    if (!grip || grip.kind !== "item") return
    if (grip.item.armed || this.flickedAtBin(grip, _x, _y)) {
      this.discard(grip.item)
      return
    }
    if (tap) {
      if (this.callbacks.onTap?.(grip.item.id, id)) return
      grip.item.mode = grip.item.mode === "wire" ? "solid" : "wire"
      sfx.select()
      this.focus(grip.item)
      this.emitItems()
    } else if (this.snap) {
      // Snapping places, it does not throw.
      this.snapToNeighbours(grip.item)
    } else {
      // Thrown: the release speed becomes spin, then friction takes over.
      grip.item.spin += grip.vx * 0.06
    }
  }

  /** Let go moving fast, straight at the bin: thrown away. */
  private flickedAtBin(grip: { speedX: number; speedY: number; lastT: number }, x: number, y: number): boolean {
    const bin = this.callbacks.binCentre?.()
    // A pause before letting go is a set-down, not a throw.
    if (!bin || performance.now() - grip.lastT > 120) return false
    const speed = Math.hypot(grip.speedX, grip.speedY)
    if (speed < FLICK_SPEED) return false
    const toBin = Math.hypot(bin.x - x, bin.y - y) || 1
    const aim = (grip.speedX * (bin.x - x) + grip.speedY * (bin.y - y)) / (speed * toBin)
    return aim > FLICK_AIM
  }

  /** Start rotating the part under (x, y), or the selected one. False if
   *  there is neither. */
  beginRotate(id: string, x: number, y: number): boolean {
    const item = this.pick(x, y) ?? this.focused
    if (!item || item.dying !== null) return false
    item.posed = true
    item.spin = 0
    this.grips.set(id, { kind: "rotate", item, lastX: x, lastY: y, yaw: item.model.rotation.y, tilt: item.model.rotation.x })
    this.focus(item)
    return true
  }

  /** Start orbiting the camera, whatever is under the pointer. */
  beginOrbit(id: string, x: number, y: number) {
    this.grips.set(id, { kind: "orbit", lastX: x, lastY: y })
  }

  /** Exploded view on or off (toggled when `on` is left out). Returns the
   *  new state and how many items have parts to spread. */
  setExploded(on = !this.exploded): { exploded: boolean; explodable: number } {
    if (on !== this.exploded) sfx.explode(on)
    this.exploded = on
    return { exploded: on, explodable: this.live().filter((item) => item.parts.length > 1).length }
  }

  setSnap(on = !this.snap): boolean {
    this.snap = on
    return on
  }

  resetView() {
    this.azimuth = VIEW.azimuth
    this.elevation = VIEW.elevation
    this.radius = VIEW.radius
  }

  hover(x: number | null, y: number | null) {
    this.hovered = x === null || y === null ? null : this.pick(x, y)
    // Which part, for its callout: a ray against the item's own meshes,
    // no more than twenty times a second.
    if (!this.hovered || x === null || y === null) {
      this.hoverPart = null
      return
    }
    const now = performance.now()
    if (now - this.lastPartPick < 50) return
    this.lastPartPick = now
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera)
    const was = this.hoverPart
    this.hoverPart = null
    hits: for (const hit of this.raycaster.intersectObjects(this.hovered.solids, false)) {
      for (let node: THREE.Object3D | null = hit.object; node && node !== this.hovered.model; node = node.parent) {
        if (node.userData.callout) {
          this.hoverPart = node
          break hits
        }
      }
    }
    if (this.hoverPart && this.hoverPart !== was) sfx.hover()
  }

  // --- cross-section ---------------------------------------------------------

  /** Set the section plane (on the focused item, or the last). `onMove`
   *  hears the offset as the plane is dragged on the stage. */
  setSection(state: SectionState, onMove?: (offset: number) => void) {
    if (onMove) this.onSectionMove = onMove
    const target = state.on ? (this.sectionItem && this.items.includes(this.sectionItem) ? this.sectionItem : (this.focused ?? this.live().slice(-1)[0] ?? null)) : null
    if (target !== this.sectionItem) {
      if (this.sectionItem) this.cutItem(this.sectionItem, false)
      if (target) this.cutItem(target, true)
      this.sectionItem = target
    }
    this.section = { ...state }
  }

  /** Put an item under the section (caps on its solids) or take it out. */
  private cutItem(item: Item, on: boolean) {
    for (const unit of item.units) {
      for (const mesh of unit.solids) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          material.clippingPlanes = on ? [unit.clip, this.sectionPlane] : [unit.clip]
        }
        // The cut face: the inside of the solid, seen through the cut, in
        // a colour of its own - so a section reads as solid material.
        const cap = mesh.children.find((c) => c.userData.cap) as THREE.Mesh | undefined
        if (on && !cap && !(mesh as THREE.InstancedMesh).isInstancedMesh) {
          const material = new THREE.MeshBasicMaterial({ color: SECTION_CAP, side: THREE.BackSide, clippingPlanes: [unit.clip, this.sectionPlane] })
          const face = new THREE.Mesh(mesh.geometry, material)
          face.userData.cap = true
          face.raycast = () => {}
          mesh.add(face)
        } else if (!on && cap) {
          ;(cap.material as THREE.Material).dispose()
          cap.removeFromParent()
        }
      }
      unit.holo.clippingPlanes = on ? [unit.ghostClip, this.sectionPlane] : [unit.ghostClip]
      unit.wire.clippingPlanes = on ? [this.sectionPlane] : []
    }
  }

  private buildSectionWidget(): THREE.Group {
    const group = new THREE.Group()
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: this.accent, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    )
    const frame = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0), new THREE.Vector3(-0.5, 0.5, 0)]),
      this.accentLine(0.9)
    )
    group.add(pane, frame)
    group.visible = false
    this.post.glow(frame)
    return group
  }

  /** Move the plane by a pointer drag: along its normal as it shows on screen. */
  private dragSection(dx: number, dy: number) {
    const item = this.sectionItem
    if (!item) return
    const axis = STAGE_AXIS[this.section.axis]
    const span = Math.abs(new THREE.Vector3().subVectors(item.bounds.max, item.bounds.min).dot(axis)) || 1
    const centre = this.sectionWidget.position.clone()
    const a = centre.clone().project(this.camera)
    const b = centre.clone().addScaledVector(axis, span).project(this.camera)
    const rect = this.renderer.domElement.getBoundingClientRect()
    const sx = ((b.x - a.x) * rect.width) / 2
    const sy = (-(b.y - a.y) * rect.height) / 2
    const length2 = sx * sx + sy * sy
    if (length2 < 1) return
    this.section.offset = THREE.MathUtils.clamp(this.section.offset + (dx * sx + dy * sy) / length2, 0, 1)
    this.onSectionMove?.(this.section.offset)
  }

  /** The plane and its widget, through the item as it stands now. */
  private placeSection() {
    // The item it cut was rebuilt or removed: cut whatever is there now.
    if (this.section.on && !this.sectionItem) this.setSection(this.section)
    const item = this.sectionItem
    this.sectionWidget.visible = !!(this.section.on && item)
    if (!this.section.on || !item) return
    const axis = STAGE_AXIS[this.section.axis]
    const { min, max } = item.bounds
    const along = (v: THREE.Vector3) => v.dot(axis)
    const lo = Math.min(along(min), along(max))
    const hi = Math.max(along(min), along(max))
    const cut = lo + (hi - lo) * this.section.offset
    // Keep the side below the cut (above, flipped).
    const normal = axis.clone().multiplyScalar(this.section.flip ? 1 : -1)
    this.sectionPlane.normal.copy(normal)
    this.sectionPlane.constant = this.section.flip ? -cut : cut
    const centre = item.bounds.getCenter(new THREE.Vector3())
    centre.addScaledVector(axis, cut - along(centre))
    this.sectionWidget.position.copy(centre)
    this.sectionWidget.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis)
    const size = item.bounds.getSize(new THREE.Vector3())
    const across = [size.x, size.y, size.z].sort((p, q) => q - p)
    this.sectionWidget.scale.set(across[0] * 1.15, across[1] * 1.15, 1)
  }

  // --- fit check ---------------------------------------------------------------

  /** Check the focused design (a project's assembly) for parts running
   *  into each other; clashes are lit red until cleared. */
  async checkFit(): Promise<{ checked: boolean; clashes: { a: string; b: string; depth: number; count: number }[] }> {
    this.clearFit()
    const item = this.focused ?? this.live().slice(-1)[0]
    let frame: THREE.Object3D | null = null
    item?.model.traverse((node) => node.userData.designFrame && !frame && (frame = node))
    if (!item || !frame) return { checked: false, clashes: [] }
    const parts: THREE.Object3D[] = []
    ;(frame as THREE.Object3D).traverse((node) => node.userData.callout && parts.push(node))
    this.clashes = await findInterference(parts, frame)
    for (const clash of this.clashes) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(1.5, Math.min(6, clash.depth)), 16, 12),
        new THREE.MeshBasicMaterial({ color: CLASH_COLOR, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthTest: false })
      )
      marker.position.copy(clash.at)
      marker.renderOrder = 5
      ;(frame as THREE.Object3D).add(marker)
      this.clashMarkers.add(marker)
      this.post.glow(marker)
    }
    // The same two kinds of part clashing again (ten resistors in a row)
    // read as one line, with how many and the worst depth.
    const name = (node: THREE.Object3D) => (node.userData.callout?.title as string) ?? node.name
    const grouped = new Map<string, { a: string; b: string; depth: number; count: number }>()
    for (const clash of this.clashes) {
      const [a, b] = [name(clash.a), name(clash.b)]
      const key = [a, b].sort().join("|")
      const line = grouped.get(key)
      if (line) {
        line.count += 1
        line.depth = Math.max(line.depth, clash.depth)
      } else grouped.set(key, { a, b, depth: clash.depth, count: 1 })
    }
    return { checked: true, clashes: [...grouped.values()].sort((x, y) => y.depth - x.depth) }
  }

  clearFit() {
    for (const clash of this.clashes) {
      for (const node of [clash.a, clash.b]) {
        node.traverse((child) => {
          const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
          if (!material?.emissive || material.userData.emissiveWas === undefined) return
          material.emissive.setHex(material.userData.emissiveWas)
          material.emissiveIntensity = material.userData.emissiveIntensityWas
          delete material.userData.emissiveWas
        })
      }
    }
    for (const marker of [...this.clashMarkers.children]) {
      this.post.glow(marker, false)
      ;(marker as THREE.Mesh).geometry.dispose()
      ;((marker as THREE.Mesh).material as THREE.Material).dispose()
      marker.removeFromParent()
    }
    this.clashMarkers.clear()
    this.clashes = []
  }

  /** Clashing parts glow red, pulsing. */
  private showClashes(t: number) {
    const level = 0.45 + 0.35 * Math.sin(t * 5)
    for (const clash of this.clashes) {
      for (const node of [clash.a, clash.b]) {
        node.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh.isMesh || child.userData.ghost || child.userData.cap) return
          for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
            if (!material.emissive) continue
            if (material.userData.emissiveWas === undefined) {
              material.userData.emissiveWas = material.emissive.getHex()
              material.userData.emissiveIntensityWas = material.emissiveIntensity
            }
            material.emissive.copy(CLASH_COLOR)
            material.emissiveIntensity = level
          }
        })
      }
    }
    for (const marker of this.clashMarkers.children) marker.scale.setScalar(0.8 + 0.4 * level)
  }

  /** How a part's cost and source are found (the project's BOM). */
  setCalloutCost(lookup: CostLookup) {
    this.callouts.setCost(lookup)
  }

  private discard(item: Item) {
    sfx.discard()
    item.armed = false
    item.dying = this.clock.elapsedTime
    for (const [id, grip] of this.grips) if ((grip.kind === "item" || grip.kind === "rotate") && grip.item === item) this.grips.delete(id)
    if (this.twoHand?.item === item) this.twoHand = null
    if (this.focused === item) this.focus(null)
    if (this.hovered === item) this.hovered = null
    this.callbacks.onBin?.("discarded")
    this.emitItems()
  }

  /** The parts an exploded view spreads: the children of the first level
   *  of the model with more than one (catalogue models wrap everything in
   *  one group), each pushed out along the line from the centre to it. */
  private explodeParts(object: THREE.Object3D): Item["parts"] {
    const isPart = (node: THREE.Object3D) =>
      !(node as THREE.Light).isLight && !node.userData.holoLines && !node.userData.cables && !node.userData.helper && ((node as THREE.Mesh).isMesh || (node as THREE.Group).isGroup)
    let level = object
    for (let depth = 0; depth < 4; depth += 1) {
      const children = level.children.filter(isPart)
      if (children.length !== 1) break
      level = children[0]
    }
    const children = level.children.filter(isPart)
    if (children.length < 2) return []
    object.updateMatrixWorld(true)
    // The base - the biggest part - stays put, and the rest come away from
    // it by a reach in proportion to it: a controller mounted far off on
    // the arm should not push the centre into the air or the reach to
    // half a metre.
    const boxes = new Map(children.map((node) => [node, new THREE.Box3().setFromObject(node)]))
    const volume = (b: THREE.Box3) => {
      const v = b.getSize(new THREE.Vector3())
      return v.x * v.y * v.z
    }
    const base = children.reduce((best, node) => (volume(boxes.get(node)!) > volume(boxes.get(best)!) ? node : best), children[0])
    const baseBox = boxes.get(base)!
    const size = baseBox.getSize(new THREE.Vector3()).length() || new THREE.Box3().setFromObject(level).getSize(new THREE.Vector3()).length() || 1
    const centre = level.worldToLocal(baseBox.getCenter(new THREE.Vector3()))
    // Local units: the level may be scaled, so the spread is converted too.
    const scale = level.getWorldScale(new THREE.Vector3()).x || 1
    // Up, in the level's own frame (z for a project's assembly, y else).
    const upLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(level.getWorldQuaternion(new THREE.Quaternion()).invert())
    const upIndex = [0, 1, 2].reduce((best, k) => (Math.abs(upLocal.getComponent(k)) > Math.abs(upLocal.getComponent(best)) ? k : best), 0)
    const upSign = Math.sign(upLocal.getComponent(upIndex)) || 1
    // Along the assembly's own axes: each part goes out along whichever of
    // its axes it already sits furthest along, so a stack comes apart as a
    // stack and a row as a row; one at the very centre goes up.
    const lanes = new Map<string, { node: THREE.Object3D; along: number; axis: THREE.Vector3 }[]>()
    for (const node of children) {
      if (node === base) continue
      const d = level.worldToLocal(boxes.get(node)!.getCenter(new THREE.Vector3())).sub(centre)
      let k = [0, 1, 2].reduce((best, i) => (Math.abs(d.getComponent(i)) > Math.abs(d.getComponent(best)) ? i : best), 0)
      let sign = Math.sign(d.getComponent(k))
      if (d.lengthSq() < 1e-6 || !sign) {
        k = upIndex
        sign = upSign
      }
      // Never down through the floor: what sits low is the base. It goes
      // out sideways if it is off to one side, else it stays where it is.
      if (k === upIndex && sign !== upSign) {
        const across = [0, 1, 2].filter((i) => i !== upIndex)
        const side = across.reduce((best, i) => (Math.abs(d.getComponent(i)) > Math.abs(d.getComponent(best)) ? i : best), across[0])
        if (Math.abs(d.getComponent(side)) < Math.abs(d.getComponent(k)) * 0.25) continue
        k = side
        sign = Math.sign(d.getComponent(side))
      }
      const key = `${k}${sign}`
      if (!lanes.has(key)) lanes.set(key, [])
      lanes.get(key)!.push({ node, along: Math.abs(d.getComponent(k)), axis: new THREE.Vector3().setComponent(k, sign) })
    }
    // Further out goes further: each lane layered by how far out it sits,
    // so parts in the same direction do not land on one another.
    const reach = (size * EXPLODE_SPREAD) / scale
    const out: { node: THREE.Object3D; base: THREE.Vector3; offset: THREE.Vector3; rank: number }[] = []
    for (const lane of lanes.values()) {
      lane.sort((a, b) => a.along - b.along)
      lane.forEach((p, i) =>
        out.push({ node: p.node, base: p.node.position.clone(), offset: p.axis.multiplyScalar(reach * (0.45 + (0.75 * (i + 1)) / lane.length)), rank: p.along })
      )
    }
    // The outermost leaves first, a beat ahead of the next.
    out.sort((a, b) => b.rank - a.rank)
    const beat = Math.min(0.07, EXPLODE_STAGGER / Math.max(1, out.length))
    return out.map(({ node, base, offset }, i) => ({ node, base, offset, delay: i * beat }))
  }

  /** Set down within SNAP_FACE of another item's side: pulled flush to it,
   *  and lined up with it when nearly lined up already. */
  private snapToNeighbours(item: Item) {
    item.bounds.setFromObject(item.model)
    const a = item.bounds
    let best: { axis: "x" | "z"; shift: number; other: THREE.Box3 } | null = null
    for (const other of this.live()) {
      if (other === item) continue
      const b = other.bounds
      const overlapX = a.min.x < b.max.x && a.max.x > b.min.x
      const overlapZ = a.min.z < b.max.z && a.max.z > b.min.z
      const options: { axis: "x" | "z"; shift: number }[] = []
      if (overlapZ) options.push({ axis: "x", shift: b.min.x - a.max.x }, { axis: "x", shift: b.max.x - a.min.x })
      if (overlapX) options.push({ axis: "z", shift: b.min.z - a.max.z }, { axis: "z", shift: b.max.z - a.min.z })
      for (const option of options) {
        if (Math.abs(option.shift) < SNAP_FACE && (!best || Math.abs(option.shift) < Math.abs(best.shift))) {
          best = { ...option, other: b }
        }
      }
    }
    if (!best) return
    item.root.position[best.axis] += best.shift
    // Flush on one axis; centred on the other if it nearly is.
    const across = best.axis === "x" ? "z" : "x"
    const gap = (best.other.min[across] + best.other.max[across]) / 2 - (a.min[across] + a.max[across]) / 2
    if (Math.abs(gap) < SNAP_FACE) item.root.position[across] += gap
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
      // A hand the tracker does not trust right now is drawn faint: seen, not acting.
      ;(rig.bones.material as THREE.LineBasicMaterial).opacity = (pointer.pinching ? 1 : 0.7) * (pointer.active ? 1 : 0.3)
    })
  }

  zoom(factor: number) {
    this.radius = THREE.MathUtils.clamp(this.radius * factor, 3.5, 18)
  }

  toggle(id: string) {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    item.mode = item.mode === "wire" ? "solid" : "wire"
    this.focus(item)
    this.emitItems()
  }

  dispose() {
    this.rafView.cancelAnimationFrame(this.raf)
    this.observer.disconnect()
    this.clear()
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | undefined
      material?.dispose?.()
    })
    this.roomEnv.dispose()
    this.contact.dispose()
    this.unsubscribeVisuals()
    this.callouts.dispose()
    this.post.dispose()
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
    this.post.glow(joints)
    this.post.glow(bones)
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

    // A faint grid fading out from the middle (off unless asked for: the
    // pad's rings are the stage's floor marking).
    const grid = radialGrid(accentHex())
    grid.visible = false
    this.scene.add(grid)
    this.floorGrid = grid

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
    this.view = { width, height }
    this.renderer.setSize(width, height, false)
    this.post.setSize(width, height)
    this.callouts.setSize(width, height)
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

  /** Where the pointer's ray meets the horizontal plane y = height, if it
   *  does in front of the camera and within reach (a ray grazing the plane
   *  near the horizon would fling the item to infinity). */
  private floorHit(x: number, y: number, height: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera)
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), new THREE.Vector3())
    if (!hit || Math.hypot(hit.x, hit.z) > STAGE_RADIUS * 1.5) return null
    return hit
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
    if (this.sectionItem === item) this.sectionItem = null
    if (this.clashes.some((c) => item.model.getObjectById(c.a.id))) this.clearFit()
    this.scene.remove(item.root)
    item.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
      // One material or several (the genuine UNO board's face and edge).
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of materials) if (m && !item.units.some((u) => u.wire === m || u.holo === m)) m.dispose()
    })
    for (const unit of item.units) {
      unit.wire.dispose()
      unit.holo.dispose()
      this.accentMaterials.splice(this.accentMaterials.indexOf(unit.wire), 1)
    }
    item.glowing.forEach((node) => this.post.glow(node, false))
  }

  private frame = () => {
    this.schedule()
    this.renderer.info.reset()
    const dt = Math.min(this.clock.getDelta(), 0.05)
    const t = this.clock.elapsedTime
    const holoOn = visuals().holoShader

    // Accent follows the console's mode.
    this.accentTimer -= dt
    if (this.accentTimer <= 0) {
      this.accentTimer = 0.25
      const hex = accentHex()
      this.accent = hex
      this.accentMaterials.forEach((m) => m.color.setHex(hex))
      ;((this.floorGrid.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setHex(hex)
      this.callouts.setColor(hex)
      this.rim.color.setHex(hex)
    }

    this.floorRings.rotation.y += dt * 0.05

    const fx = visuals()
    this.floorGrid.visible = fx.grid
    this.atmosphere.group.visible = fx.atmosphere
    if (fx.atmosphere) this.atmosphere.update(t, this.accent)
    const environment = fx.hdri && this.studioEnv ? this.studioEnv : this.roomEnv
    if (this.scene.environment !== environment) {
      this.scene.environment = environment
      this.scene.environmentIntensity = environment === this.roomEnv ? 0.55 : 0.85
    }
    this.contact.group.visible = fx.contactShadows

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
        const constant = item.bounds.min.y - 1 + (item.bounds.max.y - item.bounds.min.y + 2) * item.solidity
        for (const unit of item.units) {
          unit.clip.constant = constant
          unit.ghostClip.constant = -constant
          unit.wire.color.setHex(ARMED_COLOR)
          unit.wire.opacity = 1 - p * 0.6
          ;(unit.holo.uniforms.uColor.value as THREE.Color).setHex(ARMED_COLOR)
          unit.holo.uniforms.uOpacity.value = 1 - p
        }
        continue
      }

      const age = t - item.born
      // Spawn: grows in over half a second with an overshoot.
      const grow = Math.min(1, age / 0.5)
      const pop = grow < 1 ? 1 - Math.pow(1 - grow, 3) * Math.cos(grow * 6) : 1
      const target = item.scale * pop * (item === this.hovered && !held.has(item) ? 1.04 : 1)
      item.root.scale.lerp(new THREE.Vector3(target, target, target), Math.min(1, dt * 10))

      // Spin decays toward a slow idle turn; held items stop turning.
      if (held.has(item)) item.spin *= 0.8
      else item.spin += ((item.posed || this.exploded ? 0 : BASE_SPIN) - item.spin) * Math.min(1, dt * 0.6)
      item.model.rotation.y += item.spin * dt
      item.model.position.y = (item.model.userData.baseY ??= item.model.position.y) + Math.sin(t * 1.3 + item.born) * 0.05

      // Hologram <-> materials: one scan up the whole item - or, while a
      // new design materializes, each unit on its turn: its edges drawn
      // in, then its own scan.
      const goal = item.mode === "solid" ? 1 : 0
      // The whole-item scan waits while the units materialize on their own.
      if (item.materializing === null) item.solidity += (goal - item.solidity) * Math.min(1, dt * 1.6)
      if (Math.abs(item.solidity - goal) < 0.002) item.solidity = goal
      item.bounds.setFromObject(item.model)
      const { min, max } = item.bounds
      let cut = min.y + (max.y - min.y) * item.solidity
      let scanning = item.solidity > 0.01 && item.solidity < 0.99
      let ringBox = item.bounds
      if (item.materializing !== null) {
        if (item.materializing === 0) sfx.materialize()
        const before = item.materializing
        item.materializing += dt
        const since = item.materializing
        item.units.forEach((unit, i) => {
          if (before <= unit.delay && since > unit.delay && i % 2 === 0) sfx.sparkle(Math.round(unit.delay / 0.16))
        })
        let done = true
        scanning = false
        for (const unit of item.units) {
          unit.reveal = THREE.MathUtils.clamp((since - unit.delay) / MATERIALIZE_DRAW, 0, 1)
          const scan = THREE.MathUtils.clamp((since - unit.delay - MATERIALIZE_DRAW * 0.6) / MATERIALIZE_SCAN, 0, 1)
          unit.solidity = goal * easeInOut(scan)
          if (unit.reveal < 1 || unit.solidity < goal) done = false
          if (unit.solidity > 0 && unit.solidity < 1) {
            unit.bounds.setFromObject(unit.root)
            unit.clip.constant = unit.bounds.min.y + (unit.bounds.max.y - unit.bounds.min.y) * unit.solidity
            scanning = true
            cut = unit.clip.constant
            ringBox = unit.bounds
          } else unit.clip.constant = unit.solidity >= 1 ? 1e6 : -1e6
        }
        if (done) {
          item.materializing = null
          item.solidity = goal
        }
      } else {
        const constant = item.solidity >= 1 ? 1e6 : item.solidity <= 0 ? -1e6 : cut
        for (const unit of item.units) {
          unit.reveal = 1
          unit.solidity = item.solidity
          unit.clip.constant = constant
        }
      }
      const lit = item === this.hovered || held.has(item) || item === this.focused
      const color = item.armed ? ARMED_COLOR : this.accent
      const flicker = 0.92 + Math.sin(t * 20) * 0.04
      for (const unit of item.units) {
        // The ghosts keep the other side of the same cut.
        unit.ghostClip.constant = -unit.clip.constant
        const hologram = 1 - unit.solidity
        for (const ghost of unit.ghosts) ghost.visible = holoOn && hologram > 0.001 && unit.reveal > 0
        unit.wire.color.setHex(color)
        unit.wire.opacity = (0.1 + hologram * 0.55) * (lit ? 1.25 : 1) * flicker * unit.reveal
        ;(unit.holo.uniforms.uColor.value as THREE.Color).setHex(color)
        unit.holo.uniforms.uOpacity.value = (lit ? 1.3 : 1) * unit.reveal
      }
      for (const mesh of item.solids) mesh.visible = true
      for (const lines of item.contours) lines.visible = 1 - item.solidity > 0.05
      for (const light of item.lights) light.intensity = (light.userData.intensity as number) * (0.25 + item.solidity * 0.75)

      // The scan ring sits at the cut while it is moving (the unit's own,
      // sized to it, while materializing).
      const ringMaterial = item.scanRing.material as THREE.LineBasicMaterial
      ringMaterial.opacity += ((scanning ? 1 : 0) - ringMaterial.opacity) * Math.min(1, dt * 8)
      const span = Math.max(ringBox.max.x - ringBox.min.x, ringBox.max.z - ringBox.min.z) / item.root.scale.x
      item.scanRing.scale.setScalar(span * 0.62)
      item.scanRing.position.y = (cut - item.root.position.y) / item.root.scale.y
    }

    // Exploded view: each part eased out along its axis on its own beat,
    // the outermost first; coming back together runs the same in reverse.
    const explodeTarget = this.exploded ? 1 + EXPLODE_STAGGER : 0
    if (this.explodeT !== explodeTarget) {
      const step = dt / EXPLODE_SECONDS
      this.explodeT = explodeTarget > this.explodeT ? Math.min(explodeTarget, this.explodeT + step) : Math.max(explodeTarget, this.explodeT - step)
      for (const item of this.items) {
        for (const part of item.parts) {
          const p = easeInOut(THREE.MathUtils.clamp(this.explodeT - part.delay, 0, 1))
          part.node.position.copy(part.base).addScaledVector(part.offset, p)
        }
        // Cables run between parts that are flying apart: hide them meanwhile.
        item.model.traverse((node) => {
          if (node.userData.cables) node.visible = this.explodeT < 0.02
        })
      }
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
      const rect = this.view
      // Kept wholly on the stage: a tall item's top would push it off.
      // Its size is read when its text changes, not every frame (layout).
      const key = `${this.focused.id}|${this.focused.mode}|${this.label.textContent?.length ?? 0}`
      if (this.labelSize.for !== key || !this.labelSize.w) this.labelSize = { for: key, w: this.label.offsetWidth, h: this.label.offsetHeight }
      const { w, h } = this.labelSize
      const lx = THREE.MathUtils.clamp((top.x * 0.5 + 0.5) * rect.width, w / 2 + 8, Math.max(w / 2 + 8, rect.width - w / 2 - 8))
      const ly = THREE.MathUtils.clamp((-top.y * 0.5 + 0.5) * rect.height, h + 8, Math.max(h + 8, rect.height - 8))
      this.label.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -100%)`
      this.label.style.opacity = top.z < 1 ? "1" : "0"
    } else {
      this.label.style.opacity = "0"
    }

    this.placeGizmo()
    this.placeSection()
    if (this.clashes.length) this.showClashes(t)
    // Contact shadows from whatever stands solid now (holograms cast none),
    // every third frame: a soft blur moving slowly does not show it.
    this.frameNo += 1
    if (fx.contactShadows && this.frameNo % 3 === 0) {
      for (const item of this.items) {
        const casts = item.dying === null && item.solidity > 0.5
        for (const mesh of item.solids) {
          if (casts) mesh.layers.enable(CASTER_LAYER)
          else mesh.layers.disable(CASTER_LAYER)
        }
      }
    }
    // With contact shadows grounding the small parts, only the printed
    // parts (big surfaces that shade each other) render into the key
    // light's shadow map; without them, everything that did still does.
    if (this.frameNo % 30 === 0) {
      for (const item of this.items) {
        for (const mesh of item.solids) {
          mesh.userData.castsShadow ??= mesh.castShadow
          mesh.castShadow = fx.contactShadows ? !!mesh.userData.printPart && mesh.userData.castsShadow : mesh.userData.castsShadow
        }
      }
      this.contact.update(this.renderer, this.scene)
    }
    this.post.draw(dt)
    // Callouts: every part while exploded, else the one under the pointer
    // (with its dimensions when it is printed).
    const tagged: THREE.Object3D[] = []
    let dimension: THREE.Object3D | null = null
    if (fx.callouts) {
      if (this.explodeT > 0.5) {
        for (const item of this.live()) {
          item.labelled ??= []
          if (!item.labelled.length) item.model.traverse((node) => node.userData.callout && item.labelled!.push(node))
          for (const node of item.labelled) if (tagged.length < 30) tagged.push(node)
        }
      } else if (this.hoverPart && this.hoverPart.parent) {
        tagged.push(this.hoverPart)
        if (this.hoverPart.userData.callout.printed) dimension = this.hoverPart
      }
    }
    const around = (this.focused ?? this.hovered)?.bounds.getCenter(new THREE.Vector3()) ?? TARGET
    // The panels over the stage (marked data-keepout) are taken space,
    // looked up four times a second rather than every frame (layout).
    if (tagged.length && t - this.keepOutAt > 0.25) {
      this.keepOutAt = t
      const stage = this.container.getBoundingClientRect()
      this.keepOut = [...(this.container.parentElement?.querySelectorAll<HTMLElement>("[data-keepout]") ?? [])]
        .filter((el) => el.offsetParent !== null && getComputedStyle(el).opacity !== "0")
        .map((el) => {
          const r = el.getBoundingClientRect()
          return { x0: r.left - stage.left, y0: r.top - stage.top, x1: r.right - stage.left, y1: r.bottom - stage.top }
        })
    }
    this.callouts.update(tagged, around, dimension, this.camera, tagged.length ? this.keepOut : [])
    this.callouts.render(this.camera)
    this.sample(dt)
  }

  // Development only: frame rate and draw cost, for profiling the stage
  // (read from the console or a test as window.__workshopStats).
  private stats = { frames: 0, time: 0 }
  private sample(dt: number) {
    if (process.env.NODE_ENV === "production") return
    this.stats.frames += 1
    this.stats.time += dt
    if (this.stats.time < 1) return
    const info = this.renderer.info
    ;(this.rafView as Window & { __workshopScene?: THREE.Scene }).__workshopScene = this.scene
    ;(this.rafView as Window & { __workshopItems?: Item[] }).__workshopItems = this.items
    ;(this.rafView as Window & { __workshopStats?: object }).__workshopStats = {
      fps: Math.round(this.stats.frames / this.stats.time),
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    }
    this.stats = { frames: 0, time: 0 }
  }
}
