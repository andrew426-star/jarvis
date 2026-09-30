"use client"

import * as THREE from "three"

import { audioAmplitude } from "@/lib/audio-amplitude"
import { accentHex, cssHex, onCore, type CoreEvent } from "@/lib/core-events"
import { subscribeHands, type HandPointer } from "@/lib/hand-tracking"
import type { AgentStatus } from "@/lib/store"

// The console's centre, as a 3D holographic cipher: a geodesic shell of
// points around nested wireframe polyhedra, three tilted bands of
// scrolling cipher glyphs, orbiting particles with trails, and shockwave
// rings. It reads, every frame:
//
//   status      - spin rate; thinking scrambles the glyphs and runs a scan
//   audio       - mic and narration level swell the shell and the core
//   core events - send, reply, tool and click fire shockwaves and bursts,
//                 an error flashes it red and shakes it
//   pointer     - the mouse or a tracked hand near it tilts it toward you
//   mode        - the accent colour, read live, so a mode wipe recolours it
//
// One WebGL context, additive line and point materials, no post-processing:
// it sits in a corner of the layout and has to stay cheap.

const GLYPHS = "0123456789ABCDEF∑∆Ω⌬⏣⟁◬⌖ΞΨΦ#<>/\\"

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

// A ring of glyphs drawn into a canvas and wrapped round an open cylinder.
// Scrolling is a texture offset; "decryption" is redrawing some or all of
// the characters.
class GlyphBand {
  readonly mesh: THREE.Mesh
  private readonly canvas = document.createElement("canvas")
  private readonly ctx: CanvasRenderingContext2D
  private readonly texture: THREE.CanvasTexture
  private readonly chars: string[]

  constructor(radius: number, height: number, count: number, color: number) {
    this.canvas.width = 2048
    this.canvas.height = 64
    this.ctx = this.canvas.getContext("2d")!
    this.chars = Array.from({ length: count }, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)])
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.wrapS = THREE.RepeatWrapping
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.draw()
    this.mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 128, 1, true),
      new THREE.MeshBasicMaterial({ ...additive(color, 1), map: this.texture, side: THREE.DoubleSide })
    )
  }

  scramble(fraction: number) {
    for (let i = 0; i < this.chars.length; i += 1) {
      if (Math.random() < fraction) this.chars[i] = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
    }
    this.draw()
  }

  scroll(amount: number) {
    this.texture.offset.x = (this.texture.offset.x + amount) % 1
  }

  private draw() {
    const { ctx, canvas, chars } = this
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = "#fff"
    ctx.font = "700 44px 'JetBrains Mono', ui-monospace, monospace"
    ctx.textBaseline = "middle"
    ctx.textAlign = "center"
    const step = canvas.width / chars.length
    chars.forEach((char, i) => {
      ctx.globalAlpha = 0.7 + ((i * 37) % 7) / 20
      ctx.fillText(char, step * (i + 0.5), canvas.height / 2)
    })
    // Rules above and below, like a data track.
    ctx.globalAlpha = 0.5
    ctx.fillRect(0, 2, canvas.width, 2)
    ctx.fillRect(0, canvas.height - 4, canvas.width, 2)
    this.texture.needsUpdate = true
  }

  dispose() {
    this.texture.dispose()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}

interface Electron {
  axis: THREE.Quaternion
  radius: number
  speed: number
  phase: number
  head: THREE.Mesh
  trail: THREE.Line
  history: THREE.Vector3[]
}

interface Shockwave {
  line: THREE.LineLoop
  age: number
  life: number
  scale: number
}

