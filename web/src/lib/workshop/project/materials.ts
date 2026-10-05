import * as THREE from "three"

import type { Filament } from "@/lib/workshop/project/types"

// What things are made of, for the renders: physically based materials
// with the surface detail that tells real stock apart - a PCB's solder
// mask over copper traces and white silkscreen, brushed aluminium's
// streaks, an LED's clear epoxy, and a printed part's layer lines. The
// detail is drawn procedurally (canvas textures, a shader patch), so it
// costs no downloads. Units are millimetres, like the models.

const cache = new Map<string, THREE.Texture>()

function canvasTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void, srgb = true) {
  let texture = cache.get(key)
  if (texture) return texture
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size
  draw(canvas.getContext("2d")!, size)
  texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  cache.set(key, texture)
  return texture
}

/** A seeded random, so every board draws the same. */
function random(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

const css = (c: THREE.Color, k = 1) => `rgb(${Math.round(Math.min(1, c.r * k) * 255)},${Math.round(Math.min(1, c.g * k) * 255)},${Math.round(Math.min(1, c.b * k) * 255)})`

/** Solder mask over copper: traces, pads and vias, a little silkscreen. */
function pcbMaps(mask: number) {
  const base = new THREE.Color(mask)
  const color = canvasTexture(`pcb-${mask}`, 512, (ctx, n) => {
    const rnd = random(7 + mask)
    ctx.fillStyle = css(base)
    ctx.fillRect(0, 0, n, n)
    // Copper under the mask reads as a lighter shade of it.
    ctx.strokeStyle = css(base, 1.45)
    ctx.lineCap = "round"
    for (let i = 0; i < 70; i += 1) {
      ctx.lineWidth = rnd() < 0.8 ? 2 : 5
      let x = rnd() * n
      let y = rnd() * n
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (let k = 0; k < 4; k += 1) {
        const len = 20 + rnd() * 90
        const dir = Math.floor(rnd() * 8) * (Math.PI / 4)
        x += Math.cos(dir) * len
        y += Math.sin(dir) * len
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    // Vias and pads: tinned copper through the mask.
    for (let i = 0; i < 90; i += 1) {
      const x = rnd() * n
      const y = rnd() * n
      ctx.fillStyle = "#c9c2b0"
      ctx.beginPath()
      ctx.arc(x, y, 3 + rnd() * 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#222"
      ctx.beginPath()
      ctx.arc(x, y, 1.3, 0, Math.PI * 2)
      ctx.fill()
    }
    // Silkscreen: outlines and labels.
    ctx.strokeStyle = "rgba(240,240,235,0.9)"
    ctx.fillStyle = "rgba(240,240,235,0.9)"
    ctx.lineWidth = 2
    for (let i = 0; i < 10; i += 1) ctx.strokeRect(rnd() * n, rnd() * n, 20 + rnd() * 50, 12 + rnd() * 30)
    ctx.font = "bold 14px monospace"
    for (let i = 0; i < 12; i += 1) ctx.fillText(["R", "C", "U", "D", "J", "Q"][Math.floor(rnd() * 6)] + Math.floor(rnd() * 30), rnd() * n, rnd() * n)
  })
  const rough = canvasTexture(
    `pcb-rough-${mask}`,
    256,
    (ctx, n) => {
      const rnd = random(11)
      ctx.fillStyle = "rgb(110,110,110)"
      ctx.fillRect(0, 0, n, n)
      for (let i = 0; i < 4000; i += 1) {
        const v = 90 + rnd() * 50
        ctx.fillStyle = `rgb(${v},${v},${v})`
        ctx.fillRect(rnd() * n, rnd() * n, 2, 2)
      }
    },
    false
  )
  return { color, rough }
}

/** Fine streaks along one direction: brushed or extruded metal. */
function brushed() {
  return canvasTexture(
    "brushed",
    512,
    (ctx, n) => {
      const rnd = random(3)
      ctx.fillStyle = "rgb(120,120,120)"
      ctx.fillRect(0, 0, n, n)
      for (let i = 0; i < 1600; i += 1) {
        const v = 70 + rnd() * 110
        ctx.strokeStyle = `rgba(${v},${v},${v},0.5)`
        ctx.lineWidth = 0.5 + rnd()
        const y = rnd() * n
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(n, y + (rnd() - 0.5) * 2)
        ctx.stroke()
      }
    },
    false
  )
}

/** Moulded plastic's fine texture, as a bump map. */
function grain() {
  return canvasTexture(
    "grain",
    256,
    (ctx, n) => {
      const rnd = random(5)
      const img = ctx.createImageData(n, n)
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 110 + rnd() * 40
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
        img.data[i + 3] = 255
      }
      ctx.putImageData(img, 0, 0)
    },
    false
  )
}

function repeat(texture: THREE.Texture, x: number, y = x) {
  const t = texture.clone()
  t.repeat.set(x, y)
  t.needsUpdate = true
  return t
}

export const real = {
  pcb(mask: number) {
    const { color, rough } = pcbMaps(mask)
    return new THREE.MeshPhysicalMaterial({
      map: color,
      roughnessMap: rough,
      roughness: 0.55,
      metalness: 0.05,
      // Solder mask is a lacquer: a glossy coat over a satin board.
      clearcoat: 0.7,
      clearcoatRoughness: 0.28,
    })
  },
  plastic(color: number, roughness = 0.55) {
    return new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, bumpMap: repeat(grain(), 4), bumpScale: 0.15, clearcoat: 0.08 })
  },
  rubber(color = 0x141414) {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.92, metalness: 0, sheen: 0.4, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x333333), bumpMap: repeat(grain(), 8), bumpScale: 0.3 })
  },
  metal(color: number, roughness = 0.32, { brushedScale = 0 } = {}) {
    const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 1 })
    if (brushedScale) {
      m.roughnessMap = repeat(brushed(), brushedScale, 1)
      // Brushing scatters light across the streaks, not along them.
      m.anisotropy = 0.6
    }
    return m
  },
  /** Clear or tinted epoxy (an LED's body): light passes through it. */
  epoxy(color: number) {
    return new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.7,
      thickness: 3,
      ior: 1.52,
      attenuationColor: new THREE.Color(color),
      attenuationDistance: 6,
      emissive: color,
      emissiveIntensity: 0,
    })
  },
  ceramic(color: number) {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.4 })
  },
}

