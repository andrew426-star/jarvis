"use client"

import * as THREE from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"

import { labMaterial } from "@/lib/workshop/lab/catalog"
import type { LabResult, LabTest } from "@/lib/workshop/lab/tests"

// The material lab's bench: one lane per material, each specimen in its
// real material (glass that refracts, rubber, brushed metal, printed
// layers), going through the test together - dogbones stretching, necking
// and snapping in their grips, balls falling onto the anvil to bounce or
// shatter, bars bending over the supports, cantilevers sagging in the heat
// and glowing as they get hot. Millimetres scaled to scene units (1 unit
// = 20 mm), y up.

const MM = 0.05
const LANE = 3.2
const steel = () => new THREE.MeshPhysicalMaterial({ color: 0x3a3e44, metalness: 1, roughness: 0.35 })

function textSprite(text: string, color = "#9fe8ff") {
  const canvas = document.createElement("canvas")
  canvas.width = 512
  canvas.height = 96
  const ctx = canvas.getContext("2d")!
  ctx.font = "600 40px ui-monospace, monospace"
  ctx.fillStyle = color
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text.toUpperCase(), 256, 48)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  sprite.scale.set(2.8, 0.52, 1)
  return sprite
}

/** Incandescence: dull red from about 500 C to yellow-white past 1100. */
function glow(T: number): { color: THREE.Color; level: number } {
  const k = THREE.MathUtils.clamp((T - 480) / 650, 0, 1)
  const color = new THREE.Color().setHSL(0.02 + k * 0.1, 1, 0.35 + k * 0.3)
  return { color, level: k * k * 3 }
}

interface Lane {
  result: LabResult
  root: THREE.Group
  material: THREE.MeshPhysicalMaterial
  update: (t: number, dt: number) => void
}

