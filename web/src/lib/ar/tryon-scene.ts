"use client"

import * as THREE from "three"

import { accentHex } from "@/lib/core-events"
import { loadTracker, track, VERTICAL_FOV, type AnchorPose } from "@/lib/ar/tracker"
import { hologram } from "@/lib/workshop/project/holo"
import type { Anchor, Wear } from "@/lib/workshop/project/types"

// A project shown on Andrew through his own camera: the model drawn at
// real size over the live picture, held to his face, wrist, hand or
// forearm by the tracker, or set on the desk in front of him. The canvas
// is sized to the video and laid over it with the same fit and mirroring,
// so the model sits on the right pixels. Invisible stand-ins for the head
// and arm hide what would be behind him (glasses' arms, a band's far
// side).

const LOST_MS = 400
const SMOOTH = 0.45

/** A desk placement he moves himself: cm from the camera, degrees. */
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
    if (anchor === "hand") {
      const palm = new THREE.Mesh(new THREE.BoxGeometry(95, 85, 28), material)
      g.add(palm)
    }
  } else {
    return null
  }
  g.traverse((node) => (node.renderOrder = -1))
  return g
}

export class TryOnScene {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 16 / 9, 1, 2000)
  /** Posed at the anchor (cm, camera space). */
  private readonly anchorRoot = new THREE.Group()
  /** The wear nudges, then millimetres to centimetres. */
  private readonly design = new THREE.Group()
  private model: THREE.Object3D | null = null
  private stand: THREE.Object3D | null = null
  private anchor: Anchor = "face"
  private flip = false
  private desk: DeskPlacement = { ...DEFAULT_DESK }
  private lastSeen = 0
  private lastVideoTime = -1
  private smoothed: AnchorPose | null = null
  private raf = 0
  private disposed = false
  private status: TryOnStatus = "loading"

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getVideo: () => HTMLVideoElement | null,
    private readonly onStatus: (status: TryOnStatus, detail?: string) => void
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)
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
    // Offsets are mm in the design frame; the design group is in mm too.
    this.model?.position.set(ox, oy, oz)
    this.model?.rotation.set(deg(rx), deg(ry), deg(rz))
    this.design.scale.setScalar(0.1 * (wear.scale ?? 1))
  }

  async setAnchor(anchor: Anchor) {
    this.anchor = anchor
    this.smoothed = null
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
    if (this.anchor === "desk") pose = this.deskPose()
    else if (this.status !== "loading" && this.status !== "error" && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime
      try {
        pose = track(video, this.anchor, this.flip)
      } catch {
        pose = null
      }
    }

    const now = performance.now()
    if (pose) {
      this.lastSeen = now
      if (!this.smoothed || this.anchor === "desk") this.smoothed = { position: pose.position.clone(), quaternion: pose.quaternion.clone() }
      else {
        this.smoothed.position.lerp(pose.position, SMOOTH)
        this.smoothed.quaternion.slerp(pose.quaternion, SMOOTH)
      }
      if (this.anchor !== "desk") this.report("tracking")
    } else if (this.anchor !== "desk" && now - this.lastSeen > LOST_MS && this.status === "tracking") {
      this.report("searching")
    }

    const visible = !!this.smoothed && (this.anchor === "desk" || now - this.lastSeen < LOST_MS)
    this.anchorRoot.visible = visible
    if (this.smoothed) {
      this.anchorRoot.position.copy(this.smoothed.position)
      this.anchorRoot.quaternion.copy(this.smoothed.quaternion)
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | undefined
      material?.dispose?.()
    })
    this.renderer.dispose()
  }
}
