import { PARTS, prop, type Part, type Project } from "@/lib/workshop/project/types"

// The DC side of the simulation: every wire joins pins into nets, every
// part becomes resistors and sources between them, and nodal analysis
// gives each net's voltage. Diodes, LEDs, transistors, relays and the
// L298N switch on what the voltages say, so the solve repeats until they
// settle. Good for "does this LED light, how much current, what does A0
// read" - not for capacitors, timing or anything faster than a frame.

/** How the UNO is driving one of its pins this instant. */
export type PinDrive = { out: true; high: boolean } | { out: false; pullup: boolean }

export interface CircuitInputs {
  /** UNO pins by name (D0-D13, A0-A5). */
  mcu: Map<string, PinDrive>
  /** Live values that override part props: pressed, value, light... */
  inputs: Record<string, Record<string, unknown>>
  /** Extra loads by part id, in ohms (a servo while it moves). */
  loads: Map<string, number>
}

export interface CircuitResult {
  /** Voltage at a pin ("LED1.A"), relative to the UNO's ground. */
  volts: (ref: string) => number
  /** Current, mA, through a named branch: an UNO pin ("U1.D13", out of
   *  the pin), a supply ("U1.5V"), an LED channel ("LED1.A"), a motor
   *  ("M1"), a relay coil ("K1"). */
  current: Map<string, number>
  /** Which switching parts ended up on: "Q1", "K1", "DRV.out1"... */
  on: Set<string>
}

const OFF = 1e-9

type Element =
  | { kind: "g"; a: number; b: number; g: number }
  | { kind: "v"; a: number; b: number; v: number; r: number; tag?: string }

class Nets {
  index = new Map<string, number>()
  count = 0
  constructor(project: Project) {
    const parent = new Map<string, string>()
    const find = (ref: string): string => {
      let r = ref
      while (parent.get(r) !== r) r = parent.get(r)!
      return r
    }
    for (const part of project.parts) {
      for (const pin of Object.keys(PARTS[part.type]?.pins ?? {})) parent.set(`${part.id}.${pin}`, `${part.id}.${pin}`)
    }
    for (const wire of project.wires) {
      if (!parent.has(wire.a) || !parent.has(wire.b)) continue
      parent.set(find(wire.a), find(wire.b))
    }
    // Ground is node 0: the UNO's GND net, or else the first supply's -.
    const uno = project.parts.find((p) => p.type === "uno")
    const supply = project.parts.find((p) => PARTS[p.type]?.kind === "power")
    const groundRef = uno ? `${uno.id}.GND` : supply ? `${supply.id}.-` : null
    const roots = new Map<string, number>()
    if (groundRef && parent.has(groundRef)) roots.set(find(groundRef), 0)
    this.count = 1
    for (const ref of parent.keys()) {
      const root = find(ref)
      if (!roots.has(root)) roots.set(root, this.count++)
      this.index.set(ref, roots.get(root)!)
    }
  }
  node(ref: string): number {
    return this.index.get(ref) ?? -1
  }
}

/** Gaussian elimination with partial pivoting; ground (node 0) removed. */
function solveLinear(g: Float64Array[], i: Float64Array): Float64Array {
  const n = i.length
  const a = g.map((row, r) => {
    const copy = new Float64Array(n + 1)
    copy.set(row)
    copy[n] = i[r]
    return copy
  })
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    const p = a[col][col] || 1e-18
    for (let r = col + 1; r < n; r += 1) {
      const f = a[r][col] / p
      if (!f) continue
      for (let c = col; c <= n; c += 1) a[r][c] -= f * a[col][c]
    }
  }
  const x = new Float64Array(n)
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = a[r][n]
    for (let c = r + 1; c < n; c += 1) sum -= a[r][c] * x[c]
    x[r] = sum / (a[r][r] || 1e-18)
  }
  return x
}

export class Circuit {
  private readonly nets: Nets
  private readonly uno: Part | undefined

  constructor(private readonly project: Project) {
    this.nets = new Nets(project)
    this.uno = project.parts.find((p) => p.type === "uno")
  }

  /** Which nets two refs share - for the runner's "what is wired to D9". */
  sameNet(a: string, b: string): boolean {
    const na = this.nets.node(a)
    return na >= 0 && na === this.nets.node(b)
  }

  netOf(ref: string): number {
    return this.nets.node(ref)
  }

