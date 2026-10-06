import * as THREE from "three"
import { HDRLoader } from "three/addons/loaders/HDRLoader.js"
import { HorizontalBlurShader } from "three/addons/shaders/HorizontalBlurShader.js"
import { VerticalBlurShader } from "three/addons/shaders/VerticalBlurShader.js"

// The stage's dressing, each piece switchable (lib/workshop/visuals.ts):
// the studio HDRI it is lit by, contact shadows under what stands on it,
// the dust hanging in the projector's light and the beam itself, and a
// faint floor grid that fades out from the middle.

/** The layer a solid is on while it casts a contact shadow. */
export const CASTER_LAYER = 5

// --- studio light ------------------------------------------------------------------

let studio: Promise<THREE.Texture | null> | null = null

/** The studio HDRI (public/env, CC0) as a prefiltered environment, loaded
 *  once per page; null if it cannot be had (the room stays). */
export function loadStudio(renderer: THREE.WebGLRenderer): Promise<THREE.Texture | null> {
  studio ??= new HDRLoader()
    .loadAsync("/env/studio_small_08_1k.hdr")
    .then((hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping
      const pmrem = new THREE.PMREMGenerator(renderer)
      const env = pmrem.fromEquirectangular(hdr).texture
      pmrem.dispose()
      hdr.dispose()
      return env
    })
    .catch(() => null)
  return studio
}

// --- contact shadows -----------------------------------------------------------------

/**
 * A soft shadow where things meet the floor: what is on CASTER_LAYER is
 * drawn from below as depth (darker the closer it is to the floor), blurred
 * twice, and laid on the floor - the grounding a shadow map is too hard and
 * too costly to give small parts. After three.js's contact-shadow example.
 */
export class ContactShadows {
  readonly group = new THREE.Group()
  private readonly target: THREE.WebGLRenderTarget
  private readonly blurred: THREE.WebGLRenderTarget
  private readonly camera: THREE.OrthographicCamera
  private readonly depth: THREE.MeshDepthMaterial
  private readonly blurPlane: THREE.Mesh
  private readonly hBlur = new THREE.ShaderMaterial({ ...HorizontalBlurShader, depthTest: false })
  private readonly vBlur = new THREE.ShaderMaterial({ ...VerticalBlurShader, depthTest: false })
  private readonly plane: THREE.Mesh

  constructor(size = 14, height = 3, resolution = 256, opacity = 0.75, private readonly blur = 1.4) {
    this.target = new THREE.WebGLRenderTarget(resolution, resolution)
    this.target.texture.generateMipmaps = false
    this.blurred = new THREE.WebGLRenderTarget(resolution, resolution)
    this.blurred.texture.generateMipmaps = false
    const geometry = new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2)
    this.plane = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ map: this.target.texture, opacity, transparent: true, depthWrite: false })
    )
    this.plane.renderOrder = 1
    // The target is drawn from below: flipped to read right way up.
    this.plane.scale.y = -1
    this.plane.position.y = 0.004
    this.group.add(this.plane)
    this.blurPlane = new THREE.Mesh(geometry)
    this.blurPlane.visible = false
    this.group.add(this.blurPlane)
    this.camera = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height)
    this.camera.rotation.x = Math.PI / 2
    this.camera.layers.set(CASTER_LAYER)
    this.group.add(this.camera)
    this.depth = new THREE.MeshDepthMaterial()
    this.depth.userData.darkness = { value: 1.4 }
    this.depth.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = this.depth.userData.darkness
      shader.fragmentShader = `uniform float darkness;\n${shader.fragmentShader.replace(
        "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
        "gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );"
      )}`
    }
    this.depth.depthTest = false
    this.depth.depthWrite = false
  }

  private blurPass(amount: number, renderer: THREE.WebGLRenderer) {
    this.blurPlane.visible = true
    this.blurPlane.material = this.hBlur
    this.hBlur.uniforms.tDiffuse.value = this.target.texture
    this.hBlur.uniforms.h.value = amount / 256
    renderer.setRenderTarget(this.blurred)
    renderer.render(this.blurPlane, this.camera)
    this.blurPlane.material = this.vBlur
    this.vBlur.uniforms.tDiffuse.value = this.blurred.texture
    this.vBlur.uniforms.v.value = amount / 256
    renderer.setRenderTarget(this.target)
    renderer.render(this.blurPlane, this.camera)
    this.blurPlane.visible = false
  }

  /** Redraw the shadow from where things stand now. */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    const background = scene.background
    const alpha = renderer.getClearAlpha()
    const previous = renderer.getRenderTarget()
    scene.background = null
    scene.overrideMaterial = this.depth
    renderer.setClearAlpha(0)
    renderer.setRenderTarget(this.target)
    renderer.clear()
    renderer.render(scene, this.camera)
    scene.overrideMaterial = null
    this.blurPass(this.blur, renderer)
    this.blurPass(this.blur * 0.4, renderer)
    renderer.setRenderTarget(previous)
    renderer.setClearAlpha(alpha)
    scene.background = background
  }

  dispose() {
    this.target.dispose()
    this.blurred.dispose()
    this.depth.dispose()
    this.hBlur.dispose()
    this.vBlur.dispose()
    this.plane.geometry.dispose()
    ;(this.plane.material as THREE.Material).dispose()
  }
}

