import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import { libraryPins } from "@/lib/workshop/project/library"
import { real } from "@/lib/workshop/project/materials"
import { PARTS, type Part, type Wire } from "@/lib/workshop/project/types"
import { visuals } from "@/lib/workshop/visuals"

// A project's wiring as real cables: each wire in its list runs from the
// actual pin on one part to the actual pin on the other - the UNO's header
// sockets where the R3 board has them, an LED's legs, a servo's lead out
// of its case - as 22 AWG PVC hook-up wire in its insulation colour,
// sagging between its ends, with a DuPont plug where it meets a header
// pin or a leg (and none where it is the part's own lead, as a motor's or
// a battery pack's are). Millimetres, z up, in each part's own frame
// (components3d.ts builds the parts to match).

/** Where a pin is on its part, which way a wire leaves it, and how it joins. */
export interface PinAnchor {
  pos: [number, number, number]
  dir: [number, number, number]
  /** dupont: a plug on a pin; lead: the part's own wire, soldered on. */
  end: "dupont" | "lead"
  /** Where the leg leaves the body (library models): a wire whose tip is
   *  buried in whatever the part sits on is soldered here instead. */
  root?: [number, number, number]
}

const PITCH = 2.54
/** The UNO's female headers stand 8.5 mm on a 1.6 mm board. */
const UNO_TOP = 1.6 + 8.5

/** UNO R3 header sockets, mm from the board's lower-left corner (USB and
 *  barrel jack on the left edge, the digital header along the top). */
const UNO_R3: Record<string, [number, number]> = (() => {
  const pins: Record<string, [number, number]> = {}
  for (let i = 0; i <= 7; i += 1) pins[`D${i}`] = [63.5 - i * PITCH, 50.8]
  for (let i = 8; i <= 13; i += 1) pins[`D${i}`] = [41.66 - (i - 8) * PITCH, 50.8]
  pins.GND_TOP = [26.42, 50.8]
  pins.AREF = [23.88, 50.8]
  pins.IOREF = [30.48, 2.54]
  pins.RESET = [33.02, 2.54]
  pins["3V3"] = [35.56, 2.54]
  pins["5V"] = [38.1, 2.54]
  pins.GND = [40.64, 2.54]
  pins.GND_2 = [43.18, 2.54]
  pins.VIN = [45.72, 2.54]
  for (let i = 0; i <= 5; i += 1) pins[`A${i}`] = [50.8 + i * PITCH, 2.54]
  return pins
})()

/** A header socket on the UNO, centred on the board like its model. */
export function unoSocket(name: string): [number, number, number] {
  const [x, y] = UNO_R3[name]
  return [x - 34.3, y - 26.7, UNO_TOP]
}

const row = (names: string[], at: (i: number) => [number, number, number], dir: [number, number, number], end: PinAnchor["end"] = "dupont") =>
  Object.fromEntries(names.map((n, i) => [n, { pos: at(i), dir, end }])) as Record<string, PinAnchor>

const legs = (names: string[], z = 0) => row(names, (i) => [(i - (names.length - 1) / 2) * PITCH, 0, z], [0, 0, -1])

