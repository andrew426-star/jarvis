"use client"

import * as THREE from "three"

import { resolveCue } from "@/lib/ar/actions"
import { DepthField } from "@/lib/ar/depth"
import { ActionRig } from "@/lib/ar/effects"
import { CameraLighting } from "@/lib/ar/lighting"
import { PoseFilter } from "@/lib/ar/one-euro"
import {
  anchorPose,
  loadSensor,
  readCues,
  referenceOf,
  sense,
  sensorForCue,
  sensorReady,
  sensorsFor,
  unproject,
  VERTICAL_FOV,
  type AnchorPose,
  type Sensor,
} from "@/lib/ar/tracker"
import { accentHex } from "@/lib/core-events"
import { hologram } from "@/lib/workshop/project/holo"
import type { Anchor, Cue, Wear, WearAction } from "@/lib/workshop/project/types"

// A project shown on Andrew through his own camera: the model drawn at
// real size over the live picture, held to his face, chest, shoulder, arm,
// wrist or hand by the tracker, or set on the desk in front of him. The
// canvas is sized to the video and laid over it with the same fit and
// mirroring, so the model sits on the right pixels.
//
// In its real materials it is lit by the room (lighting.ts) and casts a
// soft shadow onto him: the invisible stand-ins for his head, torso and
// arm that hide what passes behind him also catch its shadow, and the
// desk has a catcher of its own. What it does - a repulsor firing, a
// unibeam, a launcher - plays over it (effects.ts), set off by the
// gesture each action listens for or its button.
//
// What would be behind him is hidden two ways: the stand-ins, always;
// and, with DEPTH on, the depth model's map of the whole scene, written
// into the depth buffer before the model is drawn, so a hand passing in
// front of the glasses, or a mug in front of something on the desk,
// covers it as it would a real thing.

const LOST_MS = 400
/** Real surfaces count as "in front" only by this much (cm), so the body
 *  part the model is worn on does not swallow it through the map's noise. */
const OCCLUSION_MARGIN = 3
const NEAR = 1
const FAR = 2000
/** Where the key light comes from, relative to what it lights: above, a
 *  little to the side, toward the camera. */
const KEY_FROM = new THREE.Vector3(0.35, 0.8, 0.5).normalize()

/** A desk placement: cm from the camera (x, y, distance), degrees. */
export interface DeskPlacement {
  x: number
  y: number
  distance: number
  spin: number
}

export const DEFAULT_DESK: DeskPlacement = { x: 0, y: -16, distance: 55, spin: 0 }

export type TryOnStatus = "loading" | "searching" | "tracking" | "error"

/** The stand-ins for his body: depth only, plus the model's shadow on them. */
function standIn(anchor: Anchor, flip: boolean): THREE.Object3D {
  const material = new THREE.ShadowMaterial({ opacity: 0.38 })
  // Drawn first with the opaque things, so it hides what is behind him;
  // where no shadow falls it writes nothing visible.
  material.transparent = false
  const g = new THREE.Group()
  const sphere = (sx: number, sy: number, sz: number, at: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), material)
    m.scale.set(sx, sy, sz)
    m.position.set(...at)
    g.add(m)
  }
  /** A cylinder along `axis` (design frame). */
  const limb = (r: number, length: number, axis: "x" | "z", at: [number, number, number], flatten = 1) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, length, 32), material)
    if (axis === "x") m.rotation.z = Math.PI / 2
    else m.rotation.x = Math.PI / 2
    m.scale.z = flatten
    m.position.set(...at)
    g.add(m)
  }
  // Shapes in the design frame (mm), where the body is.
  if (anchor === "face") {
    sphere(72, 100, 110, [0, 88, -20])
  } else if (anchor === "chest") {
    sphere(185, 120, 300, [0, 120, -170])
    limb(55, 160, "z", [0, 100, 190])
  } else if (anchor === "shoulder") {
    sphere(62, 62, 62, [0, 0, -55])
    limb(46, 300, "z", [0, 0, -210])
    // His torso, toward his middle from whichever shoulder it is.
    sphere(160, 110, 260, [flip ? -180 : 180, 70, -180])
  } else if (anchor === "upper_arm") {
    limb(46, 330, "x", [0, 0, 0], 0.9)
    sphere(60, 60, 60, [-170, 0, 0])
  } else if (anchor === "desk") {
    // The desk itself: catches the shadow, and hides what goes below it.
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.ShadowMaterial({ opacity: 0.45 }))
    ;(plane.material as THREE.ShadowMaterial).transparent = false
    g.add(plane)
  } else {
    const radius = anchor === "forearm" ? 34 : 29
    limb(radius, 300, "x", [anchor === "hand" ? -190 : -130, 0, 0], 0.75)
    if (anchor === "hand") g.add(new THREE.Mesh(new THREE.BoxGeometry(95, 85, 28), material))
  }
  g.traverse((node) => {
    node.renderOrder = -1
    node.receiveShadow = true
  })
  return g
}

