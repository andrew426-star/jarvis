import {
  AVRADC,
  AVRIOPort,
  AVRTWI,
  AVRTimer,
  AVRUSART,
  CPU,
  PinState,
  adcConfig,
  avrInstruction,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  twiConfig,
  usart0Config,
} from "avr8js"

import { PARTS, prop, simKind, type Part, type Project } from "@/lib/workshop/project/types"
import { Circuit, type CircuitResult, type PinDrive } from "@/lib/workshop/sim/circuit"
import { loadHex } from "@/lib/workshop/sim/hex"
import { I2CBus, max17048, type I2CDevice } from "@/lib/workshop/sim/i2c"

// The project running: an ATmega328P (the UNO's chip) emulated by avr8js,
// executing the compiled sketch instruction by instruction at 16 MHz, with
// its pins tied to the circuit (circuit.ts) and to the parts that care
// about timing - servo pulses, stepper steps, tones, the PING))) echo.
// Runs in slices of simulated time between animation frames; when the
// browser cannot keep up it runs slower than real time and says so.

const HZ = 16_000_000
/** Simulated time between circuit solves: inputs respond within this. */
const SLICE_S = 0.001
const SLICE = HZ * SLICE_S
/** Wall-clock budget per frame, so the page stays responsive. */
const FRAME_BUDGET_MS = 9
/** Window for duty cycle and frequency. */
const WINDOW_S = 0.05

export const UNO_PINS = [
  ...Array.from({ length: 14 }, (_, i) => `D${i}`),
  ...Array.from({ length: 6 }, (_, i) => `A${i}`),
]

function portOf(pin: string): ["B" | "C" | "D", number] {
  if (pin.startsWith("A")) return ["C", Number(pin.slice(1))]
  const n = Number(pin.slice(1))
  return n < 8 ? ["D", n] : ["B", n - 8]
}

interface PinTrack {
  level: boolean
  since: number
  /** High time and rising edges in the current window (cycles, count). */
  highCycles: number
  rises: number
  /** Last window's figures. */
  duty: number
  hz: number
  /** Width of the last high pulse, microseconds. */
  pulseUs: number
  output: boolean
}

export interface PartState {
  id: string
  type: string
  /** One line for people (and for Jarvis): "LED1 on, 13 mA". */
  reading: string
  /** 0-1 brightness, per channel for an RGB LED. */
  glow?: number[]
  /** Degrees: servo horn or stepper shaft. */
  angle?: number
  /** Revolutions per minute, signed. */
  rpm?: number
  /** Tone in Hz, 0 when silent. */
  tone?: number
  closed?: boolean
}

export interface SimSnapshot {
  running: boolean
  time_s: number
  /** Simulated seconds per real second, recently. */
  speed: number
  serial: string
  parts: PartState[]
  warnings: string[]
  pins: Record<string, { mode: "out" | "in" | "pullup"; volts: number; ma: number; duty: number }>
  error?: string
}

export class Simulator {
  private readonly cpu: CPU
  private readonly ports: Record<"B" | "C" | "D", AVRIOPort>
  private readonly adc: AVRADC
  private readonly usart: AVRUSART
  private readonly circuit: Circuit
  private readonly uno: Part
  private readonly track = new Map<string, PinTrack>()
  private windowStart = 0
  private serialOut = ""
  private serialIn: number[] = []
  private result: CircuitResult | null = null
  private signature = ""
  private forced = new Map<string, boolean>()
  /** Live inputs (button presses, sliders), by part id. */
  readonly inputs: Record<string, Record<string, unknown>> = {}
  /** Servo: last pulse width (continuous) or angle (positional). */
  private servoAngle = new Map<string, number>()
  private steps = new Map<string, number>()
  private speedSample = { wall: 0, sim: 0, value: 1 }
  /** Each pin's mode last seen, to catch pinMode() changes. */
  private modes = new Map<string, PinState>()
  private settling = false
  /** UNO pin -> the parts' pins on its net, worked out once. */
  private readonly attached = new Map<string, string[]>()