/** Every pin of a part, in its model's frame. */
export function pinAnchors(part: Part): Record<string, PinAnchor> {
  const spec = PARTS[part.type]
  const pins = Object.keys(spec?.pins ?? {})
  // A library model's legs, found on the model itself: a DuPont plug on
  // each tip, the wire leaving the way the leg points.
  const legsOnModel = libraryPins(part.type)
  if (legsOnModel) {
    return Object.fromEntries(
      Object.entries(legsOnModel).map(([name, pin]) => [name, { pos: pin.tip, dir: pin.dir, root: pin.root, end: "dupont" as const }])
    )
  }
  switch (part.type) {
    case "uno": {
      const out: Record<string, PinAnchor> = {}
      for (const name of pins) if (UNO_R3[name]) out[name] = { pos: unoSocket(name), dir: [0, 0, 1], end: "dupont" }
      return out
    }
    case "led":
      return { A: { pos: [1.27, 0, -6], dir: [0, 0, -1], end: "dupont" }, K: { pos: [-1.27, 0, -6], dir: [0, 0, -1], end: "dupont" } }
    case "rgb_led":
      return row(["R", "COM", "G", "B"], (i) => [-1.9 + i * 1.27, 0, -6], [0, 0, -1])
    case "resistor":
      return { 1: { pos: [-5, 0, 1.2], dir: [-1, 0, 0], end: "dupont" }, 2: { pos: [5, 0, 1.2], dir: [1, 0, 0], end: "dupont" } }
    case "diode":
      return { A: { pos: [-3.5, 0, 1.25], dir: [-1, 0, 0], end: "dupont" }, K: { pos: [3.5, 0, 1.25], dir: [1, 0, 0], end: "dupont" } }
    case "servo":
      // Its three-wire lead leaves the case's low end, away from the horn.
      return row(["SIG", "V+", "GND"], (i) => [-11.6, (1 - i) * 0.9, 4], [-1, 0, 0], "lead")
    case "servo_micro":
    case "servo_std": {
      const [x = 22.8] = (spec?.size as number[] | undefined) ?? []
      return row(["SIG", "V+", "GND"], (i) => [-x / 2, (1 - i) * 0.9, 4], [-1, 0, 0], "lead")
    }
    case "fan_5v":
      return { "+": { pos: [15, 15, 4], dir: [1, 0, 0], end: "lead" }, "-": { pos: [15, 13.5, 4], dir: [1, 0, 0], end: "lead" } }
    case "vibe_motor":
      return { "+": { pos: [5, 1, 2], dir: [1, 0, 0], end: "lead" }, "-": { pos: [5, -1, 2], dir: [1, 0, 0], end: "lead" } }
    case "lipo_500":
    case "lipo_1200":
    case "lipo_2500": {
      const [x = 36, , z = 5] = (spec?.size as number[] | undefined) ?? []
      return { "+": { pos: [x / 2 + 4, 1.5, z / 2], dir: [1, 0, 0], end: "lead" }, "-": { pos: [x / 2 + 4, -1.5, z / 2], dir: [1, 0, 0], end: "lead" } }
    }
    case "speaker_thin":
      return { "+": { pos: [6, 1.2, 1], dir: [0, 0, -1], end: "lead" }, "-": { pos: [6, -1.2, 1], dir: [0, 0, -1], end: "lead" } }
    case "speaker":
      return { "+": { pos: [35, 1.2, 4], dir: [1, 0, 0], end: "lead" }, "-": { pos: [35, -1.2, 4], dir: [1, 0, 0], end: "lead" } }
    case "supply_5v4a":
      return { "+": { pos: [47.5, 1, 16], dir: [1, 0, 0], end: "lead" }, "-": { pos: [47.5, -1, 16], dir: [1, 0, 0], end: "lead" } }
    case "pulse_sensor":
      return row(["+", "-", "S"], (i) => [(i - 1) * 1.6, -8, 0.8], [0, -1, 0], "lead")
    case "pir":
      return row(["VCC", "GND", "AL"], (i) => [(i - 1) * 2, -17.7, 0.8], [0, -1, 0], "lead")
    case "esp32": {
      // The D1 R32 keeps the UNO's sockets: its GPIO sit where the UNO's D
      // and A pins are; the few the footprint has no socket for go on a
      // header row inside.
      const out: Record<string, PinAnchor> = {}
      const digital = ["IO3", "IO1", "IO26", "IO25", "IO17", "IO16", "IO27", "IO14", "IO12", "IO13", "IO5", "IO23", "IO19", "IO18"]
      const analog = ["IO2", "IO4", "IO35", "IO34", "IO36", "IO39"]
      for (const name of pins) {
        const di = digital.indexOf(name)
        const ai = analog.indexOf(name)
        const socket = di >= 0 ? `D${di}` : ai >= 0 ? `A${ai}` : ["5V", "3V3", "VIN", "GND"].includes(name) ? name : null
        if (socket && UNO_R3[socket]) out[name] = { pos: unoSocket(socket), dir: [0, 0, 1], end: "dupont" }
      }
      pins.filter((n) => !out[n]).forEach((name, i) => {
        out[name] = { pos: [-10 + i * PITCH, 12, 10], dir: [0, 0, 1], end: "dupont" }
      })
      return out
    }
    case "dc_motor":
      return { "+": { pos: [-12, 3, 9], dir: [-1, 0, 0], end: "lead" }, "-": { pos: [-12, -3, 3], dir: [-1, 0, 0], end: "lead" } }
    case "stepper":
      return row(["A+", "A-", "B+", "B-"], (i) => [21.15, -3.75 + i * 2.5, 6], [1, 0, 0], "lead")
    case "fan":
      return { "+": { pos: [25, 25, 5], dir: [1, 0, 0], end: "lead" }, "-": { pos: [25, 23, 5], dir: [1, 0, 0], end: "lead" } }
    case "battery_6aa":
      return { "+": { pos: [29, 6, 4], dir: [1, 0, 0], end: "lead" }, "-": { pos: [29, -6, 4], dir: [1, 0, 0], end: "lead" } }
    case "supply_9v":
    case "supply_12v":
      return { "+": { pos: [30, 1, 15], dir: [1, 0, 0], end: "lead" }, "-": { pos: [30, -1, 15], dir: [1, 0, 0], end: "lead" } }
    case "ping":
      // The PING)))'s three pins hang below the board: GND, 5V, SIG.
      return row(["GND", "5V", "SIG"], (i) => [(i - 1) * PITCH, -9, -8.5], [0, 0, -1])
    case "pot":
      return row(["1", "W", "2"], (i) => [(i - 1) * 5, -8, 1.5], [0, -1, 0])
    case "button":
      return { 1: { pos: [-3, -3, 0], dir: [0, 0, -1], end: "dupont" }, 2: { pos: [3, 3, 0], dir: [0, 0, -1], end: "dupont" } }
    case "limit_switch":
      // The tab ends below the body (components3d.ts limitSwitch).
      return row(["COM", "NO", "NC"], (i) => [(i - 1) * 6, 0, -4], [0, 0, -1])
    case "relay":
      return { C1: { pos: [-6, -5, 0], dir: [0, 0, -1], end: "dupont" }, C2: { pos: [-6, 5, 0], dir: [0, 0, -1], end: "dupont" }, COM: { pos: [6, -5, 0], dir: [0, 0, -1], end: "dupont" }, NO: { pos: [6, 5, 0], dir: [0, 0, -1], end: "dupont" } }
    case "adxl335":
      return row(["VCC", "X", "Y", "Z", "GND"], (i) => [(i - 2) * PITCH, -8.7, 0], [0, 0, -1])
    case "a4988": {
      const left = row(["EN", "MS1", "MS2", "MS3", "RST", "SLP", "STEP", "DIR"], (i) => [-8.89 + i * PITCH, -6.35, -3], [0, 0, -1])
      const right = row(["VMOT", "GND", "2B", "2A", "1A", "1B", "VDD", "GND2"], (i) => [-8.89 + i * PITCH, 6.35, -3], [0, 0, -1])
      return { ...left, ...right }
    }
    case "l298n":
      return {
        OUT1: { pos: [-21.5, -3, 8], dir: [-1, 0, 0], end: "lead" },
        OUT2: { pos: [-21.5, 3, 8], dir: [-1, 0, 0], end: "lead" },
        OUT3: { pos: [21.5, -3, 8], dir: [1, 0, 0], end: "lead" },
        OUT4: { pos: [21.5, 3, 8], dir: [1, 0, 0], end: "lead" },
        ...row(["12V", "GND", "5V"], (i) => [-17 + i * 5, -19.5, 8], [0, -1, 0], "lead"),
        ...row(["ENA", "IN1", "IN2", "IN3", "IN4", "ENB"], (i) => [6.35 + i * PITCH, -19, 10.1], [0, 0, 1]),
      }
    case "npn":
    case "mosfet":
    case "hall":
    case "photoresistor":
    case "thermistor":
      return legs(pins)
    default: {
      // Unknown shape: pins in a row along its front edge, at the bottom.
      const [x = 10, y = 10] = (spec?.size as number[] | undefined) ?? []
      const step = Math.min(PITCH * 2, x / Math.max(1, pins.length))
      return row(pins, (i) => [(i - (pins.length - 1) / 2) * step, -y / 2, 0], [0, -1, 0])
    }
  }
}

