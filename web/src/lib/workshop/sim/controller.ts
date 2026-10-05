"use client"

import { sfx } from "@/lib/sfx"
import { animate } from "@/lib/workshop/project/assembly"
import { useProject } from "@/lib/workshop/project/store"
import { Simulator, type SimSnapshot } from "@/lib/workshop/sim/runner"

// Runs the open project's simulation on animation frames: steps the
// emulated UNO, moves the 3D assembly, sounds the piezo, and publishes a
// snapshot to the project store (the panel, and Jarvis's CONSOLE_STATE)
// ten times a second. One simulation at a time; a new copy of the project
// stops it, since the circuit or the sketch may have changed under it.

const PUBLISH_MS = 100

let sim: Simulator | null = null
let simVersion = -1
let raf = 0
let running = false
let speed = 1
let lastFrame = 0
let lastPublish = 0
let snapshot: SimSnapshot | null = null

let audio: AudioContext | null = null
let osc: OscillatorNode | null = null
let gain: GainNode | null = null

function sound(hz: number) {
  if (!hz || sfx.isMuted() || !running) {
    if (gain && audio) gain.gain.setTargetAtTime(0, audio.currentTime, 0.01)
    return
  }
  try {
    audio ??= new AudioContext()
    if (!osc) {
      osc = audio.createOscillator()
      gain = audio.createGain()
      osc.type = "square"
      gain.gain.value = 0
      osc.connect(gain).connect(audio.destination)
      osc.start()
    }
    osc.frequency.setTargetAtTime(Math.min(8000, hz), audio.currentTime, 0.005)
    gain!.gain.setTargetAtTime(0.03, audio.currentTime, 0.01)
  } catch {
    // No audio is no reason to stop the simulation.
  }
}

function ensure(): string | null {
  const { project, version } = useProject.getState()
  if (!project) return "No project is open."
  if (!project.parts.some((p) => p.type === "uno")) return "The project has no UNO to run."
  if (!project.hex) return "The sketch has not compiled yet."
  if (!sim || simVersion !== version) {
    try {
      sim = new Simulator(project, project.hex)
      simVersion = version
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }
  return null
}

function frame(now: number) {
  if (!running || !sim) return
  const dt = Math.min(0.1, (now - lastFrame) / 1000 || 0.016)
  lastFrame = now
  try {
    sim.run(dt * speed)
  } catch (err) {
    stopSim()
    useProject.getState().setSim({ ...(snapshot ?? emptySnapshot()), running: false, error: `The emulator stopped: ${err instanceof Error ? err.message : String(err)}` })
    return
  }
  if (now - lastPublish > PUBLISH_MS || !snapshot) {
    lastPublish = now
    snapshot = sim.snapshot(true)
    useProject.getState().setSim(snapshot)
    sound(Math.max(0, ...snapshot.parts.map((p) => p.tone ?? 0)))
  }
  animate(snapshot, dt)
  raf = requestAnimationFrame(frame)
}

function emptySnapshot(): SimSnapshot {
  return { running: false, time_s: 0, speed: 1, serial: "", parts: [], warnings: [], pins: {} }
}

/** Start (or resume) the simulation; an error message if it cannot. */
export function startSim(): string | null {
  const error = ensure()
  if (error) {
    useProject.getState().setSim({ ...emptySnapshot(), error })
    return error
  }
  if (running) return null
  running = true
  lastFrame = performance.now()
  raf = requestAnimationFrame(frame)
  return null
}

export function stopSim() {
  running = false
  cancelAnimationFrame(raf)
  sound(0)
  if (sim) {
    snapshot = sim.snapshot(false)
    useProject.getState().setSim(snapshot)
  }
}

/** Back to power-on: the sketch restarts from setup(). */
export function resetSim() {
  const wasRunning = running
  stopSim()
  sim = null
  snapshot = null
  animate(null, 0)
  useProject.getState().setSim(null)
  if (wasRunning) startSim()
}

export function isRunning() {
  return running
}

export function setSimSpeed(value: number) {
  speed = Math.max(0.05, Math.min(1, value))
}

export function sendSerial(text: string) {
  if (ensure()) return
  sim!.sendSerial(text)
}

/** Set one live input: a button press, a slider. */
export function setSimInput(id: string, key: string, value: unknown) {
  if (ensure()) return
  sim!.setInput(id, key, value)
  if (!running) {
    snapshot = sim!.snapshot(false)
    useProject.getState().setSim(snapshot)
  }
}

/** Inputs as Jarvis gives them: {part id: value}, the key from its type. */
export function applyInputs(inputs: Record<string, unknown>) {
  const { project } = useProject.getState()
  if (!project) return
  for (const [id, value] of Object.entries(inputs)) {
    const part = project.parts.find((p) => p.id === id.toUpperCase())
    if (!part) continue
    switch (part.type) {
      case "button":
      case "limit_switch":
        setSimInput(part.id, "pressed", !!value)
        break
      case "switch":
        setSimInput(part.id, "on", !!value)
        break
      case "hall":
        setSimInput(part.id, "magnet", !!value)
        break
      case "pot":
        setSimInput(part.id, "value", Number(value))
        break
      case "photoresistor":
        setSimInput(part.id, "light", Number(value))
        break
      case "thermistor":
        setSimInput(part.id, "temp_c", Number(value))
        break
      case "ping":
        setSimInput(part.id, "distance_cm", Number(value))
        break
      case "adxl335": {
        const [x = 0, y = 0, z = 1] = Array.isArray(value) ? value.map(Number) : []
        setSimInput(part.id, "x_g", x)
        setSimInput(part.id, "y_g", y)
        setSimInput(part.id, "z_g", z)
        break
      }
    }
  }
}

// A new copy of the project (Jarvis changed it, or it was saved) means a
// new circuit or sketch: stop and start over from power-on.
if (typeof window !== "undefined") {
  useProject.subscribe((state, previous) => {
    if (state.version !== previous.version && sim) {
      stopSim()
      sim = null
      snapshot = null
    }
  })
}