export class LabScene {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200)
  private readonly observer: ResizeObserver
  private lanes: Lane[] = []
  private readonly bench = new THREE.Group()
  private raf = 0
  private last = performance.now()
  private progress = 0
  private yaw = 0
  private targetYaw = 0
  private test: LabTest = "tensile"

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.domElement.style.display = "block"
    host.appendChild(this.renderer.domElement)
    this.scene.background = new THREE.Color(0x05080d)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    this.scene.environmentIntensity = 0.7
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x101010, 0.4))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(6, 14, 10)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    const s = key.shadow.camera
    s.left = s.bottom = -14
    s.right = s.top = 14
    key.shadow.radius = 5
    key.shadow.bias = -0.0004
    this.scene.add(key)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshPhysicalMaterial({ color: 0x15191f, roughness: 0.8, metalness: 0.2 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor, this.bench)
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()
    this.raf = requestAnimationFrame(this.frame)
  }

  private resize() {
    const w = this.host.clientWidth || 1
    const h = this.host.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = "100%"
    this.renderer.domElement.style.height = "100%"
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.frameCamera()
  }

  private frameCamera() {
    const width = Math.max(1, this.lanes.length) * LANE
    const height = this.test === "drop" ? 7 : this.test === "tensile" ? 6 : 4
    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    const fit = Math.max(height / (2 * Math.tan(fov / 2)), width / (2 * Math.tan(fov / 2) * this.camera.aspect)) * 1.15
    const r = fit + 4
    this.camera.position.set(Math.sin(this.yaw) * r, height * 0.55 + r * 0.18, Math.cos(this.yaw) * r)
    this.camera.lookAt(0, height * 0.42, 0)
  }

  /** Turn the bench (drag). */
  orbit(dx: number) {
    this.targetYaw = THREE.MathUtils.clamp(this.targetYaw + dx * 0.005, -0.9, 0.9)
  }

  /** Set up a run: one lane per result. */
  load(test: LabTest, results: LabResult[]) {
    this.clear()
    this.test = test
    results.forEach((result, i) => {
      const root = new THREE.Group()
      root.position.x = (i - (results.length - 1) / 2) * LANE
      this.bench.add(root)
      const material = labMaterial(result.material)
      const lane: Lane = { result, root, material, update: () => {} }
      lane.update = this.build(test, lane)
      const label = textSprite(result.material.name)
      // In front of the lane, on the bench, where nothing stands in front of it.
      label.position.set(0, 0.22, 1.5)
      root.add(label)
      root.traverse((n) => {
        if ((n as THREE.Mesh).isMesh) n.castShadow = n.receiveShadow = true
      })
      this.lanes.push(lane)
    })
    this.progress = 0
    this.lanes.forEach((l) => l.update(0, 0))
    this.frameCamera()
  }

  /** Where the run is, 0-1. */
  setProgress(t: number) {
    this.progress = t
  }

  private build(test: LabTest, lane: Lane): (t: number, dt: number) => void {
    const { root, material, result } = lane
    if (test === "tensile") {
      const grip = steel()
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.8), grip)
      base.position.y = 0.6
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.8), grip)
      const lower = new THREE.Mesh(new THREE.BoxGeometry(20 * MM, 20 * MM, 4 * MM), material)
      const upper = lower.clone()
      const gauge = new THREE.Mesh(new THREE.BoxGeometry(10 * MM, 1, 4 * MM), material)
      const gaugeB = gauge.clone()
      root.add(base, top, lower, upper, gauge, gaugeB)
      const L = 50 * MM
      const y0 = 1.0 + 10 * MM
      return (t) => {
        const pose = result.pose(t)
        // Shown stretch is capped so a 6x rubber still fits the bench.
        const strain = Math.min(pose.value, 1.3)
        const stretched = L * (1 + strain)
        const thin = 1 / Math.sqrt(1 + strain)
        lower.position.y = y0
        if (!pose.broken) {
          gauge.visible = true
          gaugeB.visible = false
          gauge.scale.set(thin, stretched, thin)
          gauge.position.y = y0 + 10 * MM + stretched / 2
          upper.position.y = y0 + 20 * MM + stretched
        } else {
          // Snapped: two halves, the top one carried off by the crosshead.
          const half = (stretched / 2) * 0.9
          const gap = 0.35
          gauge.visible = gaugeB.visible = true
          gauge.scale.set(thin, half, thin)
          gaugeB.scale.set(thin, half, thin)
          gauge.position.y = y0 + 10 * MM + half / 2
          upper.position.y = y0 + 20 * MM + stretched + gap
          gaugeB.position.y = upper.position.y - 10 * MM - half / 2
        }
        top.position.y = upper.position.y + 0.4
      }
    }

    if (test === "drop") {
      const anvil = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.6), steel())
      anvil.position.y = 0.3
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.25, 48, 32), material)
      root.add(anvil, ball)
      const shards: { mesh: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3 }[] = []
      const top = 6
      const h = Math.max(0.01, result.curve[0][1] / 100)
      return (t, dt) => {
        const pose = result.pose(t)
        const y = 0.6 + 0.25 + (pose.value / h) * (top - 1)
        ball.position.y = y
        ball.scale.set(1, pose.dented ? 0.9 : 1, 1)
        if (pose.broken && !shards.length) {
          ball.visible = false
          for (let i = 0; i < 22; i += 1) {
            const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.05 + Math.random() * 0.08), material)
            mesh.position.set(0, 0.85, 0)
            mesh.castShadow = true
            const a = Math.random() * Math.PI * 2
            const sp = 1.5 + Math.random() * 3
            shards.push({ mesh, v: new THREE.Vector3(Math.cos(a) * sp, 1 + Math.random() * 3, Math.sin(a) * sp), spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10) })
            root.add(mesh)
          }
        }
        if (!pose.broken && shards.length) {
          shards.forEach((s) => root.remove(s.mesh))
          shards.length = 0
          ball.visible = true
        }
        for (const s of shards) {
          s.v.y -= 9.8 * dt
          s.mesh.position.addScaledVector(s.v, dt)
          const floor = Math.abs(s.mesh.position.x) < 0.8 && Math.abs(s.mesh.position.z) < 0.8 ? 0.62 : 0.03
          if (s.mesh.position.y < floor) {
            s.mesh.position.y = floor
            s.v.multiplyScalar(0.35)
            s.v.y = Math.abs(s.v.y) * 0.3
          }
          s.mesh.rotation.x += s.spin.x * dt * (s.v.length() > 0.1 ? 1 : 0)
          s.mesh.rotation.z += s.spin.z * dt * (s.v.length() > 0.1 ? 1 : 0)
        }
      }
    }

    if (test === "bend") {
      const support = steel()
      for (const x of [-50, 50]) {
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(5 * MM, 5 * MM, 1.2, 24), support)
        pin.rotation.x = Math.PI / 2
        pin.position.set(x * MM, 1.2, 0)
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.2, 1.2), support)
        post.position.set(x * MM, 0.6, 0)
        root.add(pin, post)
      }
      const nose = new THREE.Mesh(new THREE.CylinderGeometry(5 * MM, 5 * MM, 1.2, 24), support)
      nose.rotation.x = Math.PI / 2
      const ram = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2, 0.6), support)
      root.add(nose, ram)
      const L = 120
      const geometry = new THREE.BoxGeometry(L * MM, 4 * MM, 10 * MM, 60, 1, 1)
      const rest = Float32Array.from(geometry.attributes.position.array)
      const bar = new THREE.Mesh(geometry, material)
      root.add(bar)
      const barY = 1.2 + 5 * MM + 2 * MM
      return (t) => {
        const pose = result.pose(t)
        const d = pose.value * MM
        const pos = geometry.attributes.position as THREE.BufferAttribute
        const span = 100 * MM
        for (let i = 0; i < pos.count; i += 1) {
          const x = rest[i * 3]
          const u = span / 2 - Math.abs(x)
          let shape = (3 * span * span * u - 4 * u * u * u) / span ** 3
          if (pose.broken) shape = Math.min(1, Math.max(0, u / (span / 2))) * 1.3
          pos.setY(i, rest[i * 3 + 1] - d * shape)
          // A broken bar parts at the middle.
          pos.setX(i, pose.broken ? x + Math.sign(x) * 0.06 : x)
        }
        pos.needsUpdate = true
        geometry.computeVertexNormals()
        bar.position.y = barY
        nose.position.y = barY - d * (pose.broken ? 1.3 : 1) + 2 * MM + 5 * MM
        ram.position.y = nose.position.y + 1
      }
    }

    // heat: a cantilever in a clamp, a weight on its tip.
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 1), steel())
    clamp.position.set(-1.6, 1.3, 0)
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.8), steel())
    stand.position.set(-1.6, 0.4, 0)
    const L = 60
    const geometry = new THREE.BoxGeometry(L * MM, 4 * MM, 10 * MM, 40, 1, 1).translate((L * MM) / 2, 0, 0)
    const rest = Float32Array.from(geometry.attributes.position.array)
    const arm = new THREE.Mesh(geometry, material)
    arm.position.set(-1.3, 1.5, 0)
    const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 24), steel())
    const puddle = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.03, 32), material)
    puddle.position.set(0.2, 0.02, 0)
    puddle.visible = false
    const furnace = new THREE.PointLight(0xff6a2a, 0, 6, 2)
    furnace.position.set(0, 0.6, 0.8)
    root.add(clamp, stand, arm, weight, puddle, furnace)
    const baseColor = material.color.clone()
    const chars = result.material.meltWord === "chars" || result.material.meltWord === "decomposes"
    return (t) => {
      const pose = result.pose(t)
      const T = pose.temp ?? 20
      const sag = Math.min(pose.value, 60) * MM
      const pos = geometry.attributes.position as THREE.BufferAttribute
      const len = L * MM
      for (let i = 0; i < pos.count; i += 1) {
        const x = rest[i * 3]
        const shape = (3 * len * x * x - x * x * x) / (2 * len ** 3)
        pos.setY(i, rest[i * 3 + 1] - sag * shape)
      }
      pos.needsUpdate = true
      geometry.computeVertexNormals()
      arm.visible = !pose.broken
      puddle.visible = pose.broken && !chars
      weight.position.set(-1.3 + len, pose.broken ? 0.18 : 1.5 - sag - 0.2, 0)
      // Hot metal and glass glow; polymers and wood darken toward their char.
      const g = glow(T)
      material.emissive.copy(g.color)
      material.emissiveIntensity = g.level
      const toChar = THREE.MathUtils.clamp((T - result.material.soften) / Math.max(1, result.material.melt - result.material.soften), 0, 1)
      material.color.copy(baseColor).lerp(new THREE.Color(0x1a1008), chars ? toChar * 0.9 : 0)
      furnace.intensity = THREE.MathUtils.clamp((T - 20) / 700, 0, 1) * 4
    }
  }

  private clear() {
    for (const lane of this.lanes) {
      lane.root.traverse((n) => {
        const mesh = n as THREE.Mesh
        mesh.geometry?.dispose()
        const m = mesh.material as THREE.Material | undefined
        if (m && "map" in m && (m as THREE.SpriteMaterial).map) (m as THREE.SpriteMaterial).map!.dispose()
        m?.dispose()
      })
      this.bench.remove(lane.root)
    }
    this.lanes = []
  }

  private frame = () => {
    this.raf = requestAnimationFrame(this.frame)
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    if (Math.abs(this.targetYaw - this.yaw) > 1e-4) {
      this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 6)
      this.frameCamera()
    }
    for (const lane of this.lanes) lane.update(this.progress, dt)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.observer.disconnect()
    this.clear()
    this.scene.environment?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
