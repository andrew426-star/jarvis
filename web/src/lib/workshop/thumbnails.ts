"use client"

import * as THREE from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"

import { CATALOGUE } from "@/lib/workshop/models"

// Small previews of the catalogue models for the workshop's library dock:
// each model built once, lit like the workshop, rendered on one shared
// offscreen renderer and kept as a data URL. Rendered one at a time, on
// demand, so opening the dock never stalls the stage.

const WIDTH = 240
const HEIGHT = 180

let renderer: THREE.WebGLRenderer | null = null
let environment: THREE.Texture | null = null
const cache = new Map<string, Promise<string>>()
let queue: Promise<unknown> = Promise.resolve()

function setup() {
  if (renderer) return renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(WIDTH, HEIGHT, false)
  renderer.setPixelRatio(1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  const pmrem = new THREE.PMREMGenerator(renderer)
  environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  return renderer
}

function draw(key: string): string {
  const entry = CATALOGUE.find((c) => c.key === key)
  if (!entry) return ""
  const r = setup()
  const scene = new THREE.Scene()
  scene.environment = environment
  scene.environmentIntensity = 0.7
  scene.add(new THREE.HemisphereLight(0x9cc8ff, 0x050505, 0.6))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4)
  keyLight.position.set(3, 5, 4)
  scene.add(keyLight)

  const { object } = entry.build()
  // Hologram-only lines (the helmet's contours) would draw as a grid over
  // the solid preview.
  object.traverse((node) => {
    if (node.userData.holoLines) node.visible = false
  })
  // Centre the model and frame it: a three-quarter view from slightly above.
  const bounds = new THREE.Box3().setFromObject(object)
  const centre = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3()).length()
  object.position.sub(centre)
  object.rotation.y = -0.5
  scene.add(object)
  const camera = new THREE.PerspectiveCamera(32, WIDTH / HEIGHT, 0.01, 100)
  camera.position.set(0, size * 0.35, size * 1.55)
  camera.lookAt(0, 0, 0)

  r.setClearColor(0x000000, 0)
  r.render(scene, camera)
  const url = r.domElement.toDataURL("image/png")

  object.traverse((node) => {
    const mesh = node as THREE.Mesh
    mesh.geometry?.dispose()
    const material = mesh.material as THREE.Material | undefined
    material?.dispose?.()
  })
  return url
}

/** A preview image of a catalogue model (data URL). */
export function thumbnail(key: string): Promise<string> {
  let pending = cache.get(key)
  if (!pending) {
    // One at a time, each on its own frame, so a full dock never blocks.
    pending = queue.then(
      () => new Promise<string>((resolve) => requestAnimationFrame(() => resolve(draw(key))))
    )
    queue = pending.catch(() => undefined)
    cache.set(key, pending)
  }
  return pending
}