// --- printed parts -------------------------------------------------------------------
//
// A filament is a finish (gloss, sheen, clarity), surface detail drawn in
// the shader from the part's own coordinates (layer lines along its build
// axis, marble veins, wood rings, glitter flakes, a dual-colour silk's two
// faces, fuzzy skin), and for the reactive ones a response to the world:
// glow-in-the-dark charges in light and glows as the room goes dark,
// thermochromic changes colour as it warms, UV-reactive fluoresces under a
// UV lamp. The world is set with setAmbient (room light, UV) and
// setTemperature (per part); the try-on feeds in the real room's light.

/** What each filament looks like: its gloss, and how deep its layer lines read. */
const FILAMENT: Record<Filament, { roughness: number; metalness: number; lines: number; clearcoat?: number; sheen?: number; transmission?: number; color: number; color2?: number }> = {
  pla: { roughness: 0.5, metalness: 0, lines: 0.32, clearcoat: 0.1, color: 0x6b7480 },
  silk: { roughness: 0.28, metalness: 0.35, lines: 0.22, clearcoat: 0.6, sheen: 0.5, color: 0xc0a060 },
  petg: { roughness: 0.22, metalness: 0, lines: 0.2, clearcoat: 0.8, color: 0x5a6a7a },
  matte: { roughness: 0.86, metalness: 0, lines: 0.42, color: 0x2a2d31 },
  resin: { roughness: 0.32, metalness: 0, lines: 0.02, clearcoat: 0.4, color: 0x9aa0a8 },
  carbon: { roughness: 0.7, metalness: 0.1, lines: 0.36, color: 0x1c1e21 },
  metal: { roughness: 0.3, metalness: 1, lines: 0.06, clearcoat: 0.2, color: 0xb02a22 },
  clear: { roughness: 0.12, metalness: 0, lines: 0.18, transmission: 0.85, color: 0xdfefff },
  marble: { roughness: 0.55, metalness: 0, lines: 0.28, clearcoat: 0.15, color: 0xe6e4df, color2: 0x5c5c60 },
  wood: { roughness: 0.82, metalness: 0, lines: 0.4, color: 0x9a6a3c, color2: 0x5a3a1c },
  glitter: { roughness: 0.45, metalness: 0.1, lines: 0.3, clearcoat: 0.3, color: 0x1a1c2c, color2: 0xe8e8ff },
  dual_silk: { roughness: 0.26, metalness: 0.4, lines: 0.22, clearcoat: 0.6, sheen: 0.5, color: 0xc9a24a, color2: 0xb33a3a },
  glow: { roughness: 0.5, metalness: 0, lines: 0.32, clearcoat: 0.1, color: 0xdfe8c8, color2: 0x8cff3a },
  thermo: { roughness: 0.5, metalness: 0, lines: 0.32, clearcoat: 0.1, color: 0x2a5ad0, color2: 0xf2f0ea },
  uv: { roughness: 0.4, metalness: 0, lines: 0.28, clearcoat: 0.2, color: 0xeeeee6, color2: 0x20ff50 },
}