/** PVC insulation colours, a little off the pure hues as real wire is. */
const INSULATION: Record<string, number> = {
  red: 0xc81e1e,
  black: 0x161616,
  white: 0xe8e6e0,
  yellow: 0xe8c21c,
  orange: 0xe06a14,
  green: 0x1f8a3a,
  blue: 0x1f4fb8,
  brown: 0x5c3418,
  purple: 0x6a2a9a,
  gray: 0x7a7c80,
  grey: 0x7a7c80,
}

/** Colours a signal may take: the rails' own (red, orange, black) are
 *  never used for a signal, so a red wire always means 5 V. */
const SIGNAL = ["yellow", "blue", "green", "white", "purple", "brown", "gray"]
const RAIL = new Set(["red", "orange", "black"])

/** What a wire carries, from the pins at its ends. */
function rail(a: string, b: string): "gnd" | "5v" | "3v3" | null {
  const ends = [a, b].map((e) => e.toUpperCase())
  const pin = (e: string) => e.slice(e.indexOf(".") + 1)
  if (ends.some((e) => /^GND/.test(pin(e)) || /^(BAT|PWR|PSU|SUPPLY)\w*\.-$/.test(e))) return "gnd"
  if (ends.some((e) => /^(5V|VIN|VMOT|12V)$/.test(pin(e)) || /^(BAT|PWR|PSU|SUPPLY)\w*\.\+$/.test(e))) return "5v"
  if (ends.some((e) => pin(e) === "3V3")) return "3v3"
  return null
}

