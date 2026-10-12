"use client"

import * as THREE from "three"

import { audioAmplitude } from "@/lib/audio-amplitude"
import { accentHex, cssHex, onCore, type CoreEvent } from "@/lib/core-events"
import { subscribeHands, type HandPointer } from "@/lib/hand-tracking"
import type { AgentStatus } from "@/lib/store"
import { JarvisMind } from "@/lib/jarvis-mind"
import { UltronFace } from "@/lib/ultron-face"

// The console's centre: Jarvis's mind (lib/jarvis-mind.ts) - a sphere of
// broken circuitry two shells deep, a debris band, chords, splintering
// shards, a tunnel of rings at its heart and out-of-focus light, drawn as
// a hologram - inside an outer tick ring, with shockwave rings on events.
// It reads, every frame:
//
//   status      - spin rate; thinking speeds the data and runs a scan
//   audio       - mic and narration level swell the shell and the core
//   core events - send, reply, tool and click fire shockwaves and bursts,
//                 an error flashes it red and shakes it
//   pointer     - the mouse or a tracked hand near it tilts it toward you
//   mode        - the accent colour, read live, so a mode wipe recolours it
//
// In serious mode the cipher gives way to Ultron's face (lib/ultron-face.ts),
// which follows the pointer, a hand and Andrew's typing; the switch cuts
// between them with a few frames of glitch.
//
// One WebGL context, additive shader materials, no post-processing: it
// sits in a corner of the layout and has to stay cheap.

const SPIN: Record<AgentStatus, number> = { idle: 1, listening: 1.8, thinking: 3.2, speaking: 1.4 }
const BASE_ENERGY: Record<AgentStatus, number> = { idle: 0.15, listening: 0.45, thinking: 0.6, speaking: 0.4 }

const additive = (color: number, opacity = 1) => ({
  color,
  transparent: true,
  opacity,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})

function glowTexture(): THREE.Texture {
  const size = 128
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size
  const ctx = canvas.getContext("2d")!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, "rgba(255,255,255,1)")
  gradient.addColorStop(0.2, "rgba(255,255,255,0.7)")
  gradient.addColorStop(0.5, "rgba(255,255,255,0.15)")
  gradient.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

interface Shockwave {
  line: THREE.LineLoop
  age: number
  life: number
  scale: number
}

export class CoreCipher {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  private readonly root = new THREE.Group()
  private readonly clock = new THREE.Clock()
  private raf = 0
  private readonly cleanups: (() => void)[] = []

  // Parts, grouped by boot stage.
  private readonly coreGroup = new THREE.Group()
  private readonly innerGroup = new THREE.Group()
  private readonly bandGroup = new THREE.Group()
  private readonly outerGroup = new THREE.Group()

  private readonly glow: THREE.Sprite
  private readonly mind: JarvisMind
  private readonly ticks: THREE.LineSegments
  private shockwaves: Shockwave[] = []
  private readonly tinted: { material: THREE.Material & { color: THREE.Color }; white?: boolean }[] = []

  private status: AgentStatus = "idle"
  private revealed = -1
  private energy = 0.2
  private amp = 0
  private flash = 0
  private shake = 0
  private burst = 0
  private accent = new THREE.Color(0x00d4ff)
  private readonly danger = new THREE.Color(0xff3333)
  private accentCheck = 0
  private readonly tilt = new THREE.Vector2()
  private readonly tiltTarget = new THREE.Vector2()
  private pointerAt: { x: number; y: number } | null = null

  // Built the first time serious mode is on: it is a large mesh.
  private face: UltronFace | null = null
  private glowMap: THREE.Texture
  private disposed = false
  private ultron = false
  private swap = 0
  private lastTyped = -100

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.domElement.style.width = "100%"
    this.renderer.domElement.style.height = "100%"
    this.renderer.domElement.style.display = "block"
    container.appendChild(this.renderer.domElement)

    // Far enough back that the outer tick ring (r 2.85) clears the frame.
    this.camera.position.set(0, 0, 9)
    this.scene.add(this.root)
    this.root.add(this.coreGroup, this.innerGroup, this.bandGroup, this.outerGroup)

    const color = accentHex()
    this.accent.setHex(color)

