"use client"

import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

// Infinity Ultron's head (public/models/infinity-ultron.glb): the helmet,
// assembled, with Vision inside it - for the console's centre in serious
// mode (lib/ultron-face.ts). Ported from the loader that came with the
// model (InfinityUltronHead.js).
//
// The GLB is aligned for three.js: +Y up, +Z toward you, the origin at the
// helmet's centre, the helmet about 1.5 wide. Only `root` is moved, turned
// or scaled - never a part inside it.
//
//   InfinityUltron
//   ├─ MainHelmet, Helmet_Back, Helmet_Front   the fixed shell (dome, neck ring, chin guard)
//   ├─ *_Trim                                  gold round the face opening
//   ├─ EarHolder_L/R, Ear_L/R                  hinge housings and horns
//   ├─ VisionHead, VisionHead_Silver           Vision: red panelled skin, silver crown
//   ├─ VisionEyes, MindStone                   his eyes (natural or glowing red) and the stone
//   └─ FaceplatePivot                          the hinge just behind the ear discs
//       ├─ Faceplate, InfinityStone
//       ├─ UpperLense_L/R, LowerLense_L/R      lens frames
//       └─ LensGlow                            the glowing red lens panels
//
// No two parts touch at rest or anywhere along the faceplate's swing (0-60
// degrees), but only on FACEPLATE_PATH: a plain hinge turn would cut the
// faceplate through the dome and Vision. Vision's jaw is a weight per
// vertex (`_jaw`) baked into his four meshes, turned in their shaders; up
// to 8 degrees clears the chin guard.

export const INFINITY_ULTRON_URL = "/models/infinity-ultron.glb"