/** The insulation a builder would use: the rails by the colour code (black
 *  ground, red 5 V and supply, orange 3.3 V) whatever was asked for, and a
 *  signal in the colour given unless that is a rail's. */
function insulation(color: string | undefined, a: string, b: string): number {
  const carried = rail(a, b)
  if (carried === "gnd") return INSULATION.black
  if (carried === "5v") return INSULATION.red
  if (carried === "3v3") return INSULATION.orange
  const asked = color?.toLowerCase()
  if (asked && INSULATION[asked] !== undefined && !RAIL.has(asked)) return INSULATION[asked]
  if (asked && /^#[0-9a-f]{3,6}$/.test(asked)) return new THREE.Color(asked).getHex()
  // A rail colour on a signal, or none: one of the signal colours, the
  // same for every wire from the same controller pin.
  const key = [a, b].sort()[0]
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return INSULATION[SIGNAL[h % SIGNAL.length]]
}

const WIRE_R = 0.8 // 22 AWG with its insulation, 1.6 mm across
const PLUG = 14 // a DuPont housing's length
/** The longest stock jumper; a run past it needs a longer lead or a splice. */
export const JUMPER_MM = 200
/** Wires between the same two places, this many or more, go in a loom. */
const LOOM_MIN = 3
/** Parts closer than this share a loom's end. */
const CLUSTER_MM = 45
/** A zip tie every so often along a loom. */
const TIE_EVERY = 45

/** A part's model relative to `frame` (one of its ancestors), from the
 *  local matrices: no world matrices, so it holds however deep the part
 *  sits in moving segments and whatever the frame itself hangs from. */
function relativeTo(node: THREE.Object3D, frame: THREE.Object3D, out: THREE.Matrix4) {
  node.updateMatrix()
  out.copy(node.matrix)
  for (let up = node.parent; up && up !== frame; up = up.parent) {
    up.updateMatrix()
    out.premultiply(up.matrix)
  }
  return out
}

/** An object's bounds in its own frame, from its meshes' geometry. */
function localBounds(object: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  const m = new THREE.Matrix4()
  object.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || node.userData.cables) return
    mesh.geometry.computeBoundingBox()
    const b = mesh.geometry.boundingBox!.clone()
    box.union(node === object ? b : b.applyMatrix4(relativeTo(node, object, m)))
  })
  return box
}

interface End {
  model: THREE.Object3D
  anchor: PinAnchor
  /** How many wires sit beside this one on the same pin. */
  stack: number
  /** Its DuPont plug's instance, or -1 for a part's own lead. */
  plug: number
}

interface Run {
  wire: Wire
  a: End
  b: End
  hex: number
  mm: number
}

interface Located {
  /** The pin, where the wire is fixed. */
  pin: THREE.Vector3
  /** Where it leaves the plug (or the pin, with no plug). */
  out: THREE.Vector3
  dir: THREE.Vector3
}

/** Hexagonally packed offsets for `n` wires in a bundle, centre first. */
function packing(n: number): [number, number][] {
  const step = WIRE_R * 2.05
  const spots: [number, number][] = []
  for (let i = -4; i <= 4; i += 1) {
    for (let j = -4; j <= 4; j += 1) spots.push([(i + j / 2) * step, j * step * 0.866])
  }
  spots.sort((p, q) => Math.hypot(...p) - Math.hypot(...q))
  return spots.slice(0, n)
}

/**
 * The project's wires as cables, in the design frame (`frame`, an ancestor
 * of every part). `placed` maps a part id to its built model (placed by
 * its layout); wires to parts not in it are left out (the try-on, showing
 * one sub-assembly). `solids` are the other things a cable must go around
 * (the printed parts). `update()` re-routes every cable from where its
 * parts are now - a segment moved on the stage or tracked on the body - so
 * moving the controller or bending the wrist stretches the wires instead
 * of leaving them behind.
 *
 * With looms on (Visuals.looms), wires that run between the same two
 * places - three or more - are bundled the way a builder would: fanned in
 * from their pins to a breakout, packed side by side along one trunk that
 * sags under its weight and is pushed clear of every part, zip-tied along
 * its length, and fanned out again at the far end.
 */
