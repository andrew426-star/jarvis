"use client"

import * as THREE from "three"

import { accentHex } from "@/lib/core-events"
import { DepthField } from "@/lib/ar/depth"
import { PoseFilter } from "@/lib/ar/one-euro"
import { loadTracker, track, trackReference, unproject, VERTICAL_FOV, type AnchorPose } from "@/lib/ar/tracker"
import { hologram } from "@/lib/workshop/project/holo"
import type { Anchor, Wear } from "@/lib/workshop/project/types"

// A project shown on Andrew through his own camera: the model drawn at
// real size over the live picture, held to his face, wrist, hand or
// forearm by the tracker, or set on the desk in front of him. The canvas
// is sized to the video and laid over it with the same fit and mirroring,
// so the model sits on the right pixels.
//
// What would be behind him is hidden two ways: invisible stand-ins for
// his head and arm, always; and, with DEPTH on, the depth model's map of
// the whole scene, written into the depth buffer before the model is
// drawn, so a hand passing in front of the glasses, or a mug in front of
// something on the desk, covers it as it would a real thing.

const LOST_MS = 400
/** Real surfaces count as "in front" only by this much (cm), so the body
 *  part the model is worn on does not swallow it through the map's noise. */
const OCCLUSION_MARGIN = 3
const NEAR = 1
const FAR = 2000

/** A desk placement: cm from the camera (x, y, distance), degrees. */
export interface DeskPlacement {
  x: number
  y: number
  distance: number
  spin: number
}

export const DEFAULT_DESK: DeskPlacement = { x: 0, y: -16, distance: 55, spin: 0 }

export type TryOnStatus = "loading" | "searching" | "tracking" | "error"

function occluder(anchor: Anchor): THREE.Object3D | null {
  const material = new THREE.MeshBasicMaterial({ colorWrite: false })
  const g = new THREE.Group()
  // Shapes in the design frame (mm), where the body is.
  if (anchor === "face") {
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), material)
    head.scale.set(72, 100, 110)
    head.position.set(0, 88, -20)
    g.add(head)
  } else if (anchor !== "desk") {
    const radius = anchor === "forearm" ? 34 : 29
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 300, 32), material)
    arm.rotation.z = Math.PI / 2
    arm.scale.set(1, 1, 0.75)
    arm.position.x = anchor === "hand" ? -190 : -130
    g.add(arm)
    if (anchor === "hand") g.add(new THREE.Mesh(new THREE.BoxGeometry(95, 85, 28), material))
  } else {
    return null
  }
  g.traverse((node) => (node.renderOrder = -1))
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
  private readonly camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 16 / 9, NEAR, FAR)
  private readonly flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly occlusion = occlusionPass()
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
  private lastSeen = 0
  private lastVideoTime = -1
  private frameCount = 0
  private smoothed: AnchorPose | null = null
  private raf = 0
  private disposed = false
  private status: TryOnStatus = "loading"

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getVideo: () => HTMLVideoElement | null,
    private readonly onStatus: (status: TryOnStatus, detail?: string) => void,
    private readonly onDepth: (text: string | null, ready: boolean, error?: boolean) => void
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.autoClear = false
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x202020, 1.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(30, 60, 80)
    this.scene.add(key)
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
    else hologram(zUp, accentHex(), { solid: true, opacity: 0.6 })
    this.design.add(zUp)
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
    if (this.stand) this.design.remove(this.stand)
    this.stand = occluder(anchor)
    if (this.stand) this.design.add(this.stand)
    this.report("loading")
    try {
      await loadTracker(anchor)
      if (!this.disposed) this.report(anchor === "desk" ? "tracking" : "searching")
    } catch (err) {
      this.report("error", err instanceof Error ? err.message : String(err))
    }
  }

  setFlip(flip: boolean) {
    this.flip = flip
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
      if (this.anchor === "desk") void loadTracker("face").catch(() => {})
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

    let pose: AnchorPose | null = null
    const fresh = video.currentTime !== this.lastVideoTime
    if (this.anchor === "desk") {
      pose = this.deskPose()
      // Every few frames, his face to keep the depth map in centimetres.
      if (this.depth && fresh && this.frameCount++ % 4 === 0) {
        try {
          const ref = trackReference(video)
          if (ref) this.depth.setReference(ref)
        } catch {
          // A missed reference just keeps the last scale.
        }
      }
    } else if (this.status !== "loading" && this.status !== "error" && fresh) {
      try {
        const tracked = track(video, this.anchor, this.flip)
        if (tracked) {
          pose = tracked.pose
          this.depth?.setReference(tracked.reference)
        }
      } catch {
        pose = null
      }
    }
    if (fresh) this.lastVideoTime = video.currentTime

    const now = performance.now()
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
    }

    this.renderer.clear()
    const depth = this.depth
    if (depth?.ready && depth.texture) {
      this.occlusion.material.uniforms.tDepth.value = depth.texture
      this.occlusion.material.uniforms.k.value = depth.scale
      this.renderer.render(this.occlusion.scene, this.flat)
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.depth?.stop()
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
