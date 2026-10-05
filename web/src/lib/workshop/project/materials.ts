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

/** What each filament looks like: its gloss, and how deep its layer lines read. */
const FILAMENT: Record<Filament, { roughness: number; metalness: number; lines: number; clearcoat?: number; sheen?: number; transmission?: number; sparkle?: boolean; color: number }> = {
  pla: { roughness: 0.5, metalness: 0, lines: 0.32, clearcoat: 0.1, color: 0x6b7480 },
  silk: { roughness: 0.28, metalness: 0.35, lines: 0.22, clearcoat: 0.6, sheen: 0.5, color: 0xc0a060 },
  petg: { roughness: 0.22, metalness: 0, lines: 0.2, clearcoat: 0.8, color: 0x5a6a7a },
  matte: { roughness: 0.86, metalness: 0, lines: 0.42, color: 0x2a2d31 },
  resin: { roughness: 0.32, metalness: 0, lines: 0.02, clearcoat: 0.4, color: 0x9aa0a8 },
  carbon: { roughness: 0.7, metalness: 0.1, lines: 0.36, sparkle: true, color: 0x1c1e21 },
  metal: { roughness: 0.3, metalness: 1, lines: 0.06, clearcoat: 0.2, color: 0xb02a22 },
  clear: { roughness: 0.12, metalness: 0, lines: 0.18, transmission: 0.85, color: 0xdfefff },
}

/** Layer height the lines are drawn at, mm. */
const LAYER = 0.2

/**
 * A printed part's material: the filament's finish, with FDM layer lines
 * drawn in the shader along the part's own z (the print's build axis).
 * Faces square to z (tops and floors) get none, as on a real print, and
 * the lines fade out where they would be finer than a pixel rather than
 * shimmer.
 */
export function filament(kind: Filament = "pla", color?: string | number) {
  const spec = FILAMENT[kind] ?? FILAMENT.pla
  const material = new THREE.MeshPhysicalMaterial({
    color: color !== undefined ? new THREE.Color(color) : spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    clearcoat: spec.clearcoat ?? 0,
    clearcoatRoughness: 0.35,
    sheen: spec.sheen ?? 0,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color(0xffffff),
    transmission: spec.transmission ?? 0,
    thickness: spec.transmission ? 2 : 0,
    ior: 1.5,
  })
  if (spec.sparkle) {
    material.roughnessMap = repeat(grain(), 10)
    material.bumpMap = repeat(grain(), 10)
    material.bumpScale = 0.4
  }
  const depth = spec.lines
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLayer = { value: LAYER }
    shader.uniforms.uLines = { value: depth }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPrintPos;\nvarying vec3 vBuildAxis;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvPrintPos = position;\nvBuildAxis = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));"
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vPrintPos;\nvarying vec3 vBuildAxis;\nuniform float uLayer;\nuniform float uLines;"
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `#include <normal_fragment_maps>
        {
          float h = vPrintPos.z / uLayer;
          float fade = 1.0 - smoothstep(0.3, 0.75, fwidth(h));
          // Each layer is a rounded bead: the surface tilts up then down
          // across it, about the wall's horizontal.
          vec3 tilt = vBuildAxis - normal * dot(vBuildAxis, normal);
          normal = normalize(normal + tilt * sin(6.2831853 * h) * uLines * fade);
        }`
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        {
          float h = vPrintPos.z / uLayer;
          float fade = 1.0 - smoothstep(0.3, 0.75, fwidth(h));
          diffuseColor.rgb *= 1.0 - 0.06 * uLines * fade * (0.5 + 0.5 * cos(6.2831853 * h));
        }`
      )
  }
  material.customProgramCacheKey = () => `fdm-${depth}-${spec.sparkle ? 1 : 0}`
  return material
}