  constructor(
    private readonly project: Project,
    hex: string
  ) {
    const uno = project.parts.find((p) => p.type === "uno")
    if (!uno) throw new Error("This project has no UNO to run.")
    this.uno = uno
    this.cpu = new CPU(loadHex(hex))
    new AVRTimer(this.cpu, timer0Config)
    new AVRTimer(this.cpu, timer1Config)
    new AVRTimer(this.cpu, timer2Config)
    this.ports = {
      B: new AVRIOPort(this.cpu, portBConfig),
      C: new AVRIOPort(this.cpu, portCConfig),
      D: new AVRIOPort(this.cpu, portDConfig),
    }
    this.adc = new AVRADC(this.cpu, adcConfig)
    this.usart = new AVRUSART(this.cpu, usart0Config, HZ)
    // The I2C bus on A4/A5 and what answers on it.
    const twi = new AVRTWI(this.cpu, twiConfig, HZ)
    const devices: I2CDevice[] = []
    for (const part of project.parts) {
      if (part.type === "fuel_gauge") devices.push(max17048(() => Number(this.inputs[part.id]?.percent ?? prop(part, "percent", 76))))
    }
    twi.eventHandler = new I2CBus(twi, devices)
    this.usart.onByteTransmit = (byte) => {
      this.serialOut = (this.serialOut + String.fromCharCode(byte)).slice(-20_000)
    }
    this.circuit = new Circuit(project)

    for (const pin of UNO_PINS) {
      this.track.set(pin, { level: false, since: 0, highCycles: 0, rises: 0, duty: 0, hz: 0, pulseUs: 0, output: false })
      const ref = `${uno.id}.${pin}`
      const net = this.circuit.netOf(ref)
      const onNet: string[] = []
      for (const part of project.parts) {
        if (part.id === uno.id) continue
        for (const p of Object.keys(PARTS[part.type]?.pins ?? {})) {
          if (net >= 0 && this.circuit.netOf(`${part.id}.${p}`) === net) onNet.push(`${part.id}.${p}`)
        }
      }
      this.attached.set(pin, onNet)
    }
    for (const key of ["B", "C", "D"] as const) {
      const port = this.ports[key]
      port.addListener(() => this.onPort(key))
    }
  }

  private pinsOf(port: "B" | "C" | "D"): string[] {
    return UNO_PINS.filter((p) => portOf(p)[0] === port)
  }

  /** A port changed: note each pin's edges, and act on the timed parts. */
  private onPort(port: "B" | "C" | "D") {
    const now = this.cpu.cycles
    let modeChanged = false
    for (const pin of this.pinsOf(port)) {
      const [, bit] = portOf(pin)
      const state = this.ports[port].pinState(bit)
      const wasInput = (m?: PinState) => m === PinState.Input || m === PinState.InputPullUp
      const before = this.modes.get(pin)
      if (before !== state && (wasInput(before) || wasInput(state))) modeChanged = true
      this.modes.set(pin, state)
      const t = this.track.get(pin)!
      t.output = state === PinState.High || state === PinState.Low
      if (!t.output) continue
      const level = state === PinState.High
      if (level === t.level) continue
      if (t.level) t.highCycles += now - Math.max(t.since, this.windowStart)
      if (level) {
        t.rises += 1
        this.onRise(pin)
      } else {
        t.pulseUs = (now - t.since) / 16
        this.onFall(pin, t.pulseUs)
      }
      t.level = level
      t.since = now
    }
    // A pin just became an input (or got its pull-up): give it the level
    // the circuit puts on it now, as real hardware would, rather than at
    // the end of the slice - a sketch reading it straight after pinMode()
    // must not see a stale LOW.
    if (modeChanged && !this.settling) {
      this.settling = true
      this.settle()
      this.settling = false
    }
  }

  private onRise(pin: string) {
    for (const ref of this.attached.get(pin) ?? []) {
      const [id, p] = ref.split(".")
      const part = this.project.parts.find((x) => x.id === id)
      if (part?.type === "a4988" && p === "STEP") this.step(part)
    }
  }