export class Cabling {
  readonly group = new THREE.Group()
  private readonly runs: Run[] = []
  private readonly materials = new Map<number, THREE.Material>()
  private readonly m = new THREE.Matrix4()
  private readonly obstacles: { object: THREE.Object3D; local: THREE.Box3 }[]
  // Drawn in as few calls as possible: every wire of one colour is one
  // mesh, every plug one instance of two instanced meshes, every zip tie
  // part of one mesh. Rebuilt on each re-route.
  private readonly tubes = new Map<number, THREE.Mesh>()
  private pendingTubes = new Map<number, THREE.BufferGeometry[]>()
  private readonly ties: THREE.Mesh
  private pendingTies: THREE.BufferGeometry[] = []
  private readonly housings: THREE.InstancedMesh
  private readonly pins: THREE.InstancedMesh
  private readonly looms: boolean

  constructor(
    parts: Part[],
    wires: Wire[],
    placed: Map<string, THREE.Object3D>,
    private readonly frame: THREE.Object3D,
    solids: THREE.Object3D[] = []
  ) {
    this.group.name = "cables"
    this.group.userData.cables = true
    this.looms = visuals().looms
    this.ties = new THREE.Mesh(new THREE.BufferGeometry(), real.plastic(0x101010, 0.55))
    this.ties.name = "zip-ties"
    this.ties.userData.noEdges = true
    this.group.add(this.ties)
    this.obstacles = [...placed.values(), ...solids].map((object) => ({ object, local: localBounds(object) }))
    const anchors = new Map(parts.map((p) => [p.id, pinAnchors(p)]))
    let plugs = 0
    // How many wires already land on each pin: they fan out rather than overlap.
    const used = new Map<string, number>()
    const end = (ref: string): End | null => {
      const [pid, pin] = ref.split(".")
      const model = placed.get(pid)
      let anchor = anchors.get(pid)?.[pin]
      if (!model || !anchor) return null
      const k = used.get(ref) ?? 0
      used.set(ref, k + 1)
      // The UNO has three GND sockets: spread the ground wires across them.
      const unoGround = model.userData.partType === "uno" && pin === "GND"
      if (unoGround) anchor = { pos: unoSocket(["GND", "GND_2", "GND_TOP"][k % 3]), dir: [0, 0, 1], end: "dupont" }
      // A leg whose tip is buried in what the part sits on is soldered at
      // its root instead, the wire leaving sideways, away from the part.
      if (anchor.root && this.buried(model, anchor.pos)) {
        const [x, y] = anchor.root
        const out = Math.hypot(x, y) > 0.3 ? new THREE.Vector2(x, y).normalize() : new THREE.Vector2(0, -1)
        anchor = { pos: anchor.root, dir: [out.x, out.y, 0], end: "lead" }
      }
      // More wires on one pin than it has room for (in a real build they
      // would meet on a breadboard rail): set each beside the last.
      const stack = unoGround ? Math.floor(k / 3) : k
      const plug = anchor.end === "dupont" ? plugs++ : -1
      return { model, anchor, stack, plug }
    }
    for (const wire of wires) {
      const a = end(wire.a)
      const b = end(wire.b)
      if (!a || !b) continue
      this.runs.push({ wire, a, b, hex: insulation(wire.color, wire.a, wire.b), mm: 0 })
    }
    this.housings = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 2.5, PLUG), real.plastic(0x121212, 0.5), Math.max(1, plugs))
    this.pins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.32, 3, 8), real.metal(0xd8b25a, 0.25), Math.max(1, plugs))
    for (const plugged of [this.housings, this.pins]) {
      plugged.count = plugs
      plugged.userData.noEdges = true
      plugged.frustumCulled = false
      this.group.add(plugged)
    }
    this.update()
    this.group.traverse((n) => {
      if ((n as THREE.Mesh).isMesh) n.receiveShadow = true
    })
  }

  /** Each wire's run, plug to plug, in millimetres. */
  get lengths(): { wire: string; mm: number }[] {
    return this.runs.map((r) => ({ wire: `${r.wire.a} → ${r.wire.b}`, mm: r.mm }))
  }

  private material(hex: number) {
    let m = this.materials.get(hex)
    if (!m) {
      m = new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.2, sheenColor: new THREE.Color(0xffffff) })
      this.materials.set(hex, m)
    }
    return m
  }

  /** Every obstacle's box in the frame, as things stand now. */
  private boxes(): { object: THREE.Object3D; box: THREE.Box3 }[] {
    return this.obstacles
      .filter((o) => !o.local.isEmpty())
      .map((o) => ({ object: o.object, box: o.local.clone().applyMatrix4(relativeTo(o.object, this.frame, this.m)) }))
  }

  /** Whether a point on `model` (its own frame) is inside another obstacle. */
  private buried(model: THREE.Object3D, local: [number, number, number]): boolean {
    const point = new THREE.Vector3(...local).applyMatrix4(relativeTo(model, this.frame, new THREE.Matrix4()))
    return this.boxes().some((o) => o.object !== model && o.box.clone().expandByScalar(-0.2).containsPoint(point))
  }

  /** Where a wire leaves its pin now, in the frame, with its plug set on it. */
  private locate(e: End): Located {
    relativeTo(e.model, this.frame, this.m)
    const pos = new THREE.Vector3(...e.anchor.pos).applyMatrix4(this.m)
    const dir = new THREE.Vector3(...e.anchor.dir).transformDirection(this.m)
    if (e.stack) {
      const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize()
      pos.addScaledVector(side, e.stack * 2.6)
    }
    if (e.plug < 0) return { pin: pos, dir, out: pos.clone() }
    const one = new THREE.Vector3(1, 1, 1)
    this.housings.setMatrixAt(
      e.plug,
      new THREE.Matrix4().compose(pos.clone().addScaledVector(dir, PLUG / 2), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir), one)
    )
    this.pins.setMatrixAt(
      e.plug,
      new THREE.Matrix4().compose(pos.clone().addScaledVector(dir, -1), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), one)
    )
    return { pin: pos, dir, out: pos.clone().addScaledVector(dir, PLUG) }
  }

  /** Lay a run's tube along `curve` (drawn with its colour's others). */
  private lay(run: Run, curve: THREE.Curve<THREE.Vector3>, detail: number) {
    const length = curve.getLength()
    run.mm = length + (run.a.plug >= 0 ? PLUG : 0) + (run.b.plug >= 0 ? PLUG : 0)
    const segments = THREE.MathUtils.clamp(Math.round((length / 3.5) * detail), 10, 160)
    const list = this.pendingTubes.get(run.hex) ?? []
    list.push(new THREE.TubeGeometry(curve, segments, WIRE_R, 6, false))
    this.pendingTubes.set(run.hex, list)
  }

  /** Swap a mesh's geometry for `geometry`, and the hologram edge lines
   *  the stage or the try-on hung on it with it. */
  private swap(mesh: THREE.Mesh, geometry: THREE.BufferGeometry) {
    mesh.geometry.dispose()
    mesh.geometry = geometry
    for (const child of mesh.children) {
      const lines = child as THREE.LineSegments
      if (!lines.isLineSegments) continue
      lines.geometry.dispose()
      lines.geometry = new THREE.EdgesGeometry(geometry, 22)
    }
  }

  /** Merge what this update laid into the colour meshes and the ties. */
  private commit() {
    for (const [hex, list] of this.pendingTubes) {
      const merged = mergeGeometries(list) ?? new THREE.BufferGeometry()
      list.forEach((g) => g.dispose())
      let mesh = this.tubes.get(hex)
      if (!mesh) {
        mesh = new THREE.Mesh(merged, this.material(hex))
        // A tube's facets meet at 60 degrees, so an edge outline would trace
        // every one of them along every wire: the hologram's rim light
        // outlines a cable instead. Too thin to need the shadow map either.
        mesh.userData.noEdges = true
        mesh.receiveShadow = true
        this.tubes.set(hex, mesh)
        this.group.add(mesh)
      } else this.swap(mesh, merged)
    }
    this.pendingTubes = new Map()
    const ties = this.pendingTies.length ? (mergeGeometries(this.pendingTies) ?? new THREE.BufferGeometry()) : new THREE.BufferGeometry()
    this.pendingTies.forEach((g) => g.dispose())
    this.pendingTies = []
    this.swap(this.ties, ties)
    this.housings.instanceMatrix.needsUpdate = true
    this.pins.instanceMatrix.needsUpdate = true
  }

  /** A single wire, routed on its own: up out of a header and over, or
   *  sagging between two low ends, never through the bench (z = 0). */
  private single(a: Located, b: Located): THREE.Curve<THREE.Vector3> {
    const p0 = a.out
    const q0 = b.out
    const span = p0.distanceTo(q0)
    const lead = 6 + Math.min(span, 300) * 0.12
    const p1 = p0.clone().addScaledVector(a.dir, lead)
    const q1 = q0.clone().addScaledVector(b.dir, lead)
    const mid = p1.clone().add(q1).multiplyScalar(0.5)
    const fromAbove = a.dir.z > 0.5 || b.dir.z > 0.5
    mid.z += fromAbove ? Math.min(30, span * 0.1) : -Math.min(45, span * 0.16)
    mid.z = Math.max(mid.z, Math.min(p0.z, q0.z, 0) + WIRE_R + 1)
    return new THREE.CatmullRomCurve3([p0, p1, mid, q1, q0], false, "centripetal")
  }

  /** Push points out of every box (grown by `clear`), over the top where
   *  that is nearest, and smooth what moved; the ends stay where they are. */
  private clearOf(points: THREE.Vector3[], boxes: THREE.Box3[], clear: number) {
    const grown = boxes.map((b) => b.clone().expandByScalar(clear))
    for (let pass = 0; pass < 4; pass += 1) {
      for (let i = 1; i < points.length - 1; i += 1) {
        const p = points[i]
        for (const box of grown) {
          if (!box.containsPoint(p)) continue
          // The shortest way out, preferring up (a loom goes over a part,
          // not under it) and never down through the bench.
          const ways = [
            { d: (box.max.z - p.z) * 0.6, set: () => (p.z = box.max.z) },
            { d: box.max.x - p.x, set: () => (p.x = box.max.x) },
            { d: p.x - box.min.x, set: () => (p.x = box.min.x) },
            { d: box.max.y - p.y, set: () => (p.y = box.max.y) },
            { d: p.y - box.min.y, set: () => (p.y = box.min.y) },
          ]
          ways.sort((u, v) => u.d - v.d)[0].set()
        }
      }
      // A light smoothing pass so the pushed points make a curve, not steps.
      for (let i = 1; i < points.length - 1; i += 1) {
        points[i].lerp(points[i - 1].clone().add(points[i + 1]).multiplyScalar(0.5), 0.35)
      }
    }
    for (const p of points) p.z = Math.max(p.z, clear)
  }

  /** Which runs go in which loom: their ends gathered by part, parts near
   *  each other gathered into one place, and the places paired. */
  private plan(ends: Map<Run, [Located, Located]>) {
    // Places: one per part to start, merged while two are close.
    const places: { parts: Set<THREE.Object3D>; at: THREE.Vector3; n: number }[] = []
    for (const run of this.runs) {
      for (const [e, loc] of [[run.a, ends.get(run)![0]], [run.b, ends.get(run)![1]]] as const) {
        let place = places.find((p) => p.parts.has(e.model))
        if (!place) places.push((place = { parts: new Set([e.model]), at: new THREE.Vector3(), n: 0 }))
        place.at.add(loc.out)
        place.n += 1
      }
    }
    places.forEach((p) => p.at.divideScalar(p.n))
    for (let merged = true; merged; ) {
      merged = false
      for (let i = 0; i < places.length && !merged; i += 1) {
        for (let j = i + 1; j < places.length && !merged; j += 1) {
          if (places[i].at.distanceTo(places[j].at) > CLUSTER_MM) continue
          const [p, q] = [places[i], places[j]]
          q.parts.forEach((x) => p.parts.add(x))
          p.at.multiplyScalar(p.n).addScaledVector(q.at, q.n).divideScalar(p.n + q.n)
          p.n += q.n
          places.splice(j, 1)
          merged = true
        }
      }
    }
    const placeOf = (e: End) => places.findIndex((p) => p.parts.has(e.model))
    const looms = new Map<string, { from: number; runs: Run[] }>()
    for (const run of this.runs) {
      const [i, j] = [placeOf(run.a), placeOf(run.b)]
      if (i === j) continue
      const key = `${Math.min(i, j)}-${Math.max(i, j)}`
      if (!looms.has(key)) looms.set(key, { from: Math.min(i, j), runs: [] })
      looms.get(key)!.runs.push(run)
    }
    return { placeOf, looms: [...looms.values()].filter((l) => l.runs.length >= LOOM_MIN) }
  }

  /** A zip tie round the bundle at `at`, square to `along`. */
  private tie(at: THREE.Vector3, along: THREE.Vector3, radius: number) {
    const place = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), along), new THREE.Vector3(1, 1, 1))
    const ring = new THREE.TorusGeometry(radius + 0.5, 0.45, 5, 18).applyMatrix4(place)
    // The tie's head, the square lock on one side.
    const head = new THREE.BoxGeometry(2.6, 2.4, 2.2).translate(radius + 1.2, 0, 0).applyMatrix4(place)
    this.pendingTies.push(ring.toNonIndexed(), head.toNonIndexed())
  }

  /** Re-route every cable from where its two ends are now. `detail`
   *  below 1 draws coarser tubes (the try-on, re-routing every frame). */
  update(detail = 1) {
    const ends = new Map(this.runs.map((run) => [run, [this.locate(run.a), this.locate(run.b)] as [Located, Located]]))
    const looms = this.looms ? this.plan(ends) : null
    const bundled = new Set<Run>()
    if (looms) {
      const boxes = this.boxes()
      for (const loom of looms.looms) {
        this.routeLoom(loom.runs, loom.from, looms.placeOf, ends, boxes, detail)
        loom.runs.forEach((r) => bundled.add(r))
      }
    }
    for (const run of this.runs) {
      if (bundled.has(run)) continue
      const [a, b] = ends.get(run)!
      this.lay(run, this.single(a, b), detail)
    }
    this.commit()
  }

  /** One loom: breakouts at both places, a trunk between them clear of
   *  the parts, each wire packed in its own spot along it. */
  private routeLoom(
    runs: Run[],
    from: number,
    placeOf: (e: End) => number,
    ends: Map<Run, [Located, Located]>,
    boxes: { object: THREE.Object3D; box: THREE.Box3 }[],
    detail: number
  ) {
    // Each run's ends ordered from the loom's first place to its second.
    const legs = runs.map((run) => {
      const [a, b] = ends.get(run)!
      return placeOf(run.a) === from ? { run, near: a, far: b } : { run, near: b, far: a }
    })
    const radius = WIRE_R * 1.05 * Math.sqrt(runs.length) + WIRE_R
    const clear = radius + 3
    const breakout = (side: "near" | "far") => {
      const at = new THREE.Vector3()
      const dir = new THREE.Vector3()
      for (const l of legs) {
        at.add(l[side].out)
        dir.add(l[side].dir)
      }
      at.divideScalar(legs.length)
      // Out the way the wires leave, then lifted clear of whatever is there.
      at.addScaledVector(dir.lengthSq() > 1e-6 ? dir.normalize() : new THREE.Vector3(0, 0, 1), 16)
      const pushed = [at.clone(), at, at.clone()]
      this.clearOf(pushed, boxes.map((b) => b.box), clear)
      return at
    }
    const start = breakout("near")
    const end = breakout("far")
    // The trunk: sagging under its weight between the breakouts, then
    // pushed clear of every part and printed piece.
    const span = start.distanceTo(end)
    const samples = THREE.MathUtils.clamp(Math.round(span / 12), 6, 40)
    const sag = Math.min(40, span * 0.1)
    const trunk = Array.from({ length: samples + 1 }, (_, i) => {
      const t = i / samples
      const p = start.clone().lerp(end, t)
      p.z -= sag * 4 * t * (1 - t)
      return p
    })
    this.clearOf(trunk, boxes.map((b) => b.box), clear)
    const path = new THREE.CatmullRomCurve3(trunk, false, "centripetal")
    const steps = Math.max(16, samples * 3)
    const frames = path.computeFrenetFrames(steps, false)
    const along = path.getSpacedPoints(steps)
    const offsets = packing(legs.length)
    // Shortest first in the middle: the wire that leaves first sits outside.
    legs.forEach((leg, k) => {
      const [ox, oy] = offsets[k]
      const lane = along.map((p, s) => p.clone().addScaledVector(frames.normals[s], ox).addScaledVector(frames.binormals[s], oy))
      const lead = (l: Located) => l.out.clone().addScaledVector(l.dir, 8)
      const points = [leg.near.out, lead(leg.near), ...lane, lead(leg.far), leg.far.out]
      this.lay(leg.run, new THREE.CatmullRomCurve3(points, false, "centripetal"), detail)
    })
    // Zip ties: one at each breakout and every TIE_EVERY mm between.
    const length = path.getLength()
    const count = Math.max(2, Math.floor(length / TIE_EVERY) + 1)
    for (let i = 0; i < count; i += 1) {
      const u = count === 1 ? 0.5 : 0.04 + (0.92 * i) / (count - 1)
      this.tie(path.getPointAt(u), path.getTangentAt(u), radius)
    }
  }
}

/** The cables as a plain group, routed once (Cabling re-routes them). */
export function buildCables(parts: Part[], wires: Wire[], placed: Map<string, THREE.Object3D>, frame: THREE.Object3D): THREE.Group {
  return new Cabling(parts, wires, placed, frame).group
}