// [angleDeg, liftY, liftZ]: the checked swing - a turn about the pivot plus a small lift.
const FACEPLATE_PATH: [number, number, number][] = [[0.0, 0.0, -0.0], [0.5, 0.0, -0.0], [1.0, 0.0, -0.0], [1.5, 0.0, -0.0], [2.0, 0.0, -0.0], [2.5, 0.0, -0.0], [3.0, 0.0, -0.0], [3.5, 0.0, -0.0], [4.0, 0.0, -0.0], [4.5, 0.00176, 0.00243], [5.0, 0.00176, 0.00243], [5.5, 0.00176, 0.00243], [6.0, 0.0, 0.00485], [6.5, 0.0, 0.00485], [7.0, 0.00176, 0.00728], [7.5, 0.00353, 0.00971], [8.0, 0.00353, 0.00971], [8.5, 0.00353, 0.00971], [9.0, 0.00353, 0.00971], [9.5, 0.00353, 0.00971], [10.0, 0.00353, 0.00971], [10.5, 0.00353, 0.00971], [11.0, 0.00353, 0.00971], [11.5, 0.00353, 0.00971], [12.0, 0.00353, 0.00971], [12.5, 0.00176, 0.01214], [13.0, 0.00176, 0.01214], [13.5, 0.00176, 0.01214], [14.0, 0.00176, 0.01214], [14.5, 0.0, 0.01456], [15.0, 0.0, 0.01456], [15.5, 0.0, 0.01456], [16.0, 0.0, 0.01456], [16.5, 0.00176, 0.01699], [17.0, 0.00176, 0.01699], [17.5, 0.00176, 0.01699], [18.0, 0.00176, 0.01699], [18.5, 0.00176, 0.01699], [19.0, 0.0, 0.01942], [19.5, 0.0, 0.01942], [20.0, 0.00176, 0.02184], [20.5, 0.00176, 0.02184], [21.0, 0.0, 0.02427], [21.5, 0.0, 0.02427], [22.0, 0.00176, 0.0267], [22.5, 0.00176, 0.0267], [23.0, 0.0, 0.02912], [23.5, 0.00176, 0.03155], [24.0, 0.00176, 0.03155], [24.5, 0.00176, 0.03155], [25.0, 0.00176, 0.03155], [25.5, 0.0, 0.03398], [26.0, 0.0, 0.03398], [26.5, 0.0, 0.03398], [27.0, 0.0, 0.03398], [27.5, 0.0, 0.03398], [28.0, 0.0, 0.03398], [28.5, 0.0, 0.03398], [29.0, 0.0, 0.03398], [29.5, 0.0, 0.03398], [30.0, 0.00176, 0.03641], [30.5, 0.00176, 0.03641], [31.0, 0.00176, 0.03641], [31.5, 0.0, 0.03883], [32.0, 0.0, 0.03883], [32.5, 0.00176, 0.04126], [33.0, 0.00176, 0.04126], [33.5, 0.00176, 0.04126], [34.0, 0.0, 0.04369], [34.5, 0.0, 0.04369], [35.0, 0.0, 0.04369], [35.5, 0.00176, 0.04611], [36.0, 0.00176, 0.04611], [36.5, 0.00176, 0.04611], [37.0, 0.0, 0.04854], [37.5, 0.0, 0.04854], [38.0, 0.00176, 0.05097], [38.5, 0.00176, 0.05097], [39.0, 0.00176, 0.05097], [39.5, 0.00176, 0.05097], [40.0, 0.0, 0.0534], [40.5, 0.00285, 0.05247], [41.0, 0.00109, 0.0549], [41.5, 0.00109, 0.0549], [42.0, -0.00067, 0.05732], [42.5, -0.00067, 0.05732], [43.0, 0.00109, 0.05975], [43.5, 0.00109, 0.05975], [44.0, 0.00109, 0.05975], [44.5, -0.00067, 0.06218], [45.0, -0.00067, 0.06218], [45.5, 0.00109, 0.0646], [46.0, 0.00109, 0.0646], [46.5, 0.00109, 0.0646], [47.0, 0.01183, 0.05925], [47.5, 0.01468, 0.05833], [48.0, 0.01754, 0.0574], [48.5, 0.02039, 0.05647], [49.0, 0.02324, 0.05555], [49.5, 0.03065, 0.05043], [50.0, 0.03065, 0.05043], [50.5, 0.03065, 0.05043], [51.0, 0.03806, 0.04532], [51.5, 0.03806, 0.04532], [52.0, 0.03806, 0.04532], [52.5, 0.04191, 0.04072], [53.0, 0.04191, 0.04072], [53.5, 0.04191, 0.04072], [54.0, 0.03906, 0.0398], [54.5, 0.04191, 0.03887], [55.0, 0.03906, 0.03794], [55.5, 0.03906, 0.03494], [56.0, 0.03906, 0.03494], [56.5, 0.03621, 0.03402], [57.0, 0.04007, 0.02942], [57.5, 0.04007, 0.02942], [58.0, 0.04007, 0.02942], [58.5, 0.03721, 0.02849], [59.0, 0.03436, 0.02757], [59.5, 0.03151, 0.02664], [60.0, 0.02865, 0.02571]]

/** A studio baked into a reflection map - a dark room, cool softboxes, a
 *  warm bounce off the floor - for the glossy gunmetal. */
function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene()
  env.background = new THREE.Color(0x0c0f14)
  const panel = (w: number, h: number, rgb: [number, number, number], k: number, pos: [number, number, number]) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0] * k, rgb[1] * k, rgb[2] * k), side: THREE.DoubleSide })
    )
    m.position.set(...pos)
    m.lookAt(0, 0, 0)
    env.add(m)
  }
  panel(9, 5, [0.85, 0.92, 1.0], 3.2, [0, 6, 1.5]) // overhead softbox, cool
  panel(2.2, 7, [0.8, 0.9, 1.0], 3.6, [-5, 1, 3]) // left strip
  panel(2.2, 7, [0.8, 0.9, 1.0], 3.6, [5, 1, 3]) // right strip
  panel(6, 2, [0.6, 0.7, 0.9], 1.6, [0, 2, -6]) // back rim
  panel(7, 4, [1.0, 0.55, 0.25], 0.9, [0, -5, 2]) // warm floor bounce
  panel(6, 3, [0.75, 0.82, 0.95], 0.9, [0, 2, 6]) // broad front fill
  const pmrem = new THREE.PMREMGenerator(renderer)
  const texture = pmrem.fromScene(env, 0.02).texture
  pmrem.dispose()
  env.traverse((o) => {
    const mesh = o as THREE.Mesh
    mesh.geometry?.dispose()
    ;(mesh.material as THREE.Material | undefined)?.dispose()
  })
  return texture
}