/** A printed part's surface: as printed, fuzzy skin, or sanded/ironed smooth. */
export type PrintTexture = "layers" | "fuzzy" | "smooth"

/** Layer height the lines are drawn at, mm. */
const LAYER = 0.2

/** The world the reactive filaments respond to. */
const world = { light: 0.85, uv: 0 }
const reactive = new Set<THREE.MeshPhysicalMaterial>()

/** Room light (0 dark - 1 bright) and UV (0 none - 1 a UV lamp up close). */
export function setAmbient({ light, uv }: { light?: number; uv?: number }) {
  if (light !== undefined) world.light = THREE.MathUtils.clamp(light, 0, 1)
  if (uv !== undefined) world.uv = THREE.MathUtils.clamp(uv, 0, 1)
  for (const m of reactive) {
    m.userData.uniforms.uLight.value = world.light
    m.userData.uniforms.uUv.value = world.uv
  }
}

/** A part's temperature, C (thermochromic filament turns at about 31 C). */
export function setTemperature(material: THREE.Material, celsius: number) {
  const u = material.userData.uniforms
  if (u?.uTemp) u.uTemp.value = celsius
}

const GLSL_NOISE = /* glsl */ `
  float fHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float fNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(fHash(i), fHash(i + vec3(1, 0, 0)), f.x), mix(fHash(i + vec3(0, 1, 0)), fHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(fHash(i + vec3(0, 0, 1)), fHash(i + vec3(1, 0, 1)), f.x), mix(fHash(i + vec3(0, 1, 1)), fHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fFbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * fNoise(p); p *= 2.03; a *= 0.5; } return s; }
`

/**
 * A printed part's material: the filament's finish and surface, with FDM
 * layer lines along the part's own z (the print's build axis). Faces
 * square to z (tops and floors) get no lines, as on a real print, and fine
 * detail fades out where it would be smaller than a pixel rather than
 * shimmer. `color2` is the second colour where a filament has one (marble
 * veins, wood rings, glitter flakes, a dual silk's other face, the colour
 * a thermochromic turns, the glow or fluorescence).
 */