  private onFall(pin: string, widthUs: number) {
    for (const ref of this.attached.get(pin) ?? []) {
      const [id, p] = ref.split(".")
      const part = this.project.parts.find((x) => x.id === id)
      if (part && simKind(part.type) === "servo" && p === "SIG" && widthUs > 400 && widthUs < 2600) this.servoPulse(part, widthUs)
      // A short trigger pulse into the PING))): it answers with an echo
      // 750 us later, as long as the round trip takes.
      if (part?.type === "ping" && p === "SIG" && widthUs >= 2 && widthUs < 50) this.echo(part, pin)
    }
  }

  private servoPulse(part: Part, widthUs: number) {
    if (prop(part, "continuous", true)) this.servoAngle.set(part.id, widthUs)
    else this.servoAngle.set(part.id, Math.min(180, Math.max(0, ((widthUs - 544) / (2400 - 544)) * 180)))
  }

  /** The circuit as it stands this instant: re-solved if anything changed
   *  since the last slice (a STEP edge must see the DIR level just set). */
  private solved(): CircuitResult {
    this.settle()
    return this.result!
  }

  private echo(part: Part, pin: string) {
    const r = this.solved()
    const powered = r.volts(`${part.id}.5V`) - r.volts(`${part.id}.GND`) > 4.3
    if (!powered) return
    const cm = Math.min(300, Math.max(2, Number(this.inputs[part.id]?.distance_cm ?? prop(part, "distance_cm", 50))))
    const [port, bit] = portOf(pin)
    this.cpu.addClockEvent(() => {
      this.forced.set(pin, true)
      this.ports[port].setPin(bit, true)
      this.cpu.addClockEvent(() => {
        this.forced.set(pin, false)
        this.ports[port].setPin(bit, false)
        this.cpu.addClockEvent(() => this.forced.delete(pin), 16 * 200)
      }, Math.round(cm * 58.3 * 16))
    }, 750 * 16)
  }

  private step(driver: Part) {
    const r = this.solved()
    const level = (pin: string) => r.volts(`${driver.id}.${pin}`) - r.volts(`${driver.id}.GND`) > 2.5
    const vmot = r.volts(`${driver.id}.VMOT`) - r.volts(`${driver.id}.GND`)
    const vdd = r.volts(`${driver.id}.VDD`) - r.volts(`${driver.id}.GND`)
    if (vmot < 8 || vdd < 3 || level("EN") || !level("SLP") || !level("RST")) return
    for (const motor of this.project.parts) {
      if (motor.type !== "stepper") continue
      if (!this.circuit.sameNet(`${motor.id}.A+`, `${driver.id}.1A`) && !this.circuit.sameNet(`${motor.id}.A+`, `${driver.id}.1B`)) continue
      this.steps.set(motor.id, (this.steps.get(motor.id) ?? 0) + (level("DIR") ? 1 : -1))
    }
  }

  /** Bytes typed into the serial monitor, for the sketch's Serial.read(). */
  sendSerial(text: string) {
    for (const ch of text) this.serialIn.push(ch.charCodeAt(0) & 0xff)
  }

  setInput(id: string, key: string, value: unknown) {
    this.inputs[id] = { ...(this.inputs[id] ?? {}), [key]: value }
    this.signature = ""
  }

  get timeS() {
    return this.cpu.cycles / HZ
  }

  /** Run up to `seconds` of simulated time, within the frame budget. */
  run(seconds: number) {
    const wallStart = performance.now()
    const target = this.cpu.cycles + seconds * HZ
    while (this.cpu.cycles < target) {
      const sliceEnd = Math.min(target, this.cpu.cycles + SLICE)
      while (this.cpu.cycles < sliceEnd) {
        avrInstruction(this.cpu)
        this.cpu.tick()
      }
      this.settle()
      if (this.serialIn.length && this.usart.writeByte(this.serialIn[0])) this.serialIn.shift()
      if (this.cpu.cycles - this.windowStart >= WINDOW_S * HZ) this.closeWindow()
      if (performance.now() - wallStart > FRAME_BUDGET_MS) break
    }
    const wall = performance.now() - wallStart
    // Smoothed simulated-per-real speed, for the "x0.6" readout.
    this.speedSample.wall += Math.max(wall, 16)
    this.speedSample.sim += (this.cpu.cycles - (target - seconds * HZ)) / HZ * 1000
    if (this.speedSample.wall > 500) {
      this.speedSample.value = Math.min(1, this.speedSample.sim / this.speedSample.wall)
      this.speedSample.wall = this.speedSample.sim = 0
    }
  }