// 23 MB: fetched once, however many times the head is built.
let gltfPromise: Promise<THREE.Group> | null = null
function loadScene(): Promise<THREE.Group> {
  gltfPromise ??= new GLTFLoader().loadAsync(INFINITY_ULTRON_URL).then((gltf) => gltf.scene)
  gltfPromise.catch(() => (gltfPromise = null))
  return gltfPromise
}

export type EyeMode = "natural" | "glow"

export class InfinityUltronHead {
  root: THREE.Object3D | null = null
  private pivot: THREE.Object3D | null = null
  private pivotRest = new THREE.Vector3()
  private readonly parts: Record<string, THREE.Mesh> = {}
  private readonly materials: THREE.Material[] = []
  private environment: THREE.Texture | null = null

  readonly openAngleDeg: number
  readonly openTime: number
  readonly closeTime: number
  private readonly jawMaxDeg: number
  private t = 0
  private target = 0
  private eyeMode: EyeMode
  private voice = 0
  private jawTarget: number | null = null
  private jaw = 0
  private stoneBase = 0.6
  private time = 0
  private readonly jawUniforms = { uJaw: { value: 0 }, uJawOpen: { value: 0 }, uHinge: { value: new THREE.Vector3(0, -0.396, 0.186) } }

  private lensMat: THREE.MeshBasicMaterial | null = null
  private eyeMat: THREE.MeshPhysicalMaterial | null = null
  private mindStoneMat: THREE.MeshPhysicalMaterial | null = null
  private stoneMat: THREE.MeshPhysicalMaterial | null = null

  constructor(opts: { openAngleDeg?: number; openTime?: number; closeTime?: number; jawMaxDeg?: number; eyeMode?: EyeMode } = {}) {
    // The path is checked up to 60 degrees, the jaw up to 8.
    this.openAngleDeg = Math.min(opts.openAngleDeg ?? 55, 60)
    this.openTime = opts.openTime ?? 0.7
    this.closeTime = opts.closeTime ?? 0.55
    this.jawMaxDeg = Math.min(opts.jawMaxDeg ?? 8, 8)
    this.eyeMode = opts.eyeMode ?? "glow"
  }