export function filament(kind: Filament = "pla", color?: string | number, { color2, texture = "layers" }: { color2?: string | number; texture?: PrintTexture } = {}) {
  const spec = FILAMENT[kind] ?? FILAMENT.pla
  const material = new THREE.MeshPhysicalMaterial({
    color: color !== undefined ? new THREE.Color(color) : spec.color,
    roughness: texture === "fuzzy" ? Math.max(0.8, spec.roughness) : spec.roughness,
    metalness: spec.metalness,
    clearcoat: texture === "fuzzy" ? 0 : spec.clearcoat ?? 0,
    clearcoatRoughness: 0.35,
    sheen: spec.sheen ?? 0,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color(0xffffff),
    transmission: spec.transmission ?? 0,
    thickness: spec.transmission ? 2 : 0,
    ior: 1.5,
  })
  if (kind === "carbon") {
    material.roughnessMap = repeat(grain(), 10)
    material.bumpMap = repeat(grain(), 10)
    material.bumpScale = 0.4
  }
  const lines = texture === "smooth" ? 0 : spec.lines
  const uniforms = {
    uLayer: { value: LAYER },
    uLines: { value: lines },
    uColor2: { value: new THREE.Color(color2 ?? spec.color2 ?? 0xffffff) },
    uLight: { value: world.light },
    uUv: { value: world.uv },
    uTemp: { value: 20 },
  }
  material.userData.uniforms = uniforms
  material.userData.filament = kind
  if (kind === "glow" || kind === "uv" || kind === "thermo") {
    reactive.add(material)
    material.addEventListener("dispose", () => reactive.delete(material))
  }
  const define = `#define F_${kind.toUpperCase()}\n${texture === "fuzzy" ? "#define F_FUZZY\n" : ""}`

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPrintPos;\nvarying vec3 vBuildAxis;\nvarying vec3 vObjNormal;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvPrintPos = position;\nvObjNormal = normal;\nvBuildAxis = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));"
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `${define}#include <common>
        varying vec3 vPrintPos; varying vec3 vBuildAxis; varying vec3 vObjNormal;
        uniform float uLayer, uLines, uLight, uUv, uTemp;
        uniform vec3 uColor2;
        ${GLSL_NOISE}`
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        float fH = vPrintPos.z / uLayer;
        float fFade = 1.0 - smoothstep(0.3, 0.75, fwidth(fH));
        diffuseColor.rgb *= 1.0 - 0.06 * uLines * fFade * (0.5 + 0.5 * cos(6.2831853 * fH));
        #ifdef F_MARBLE
          // Veins a few centimetres apart, wandering, with fainter ones between.
          float fV = fFbm(vPrintPos * 0.12);
          float fVein = 1.0 - smoothstep(0.0, 0.14, abs(sin((vPrintPos.x + vPrintPos.z * 0.6 - vPrintPos.y * 0.3) * 0.16 + fV * 6.0))) * (0.6 + 0.4 * fV);
          fVein = max(fVein, (1.0 - smoothstep(0.0, 0.3, abs(sin((vPrintPos.x + vPrintPos.z * 0.6 - vPrintPos.y * 0.3) * 0.16 + fV * 6.0)))) * 0.35);
          float fFaint = 1.0 - smoothstep(0.0, 0.1, abs(sin((vPrintPos.y - vPrintPos.z * 0.4) * 0.35 + fFbm(vPrintPos * 0.25) * 4.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, uColor2, fVein * 0.75 + fFaint * 0.25);
        #endif
        #ifdef F_WOOD
          float fRing = fract(length(vPrintPos.xy) * 0.12 + fFbm(vPrintPos * 0.04) * 2.5);
          float fFibre = fNoise(vec3(vPrintPos.xy * 2.0, vPrintPos.z * 0.2));
          diffuseColor.rgb = mix(diffuseColor.rgb, uColor2, smoothstep(0.55, 0.95, fRing) * 0.7 + fFibre * 0.15);
        #endif
        #ifdef F_DUAL_SILK
          vec2 fSide = normalize(vObjNormal.xy + vec2(1e-4));
          diffuseColor.rgb = mix(diffuseColor.rgb, uColor2, smoothstep(-0.3, 0.3, dot(fSide, vec2(0.7071, 0.7071))));
        #endif
        #ifdef F_THERMO
          diffuseColor.rgb = mix(diffuseColor.rgb, uColor2, smoothstep(27.0, 34.0, uTemp));
        #endif
        #ifdef F_GLITTER
          float fCell = fHash(floor(vPrintPos * 3.0));
          float fFlake = step(0.94, fCell) * (1.0 - smoothstep(0.4, 1.2, fwidth(vPrintPos.x * 3.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, uColor2, fFlake * 0.6);
        #endif`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `#include <roughnessmap_fragment>
        #ifdef F_GLITTER
          roughnessFactor = mix(roughnessFactor, 0.08, fFlake);
        #endif`
      )
      .replace(
        "#include <metalnessmap_fragment>",
        /* glsl */ `#include <metalnessmap_fragment>
        #ifdef F_GLITTER
          metalnessFactor = mix(metalnessFactor, 1.0, fFlake);
        #endif`
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `#include <normal_fragment_maps>
        {
          // Each layer is a rounded bead: the surface tilts up then down
          // across it, about the wall's horizontal.
          vec3 tilt = vBuildAxis - normal * dot(vBuildAxis, normal);
          normal = normalize(normal + tilt * sin(6.2831853 * fH) * uLines * fFade);
          #ifdef F_FUZZY
            vec3 fJ = vec3(fNoise(vPrintPos * 1.7), fNoise(vPrintPos * 1.7 + 31.0), fNoise(vPrintPos * 1.7 + 57.0)) - 0.5;
            normal = normalize(normal + fJ * 0.9 * (1.0 - smoothstep(0.5, 1.5, fwidth(vPrintPos.x * 1.7))));
          #endif
        }`
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        #ifdef F_GLOW
          // Charged by the light, it shows as the room goes dark - and
          // under UV it lights straight up.
          totalEmissiveRadiance += uColor2 * (pow(1.0 - uLight, 2.0) * 0.75 + uUv * 0.7);
        #endif
        #ifdef F_UV
          totalEmissiveRadiance += uColor2 * uUv * 0.9;
        #endif`
      )
  }
  material.customProgramCacheKey = () => `fdm-${kind}-${texture}-${lines}`
  return material
}
