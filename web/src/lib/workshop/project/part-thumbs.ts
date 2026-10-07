"use client"

import * as THREE from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { STLLoader } from "three/addons/loaders/STLLoader.js"

import { componentModel } from "@/lib/workshop/project/components3d"
import { loadGenuine } from "@/lib/workshop/project/genuine"
import { loadLibrary } from "@/lib/workshop/project/library"
import { filament } from "@/lib/workshop/project/materials"
import type { Part, PrintedPart } from "@/lib/workshop/project/types"

// Pictures for the project folder's parts list: each component (and each
// printed part) drawn at a three-quarter view in its real materials, by
// one small offscreen renderer shared by every thumbnail, one at a time,
// and kept by what it shows - a list of forty resistors draws one.

const W = 192
const H = 144

let stage: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null

function getStage() {
  if (stage) return stage
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(W, H, false)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.7
  pmrem.dispose()
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x101418, 0.6))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(3, 5, 4)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x9fe8ff, 1.2)
  rim.position.set(-4, 2, -4)
  scene.add(rim)
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 10000)
  stage = { renderer, scene, camera }
  return stage
}

/** Draw a z-up, millimetre model and hand back a PNG. */
function shoot(model: THREE.Object3D): string {
  const { renderer, scene, camera } = getStage()
  const holder = new THREE.Group()
  holder.rotation.x = -Math.PI / 2 // z up into three's y up
  holder.add(model)
  scene.add(holder)
  holder.updateMatrixWorld(true)
  const sphere = new THREE.Box3().setFromObject(holder).getBoundingSphere(new THREE.Sphere())
  const radius = Math.max(sphere.radius, 0.5)
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.92
  camera.position.copy(sphere.center).add(new THREE.Vector3(0.75, 0.62, 1).normalize().multiplyScalar(distance))
  camera.near = distance / 50
  camera.far = distance * 4
  camera.lookAt(sphere.center)
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
  const url = renderer.domElement.toDataURL("image/png")
  scene.remove(holder)
  return url
}

const cache = new Map<string, Promise<string | null>>()
let queue: Promise<unknown> = Promise.resolve()

/** One picture at a time through the shared renderer, remembered by key. */
function thumb(key: string, build: () => Promise<THREE.Object3D | null>, dispose = false): Promise<string | null> {
  let entry = cache.get(key)
  if (entry) return entry
  entry = (queue = queue.then(async () => {
    try {
      const model = await build()
      if (!model) return null
      const url = shoot(model)
      if (dispose) model.traverse((node) => (node as THREE.Mesh).geometry?.dispose())
      return url
    } catch {
      return null
    }
  })) as Promise<string | null>
  cache.set(key, entry)
  return entry
}

/** A catalogue part, as the stage draws it (the library model when there is one). */
export function partThumb(part: Part): Promise<string | null> {
  return thumb(`part:${part.type}:${JSON.stringify(part.props ?? {})}`, async () => {
    await Promise.all([loadLibrary([part.type]).catch(() => {}), part.type === "uno" ? loadGenuine().catch(() => {}) : null])
    return componentModel(part)
  })
}

/** A printed part, compiled (by `compile`, the workshop's cached OpenSCAD)
 *  and drawn in its filament. */
export function printedThumb(part: PrintedPart, compile: (code: string) => Promise<Uint8Array>): Promise<string | null> {
  return thumb(
    `printed:${part.material}:${part.color}:${part.color2}:${part.texture}:${part.code}`,
    async () => {
      const geometry = new STLLoader().parse((await compile(part.code)).slice().buffer)
      geometry.computeVertexNormals()
      return new THREE.Mesh(geometry, filament(part.material, part.color, { color2: part.color2, texture: part.texture }))
    },
    true
  )
}