  async load(renderer: THREE.WebGLRenderer): Promise<this> {
    // A copy, so a second head never shares nodes with the first.
    const scene = (await loadScene()).clone(true)
    this.root = scene.getObjectByName("InfinityUltron") ?? scene
    this.pivot = this.root.getObjectByName("FaceplatePivot") ?? null
    if (this.pivot) this.pivotRest.copy(this.pivot.position)
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      this.parts[mesh.name] = mesh
      if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals()
    })

    const envMap = (this.environment = studioEnvironment(renderer))
    const keep = <M extends THREE.Material>(m: M) => {
      this.materials.push(m)
      return m
    }

    // The paint, after the concept art: dark warm gunmetal, brushed
    // bronze-gold trim round the face and along the ridges. The panel lines
    // are baked into the vertex colours, so those stay on.
    const paint = keep(new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.75, roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.12, envMap, envMapIntensity: 1.25 }))
    const gold = keep(new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 1.0, roughness: 0.34, clearcoat: 0.4, clearcoatRoughness: 0.15, envMap, envMapIntensity: 1.5 }))
    const lensFrame = keep(new THREE.MeshPhysicalMaterial({ color: 0x3a0505, emissive: 0xff1208, emissiveIntensity: 0.35, roughness: 0.25, clearcoat: 1.0, envMap, envMapIntensity: 0.4 }))
    // The glowing red eye slots.
    this.lensMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.03, 0.02), transparent: true, opacity: 0.92, depthWrite: false }))
    // The glowing yellow stone in the faceplate's brow.
    this.stoneMat = keep(new THREE.MeshPhysicalMaterial({ color: 0x3a2a00, emissive: 0xffc23a, emissiveIntensity: 2.4, roughness: 0.1, clearcoat: 1.0, envMap, envMapIntensity: 0.6 }))

    // Vision: red panelled skin, silver crown, glossy eyes, the Mind Stone.
    // All four turn their jaw by the baked weight.
    const U = this.jawUniforms
    const withJaw = <M extends THREE.MeshPhysicalMaterial>(mat: M, key: string): M => {
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U)
        sh.vertexShader =
          "attribute float _jaw;\nuniform float uJaw;\nuniform float uJawOpen;\nuniform vec3 uHinge;\nvarying float vLip;\n" +
          sh.vertexShader
            .replace(
              "#include <beginnormal_vertex>",
              `#include <beginnormal_vertex>
            { float ja = uJaw * _jaw; float cj = cos(ja), sj = sin(ja);
              objectNormal = vec3(objectNormal.x, cj*objectNormal.y - sj*objectNormal.z, sj*objectNormal.y + cj*objectNormal.z); }`
            )
            .replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>
            { float ja = uJaw * _jaw; float cj = cos(ja), sj = sin(ja); vec3 d = transformed - uHinge;
              transformed = uHinge + vec3(d.x, cj*d.y - sj*d.z, sj*d.y + cj*d.z);
              vLip = pow(4.0 * _jaw * (1.0 - _jaw), 3.0) * uJawOpen * (1.0 - smoothstep(0.08, 0.15, abs(position.x))); }`
            )
        sh.fragmentShader = "varying float vLip;\n" + sh.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\n diffuseColor.rgb *= 1.0 - 0.85 * vLip;")
      }
      mat.customProgramCacheKey = () => "vision-jaw-" + key
      return keep(mat)
    }
    const visionSkin = withJaw(new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.0, roughness: 0.58, sheen: 0.35, sheenRoughness: 0.6, sheenColor: 0xd04040, clearcoat: 0.08, clearcoatRoughness: 0.5, envMap, envMapIntensity: 0.45 }), "skin")
    const visionSilver = withJaw(new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.85, roughness: 0.38, clearcoat: 0.15, clearcoatRoughness: 0.35, envMap, envMapIntensity: 1.1 }), "silver")
    this.eyeMat = withJaw(new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.0, roughness: 0.12, clearcoat: 1.0, clearcoatRoughness: 0.03, envMap, envMapIntensity: 0.9, emissive: 0xff1a0a, emissiveIntensity: 0 }), "eyes")
    this.mindStoneMat = withJaw(new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.0, roughness: 0.08, clearcoat: 1.0, envMap, envMapIntensity: 0.8, emissive: 0xffb81f, emissiveIntensity: 1.2 }), "stone")

    for (const [name, mesh] of Object.entries(this.parts)) {
      mesh.material = name.startsWith("LensGlow")
        ? this.lensMat
        : name.includes("Lense")
          ? lensFrame
          : name === "InfinityStone"
            ? this.stoneMat
            : name === "VisionHead"
              ? visionSkin
              : name === "VisionHead_Silver"
                ? visionSilver
                : name === "VisionEyes"
                  ? this.eyeMat
                  : name === "MindStone"
                    ? this.mindStoneMat
                    : name.endsWith("_Trim")
                      ? gold
                      : paint
      // Thin printed shells: their inner walls show while the plate is open.
      ;(mesh.material as THREE.Material).side = THREE.DoubleSide
    }
    this.setEyeMode(this.eyeMode)
    this.apply()
    return this
  }

  /** Open (true) or close the faceplate at its own pace. */
  setOpenGoal(open: boolean) {
    this.target = open ? 1 : 0
  }

  get opening(): number {
    return this.t
  }

  /** The eye slots' glow, 0..1 (with the voice, say). */
  setGlow(level: number) {
    const k = 0.9 + 1.1 * THREE.MathUtils.clamp(level, 0, 1)
    this.lensMat?.color.setRGB(1.0 * k, 0.03 * k, 0.02 * k)
  }

  /** The faceplate stone's glow (emissive intensity). */
  setFaceplateStone(intensity: number) {
    if (this.stoneMat) this.stoneMat.emissiveIntensity = intensity
  }

  /** The voice level, 0..1: the jaw and Mind Stone follow it. */
  setVoiceLevel(level: number) {
    this.voice = THREE.MathUtils.clamp(level, 0, 1)
  }

  /** Drive the jaw directly (0 shut, 1 the full 8 degrees); null hands it back to the voice. */
  setJaw(v: number | null) {
    this.jawTarget = v === null ? null : THREE.MathUtils.clamp(v, 0, 1)
  }

  setEyeMode(mode: EyeMode) {
    this.eyeMode = mode
    if (!this.eyeMat) return
    this.eyeMat.emissiveIntensity = mode === "glow" ? 2.2 : 0
    // Dark under the glow, so the red emission is what shows.
    this.eyeMat.color.set(mode === "glow" ? 0x2a0000 : 0xffffff)
  }

  /** The Mind Stone's base brightness, 0..1 (it also pulses on its own). */
  setStoneGlow(v: number) {
    this.stoneBase = Math.max(0, v)
  }

  update(dt: number) {
    if (!this.root) return
    this.time += dt
    // The jaw follows the voice - quick to open, slower to close - unless driven.
    const target = this.jawTarget ?? Math.min(1, Math.max(0, (this.voice - 0.04) * 1.6))
    const k = target > this.jaw ? 1 - Math.exp(-dt / 0.035) : 1 - Math.exp(-dt / 0.09)
    this.jaw += (target - this.jaw) * k
    this.jawUniforms.uJaw.value = THREE.MathUtils.degToRad(this.jawMaxDeg) * this.jaw
    this.jawUniforms.uJawOpen.value = this.jaw
    // The Mind Stone: a slow pulse, brighter while he speaks.
    if (this.mindStoneMat) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.2)
      this.mindStoneMat.emissiveIntensity = 0.6 + 1.4 * this.stoneBase + 0.5 * pulse + 1.5 * this.voice
    }
    if (this.eyeMat && this.eyeMode === "glow") this.eyeMat.emissiveIntensity = 2.0 + 1.5 * this.voice

    const dur = this.target > this.t ? this.openTime : this.closeTime
    const step = dt / Math.max(dur, 1e-3)
    this.t = this.target > this.t ? Math.min(this.target, this.t + step) : Math.max(this.target, this.t - step)
    this.apply()
  }

  private apply() {
    if (!this.pivot) return
    const x = this.t
    const e = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 // ease in-out, cubic
    const ang = this.openAngleDeg * e
    // The checked path, every half degree, read between its samples.
    const f = Math.min(ang / 0.5, FACEPLATE_PATH.length - 1)
    const i = Math.floor(f)
    const j = Math.min(i + 1, FACEPLATE_PATH.length - 1)
    const w = f - i
    const a = FACEPLATE_PATH[i]
    const b = FACEPLATE_PATH[j]
    this.pivot.rotation.x = -THREE.MathUtils.degToRad(ang)
    this.pivot.position.set(this.pivotRest.x, this.pivotRest.y + a[1] + (b[1] - a[1]) * w, this.pivotRest.z + a[2] + (b[2] - a[2]) * w)
  }

  dispose() {
    // Geometry is shared with the cached scene; only the materials are ours.
    for (const m of this.materials) m.dispose()
    this.environment?.dispose()
  }
}
