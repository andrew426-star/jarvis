"use client"

import * as THREE from "three"

import type { Cue, WearAction } from "@/lib/workshop/project/types"

// What a worn project does, simulated over the camera picture: a repulsor
// charges in the palm and fires (flash, shockwave rings, a beam, sparks),
// a unibeam burns while held, a launcher shoots missiles, tracers or a web
// line, a deploy swings or slides its parts out, an arc reactor glows.
// Emitters ride on the model; what leaves it flies on in camera space,
// in centimetres. Light is added, never painted: every glow blends onto
// the picture additively (colour added, the canvas's alpha untouched), so
// it brightens the real room the way the light would, and the strongest
// effect also spills a soft glow across the whole picture.

/** Additive light that leaves alpha alone, so it adds to the video below. */
export function lightBlend<T extends THREE.Material>(material: T): T {
  material.blending = THREE.CustomBlending
  material.blendEquation = THREE.AddEquation
  material.blendSrc = THREE.SrcAlphaFactor
  material.blendDst = THREE.OneFactor
  material.blendSrcAlpha = THREE.ZeroFactor
  material.blendDstAlpha = THREE.OneFactor
  material.transparent = true
  material.depthWrite = false
  return material
}

const textures: Record<string, THREE.Texture> = {}

function sprite(name: "glow" | "ring" | "smoke" | "star") {
  if (textures[name]) return textures[name]
  const n = 128
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = n
  const ctx = canvas.getContext("2d")!
  const c = n / 2
  if (name === "glow") {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c)
    g.addColorStop(0, "rgba(255,255,255,1)")
    g.addColorStop(0.15, "rgba(255,255,255,0.75)")
    g.addColorStop(0.4, "rgba(255,255,255,0.22)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, n, n)
  } else if (name === "ring") {
    const g = ctx.createRadialGradient(c, c, c * 0.55, c, c, c)
    g.addColorStop(0, "rgba(255,255,255,0)")
    g.addColorStop(0.55, "rgba(255,255,255,0.9)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, n, n)
  } else if (name === "star") {
    ctx.translate(c, c)
    for (let i = 0; i < 6; i += 1) {
      ctx.rotate(Math.PI / 3)
      const g = ctx.createLinearGradient(0, 0, c, 0)
      g.addColorStop(0, "rgba(255,255,255,0.9)")
      g.addColorStop(1, "rgba(255,255,255,0)")
      ctx.fillStyle = g
      ctx.fillRect(0, -1.5, c, 3)
    }
  } else {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c)
    g.addColorStop(0, "rgba(200,200,200,0.55)")
    g.addColorStop(0.6, "rgba(160,160,160,0.2)")
    g.addColorStop(1, "rgba(140,140,140,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, n, n)
  }
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  textures[name] = t
  return t
}

function glowSprite(color: THREE.Color, name: "glow" | "ring" | "star" = "glow") {
  const s = new THREE.Sprite(lightBlend(new THREE.SpriteMaterial({ map: sprite(name), color, depthTest: true })))
  s.renderOrder = 10
  return s
}

/** A beam's look: a white-hot core, a coloured sheath, flicker along it. */
function beamMaterial(color: THREE.Color) {
  return lightBlend(
    new THREE.ShaderMaterial({
      uniforms: { color: { value: color }, intensity: { value: 0 }, time: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color; uniform float intensity, time;
        varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        void main() {
          float f = abs(dot(normalize(vN), normalize(vV)));
          float core = pow(f, 4.0);
          float flicker = 0.85 + 0.15 * sin(vUv.y * 90.0 - time * 70.0);
          float ends = smoothstep(0.0, 0.04, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
          vec3 c = mix(color, vec3(1.0), core * 0.85) * (core * 1.6 + f * 0.35) * intensity * flicker * ends;
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: THREE.DoubleSide,
    })
  )
}

/** A unit cylinder from the origin along +y, for beams and tracers. */
const BEAM_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0)
const UP = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)

interface Transient {
  objects: THREE.Object3D[]
  age: number
  life: number
  /** Return false to end early. */
  tick: (age: number, dt: number) => boolean | void
}

interface Target {
  object: THREE.Object3D
  base: THREE.Matrix4
}

interface Live {
  action: WearAction
  cue: Cue
  color: THREE.Color
  glow: THREE.Sprite
  light: THREE.PointLight
  charge: number
  cooldown: number
  held: boolean
  /** A press of its button: fire now (repulsor/projectile), hold a while (beam). */
  pressed: number
  beam: THREE.Mesh | null
  beamLevel: number
  deployed: boolean
  progress: number
  targets: Target[]
  burstLeft: number
  burstTimer: number
  /** A brief extra brightness after a shot. */
  kick: number
}

export class ActionRig {
  private readonly lives: Live[] = []
  private readonly transients: Transient[] = []
  private readonly sparks: { points: THREE.Points; velocity: Float32Array; age: Float32Array; next: number }
  private readonly spill: THREE.Mesh
  private readonly spillMaterial: THREE.ShaderMaterial
  private time = 0
  private readonly emit = new THREE.Vector3()
  private readonly aim = new THREE.Vector3()

  constructor(
    private readonly scene: THREE.Scene,
    private readonly overlay: THREE.Scene,
    private readonly model: THREE.Object3D,
    actions: WearAction[],
    cueFor: (cue: Cue) => Cue,
    private readonly onFire: (name: string) => void
  ) {
    for (const action of actions) {
      const color = new THREE.Color(action.color ?? "#bfe6ff")
      const glow = glowSprite(color)
      glow.visible = action.kind !== "deploy"
      scene.add(glow)
      const light = new THREE.PointLight(color, 0, 0, 2)
      scene.add(light)
      const live: Live = {
        action,
        cue: cueFor(action.cue),
        color,
        glow,
        light,
        charge: 0,
        cooldown: 0,
        held: false,
        pressed: 0,
        beam: null,
        beamLevel: 0,
        deployed: false,
        progress: 0,
        targets: [],
        burstLeft: 0,
        burstTimer: 0,
        kick: 0,
      }
      if (action.kind === "beam") {
        live.beam = new THREE.Mesh(BEAM_GEOMETRY, beamMaterial(color))
        live.beam.frustumCulled = false
        live.beam.visible = false
        live.beam.renderOrder = 11
        scene.add(live.beam)
      }
      if (action.kind === "deploy") live.targets = this.findTargets(action.targets ?? [])
      this.lives.push(live)
    }

    // One pool of sparks for everything.
    const count = 400
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3).fill(1e5), 3))
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    const points = new THREE.Points(
      geometry,
      lightBlend(new THREE.PointsMaterial({ map: sprite("glow"), size: 1.1, sizeAttenuation: true, vertexColors: true }))
    )
    points.frustumCulled = false
    points.renderOrder = 12
    scene.add(points)
    this.sparks = { points, velocity: new Float32Array(count * 3), age: new Float32Array(count).fill(9), next: 0 }

    // The light spilling across the picture.
    this.spillMaterial = lightBlend(
      new THREE.ShaderMaterial({
        uniforms: { centre: { value: new THREE.Vector2() }, color: { value: new THREE.Color() }, strength: { value: 0 }, aspect: { value: 1 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec2 centre; uniform vec3 color; uniform float strength, aspect;
          varying vec2 vUv;
          void main() {
            vec2 d = (vUv * 2.0 - 1.0) - centre;
            d.x *= aspect;
            float r2 = dot(d, d);
            float glow = 0.55 * exp(-r2 * 7.0) + 0.25 * exp(-r2 * 1.2) + 0.06;
            gl_FragColor = vec4(color * glow * strength, 1.0);
          }`,
        depthTest: false,
      })
    )
    this.spill = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.spillMaterial)
    this.spill.frustumCulled = false
    overlay.add(this.spill)
  }

  get names() {
    return this.lives.map((l) => l.action.name)
  }

  /** The button: fire (or toggle) an action by name, or the first. */
  press(name?: string) {
    const live = name ? this.lives.find((l) => l.action.name.toLowerCase() === name.toLowerCase()) : this.lives[0]
    if (!live) return false
    live.pressed = live.action.kind === "beam" ? 1.6 : 0.01
    return true
  }

  private findTargets(names: string[]): Target[] {
    const wanted = new Set(names.map((n) => n.toLowerCase()))
    const out: Target[] = []
    for (const child of this.model.children) {
      const keys = [child.userData.partId, child.userData.printedName, child.userData.group].filter(Boolean).map((k: string) => k.toLowerCase())
      if (keys.some((k) => wanted.has(k))) {
        child.updateMatrix()
        out.push({ object: child, base: child.matrix.clone() })
      }
    }
    return out
  }

  /** The emitter's place and direction in camera space (cm). */
  private locate(action: WearAction) {
    const [x = 0, y = 0, z = 0] = action.at
    const [dx = 0, dy = 0, dz = -1] = action.dir
    const local = new THREE.Vector3(dx, dy, dz)
    if (local.lengthSq() < 1e-9) local.set(0, 0, -1)
    local.normalize()
    // A few millimetres out of its surface, so the glow sits in front of it.
    this.emit.set(x, y, z).addScaledVector(local, 5)
    this.model.localToWorld(this.emit)
    const rotation = new THREE.Quaternion()
    this.model.getWorldQuaternion(rotation)
    this.aim.copy(local).applyQuaternion(rotation).normalize()
    return { at: this.emit.clone(), dir: this.aim.clone() }
  }

  private burst(at: THREE.Vector3, dir: THREE.Vector3, color: THREE.Color, n: number, speed: number, spread: number) {
    const s = this.sparks
    const pos = s.points.geometry.getAttribute("position") as THREE.BufferAttribute
    const col = s.points.geometry.getAttribute("color") as THREE.BufferAttribute
    const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? UP : Z).normalize()
    const up = new THREE.Vector3().crossVectors(side, dir)
    for (let k = 0; k < n; k += 1) {
      const i = s.next
      s.next = (s.next + 1) % s.age.length
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * spread
      const v = dir.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8))
      pos.setXYZ(i, at.x, at.y, at.z)
      s.velocity.set([v.x, v.y, v.z], i * 3)
      const hot = Math.random() < 0.4 ? new THREE.Color(1, 1, 1) : color
      col.setXYZ(i, hot.r, hot.g, hot.b)
      s.age[i] = 0
    }
    pos.needsUpdate = col.needsUpdate = true
  }

  private add(t: Transient) {
    for (const o of t.objects) this.scene.add(o)
    this.transients.push(t)
  }

  private flash(at: THREE.Vector3, color: THREE.Color, size: number, life: number) {
    const s = glowSprite(color)
    s.position.copy(at)
    const star = glowSprite(color, "star")
    star.position.copy(at)
    this.add({
      objects: [s, star],
      age: 0,
      life,
      tick: (age) => {
        const k = 1 - age / life
        s.scale.setScalar(size * (0.6 + age / life))
        star.scale.setScalar(size * 1.8 * (0.5 + age / life))
        ;(s.material as THREE.SpriteMaterial).opacity = k * k
        ;(star.material as THREE.SpriteMaterial).opacity = k * k * 0.8
      },
    })
  }

  private repulsor(live: Live) {
    const { at, dir } = this.locate(live.action)
    const color = live.color
    this.flash(at, color, 14, 0.3)
    // Shockwave rings running out along the shot.
    for (let i = 0; i < 3; i += 1) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 48), lightBlend(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })))
      ring.quaternion.setFromUnitVectors(Z, dir)
      ring.renderOrder = 11
      const delay = i * 0.06
      this.add({
        objects: [ring],
        age: 0,
        life: 0.5 + delay,
        tick: (age) => {
          const t = Math.max(0, age - delay)
          ring.visible = age >= delay
          ring.position.copy(at).addScaledVector(dir, t * 260)
          ring.scale.setScalar(3 + t * 40)
          ;(ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t / 0.5) * 0.9
        },
      })
    }
    // The bolt itself.
    const bolt = new THREE.Mesh(BEAM_GEOMETRY, beamMaterial(color))
    bolt.frustumCulled = false
    bolt.renderOrder = 11
    bolt.position.copy(at)
    bolt.quaternion.setFromUnitVectors(UP, dir)
    this.add({
      objects: [bolt],
      age: 0,
      life: 0.32,
      tick: (age) => {
        const k = age / 0.32
        bolt.scale.set(2.2 * (1 - k * 0.6), Math.min(1, age / 0.06) * 320, 2.2 * (1 - k * 0.6))
        const m = bolt.material as THREE.ShaderMaterial
        m.uniforms.intensity.value = 2.2 * (1 - k)
        m.uniforms.time.value = this.time
      },
    })
    this.burst(at, dir, color, 60, 220, 0.45)
    live.kick = 1
    this.onFire(live.action.name)
  }

  private shoot(live: Live) {
    const { at, dir } = this.locate(live.action)
    const name = live.action.name.toLowerCase()
    const color = live.color
    const tracer = (live.action.burst ?? 1) > 3
    const tether = /web|line|grapple|cable/.test(name)
    if (!tether) this.flash(at, new THREE.Color(1, 0.8, 0.5), tracer ? 5 : 9, 0.12)
    live.kick = tracer ? 0.5 : 1

    if (tether) {
      // A strand from the launcher to a head that flies out and sticks.
      const geometry = new THREE.BufferGeometry().setFromPoints([at, at])
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true }))
      line.frustumCulled = false
      const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite("star"), color, transparent: true, depthWrite: false }))
      const start = at.clone()
      this.add({
        objects: [line, head],
        age: 0,
        life: 1.6,
        tick: (age) => {
          const out = Math.min(age, 0.35) * 600
          const end = start.clone().addScaledVector(dir, out)
          // While it flies the strand trails from the wrist, wherever it goes.
          const from = age < 0.35 ? this.locate(live.action).at : start
          geometry.setFromPoints([from, end])
          head.position.copy(end)
          head.scale.setScalar(age < 0.35 ? 3 : 3 + (age - 0.35) * 30)
          const fade = age > 1.1 ? 1 - (age - 1.1) / 0.5 : 1
          ;(line.material as THREE.LineBasicMaterial).opacity = fade
          ;(head.material as THREE.SpriteMaterial).opacity = fade * 0.9
        },
      })
      this.onFire(live.action.name)
      return
    }

    if (tracer) {
      const round = new THREE.Mesh(BEAM_GEOMETRY, beamMaterial(color))
      round.frustumCulled = false
      round.quaternion.setFromUnitVectors(UP, dir)
      round.scale.set(0.35, 10, 0.35)
      const start = at.clone()
      const m = round.material as THREE.ShaderMaterial
      m.uniforms.intensity.value = 2
      this.add({ objects: [round], age: 0, life: 0.6, tick: (age) => void round.position.copy(start).addScaledVector(dir, age * 900) })
      if (live.burstLeft <= 1) this.onFire(live.action.name)
      return
    }

    // A missile: body, exhaust and a smoke trail.
    const missile = new THREE.Group()
    const metal = new THREE.MeshStandardMaterial({ color: 0xd8dade, metalness: 0.9, roughness: 0.3 })
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 5, 16), metal)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 16), new THREE.MeshStandardMaterial({ color: 0xb02a22, metalness: 0.4, roughness: 0.4 }))
    nose.position.y = 3.3
    missile.add(body, nose)
    for (let i = 0; i < 4; i += 1) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.9), metal)
      fin.position.set(Math.cos((i * Math.PI) / 2) * 0.7, -2, Math.sin((i * Math.PI) / 2) * 0.7)
      fin.rotation.y = (-i * Math.PI) / 2
      missile.add(fin)
    }
    const exhaust = glowSprite(new THREE.Color(1, 0.65, 0.3))
    exhaust.position.y = -3.2
    missile.add(exhaust)
    missile.quaternion.setFromUnitVectors(UP, dir)
    const start = at.clone()
    let lastPuff = 0
    const life = 1.6
    let burst = false
    this.add({
      objects: [missile],
      age: 0,
      life,
      tick: (age) => {
        // Kicked out slowly, then the motor lights.
        const d = age < 0.12 ? age * 60 : 7.2 + (age - 0.12) ** 1.6 * 420
        missile.position.copy(start).addScaledVector(dir, d)
        exhaust.scale.setScalar(age < 0.12 ? 0.5 : 2.5 + Math.random())
        if (age - lastPuff > 0.02 && age > 0.12) {
          lastPuff = age
          this.puff(missile.position.clone().addScaledVector(dir, -3))
        }
        if (age > life - 0.05 && !burst) {
          burst = true
          this.flash(missile.position.clone(), new THREE.Color(1, 0.6, 0.3), 30, 0.4)
          missile.visible = false
        }
      },
    })
    this.onFire(live.action.name)
  }

  private puff(at: THREE.Vector3) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite("smoke"), color: 0xcfcfcf, transparent: true, depthWrite: false }))
    s.position.copy(at)
    const drift = new THREE.Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 4, (Math.random() - 0.5) * 6)
    this.add({
      objects: [s],
      age: 0,
      life: 1.4,
      tick: (age, dt) => {
        s.position.addScaledVector(drift, dt)
        s.scale.setScalar(2 + age * 9)
        ;(s.material as THREE.SpriteMaterial).opacity = 0.55 * (1 - age / 1.4)
      },
    })
  }

  /** Advance everything by dt seconds; `cues` are the gestures seen now. */
  update(dt: number, cues: Set<Cue>, gestures: boolean, visible: boolean, camera: THREE.PerspectiveCamera) {
    this.time += dt
    const spill = { strength: 0, at: null as THREE.Vector3 | null, color: null as THREE.Color | null }
    const lit = (strength: number, at: THREE.Vector3, color: THREE.Color) => {
      if (strength > spill.strength) Object.assign(spill, { strength, at, color })
    }

    for (const live of this.lives) {
      const a = live.action
      const was = live.held
      const pressed = live.pressed > 0
      live.pressed = Math.max(0, live.pressed - dt)
      live.held = visible && ((gestures && cues.has(live.cue)) || pressed)
      const rising = live.held && !was
      live.cooldown = Math.max(0, live.cooldown - dt)
      live.kick = Math.max(0, live.kick - dt * 4)
      const { at, dir } = this.locate(a)
      live.glow.position.copy(at)
      live.light.position.copy(at).addScaledVector(dir, 1.5)
      let level = 0

      if (a.kind === "repulsor") {
        const chargeTime = a.charge ?? 0.55
        if (pressed && live.cooldown <= 0) {
          live.charge = 1
        } else if (live.held) live.charge = Math.min(1, live.charge + dt / chargeTime)
        else live.charge = Math.max(0, live.charge - dt * 3)
        if (live.charge >= 1 && live.cooldown <= 0) {
          this.repulsor(live)
          live.charge = 0.3
          live.cooldown = 0.75
          live.pressed = 0
        }
        level = 0.18 + live.charge * 0.9 + live.kick
        live.glow.scale.setScalar(1.5 + live.charge * 6 + live.kick * 10)
      } else if (a.kind === "beam") {
        const want = live.held ? 1 : 0
        const rate = want ? 1 / (a.charge ?? 0.35) : 4
        live.beamLevel += Math.sign(want - live.beamLevel) * Math.min(Math.abs(want - live.beamLevel), dt * rate)
        const on = live.beamLevel
        if (live.beam) {
          live.beam.visible = on > 0.02
          live.beam.position.copy(at)
          live.beam.quaternion.setFromUnitVectors(UP, dir)
          const width = 1.2 + on * 3.5
          live.beam.scale.set(width, 400 * Math.min(1, on * 2), width)
          const m = live.beam.material as THREE.ShaderMaterial
          m.uniforms.intensity.value = on * 1.8
          m.uniforms.time.value = this.time
        }
        if (on > 0.5 && Math.random() < dt * 40) this.burst(at, dir, live.color, 2, 120, 0.25)
        if (rising) this.onFire(a.name)
        level = 0.25 + on * 1.4
        live.glow.scale.setScalar(2.5 + on * 10)
      } else if (a.kind === "projectile") {
        if ((rising || (pressed && live.burstLeft === 0)) && live.cooldown <= 0) {
          live.burstLeft = Math.max(1, Math.min(60, a.burst ?? 1))
          live.burstTimer = 0
          live.pressed = 0
        }
        live.burstTimer -= dt
        if (live.burstLeft > 0 && live.burstTimer <= 0) {
          this.shoot(live)
          live.burstLeft -= 1
          live.burstTimer = (a.burst ?? 1) > 1 ? (a.charge ?? 0.07) : 0
          if (live.burstLeft === 0) live.cooldown = Math.max(0.4, a.charge ?? 0.6)
        }
        level = live.kick * 1.2
        live.glow.scale.setScalar(0.5 + live.kick * 6)
      } else if (a.kind === "deploy") {
        if (rising || (pressed && !was)) {
          live.deployed = !live.deployed
          live.pressed = 0
          this.onFire(a.name)
        }
        const want = live.deployed ? 1 : 0
        live.progress += Math.sign(want - live.progress) * Math.min(Math.abs(want - live.progress), dt / 0.45)
        this.pose(live)
      } else {
        // glow: always on, breathing; the cue (or button) surges it.
        const surge = live.held ? 1 : 0
        live.charge += (surge - live.charge) * Math.min(1, dt * 6)
        if (rising) this.onFire(a.name)
        level = 0.5 + Math.sin(this.time * 2.6) * 0.08 + live.charge * 0.9
        live.glow.scale.setScalar(3 + level * 4)
      }

      live.glow.visible = visible && a.kind !== "deploy"
      ;(live.glow.material as THREE.SpriteMaterial).opacity = Math.min(1, level)
      live.light.intensity = visible ? level * 220 : 0
      if (visible) lit(Math.min(1.2, level * (a.kind === "glow" ? 0.25 : 0.5) + live.kick * 0.6), at, live.color)
    }

    // Sparks: fly, drag, fade by darkening (they are light).
    const s = this.sparks
    const pos = s.points.geometry.getAttribute("position") as THREE.BufferAttribute
    const col = s.points.geometry.getAttribute("color") as THREE.BufferAttribute
    for (let i = 0; i < s.age.length; i += 1) {
      if (s.age[i] > 0.7) continue
      s.age[i] += dt
      const k = Math.exp(-dt * 3)
      s.velocity[i * 3] *= k
      s.velocity[i * 3 + 1] = s.velocity[i * 3 + 1] * k - 40 * dt
      s.velocity[i * 3 + 2] *= k
      pos.setXYZ(i, pos.getX(i) + s.velocity[i * 3] * dt, pos.getY(i) + s.velocity[i * 3 + 1] * dt, pos.getZ(i) + s.velocity[i * 3 + 2] * dt)
      const fade = s.age[i] > 0.7 ? 0 : 1 - dt * 3.5
      col.setXYZ(i, col.getX(i) * fade, col.getY(i) * fade, col.getZ(i) * fade)
      if (s.age[i] > 0.7) pos.setXYZ(i, 1e5, 1e5, 1e5)
    }
    pos.needsUpdate = col.needsUpdate = true

    for (let i = this.transients.length - 1; i >= 0; i -= 1) {
      const t = this.transients[i]
      t.age += dt
      const alive = t.age < t.life && t.tick(Math.min(t.age, t.life), dt) !== false
      if (!alive) {
        for (const o of t.objects) {
          this.scene.remove(o)
          o.traverse((n) => {
            const m = (n as THREE.Mesh).material as THREE.Material | undefined
            m?.dispose()
            const g = (n as THREE.Mesh).geometry
            if (g && g !== BEAM_GEOMETRY) g.dispose()
          })
        }
        this.transients.splice(i, 1)
      }
    }

    // The room lit by the brightest thing in it.
    this.spillMaterial.uniforms.strength.value = spill.strength
    if (spill.at && spill.color) {
      const p = spill.at.clone().project(camera)
      this.spillMaterial.uniforms.centre.value.set(p.x, p.y)
      this.spillMaterial.uniforms.color.value.copy(spill.color)
      this.spillMaterial.uniforms.aspect.value = camera.aspect
    }
    this.spill.visible = spill.strength > 0.01
  }

  /** A deploy's parts, the fraction of the way out. */
  private pose(live: Live) {
    const a = live.action
    const t = live.progress * live.progress * (3 - 2 * live.progress)
    const [px = 0, py = 0, pz = 0] = a.at
    const [mx = 0, my = 0, mz = 0] = a.move ?? []
    const [rx = 0, ry = 0, rz = 0] = a.turn ?? []
    const d = THREE.MathUtils.degToRad
    const pivot = new THREE.Matrix4().makeTranslation(px, py, pz)
    const back = new THREE.Matrix4().makeTranslation(-px, -py, -pz)
    const turn = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(d(rx) * t, d(ry) * t, d(rz) * t))
    const move = new THREE.Matrix4().makeTranslation(mx * t, my * t, mz * t)
    const m = move.multiply(pivot).multiply(turn).multiply(back)
    for (const target of live.targets) {
      target.object.matrix.copy(m).multiply(target.base)
      target.object.matrix.decompose(target.object.position, target.object.quaternion, target.object.scale)
    }
  }

  dispose() {
    for (const live of this.lives) {
      this.scene.remove(live.glow, live.light)
      live.glow.material.dispose()
      if (live.beam) {
        this.scene.remove(live.beam)
        ;(live.beam.material as THREE.Material).dispose()
      }
      for (const t of live.targets) {
        t.object.matrix.copy(t.base)
        t.object.matrix.decompose(t.object.position, t.object.quaternion, t.object.scale)
      }
    }
    for (const t of this.transients) for (const o of t.objects) this.scene.remove(o)
    this.scene.remove(this.sparks.points)
    this.sparks.points.geometry.dispose()
    ;(this.sparks.points.material as THREE.Material).dispose()
    this.overlay.remove(this.spill)
    this.spillMaterial.dispose()
  }
}