  solve(input: CircuitInputs): CircuitResult {
    const live = (part: Part, key: string, fallback: unknown) => input.inputs[part.id]?.[key] ?? prop(part, key, fallback)
    const on = new Set<string>()
    let volts: Float64Array<ArrayBufferLike> = new Float64Array(this.nets.count)
    let elements: Element[] = []

    for (let pass = 0; pass < 14; pass += 1) {
      const V = (ref: string) => {
        const n = this.nets.node(ref)
        return n > 0 ? volts[n] : 0
      }
      elements = []
      const g = (a: string, b: string, ohms: number) =>
        elements.push({ kind: "g", a: this.nets.node(a), b: this.nets.node(b), g: 1 / Math.max(ohms, 1e-3) })
      const src = (a: string, b: string, v: number, r: number, tag?: string) =>
        elements.push({ kind: "v", a: this.nets.node(a), b: this.nets.node(b), v, r, tag })
      const next = new Set<string>()

      for (const part of this.project.parts) {
        const id = part.id
        const spec = PARTS[part.type]
        if (!spec) continue
        switch (part.type) {
          case "uno": {
            src(`${id}.5V`, `${id}.GND`, 5, 0.05, `${id}.5V`)
            src(`${id}.3V3`, `${id}.GND`, 3.3, 0.5, `${id}.3V3`)
            for (const [pin, drive] of input.mcu) {
              if (drive.out) src(`${id}.${pin}`, `${id}.GND`, drive.high ? 5 : 0, 25, `${id}.${pin}`)
              else if (drive.pullup) src(`${id}.${pin}`, `${id}.GND`, 5, 35_000)
            }
            break
          }
          case "resistor":
            g(`${id}.1`, `${id}.2`, Number(live(part, "ohms", 1000)))
            break
          case "pot": {
            const ohms = Number(live(part, "ohms", 200))
            const value = Math.min(1, Math.max(0, Number(live(part, "value", 0.5))))
            g(`${id}.1`, `${id}.W`, Math.max(0.5, ohms * value))
            g(`${id}.W`, `${id}.2`, Math.max(0.5, ohms * (1 - value)))
            break
          }
          case "photoresistor": {
            const light = Math.min(1, Math.max(0, Number(live(part, "light", 0.5))))
            const dark = Math.log(Number(prop(part, "dark_ohms", 1e6)))
            const bright = Math.log(Number(prop(part, "bright_ohms", 1e3)))
            g(`${id}.1`, `${id}.2`, Math.exp(dark + (bright - dark) * light))
            break
          }
          case "thermistor": {
            const t = Number(live(part, "temp_c", 25)) + 273.15
            const r = Number(prop(part, "r25", 1e4)) * Math.exp(Number(prop(part, "beta", 3950)) * (1 / t - 1 / 298.15))
            g(`${id}.1`, `${id}.2`, r)
            break
          }
          case "button":
            if (live(part, "pressed", false)) g(`${id}.1`, `${id}.2`, 0.05)
            break
          case "switch":
            if (live(part, "on", false)) g(`${id}.1`, `${id}.2`, 0.05)
            break
          case "limit_switch":
            g(`${id}.COM`, live(part, "pressed", false) ? `${id}.NO` : `${id}.NC`, 0.05)
            break
          case "diode":
          case "led":
          case "rgb_led": {
            const pins = part.type === "rgb_led" ? ["R", "G", "B"] : ["A"]
            const k = part.type === "rgb_led" ? `${id}.COM` : `${id}.K`
            for (const pin of pins) {
              const vf =
                part.type === "diode"
                  ? 0.7
                  : part.type === "rgb_led"
                    ? Number((spec.vf_by_pin as Record<string, number>)[pin])
                    : Number((spec.vf_by_color as Record<string, number>)[String(live(part, "color", "red"))] ?? 2)
              const key = `${id}.${pin}`
              const wasOn = on.has(key)
              const forward = V(`${id}.${pin}`) - V(k)
              const isOn = wasOn ? forward > vf - 0.02 : forward > vf
              if (isOn) {
                next.add(key)
                src(`${id}.${pin}`, k, vf, part.type === "diode" ? 1 : 12, key)
              }
            }
            break
          }
          case "piezo":
            g(`${id}.+`, `${id}.-`, 1e5)
            break
          case "servo":
            g(`${id}.V+`, `${id}.GND`, input.loads.get(id) ?? 500)
            break
          case "dc_motor":
          case "fan":
            g(`${id}.+`, `${id}.-`, Number(spec.ohms ?? 30))
            break
          case "relay": {
            src(`${id}.C1`, `${id}.C2`, 0, Number(spec.coil_ohms ?? 125), `${id}`)
            const coilMa = Math.abs(V(`${id}.C1`) - V(`${id}.C2`)) / Number(spec.coil_ohms ?? 125) * 1000
            const closed = on.has(id) ? coilMa > Number(spec.pull_in_ma ?? 30) * 0.5 : coilMa > Number(spec.pull_in_ma ?? 30)
            if (closed) {
              next.add(id)
              g(`${id}.COM`, `${id}.NO`, 0.05)
            }
            break
          }
          case "npn": {
            const be = V(`${id}.B`) - V(`${id}.E`)
            const wasOn = on.has(id)
            if (wasOn ? be > 0.6 : be > 0.65) {
              next.add(id)
              src(`${id}.B`, `${id}.E`, 0.65, 50)
              src(`${id}.C`, `${id}.E`, 0.15, 2)
            }
            break
          }
          case "mosfet": {
            if (V(`${id}.G`) - V(`${id}.S`) > Number(spec.vth ?? 2)) {
              next.add(id)
              g(`${id}.D`, `${id}.S`, 0.1)
            }
            break
          }
          case "l298n": {
            const supply = V(`${id}.12V`) - V(`${id}.GND`)
            g(`${id}.12V`, `${id}.GND`, supply > 0 ? 12 / 0.036 : 1e6)
            if (supply >= 7) src(`${id}.5V`, `${id}.GND`, 5, 0.5)
            const high = (pin: string) => V(`${id}.${pin}`) - V(`${id}.GND`) > 2.3
            for (const [en, jumper, a, b, outA, outB] of [
              ["ENA", "ena_jumper", "IN1", "IN2", "OUT1", "OUT2"],
              ["ENB", "enb_jumper", "IN3", "IN4", "OUT3", "OUT4"],
            ] as const) {
              const enabled = live(part, jumper, true) ? true : high(en)
              if (!enabled || supply < 4) continue
              next.add(`${id}.${en}`)
              src(`${id}.${outA}`, `${id}.GND`, high(a) ? supply - 1.4 : 0.4, 1)
              src(`${id}.${outB}`, `${id}.GND`, high(b) ? supply - 1.4 : 0.4, 1)
            }
            break
          }
          case "a4988":
            g(`${id}.VDD`, `${id}.GND`, 1000)
            g(`${id}.VMOT`, `${id}.GND`, 2000)
            // The carrier pulls SLP up to VDD; RST floats (hence the RST-SLP jumper).
            g(`${id}.SLP`, `${id}.VDD`, 10_000)
            break
          case "ping":
            g(`${id}.5V`, `${id}.GND`, 5 / 0.03)
            break
          case "hall":
            g(`${id}.VCC`, `${id}.GND`, 1000)
            if (live(part, "magnet", false) && V(`${id}.VCC`) - V(`${id}.GND`) > 3.5) g(`${id}.OUT`, `${id}.GND`, 20)
            break
          case "adxl335": {
            const vcc = V(`${id}.VCC`) - V(`${id}.GND`)
            g(`${id}.VCC`, `${id}.GND`, 3.3 / 0.0004)
            if (vcc > 1.6) {
              for (const axis of ["X", "Y", "Z"]) {
                const gs = Number(live(part, `${axis.toLowerCase()}_g`, axis === "Z" ? 1 : 0))
                src(`${id}.${axis}`, `${id}.GND`, vcc / 2 + gs * 0.1 * vcc, 32_000)
              }
            }
            break
          }
          default:
            if (spec.kind === "power") src(`${id}.+`, `${id}.-`, Number(spec.volts ?? 9), part.type === "battery_6aa" ? 1.2 : 0.2, id)
        }
      }

      volts = this.nodal(elements)
      const settled = next.size === on.size && [...next].every((key) => on.has(key))
      on.clear()
      next.forEach((key) => on.add(key))
      if (settled && pass > 0) break
    }

    const current = new Map<string, number>()
    const nodeV = (n: number) => (n > 0 ? volts[n] : 0)
    for (const el of elements) {
      if (el.kind === "v" && el.tag) {
        const i = (el.v - (nodeV(el.a) - nodeV(el.b))) / el.r
        current.set(el.tag, (current.get(el.tag) ?? 0) + i * 1000)
      }
    }
    for (const part of this.project.parts) {
      if (part.type === "dc_motor" || part.type === "fan") {
        const v = nodeV(this.nets.node(`${part.id}.+`)) - nodeV(this.nets.node(`${part.id}.-`))
        current.set(part.id, (v / Number(PARTS[part.type].ohms ?? 30)) * 1000)
      }
      if (part.type === "relay") current.set(part.id, Math.abs(current.get(part.id) ?? 0))
    }
    // An LED's tag measures current from anode to cathode: the sign is
    // right for the source formula only if read as -i.
    for (const key of on) if (current.has(key) && current.get(key)! < 0) current.set(key, -current.get(key)!)

    return {
      volts: (ref: string) => nodeV(this.nets.node(ref)),
      current,
      on,
    }
  }

  private nodal(elements: Element[]): Float64Array {
    const n = this.nets.count - 1
    if (n <= 0) return new Float64Array(this.nets.count)
    const G = Array.from({ length: n }, () => new Float64Array(n))
    const I = new Float64Array(n)
    const stamp = (a: number, b: number, g: number) => {
      if (a > 0) G[a - 1][a - 1] += g
      if (b > 0) G[b - 1][b - 1] += g
      if (a > 0 && b > 0) {
        G[a - 1][b - 1] -= g
        G[b - 1][a - 1] -= g
      }
    }
    for (let k = 1; k <= n; k += 1) G[k - 1][k - 1] += OFF
    for (const el of elements) {
      if (el.a < 0 || el.b < 0) continue
      if (el.kind === "g") stamp(el.a, el.b, el.g)
      else {
        // Norton: a source of v behind r is a conductance 1/r plus a
        // current v/r pushed into a and out of b.
        const g = 1 / el.r
        stamp(el.a, el.b, g)
        if (el.a > 0) I[el.a - 1] += el.v * g
        if (el.b > 0) I[el.b - 1] -= el.v * g
      }
    }
    const x = solveLinear(G, I)
    const out = new Float64Array(this.nets.count)
    out.set(x, 1)
    return out
  }
}