/** A full-screen pass that writes the scene's real depth into the depth
 *  buffer, colour untouched. */
function occlusionPass() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: null },
      k: { value: 0 },
      margin: { value: OCCLUSION_MARGIN },
      near: { value: NEAR },
      far: { value: FAR },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDepth;
      uniform float k, margin, near, far;
      varying vec2 vUv;
      void main() {
        // The map's first row is the top of the picture.
        float value = texture2D(tDepth, vec2(vUv.x, 1.0 - vUv.y)).r;
        if (value <= 0.0 || k <= 0.0) discard;
        float z = k / value + margin;
        float ndc = (far + near) / (far - near) - (2.0 * far * near) / ((far - near) * z);
        gl_FragDepth = clamp(ndc * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(0.0);
      }
    `,
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
    depthFunc: THREE.AlwaysDepth,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(quad)
  return { scene, material }
}

export class TryOnScene {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  /** Drawn last, over everything: light spilling across the picture. */
  private readonly overlay = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 16 / 9, NEAR, FAR)
  private readonly flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly occlusion = occlusionPass()
  private readonly sky = new THREE.HemisphereLight(0xdfefff, 0x202020, 1.2)
  private readonly key = new THREE.DirectionalLight(0xffffff, 1.6)
  private readonly lighting: CameraLighting
  /** Posed at the anchor (cm, camera space). */
  private readonly anchorRoot = new THREE.Group()
  /** The wear nudges, then millimetres to centimetres. */
  private readonly design = new THREE.Group()
  private readonly filter = new PoseFilter()
  private model: THREE.Object3D | null = null
  private stand: THREE.Object3D | null = null
  private anchor: Anchor = "face"
  private flip = false
  private desk: DeskPlacement = { ...DEFAULT_DESK }
  private depth: DepthField | null = null
  private actions: WearAction[] = []
  private rig: ActionRig | null = null
  private gestures = true
  private pending: (string | undefined)[] = []
  private cues = new Set<Cue>()
  /** Sensors to run each frame: the anchor's, its extras, the cues'. */
  private sensors = new Set<Sensor>()
  private cueSensors = new Set<Sensor>()
  private lastSeen = 0
  private lastVideoTime = -1
  private lastFrame = performance.now()
  private frameCount = 0
  private smoothed: AnchorPose | null = null
  private raf = 0
  private disposed = false
  private status: TryOnStatus = "loading"

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getVideo: () => HTMLVideoElement | null,
    private readonly onStatus: (status: TryOnStatus, detail?: string) => void,
    private readonly onDepth: (text: string | null, ready: boolean, error?: boolean) => void,
    private readonly onAction: (name: string) => void = () => {}
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.autoClear = false
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.scene.add(this.sky)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(1024, 1024)
    const s = this.key.shadow.camera
    s.left = s.bottom = -30
    s.right = s.top = 30
    s.near = 1
    s.far = 300
    this.key.shadow.bias = -0.0005
    this.key.shadow.normalBias = 0.04
    this.key.shadow.radius = 4
    this.scene.add(this.key, this.key.target)
    this.lighting = new CameraLighting(this.renderer, this.scene, this.sky, this.key)
    this.design.scale.setScalar(0.1)
    this.anchorRoot.add(this.design)
    this.scene.add(this.anchorRoot)
    this.raf = requestAnimationFrame(this.frame)
  }

  /** The model to wear: the project's design frame (mm, z up). */
  setModel(zUp: THREE.Object3D, mode: "holo" | "solid") {
    if (this.model) this.design.remove(this.model)
    this.model = zUp
    if (mode === "holo") hologram(zUp, accentHex())
    else zUp.traverse((node) => (node.castShadow = (node as THREE.Mesh).isMesh))
    this.design.add(zUp)
    this.rebuildRig()
  }

  setWear(wear: Pick<Wear, "offset" | "rot" | "scale">) {
    const [ox = 0, oy = 0, oz = 0] = wear.offset ?? []
    const [rx = 0, ry = 0, rz = 0] = wear.rot ?? []
    const deg = THREE.MathUtils.degToRad
    this.model?.position.set(ox, oy, oz)
    this.model?.rotation.set(deg(rx), deg(ry), deg(rz))
    this.design.scale.setScalar(0.1 * (wear.scale ?? 1))
  }

  async setAnchor(anchor: Anchor) {
    this.anchor = anchor
    this.smoothed = null
    this.filter.reset()
    this.placeStand()
    const { need, extra } = sensorsFor(anchor)
    this.sensors = new Set([...need, ...extra, ...this.cueSensors])
    this.rebuildRig()
    this.report("loading")
    // Extras improve the fit; never wait for them, never fail on them.
    for (const s of extra) void loadSensor(s).catch(() => {})
    try {
      await Promise.all(need.map(loadSensor))
      if (!this.disposed) this.report(anchor === "desk" ? "tracking" : "searching")
    } catch (err) {
      this.report("error", err instanceof Error ? err.message : String(err))
    }
  }

  /** What it does, and the gestures that set it off. */
  setActions(actions: WearAction[]) {
    this.actions = actions
    this.cueSensors = new Set(
      actions.flatMap((a) => {
        const s = sensorForCue(resolveCue(a.cue, this.anchor))
        return s ? [s] : []
      })
    )
    for (const s of this.cueSensors) {
      this.sensors.add(s)
      void loadSensor(s).catch(() => {})
    }
    this.rebuildRig()
  }

  /** Gestures on or off (the buttons always work). */
  setGestures(on: boolean) {
    this.gestures = on
  }

  /** Fire an action by name (or the first), as its button does. */
  press(name?: string) {
    if (!this.rig) this.pending.push(name)
    else this.rig.press(name)
  }

  private rebuildRig() {
    this.rig?.dispose()
    this.rig = null
    if (!this.model || !this.actions.length) return
    this.rig = new ActionRig(this.scene, this.overlay, this.model, this.actions, (cue) => resolveCue(cue, this.anchor), this.onAction)
    for (const name of this.pending.splice(0)) this.rig.press(name)
  }

  setFlip(flip: boolean) {
    this.flip = flip
    if (this.anchor === "shoulder") this.placeStand()
  }

  private placeStand() {
    if (this.stand) this.design.remove(this.stand)
    this.stand = standIn(this.anchor, this.flip)
    this.design.add(this.stand)
  }

  setDesk(desk: DeskPlacement) {
    this.desk = desk
  }

  /** Scene depth on or off: the depth model, its occlusion and placement. */
  setDepth(on: boolean) {
    if (on && !this.depth) {
      this.depth = new DepthField(this.getVideo, (text, ready, error) => this.onDepth(text, ready, error))
      this.depth.start()
      // The desk has no body part of known size: the face is its yardstick.
      if (this.anchor === "desk") {
        this.sensors.add("face")
        void loadSensor("face").catch(() => {})
      }
    } else if (!on && this.depth) {
      this.depth.stop()
      this.depth = null
      this.onDepth(null, false)
    }
  }

  /** Where a point of the picture is on a real surface, as a desk
   *  placement - null without a depth map. */
  surfaceAt(u: number, v: number): DeskPlacement | null {
    const video = this.getVideo()
    const cm = this.depth?.distance(u, v)
    if (!video || !cm) return null
    const at = unproject(u, v, cm, video.videoWidth, video.videoHeight)
    return { ...this.desk, x: at.x, y: at.y, distance: -at.z }
  }

  private report(status: TryOnStatus, detail?: string) {
    if (status === this.status && !detail) return
    this.status = status
    this.onStatus(status, detail)
  }

  private deskPose(): AnchorPose {
    const d = this.desk
    const upright = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(d.spin))
    return { position: new THREE.Vector3(d.x, d.y, -d.distance), quaternion: upright.multiply(spin) }
  }

  /** The sensors to run on this frame. */
  private running(): Sensor[] {
    const out = [...this.sensors].filter(sensorReady)
    // At the desk the face is only the depth map's yardstick: every few
    // frames is plenty, unless a gesture is read from it.
    if (this.anchor === "desk" && !this.cueSensors.has("face") && this.frameCount++ % 4 !== 0) return out.filter((s) => s !== "face")
    return out
  }

  private frame = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    const video = this.getVideo()
    if (!video || !video.videoWidth) return
    if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
      this.renderer.setSize(video.videoWidth, video.videoHeight, false)
      this.camera.aspect = video.videoWidth / video.videoHeight
      this.camera.updateProjectionMatrix()
    }
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    this.lighting.update(video, now)

    let pose: AnchorPose | null = null
    const fresh = video.currentTime !== this.lastVideoTime
    if (this.status !== "loading" && this.status !== "error" && fresh) {
      try {
        const senses = sense(video, this.running(), this.flip)
        const tracked = anchorPose(senses, this.anchor, this.flip)
        if (tracked) pose = tracked.pose
        const ref = referenceOf(senses, tracked)
        if (ref) this.depth?.setReference(ref)
        this.cues = readCues(senses)
      } catch {
        pose = null
      }
    }
    if (fresh) this.lastVideoTime = video.currentTime
    if (this.anchor === "desk") pose = this.deskPose()

    if (pose) {
      this.lastSeen = now
      this.smoothed = this.anchor === "desk" ? pose : this.filter.apply(pose.position, pose.quaternion, now / 1000)
      if (this.anchor !== "desk") this.report("tracking")
    } else if (this.anchor !== "desk" && now - this.lastSeen > LOST_MS) {
      if (this.status === "tracking") this.report("searching")
      this.filter.reset()
    }

    const visible = !!this.smoothed && (this.anchor === "desk" || now - this.lastSeen < LOST_MS)
    this.anchorRoot.visible = visible
    if (this.smoothed) {
      this.anchorRoot.position.copy(this.smoothed.position)
      this.anchorRoot.quaternion.copy(this.smoothed.quaternion)
      // The key light rides with the model, so its shadow map stays tight on it.
      this.key.target.position.copy(this.smoothed.position)
      this.key.position.copy(this.smoothed.position).addScaledVector(KEY_FROM, 120)
    }
    this.anchorRoot.updateMatrixWorld(true)
    this.rig?.update(dt, this.cues, this.gestures, visible, this.camera)

    this.renderer.clear()
    const depth = this.depth
    if (depth?.ready && depth.texture) {
      this.occlusion.material.uniforms.tDepth.value = depth.texture
      this.occlusion.material.uniforms.k.value = depth.scale
      this.renderer.render(this.occlusion.scene, this.flat)
    }
    this.renderer.render(this.scene, this.camera)
    this.renderer.render(this.overlay, this.flat)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.depth?.stop()
    this.rig?.dispose()
    this.lighting.dispose()
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | undefined
      material?.dispose?.()
    })
    this.occlusion.material.dispose()
    this.renderer.dispose()
  }
}