const TRAIL = 36

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
  private readonly heart: THREE.Mesh
  private readonly ico: THREE.LineSegments
  private readonly octa: THREE.LineSegments
  private readonly shell: THREE.Points
  private readonly shellBase: Float32Array
  private readonly lattice: THREE.LineSegments
  private readonly ticks: THREE.LineSegments
  private readonly scan: THREE.LineLoop
  private readonly bands: GlyphBand[] = []
  private readonly bandPivots: THREE.Group[] = []
  private readonly electrons: Electron[] = []
  private shockwaves: Shockwave[] = []
  private readonly tinted: { material: THREE.Material & { color: THREE.Color }; white?: boolean }[] = []

  private status: AgentStatus = "idle"
  private revealed = -1
  private energy = 0.2
  private amp = 0
  private flash = 0
  private shake = 0
  private burst = 0
  private scrambleTimer = 0
  private accent = new THREE.Color(0x00d4ff)
  private readonly danger = new THREE.Color(0xff3333)
  private accentCheck = 0
  private readonly tilt = new THREE.Vector2()
  private readonly tiltTarget = new THREE.Vector2()
  private pointerAt: { x: number; y: number } | null = null

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

    // Core: a white-hot point inside a glow.
    const glowMap = glowTexture()
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ ...additive(color, 0.9), map: glowMap }))
    this.glow.scale.setScalar(2.2)
    this.heart = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.09, 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    )
    this.coreGroup.add(this.glow, this.heart)
    this.track(this.glow.material as THREE.SpriteMaterial)

    // Nested polyhedra, counter-rotating.
    this.ico = this.edges(new THREE.IcosahedronGeometry(0.78, 0), 0.95)
    this.octa = this.edges(new THREE.OctahedronGeometry(0.5, 0), 0.8)
    const dodeca = this.edges(new THREE.DodecahedronGeometry(1.05, 0), 0.35)
    this.innerGroup.add(this.ico, this.octa, dodeca)

    // Geodesic shell: points that ripple, over a faint lattice.
    const shellGeometry = new THREE.IcosahedronGeometry(1.5, 4)
    shellGeometry.deleteAttribute("normal")
    shellGeometry.deleteAttribute("uv")
    this.shellBase = Float32Array.from(shellGeometry.getAttribute("position").array)
    this.shell = new THREE.Points(
      shellGeometry,
      new THREE.PointsMaterial({ ...additive(color, 0.75), size: 0.028, sizeAttenuation: true })
    )
    this.track(this.shell.material as THREE.PointsMaterial)
    this.lattice = this.edges(new THREE.IcosahedronGeometry(1.5, 1), 0.16)
    this.innerGroup.add(this.shell, this.lattice)

    // Cipher bands on three tilts.
    const tilts: [number, number, number, number][] = [
      // [tiltX, tiltZ, radius, glyphs]
      [0.18, 0.05, 1.95, 64],
      [1.15, 0.4, 2.2, 72],
      [-0.9, -0.55, 2.45, 80],
    ]
    for (const [tx, tz, radius, count] of tilts) {
      const band = new GlyphBand(radius, 0.17, count, color)
      this.track(band.mesh.material as THREE.MeshBasicMaterial)
      const pivot = new THREE.Group()
      pivot.rotation.set(tx, 0, tz)
      pivot.add(band.mesh)
      this.bandGroup.add(pivot)
      this.bands.push(band)
      this.bandPivots.push(pivot)
    }

    // Outer tick ring and the thinking scan.
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

    this.scan = new THREE.LineLoop(this.circle(1.55, 96), new THREE.LineBasicMaterial(additive(color, 0)))
    this.scan.rotation.x = Math.PI / 2
    this.track(this.scan.material as THREE.LineBasicMaterial)
    this.innerGroup.add(this.scan)

    // Electrons with fading trails.
    for (let i = 0; i < 4; i += 1) {
      const axis = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
      )
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }))
      const trailGeometry = new THREE.BufferGeometry()
      trailGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(TRAIL * 3), 3))
      trailGeometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(TRAIL * 3), 3))
      const trail = new THREE.Line(
        trailGeometry,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      )
      this.outerGroup.add(head, trail)
      this.electrons.push({
        axis,
        radius: 1.75 + Math.random() * 0.6,
        speed: 0.9 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
        head,
        trail,
        history: [],
      })
    }

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
    cancelAnimationFrame(this.raf)
    this.cleanups.forEach((fn) => fn())
    this.bands.forEach((band) => band.dispose())
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

  private edges(geometry: THREE.BufferGeometry, opacity: number): THREE.LineSegments {
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial(additive(this.accent.getHex(), opacity))
    )
    geometry.dispose()
    this.track(lines.material as THREE.LineBasicMaterial)
    return lines
  }

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
    this.coreGroup.visible = this.revealed >= 0
    this.innerGroup.visible = this.revealed >= 1
    this.bandGroup.visible = this.revealed >= 2
    this.outerGroup.visible = this.revealed >= 3
  }

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.container
    if (!width || !height) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  // --- reactions --------------------------------------------------------

  private react(event: CoreEvent) {
    switch (event.kind) {
      case "send":
        this.energy += 0.6
        this.wave(1.2, 1.1)
        this.bands.forEach((band) => band.scramble(0.6))
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
    }
    this.flash = Math.max(0, this.flash - dt * 1.6)
    const tint = this.accent.clone().lerp(this.danger, this.flash)
    for (const { material } of this.tinted) material.color.copy(tint)

    // Core.
    this.glow.scale.setScalar(1.8 + e * 1.6 + breath * 0.25 + this.amp * 1.2)
    ;(this.glow.material as THREE.SpriteMaterial).opacity = 0.55 + Math.min(0.45, e * 0.5)
    this.heart.scale.setScalar(1 + this.amp * 1.5 + breath * 0.15)

    // Polyhedra.
    this.ico.rotation.x += dt * 0.35 * spin
    this.ico.rotation.y += dt * 0.5 * spin
    this.octa.rotation.x -= dt * 0.6 * spin
    this.octa.rotation.z += dt * 0.45 * spin
    this.lattice.rotation.y -= dt * 0.08 * spin
    this.shell.rotation.y += dt * 0.12 * spin
    this.shell.rotation.x = Math.sin(t * 0.2) * 0.2

    // Shell ripple: every point pushed out along its own direction by a
    // travelling wave, harder when energy or audio is up.
    const positions = this.shell.geometry.getAttribute("position") as THREE.BufferAttribute
    const array = positions.array as Float32Array
    const ripple = 0.025 + e * 0.07 + this.amp * 0.25
    for (let i = 0; i < array.length; i += 3) {
      const bx = this.shellBase[i]
      const by = this.shellBase[i + 1]
      const bz = this.shellBase[i + 2]
      const wave = Math.sin(t * 3.2 + by * 3.5 + bx * 1.7) * Math.cos(t * 1.7 + bz * 2.6)
      const k = 1 + wave * ripple
      array[i] = bx * k
      array[i + 1] = by * k
      array[i + 2] = bz * k
    }
    positions.needsUpdate = true

    // Cipher bands: always scrolling; a trickle of changed glyphs at rest,
    // continuous scrambling while he thinks.
    this.bandPivots.forEach((pivot, i) => {
      pivot.rotation.y += dt * (i % 2 === 0 ? 0.25 : -0.32) * spin
    })
    this.bands.forEach((band, i) => band.scroll(dt * 0.01 * (i + 1) * spin))
    this.scrambleTimer -= dt
    if (this.scrambleTimer <= 0) {
      const thinking = this.status === "thinking"
      this.scrambleTimer = thinking ? 0.08 : 1.2
      this.bands.forEach((band) => band.scramble(thinking ? 0.35 : 0.06))
    }

    // Ticks.
    this.ticks.rotation.z -= dt * 0.1 * spin
    ;(this.ticks.material as THREE.LineBasicMaterial).opacity = 0.35 + Math.min(0.5, e * 0.4)

    // Thinking scan: a ring sweeping up and down through the shell.
    const scanMaterial = this.scan.material as THREE.LineBasicMaterial
    const scanning = this.status === "thinking"
    scanMaterial.opacity += ((scanning ? 0.9 : 0) - scanMaterial.opacity) * Math.min(1, dt * 6)
    const sweep = Math.sin(t * 2.4)
    this.scan.position.y = sweep * 1.3
    this.scan.scale.setScalar(Math.sqrt(Math.max(0.05, 1 - sweep * sweep * 0.7)))

    // Electrons: faster with energy; a tool burst flings them wide.
    this.burst = Math.max(0, this.burst - dt * 1.2)
    const point = new THREE.Vector3()
    for (const electron of this.electrons) {
      electron.phase += dt * electron.speed * (1 + e * 1.5) * spin * 0.8
      const radius = electron.radius * (1 + this.burst * 0.45)
      point.set(Math.cos(electron.phase) * radius, 0, Math.sin(electron.phase) * radius).applyQuaternion(electron.axis)
      electron.head.position.copy(point)
      electron.history.unshift(point.clone())
      if (electron.history.length > TRAIL) electron.history.pop()
      const trailPositions = electron.trail.geometry.getAttribute("position") as THREE.BufferAttribute
      const trailColors = electron.trail.geometry.getAttribute("color") as THREE.BufferAttribute
      for (let i = 0; i < TRAIL; i += 1) {
        const p = electron.history[Math.min(i, electron.history.length - 1)]
        trailPositions.setXYZ(i, p.x, p.y, p.z)
        const fade = 1 - i / TRAIL
        trailColors.setXYZ(i, tint.r * fade, tint.g * fade, tint.b * fade)
      }
      trailPositions.needsUpdate = true
      trailColors.needsUpdate = true
    }

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

    // Error shake.
    this.shake = Math.max(0, this.shake - dt * 2.2)
    const jolt = this.shake * 0.12
    this.root.rotation.set(this.tilt.x, this.tilt.y, 0)
    this.root.position.set((Math.random() - 0.5) * jolt, (Math.random() - 0.5) * jolt, 0)
    this.root.scale.setScalar(1 + e * 0.06 + this.amp * 0.08)

    this.renderer.render(this.scene, this.camera)
  }
}