  private closeWindow() {
    const now = this.cpu.cycles
    const span = now - this.windowStart
    for (const t of this.track.values()) {
      if (t.level && t.output) t.highCycles += now - Math.max(t.since, this.windowStart)
      t.duty = t.output ? Math.min(1, t.highCycles / span) : 0
      t.hz = t.rises / (span / HZ)
      t.highCycles = 0
      t.rises = 0
    }
    this.windowStart = now
  }

  /** What the UNO's pins are doing now, for the circuit. A pin toggling
   *  fast (PWM, tone) counts as on, its duty applied afterwards. */
  private drives(): Map<string, PinDrive> {
    const map = new Map<string, PinDrive>()
    for (const pin of UNO_PINS) {
      const [port, bit] = portOf(pin)
      const state = this.ports[port].pinState(bit)
      const t = this.track.get(pin)!
      if (state === PinState.High || state === PinState.Low) {
        const toggling = t.hz > 60 && t.duty > 0.01
        map.set(pin, { out: true, high: toggling || state === PinState.High })
      } else {
        map.set(pin, { out: false, pullup: state === PinState.InputPullUp })
      }
    }
    return map
  }

  private loads(): Map<string, number> {
    const map = new Map<string, number>()
    for (const part of this.project.parts) {
      if (simKind(part.type) !== "servo") continue
      const width = this.servoAngle.get(part.id)
      const moving = width !== undefined && (prop(part, "continuous", true) ? Math.abs(width - 1500) > 30 : true)
      map.set(part.id, moving ? 33 : 500)
    }
    return map
  }

  /** Re-solve the circuit if anything it depends on changed, then feed the
   *  answer back into the UNO's input pins and ADC. */
  private settle() {
    const mcu = this.drives()
    const loads = this.loads()
    const signature =
      JSON.stringify([...mcu.entries()]) + JSON.stringify([...loads.entries()]) + JSON.stringify(this.inputs)
    if (signature !== this.signature || !this.result) {
      this.signature = signature
      this.result = this.circuit.solve({ mcu, inputs: this.inputs, loads })
    }
    const r = this.result
    const vcc = 5
    for (const pin of UNO_PINS) {
      const drive = mcu.get(pin)!
      const [port, bit] = portOf(pin)
      if (pin.startsWith("A")) this.adc.channelValues[Number(pin.slice(1))] = Math.max(0, Math.min(vcc, r.volts(`${this.uno.id}.${pin}`)))
      if (drive.out || this.forced.has(pin)) continue
      const v = r.volts(`${this.uno.id}.${pin}`)
      // Schmitt thresholds, like the real pins: 0.6 Vcc up, 0.3 Vcc down.
      const was = this.ports[port].pinState(bit) === PinState.High
      this.ports[port].setPin(bit, was ? v > 0.3 * vcc : v > 0.6 * vcc)
    }
  }

  /** The duty a PWM pin applies to a part pin's net - on it directly or
   *  through resistors in series - 1 if nothing there is pulsing. */
  private dutyAt(ref: string): number {
    const c = this.circuit
    const nets = new Set([c.netOf(ref)])
    for (let hop = 0; hop < 4; hop += 1) {
      for (const p of this.project.parts) {
        if (p.type !== "resistor") continue
        const a = c.netOf(`${p.id}.1`)
        const b = c.netOf(`${p.id}.2`)
        if (nets.has(a)) nets.add(b)
        if (nets.has(b)) nets.add(a)
      }
    }
    let duty = 1
    for (const pin of UNO_PINS) {
      const t = this.track.get(pin)!
      if (t.output && t.hz > 60 && nets.has(c.netOf(`${this.uno.id}.${pin}`))) duty = Math.min(duty, t.duty)
    }
    return duty
  }