// --- atmosphere ----------------------------------------------------------------------

const dustVertex = /* glsl */ `
uniform float uTime;
uniform float uHeight;
uniform float uSize;
attribute float aPhase;
varying float vAlpha;
void main() {
  vec3 p = position;
  // Drifting up and around, wrapping at the top.
  p.y = mod(p.y + uTime * 0.04 * (0.5 + aPhase), uHeight);
  p.x += sin(uTime * 0.15 + aPhase * 6.28) * 0.25;
  p.z += cos(uTime * 0.12 + aPhase * 6.28) * 0.25;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + aPhase) / -mv.z;
  // Brighter near the beam's axis, twinkling, gone near floor and ceiling.
  float axis = 1.0 - smoothstep(0.5, 4.5, length(p.xz));
  float ends = smoothstep(0.0, 0.6, p.y) * (1.0 - smoothstep(uHeight - 1.2, uHeight, p.y));
  vAlpha = (0.25 + 0.75 * axis) * ends * (0.55 + 0.45 * sin(uTime * (1.0 + aPhase * 2.0) + aPhase * 40.0));
}
`

const dustFragment = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha * 0.55;
  gl_FragColor = vec4(uColor, a);
}
`

const beamVertex = /* glsl */ `
varying vec3 vNormalView;
varying vec3 vToEye;
varying float vAlong;
varying vec2 vUv;
void main() {
  vUv = uv;
  vAlong = uv.y;
  vNormalView = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vToEye = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`

const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec3 vNormalView;
varying vec3 vToEye;
varying float vAlong;
varying vec2 vUv;
void main() {
  // A volume seen through: densest where the eye looks through most of it
  // (the middle), thinning to its edges; brightest at the projector.
  float through = pow(abs(dot(normalize(vNormalView), normalize(vToEye))), 1.6);
  float fall = mix(0.25, 1.0, pow(vAlong, 1.5));
  float streaks = 0.75 + 0.25 * sin(vUv.x * 80.0 + uTime * 0.6) * sin(vUv.x * 23.0 - uTime * 0.4);
  float a = through * fall * streaks * 0.075;
  gl_FragColor = vec4(uColor, a);
}
`

/** Dust in the air and the projector's beam down onto the pad. */
export class Atmosphere {
  readonly group = new THREE.Group()
  private readonly dust: THREE.ShaderMaterial
  private readonly beam: THREE.ShaderMaterial
  /** The projector's lens ring, for the bloom. */
  readonly emitter: THREE.LineLoop

  constructor(color: number, { count = 520, radius = 6.5, height = 6 } = {}) {
    const positions = new Float32Array(count * 3)
    const phases = new Float32Array(count)
    for (let i = 0; i < count; i += 1) {
      // More of it near the middle, where the light is.
      const r = radius * Math.pow(Math.random(), 0.7)
      const a = Math.random() * Math.PI * 2
      positions.set([Math.cos(a) * r, Math.random() * height, Math.sin(a) * r], i * 3)
      phases[i] = Math.random()
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1))
    this.dust = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHeight: { value: height }, uSize: { value: 22 }, uColor: { value: new THREE.Color(color) } },
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const points = new THREE.Points(geometry, this.dust)
    points.frustumCulled = false
    this.group.add(points)

    // The beam: from a small lens high above the pad, widening down to it.
    const top = 0.18
    const bottom = 2.3
    const drop = 5.6
    this.beam = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, drop, 64, 1, true), this.beam)
    cone.position.y = drop / 2
    cone.renderOrder = 2
    this.group.add(cone)
    const ring: number[] = []
    for (let i = 0; i < 48; i += 1) {
      const a = (i / 48) * Math.PI * 2
      ring.push(Math.cos(a) * top * 1.4, 0, Math.sin(a) * top * 1.4)
    }
    const lens = new THREE.BufferGeometry()
    lens.setAttribute("position", new THREE.Float32BufferAttribute(ring, 3))
    this.emitter = new THREE.LineLoop(lens, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.emitter.position.y = drop
    this.group.add(this.emitter)
  }

  update(t: number, color: number) {
    this.dust.uniforms.uTime.value = t
    this.beam.uniforms.uTime.value = t
    ;(this.dust.uniforms.uColor.value as THREE.Color).setHex(color)
    ;(this.beam.uniforms.uColor.value as THREE.Color).setHex(color)
    ;(this.emitter.material as THREE.LineBasicMaterial).color.setHex(color)
  }
}

// --- floor grid ------------------------------------------------------------------------

/** A fine floor grid, anti-aliased, fading out from the middle. */
export function radialGrid(color: number, size = 18, cell = 0.5): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uCell: { value: cell }, uFade: { value: new THREE.Vector2(1.5, size * 0.42) } },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vXZ = (modelMatrix * vec4(position, 1.0)).xz;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uCell;
      uniform vec2 uFade;
      varying vec2 vXZ;
      void main() {
        vec2 g = abs(fract(vXZ / uCell - 0.5) - 0.5) / fwidth(vXZ / uCell);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float fade = 1.0 - smoothstep(uFade.x, uFade.y, length(vXZ));
        gl_FragColor = vec4(uColor, line * fade * 0.16);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), material)
  grid.position.y = 0.003
  return grid
}