    // Core: a glow behind the mind's tunnel.
    const glowMap = glowTexture()
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ ...additive(color, 0.9), map: glowMap }))
    this.glow.scale.setScalar(1.6)
    this.coreGroup.add(this.glow)
    this.track(this.glow.material as THREE.SpriteMaterial)

    // The mind: its heart with the core, its shells, its band, and what
    // flies off it with the outer ring - revealed in that order at boot.
    this.mind = new JarvisMind(Math.min(window.devicePixelRatio, 2))
    this.coreGroup.add(this.mind.core)
    this.innerGroup.add(this.mind.shells)
    this.bandGroup.add(this.mind.band)
    this.outerGroup.add(this.mind.outer)

    // Outer tick ring.
    const tickPoints: number[] = []
    const TICKS = 144
    for (let i = 0; i < TICKS; i += 1) {
      const a = (i / TICKS) * Math.PI * 2
      const long = i % 6 === 0
      const r1 = 2.85
      const r2 = long ? 2.62 : 2.74
      tickPoints.push(Math.cos(a) * r1, Math.sin(a) * r1, 0, Math.cos(a) * r2, Math.sin(a) * r2, 0)
    }
    const tickGeometry = new THREE.BufferGeometry()
    tickGeometry.setAttribute("position", new THREE.Float32BufferAttribute(tickPoints, 3))
    this.ticks = new THREE.LineSegments(tickGeometry, new THREE.LineBasicMaterial(additive(color, 0.55)))
    this.track(this.ticks.material as THREE.LineBasicMaterial)
    this.outerGroup.add(this.ticks)

    this.glowMap = glowMap
    // Ultron's head takes most of a second to build; do it while the console
    // is idle, so switching to serious mode never waits on it.
    const idle = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const prebuild = () => {
      if (!this.face && !this.disposed) {
        this.face = new UltronFace(this.glowMap, this.accent.getHex(), this.renderer)
        this.face.group.visible = false
        this.root.add(this.face.group)
      }
    }
    const timer = setTimeout(() => (idle ? idle(prebuild, { timeout: 4000 }) : prebuild()), 3000)
    this.cleanups.push(() => clearTimeout(timer))
    this.ultron = document.documentElement.classList.contains("serious")

    this.applyReveal()

    // Sizing.
    const observer = new ResizeObserver(() => this.resize())
    observer.observe(container)
    this.cleanups.push(() => observer.disconnect())
    this.resize()

    // Events from the rest of the console.
    this.cleanups.push(onCore((event) => this.react(event)))

    // Tilt toward the mouse, or a tracked hand, when either is nearby.
    const onMove = (event: PointerEvent) => {
      this.pointerAt = { x: event.clientX, y: event.clientY }
    }
    const onLeave = () => {
      this.pointerAt = null
    }
    // Typing anywhere in the console: Ultron's eyes go to it.
    const onKey = () => {
      this.lastTyped = this.clock.elapsedTime
    }
    window.addEventListener("keydown", onKey)
    this.cleanups.push(() => window.removeEventListener("keydown", onKey))
    window.addEventListener("pointermove", onMove)
    document.addEventListener("pointerleave", onLeave)
    this.cleanups.push(() => {
      window.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerleave", onLeave)
    })
    this.cleanups.push(
      subscribeHands((pointers: HandPointer[]) => {
        if (pointers.length) this.pointerAt = { x: pointers[0].x, y: pointers[0].y }
      })
    )

    this.raf = requestAnimationFrame(this.frame)
  }

  setStatus(status: AgentStatus) {
    this.status = status
  }

  setRevealed(stage: number) {
    this.revealed = stage
    this.applyReveal()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.cleanups.forEach((fn) => fn())
    this.mind.dispose()
    this.face?.dispose()
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material?.dispose()
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // --- building helpers -------------------------------------------------

  private circle(radius: number, segments: number): THREE.BufferGeometry {
    const points: number[] = []
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2
      points.push(Math.cos(a) * radius, Math.sin(a) * radius, 0)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3))
    return geometry
  }

  private track(material: THREE.Material & { color: THREE.Color }) {
    this.tinted.push({ material })
  }

  private applyReveal() {
    // Mid-swap, each side flickers in and out at random, like a bad signal.
    const flicker = this.swap > 0
    const jarvis = flicker ? Math.random() < 0.5 : !this.ultron
    const ultron = flicker ? !jarvis || Math.random() < 0.3 : this.ultron
    this.coreGroup.visible = jarvis && this.revealed >= 0
    this.innerGroup.visible = jarvis && this.revealed >= 1
    this.bandGroup.visible = jarvis && this.revealed >= 2
    // The tick ring frames either; the mind's shards and bokeh are Jarvis's.
    this.outerGroup.visible = this.revealed >= 3
    this.mind.outer.visible = jarvis
    if (ultron && !this.face) {
      this.face = new UltronFace(this.glowMap, this.accent.getHex(), this.renderer)
      this.root.add(this.face.group)
    }
    if (this.face) this.face.group.visible = ultron && this.revealed >= 0
  }

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.container
    if (!width || !height) return
    this.renderer.setSize(width, height, false)
    this.mind?.setViewport(height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  // --- reactions --------------------------------------------------------

  private react(event: CoreEvent) {
    switch (event.kind) {
      case "send":
        this.energy += 0.6
        this.wave(1.2, 1.1)
        break
      case "reply":
        this.energy += 0.5
        this.wave(0.9, 1.4)
        this.wave(1.3, 1.6)
        break
      case "tool":
        this.burst = 1
        this.energy += 0.35
        this.wave(1.6, 0.9)
        break
      case "error":
        this.flash = 1
        this.shake = 1
        break
      case "click":
        this.energy += 0.25
        this.wave(0.6, 0.8)
        break
    }
  }

  private wave(startScale: number, life: number) {
    const line = new THREE.LineLoop(this.circle(1, 128), new THREE.LineBasicMaterial(additive(this.accent.getHex(), 1)))
    line.scale.setScalar(startScale)
    // Each one on a slightly different plane, so repeated waves read as
    // a sphere of energy rather than a stack of rings.
    line.rotation.set((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, 0)
    this.root.add(line)
    this.shockwaves.push({ line, age: 0, life, scale: startScale })
  }

  // --- frame ------------------------------------------------------------

  private frame = () => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(this.clock.getDelta(), 0.05)
    const t = this.clock.elapsedTime
    const spin = SPIN[this.status]

    // Live audio only means something while someone is talking.
    const live = this.status === "speaking" || this.status === "listening"
    this.amp += ((live ? audioAmplitude.current : 0) - this.amp) * 0.2
    const target = BASE_ENERGY[this.status] + this.amp * 1.4
    this.energy += (target - this.energy) * Math.min(1, dt * 2.5)
    const breath = 0.5 + 0.5 * Math.sin(t * (this.status === "idle" ? 1.6 : 3.2))
    const e = this.energy

    // Colour: the live accent, pulled toward red by an error flash.
    this.accentCheck -= dt
    if (this.accentCheck <= 0) {
      this.accentCheck = 0.2
      this.accent.setHex(accentHex())
      this.danger.setHex(cssHex("--error", 0xff3333))
      const serious = document.documentElement.classList.contains("serious")
      if (serious !== this.ultron) {
        this.ultron = serious
        this.swap = 0.5
        this.shake = 0.8
      }
    }
    if (this.swap > 0) {
      this.swap = Math.max(0, this.swap - dt)
      this.applyReveal()
    }
    this.flash = Math.max(0, this.flash - dt * 1.6)
    const tint = this.accent.clone().lerp(this.danger, this.flash)
    for (const { material } of this.tinted) material.color.copy(tint)

    // Core glow, and the mind.
    this.glow.scale.setScalar(1.3 + e * 1.2 + breath * 0.2 + this.amp * 1.0)
    ;(this.glow.material as THREE.SpriteMaterial).opacity = 0.35 + Math.min(0.4, e * 0.4)
    this.burst = Math.max(0, this.burst - dt * 1.2)
    this.mind.update(dt, t, { energy: e, amp: this.amp, spin, burst: this.burst, thinking: this.status === "thinking", tint })

    // Ticks.
    this.ticks.rotation.z -= dt * 0.1 * spin
    ;(this.ticks.material as THREE.LineBasicMaterial).opacity = 0.35 + Math.min(0.5, e * 0.4)

    // Shockwaves.
    this.shockwaves = this.shockwaves.filter((wave) => {
      wave.age += dt
      const p = wave.age / wave.life
      if (p >= 1) {
        this.root.remove(wave.line)
        wave.line.geometry.dispose()
        ;(wave.line.material as THREE.Material).dispose()
        return false
      }
      wave.line.scale.setScalar(wave.scale + p * 2.4)
      const material = wave.line.material as THREE.LineBasicMaterial
      material.color.copy(tint)
      material.opacity = (1 - p) * (1 - p)
      return true
    })

    // Tilt toward the pointer when it is near, back to neutral when not.
    if (this.pointerAt) {
      const rect = this.container.getBoundingClientRect()
      const nx = ((this.pointerAt.x - rect.left) / rect.width) * 2 - 1
      const ny = ((this.pointerAt.y - rect.top) / rect.height) * 2 - 1
      const near = Math.abs(nx) < 1.6 && Math.abs(ny) < 1.6
      this.tiltTarget.set(near ? ny * 0.35 : 0, near ? nx * 0.5 : 0)
    } else {
      this.tiltTarget.set(0, 0)
    }
    this.tilt.lerp(this.tiltTarget, Math.min(1, dt * 3))

    // Ultron turns his own head (toward the pointer); the scene stays square.
    if (this.face?.group.visible) {
      const look = this.ultron && this.tiltTarget.lengthSq() > 0 ? { x: this.tiltTarget.y / 0.5, y: this.tiltTarget.x / 0.35 } : null
      this.face.update(dt, t, { status: this.status, amp: this.amp, energy: e, look, sinceTyped: t - this.lastTyped, tint })
      if (this.ultron) this.tilt.set(0, 0)
    }

    // Error shake.
    this.shake = Math.max(0, this.shake - dt * 2.2)
    const jolt = this.shake * 0.12
    this.root.rotation.set(this.tilt.x, this.tilt.y, 0)
    this.root.position.set((Math.random() - 0.5) * jolt, (Math.random() - 0.5) * jolt, 0)
    this.root.scale.setScalar(1 + e * 0.06 + this.amp * 0.08)

    this.renderer.render(this.scene, this.camera)
  }
}