  snapshot(running: boolean): SimSnapshot {
    const r = this.result ?? this.circuit.solve({ mcu: this.drives(), inputs: this.inputs, loads: new Map() })
    const warnings: string[] = []
    const parts: PartState[] = []
    const uno = this.uno.id
    const ma = (key: string) => r.current.get(key) ?? 0

    const pins: SimSnapshot["pins"] = {}
    for (const pin of UNO_PINS) {
      const [port, bit] = portOf(pin)
      const state = this.ports[port].pinState(bit)
      const t = this.track.get(pin)!
      const current = Math.abs(ma(`${uno}.${pin}`)) * (t.hz > 60 ? t.duty : 1)
      pins[pin] = {
        mode: state === PinState.High || state === PinState.Low ? "out" : state === PinState.InputPullUp ? "pullup" : "in",
        volts: r.volts(`${uno}.${pin}`),
        ma: current,
        duty: t.hz > 60 ? t.duty : state === PinState.High ? 1 : 0,
      }
      if (current > 40) warnings.push(`${pin} is carrying ${current.toFixed(0)} mA: over the pin's 40 mA absolute maximum, it will be damaged`)
      else if (current > 20) warnings.push(`${pin} is carrying ${current.toFixed(0)} mA, over the 20 mA it is rated for`)
    }
    const fiveV = ma(`${uno}.5V`)
    if (fiveV > 500) warnings.push(`The UNO's 5V pin is supplying ${fiveV.toFixed(0)} mA; USB gives 500 mA, so the board will brown out and reset`)

    for (const part of this.project.parts) {
      const spec = PARTS[part.type]
      const id = part.id
      const gnd = (pin: string) => r.volts(`${id}.${pin}`)
      switch (simKind(part.type)) {
        case "led":
        case "rgb_led": {
          const channels = part.type === "rgb_led" ? ["R", "G", "B"] : ["A"]
          const glow = channels.map((ch) => {
            const i = r.on.has(`${id}.${ch}`) ? ma(`${id}.${ch}`) : 0
            const level = Math.min(1, i / Number(spec.max_ma ?? 20)) * this.dutyAt(`${id}.${ch}`)
            if (i > Number(spec.abs_ma ?? 30)) warnings.push(`${id}${part.type === "rgb_led" ? ` (${ch})` : ""} is taking ${i.toFixed(0)} mA and burning out`)
            return level
          })
          const total = channels.reduce((sum, ch) => sum + (r.on.has(`${id}.${ch}`) ? ma(`${id}.${ch}`) : 0), 0)
          const duty = Math.min(...channels.map((ch) => this.dutyAt(`${id}.${ch}`)))
          parts.push({
            id, type: part.type, glow,
            reading: glow.some((x) => x > 0.01)
              ? `${id} on, ${total.toFixed(1)} mA${duty < 0.99 ? ` while pulsed (PWM ${(duty * 100).toFixed(0)}%)` : ""}`
              : `${id} off`,
          })
          break
        }
        case "servo": {
          const supply = gnd("V+") - gnd("GND")
          const width = this.servoAngle.get(id)
          if (width !== undefined && supply < 4.3) warnings.push(`${id} gets ${supply.toFixed(1)} V and will not move properly`)
          if (prop(part, "continuous", true)) {
            const power = width === undefined || supply < 4.3 ? 0 : Math.max(-1, Math.min(1, (width - 1500) / 500))
            const rpm = Math.abs(power) < 0.06 ? 0 : power * Number(spec.rpm ?? 130)
            parts.push({ id, type: part.type, rpm, reading: rpm ? `${id} turning ${rpm > 0 ? "forward" : "in reverse"} at ${Math.abs(rpm).toFixed(0)} rpm (pulse ${width?.toFixed(0)} us; above 1500 is forward)` : `${id} stopped${width ? ` (pulse ${width.toFixed(0)} us)` : ", no signal"}` })
          } else {
            const angle = width ?? 90
            parts.push({ id, type: part.type, angle, reading: `${id} at ${angle.toFixed(0)} deg` })
          }
          break
        }
        case "dc_motor":
        case "fan": {
          const volts = gnd("+") - gnd("-")
          const duty = this.motorDuty(part)
          const rated = Number(spec.rated_v ?? 6)
          const rpm = Math.abs(volts) < 0.5 ? 0 : (volts / rated) * duty * Number(spec.rpm ?? 2000)
          if (Math.abs(volts * duty) > rated * 1.4) warnings.push(`${id} is getting ${Math.abs(volts * duty).toFixed(1)} V, well over its ${rated} V rating: it will overheat`)
          parts.push({ id, type: part.type, rpm, reading: rpm ? `${id} ${volts > 0 ? "forward" : "reverse"} at ${Math.abs(volts * duty).toFixed(1)} V effective, about ${Math.abs(rpm).toFixed(0)} rpm` : `${id} stopped` })
          break
        }
        case "stepper": {
          const steps = this.steps.get(id) ?? 0
          const angle = steps * Number(spec.step_deg ?? 1.8)
          parts.push({ id, type: part.type, angle, reading: `${id} at ${angle.toFixed(1)} deg (${steps} steps)` })
          break
        }
        case "a4988": {
          const level = (pin: string) => gnd(pin) - gnd("GND") > 2.5
          if (!level("RST")) warnings.push(`${id} is held in reset (RST low or floating): jumper RST to SLP`)
          else if (gnd("VMOT") - gnd("GND") < 8) warnings.push(`${id}'s VMOT has ${(gnd("VMOT") - gnd("GND")).toFixed(1)} V; it needs 8-35 V to drive the motor`)
          break
        }
        case "piezo": {
          let hz = 0
          for (const pin of UNO_PINS) if (this.circuit.sameNet(`${uno}.${pin}`, `${id}.+`)) hz = Math.max(hz, this.track.get(pin)!.hz)
          parts.push({ id, type: part.type, tone: hz > 30 ? hz : 0, reading: hz > 30 ? `${id} sounding ${hz.toFixed(0)} Hz` : `${id} silent` })
          break
        }
        case "relay":
          parts.push({ id, type: part.type, closed: r.on.has(id), reading: `${id} ${r.on.has(id) ? "closed" : "open"} (coil ${ma(id).toFixed(0)} mA)` })
          break
        case "ping":
          parts.push({ id, type: part.type, reading: `${id} sees ${Number(this.inputs[id]?.distance_cm ?? prop(part, "distance_cm", 50)).toFixed(0)} cm` })
          break
        case "button":
        case "limit_switch":
          parts.push({ id, type: part.type, reading: `${id} ${(this.inputs[id]?.pressed ?? prop(part, "pressed", false)) ? "pressed" : "released"}` })
          break
        case "uno":
          parts.push({ id, type: part.type, reading: `${id} 5V pin supplying ${fiveV.toFixed(0)} mA` })
          break
      }
    }
    return {
      running,
      time_s: this.timeS,
      speed: this.speedSample.value,
      serial: this.serialOut,
      parts,
      warnings,
      pins,
    }
  }

  /** An L298N channel's enable duty for a motor on its outputs, else 1. */
  private motorDuty(motor: Part): number {
    for (const driver of this.project.parts) {
      if (driver.type !== "l298n") continue
      for (const [en, jumper, outs] of [["ENA", "ena_jumper", ["OUT1", "OUT2"]], ["ENB", "enb_jumper", ["OUT3", "OUT4"]]] as const) {
        if (!outs.some((o) => this.circuit.sameNet(`${driver.id}.${o}`, `${motor.id}.+`) || this.circuit.sameNet(`${driver.id}.${o}`, `${motor.id}.-`))) continue
        if (prop(driver, jumper, true)) return 1
        return this.dutyAt(`${driver.id}.${en}`)
      }
    }
    return this.dutyAt(`${motor.id}.+`)
  }
}
