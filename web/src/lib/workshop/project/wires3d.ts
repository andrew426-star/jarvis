import * as THREE from "three"

import { real } from "@/lib/workshop/project/materials"
import { PARTS, type Part, type Wire } from "@/lib/workshop/project/types"

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
      return row(["COM", "NO", "NC"], (i) => [(i - 1) * 6, 0, 0], [0, 0, -1])
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

function insulation(color: string | undefined, a: string, b: string): number {
  if (color && INSULATION[color.toLowerCase()] !== undefined) return INSULATION[color.toLowerCase()]
  if (color && /^#[0-9a-f]{3,6}$/i.test(color)) return new THREE.Color(color).getHex()
  // No colour given: the colour code a builder would use.
  const ends = `${a} ${b}`.toUpperCase()
  if (/GND|\.-|\.K\b|COM/.test(ends)) return INSULATION.black
  if (/5V|VIN|VCC|V\+|12V|\.\+|VMOT/.test(ends)) return INSULATION.red
  return INSULATION.yellow
}

const WIRE_R = 0.8 // 22 AWG with its insulation, 1.6 mm across
const PLUG = 14 // a DuPont housing's length
/** The longest stock jumper; a run past it needs a longer lead or a splice. */
export const JUMPER_MM = 200

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

interface End {
  model: THREE.Object3D
  anchor: PinAnchor
  /** How many wires sit beside this one on the same pin. */
  stack: number
  /** The DuPont housing and pin, or none for a part's own lead. */
  plug: THREE.Object3D[]
}

interface Run {
  wire: Wire
  a: End
  b: End
  hex: number
  tube: THREE.Mesh | null
  mm: number
}

/**
 * The project's wires as cables, in the design frame (`frame`, an ancestor
 * of every part). `placed` maps a part id to its built model (placed by
 * its layout); wires to parts not in it are left out (the try-on, showing
 * one sub-assembly). `update()` re-routes every cable from where its parts
 * are now - a segment moved on the stage or tracked on the body - so
 * moving the controller or bending the wrist stretches the wires instead
 * of leaving them behind.
 */
export class Cabling {
  readonly group = new THREE.Group()
  private readonly runs: Run[] = []
  private readonly materials = new Map<number, THREE.Material>()
  private readonly m = new THREE.Matrix4()

  constructor(parts: Part[], wires: Wire[], placed: Map<string, THREE.Object3D>, private readonly frame: THREE.Object3D) {
    this.group.name = "cables"
    this.group.userData.cables = true
    const anchors = new Map(parts.map((p) => [p.id, pinAnchors(p)]))
    const housing = real.plastic(0x121212, 0.5)
    const pinMetal = real.metal(0xd8b25a, 0.25)
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
      // More wires on one pin than it has room for (in a real build they
      // would meet on a breadboard rail): set each beside the last.
      const stack = unoGround ? Math.floor(k / 3) : k
      const plug: THREE.Object3D[] = []
      if (anchor.end === "dupont") {
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, PLUG), housing)
        const metal = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 3, 8), pinMetal)
        plug.push(body, metal)
        this.group.add(body, metal)
      }
      return { model, anchor, stack, plug }
    }
    for (const wire of wires) {
      const a = end(wire.a)
      const b = end(wire.b)
      if (!a || !b) continue
      this.runs.push({ wire, a, b, hex: insulation(wire.color, wire.a, wire.b), tube: null, mm: 0 })
    }
    this.update()
    this.group.traverse((n) => {
      if ((n as THREE.Mesh).isMesh) n.castShadow = n.receiveShadow = true
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

  /** Where a wire leaves its pin now, in the frame, with its plug set on it. */
  private locate(e: End) {
    relativeTo(e.model, this.frame, this.m)
    const pos = new THREE.Vector3(...e.anchor.pos).applyMatrix4(this.m)
    const dir = new THREE.Vector3(...e.anchor.dir).transformDirection(this.m)
    if (e.stack) {
      const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize()
      pos.addScaledVector(side, e.stack * 2.6)
    }
    if (!e.plug.length) return { dir, out: pos }
    const [body, pin] = e.plug
    body.position.copy(pos).addScaledVector(dir, PLUG / 2)
    body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
    pin.position.copy(pos).addScaledVector(dir, -1)
    pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    return { dir, out: pos.clone().addScaledVector(dir, PLUG) }
  }

  /** Re-route every cable from where its two ends are now. `detail`
   *  below 1 draws coarser tubes (the try-on, re-routing every frame). */
  update(detail = 1) {
    for (const run of this.runs) {
      const a = this.locate(run.a)
      const b = this.locate(run.b)
      const p0 = a.out
      const q0 = b.out
      const span = p0.distanceTo(q0)
      const lead = 6 + Math.min(span, 300) * 0.12
      const p1 = p0.clone().addScaledVector(a.dir, lead)
      const q1 = q0.clone().addScaledVector(b.dir, lead)
      // Stiff jumper wire arcs up out of a header before it falls to its
      // other end; between two low ends it sags under its own weight.
      // Never below the lower of its ends, so never through the bench the
      // parts stand on (z = 0).
      const mid = p1.clone().add(q1).multiplyScalar(0.5)
      const fromAbove = a.dir.z > 0.5 || b.dir.z > 0.5
      mid.z += fromAbove ? Math.min(30, span * 0.1) : -Math.min(45, span * 0.16)
      mid.z = Math.max(mid.z, Math.min(p0.z, q0.z, 0) + WIRE_R + 1)
      const curve = new THREE.CatmullRomCurve3([p0, p1, mid, q1, q0], false, "centripetal")
      const length = curve.getLength()
      run.mm = length + (run.a.plug.length ? PLUG : 0) + (run.b.plug.length ? PLUG : 0)
      const segments = THREE.MathUtils.clamp(Math.round((length / 2.5) * detail), 12, 160)
      const geometry = new THREE.TubeGeometry(curve, segments, WIRE_R, 8, false)
      if (!run.tube) {
        run.tube = new THREE.Mesh(geometry, this.material(run.hex))
        run.tube.userData.wire = `${run.wire.a}-${run.wire.b}`
        this.group.add(run.tube)
        continue
      }
      run.tube.geometry.dispose()
      run.tube.geometry = geometry
      // The hologram edge lines the stage or the try-on hung on it.
      for (const child of run.tube.children) {
        const lines = child as THREE.LineSegments
        if (!lines.isLineSegments) continue
        lines.geometry.dispose()
        lines.geometry = new THREE.EdgesGeometry(geometry, 22)
      }
    }
  }
}

/** The cables as a plain group, routed once (Cabling re-routes them). */
export function buildCables(parts: Part[], wires: Wire[], placed: Map<string, THREE.Object3D>, frame: THREE.Object3D): THREE.Group {
  return new Cabling(parts, wires, placed, frame).group
}
