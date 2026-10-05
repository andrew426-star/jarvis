import * as THREE from "three"

import { filament, real } from "@/lib/workshop/project/materials"
import type { Filament } from "@/lib/workshop/project/types"

// The material lab's stock: real engineering materials with the published
// figures the tests run on (typical values; a datasheet for the exact
// grade beats them). Units: E in GPa, strengths in MPa, elongation at
// break in %, density kg/m3, temperatures in degrees C. `soften` is where
// stiffness falls away (glass transition, heat deflection, or a metal's
// loss of strength); `melt` is where it stops being a solid at all (melts,
// chars or decomposes).

export type Behaviour = "ductile" | "brittle" | "elastomer"

export interface LabMaterial {
  id: string
  name: string
  family: "Elastomer" | "Printed polymer" | "Polymer" | "Glass" | "Metal" | "Composite" | "Natural" | "Ceramic"
  behaviour: Behaviour
  E: number
  yield?: number
  uts: number
  elongation: number
  density: number
  poisson: number
  /** Coefficient of restitution against hardened steel. */
  bounce: number
  soften: number
  melt: number
  /** What the melt temperature means. */
  meltWord?: "melts" | "chars" | "decomposes" | "softens to flow"
  note?: string
  /** The filament it is, when it is one (for printed parts). */
  filament?: Filament
}

export const MATERIALS: LabMaterial[] = [
  { id: "natural_rubber", name: "Natural rubber", family: "Elastomer", behaviour: "elastomer", E: 0.0015, uts: 25, elongation: 650, density: 920, poisson: 0.49, bounce: 0.85, soften: 80, melt: 200, meltWord: "decomposes" },
  { id: "silicone", name: "Silicone rubber", family: "Elastomer", behaviour: "elastomer", E: 0.004, uts: 8, elongation: 450, density: 1100, poisson: 0.49, bounce: 0.6, soften: 230, melt: 350, meltWord: "decomposes" },
  { id: "tpu", name: "TPU 95A", family: "Printed polymer", behaviour: "elastomer", E: 0.026, uts: 40, elongation: 550, density: 1210, poisson: 0.48, bounce: 0.7, soften: 60, melt: 220, filament: "matte" },
  { id: "pla", name: "PLA", family: "Printed polymer", behaviour: "ductile", E: 3.5, yield: 55, uts: 60, elongation: 6, density: 1240, poisson: 0.36, bounce: 0.5, soften: 58, melt: 175, filament: "pla", note: "Printed parts are weaker across layers: about 60% of this along z." },
  { id: "petg", name: "PETG", family: "Printed polymer", behaviour: "ductile", E: 2.1, yield: 50, uts: 53, elongation: 25, density: 1270, poisson: 0.38, bounce: 0.55, soften: 78, melt: 240, filament: "petg" },
  { id: "abs", name: "ABS", family: "Printed polymer", behaviour: "ductile", E: 2.3, yield: 40, uts: 43, elongation: 25, density: 1050, poisson: 0.35, bounce: 0.5, soften: 98, melt: 230, filament: "matte" },
  { id: "nylon", name: "Nylon PA12", family: "Printed polymer", behaviour: "ductile", E: 1.7, yield: 45, uts: 50, elongation: 50, density: 1010, poisson: 0.39, bounce: 0.55, soften: 95, melt: 178, filament: "matte" },
  { id: "pla_cf", name: "PLA carbon fibre", family: "Printed polymer", behaviour: "brittle", E: 6, uts: 65, elongation: 2, density: 1300, poisson: 0.35, bounce: 0.45, soften: 60, melt: 175, filament: "carbon" },
  { id: "resin", name: "SLA resin (standard)", family: "Printed polymer", behaviour: "brittle", E: 2.5, uts: 55, elongation: 6, density: 1180, poisson: 0.36, bounce: 0.5, soften: 60, melt: 300, meltWord: "decomposes", filament: "resin" },
  { id: "acrylic", name: "Acrylic (PMMA)", family: "Polymer", behaviour: "brittle", E: 3.2, uts: 70, elongation: 4, density: 1180, poisson: 0.37, bounce: 0.6, soften: 105, melt: 160, meltWord: "softens to flow" },
  { id: "polycarbonate", name: "Polycarbonate", family: "Polymer", behaviour: "ductile", E: 2.4, yield: 62, uts: 66, elongation: 110, density: 1200, poisson: 0.37, bounce: 0.6, soften: 140, melt: 260 },
  { id: "glass", name: "Soda-lime glass", family: "Glass", behaviour: "brittle", E: 70, uts: 50, elongation: 0.07, density: 2500, poisson: 0.22, bounce: 0.9, soften: 720, melt: 1000, meltWord: "softens to flow", note: "Strength is set by surface flaws: a scratched pane is far weaker." },
  { id: "tempered_glass", name: "Tempered glass", family: "Glass", behaviour: "brittle", E: 70, uts: 150, elongation: 0.21, density: 2500, poisson: 0.22, bounce: 0.9, soften: 500, melt: 1000, meltWord: "softens to flow", note: "Above about 500 C the temper relaxes and it is ordinary glass again." },
  { id: "aluminium", name: "Aluminium 6061-T6", family: "Metal", behaviour: "ductile", E: 69, yield: 276, uts: 310, elongation: 12, density: 2700, poisson: 0.33, bounce: 0.5, soften: 300, melt: 650 },
  { id: "mild_steel", name: "Mild steel 1018", family: "Metal", behaviour: "ductile", E: 205, yield: 370, uts: 440, elongation: 15, density: 7870, poisson: 0.29, bounce: 0.6, soften: 550, melt: 1450 },
  { id: "stainless", name: "Stainless 304", family: "Metal", behaviour: "ductile", E: 193, yield: 215, uts: 505, elongation: 70, density: 8000, poisson: 0.29, bounce: 0.6, soften: 650, melt: 1400 },
  { id: "titanium", name: "Titanium Ti-6Al-4V", family: "Metal", behaviour: "ductile", E: 114, yield: 880, uts: 950, elongation: 14, density: 4430, poisson: 0.34, bounce: 0.65, soften: 450, melt: 1600 },
  { id: "copper", name: "Copper (annealed)", family: "Metal", behaviour: "ductile", E: 117, yield: 70, uts: 220, elongation: 45, density: 8960, poisson: 0.34, bounce: 0.4, soften: 400, melt: 1085 },
  { id: "cfrp", name: "Carbon fibre (CFRP)", family: "Composite", behaviour: "brittle", E: 70, uts: 600, elongation: 0.9, density: 1600, poisson: 0.3, bounce: 0.55, soften: 120, melt: 350, meltWord: "decomposes", note: "Quasi-isotropic laminate; along a single ply it is several times stiffer." },
  { id: "oak", name: "Oak (along grain)", family: "Natural", behaviour: "brittle", E: 11, uts: 90, elongation: 1, density: 750, poisson: 0.35, bounce: 0.45, soften: 200, melt: 280, meltWord: "chars", note: "Across the grain it is about a tenth as strong." },
  { id: "concrete", name: "Concrete", family: "Ceramic", behaviour: "brittle", E: 30, uts: 3, elongation: 0.01, density: 2400, poisson: 0.2, bounce: 0.3, soften: 600, melt: 1200, meltWord: "decomposes", note: "Tensile strength only; in compression it is about ten times stronger." },
]

export const BY_ID = new Map(MATERIALS.map((m) => [m.id, m]))

/** A printed part's filament as a lab material. */
export function forFilament(kind: Filament | undefined): LabMaterial {
  const map: Record<Filament, string> = { pla: "pla", silk: "pla", matte: "pla", petg: "petg", resin: "resin", carbon: "pla_cf", metal: "pla", clear: "petg" }
  return BY_ID.get(map[kind ?? "pla"])!
}

/** Find a material by id or loosely by name ("rubber", "glass", "steel"). */
export function findMaterial(query: string): LabMaterial | undefined {
  const q = query.toLowerCase().trim()
  return BY_ID.get(q) ?? MATERIALS.find((m) => m.name.toLowerCase() === q) ?? MATERIALS.find((m) => m.name.toLowerCase().includes(q) || m.id.includes(q.replace(/\s+/g, "_")))
}

/** What it looks like: the same real materials the renders use. */
export function labMaterial(m: LabMaterial): THREE.MeshPhysicalMaterial {
  switch (m.id) {
    case "natural_rubber":
      return real.rubber(0x2a2420)
    case "silicone":
      return Object.assign(real.rubber(0xc23b3b), { roughness: 0.6 })
    case "tpu":
      return filament("matte", "#e0662a")
    case "glass":
    case "tempered_glass":
    case "acrylic":
      return new THREE.MeshPhysicalMaterial({ color: m.id === "acrylic" ? 0xf4fbff : 0xd8f0e8, roughness: 0.03, metalness: 0, transmission: 0.95, thickness: 4, ior: m.id === "acrylic" ? 1.49 : 1.52, attenuationColor: new THREE.Color(m.id === "acrylic" ? 0xffffff : 0x9fe0c8), attenuationDistance: 40, specularIntensity: 1 })
    case "polycarbonate":
      return new THREE.MeshPhysicalMaterial({ color: 0xe8f2ff, roughness: 0.08, transmission: 0.85, thickness: 4, ior: 1.58 })
    case "aluminium":
      return real.metal(0xd2d6db, 0.35, { brushedScale: 4 })
    case "mild_steel":
      return real.metal(0x8c9096, 0.42)
    case "stainless":
      return real.metal(0xc8ccd0, 0.22, { brushedScale: 6 })
    case "titanium":
      return real.metal(0xa29b91, 0.3)
    case "copper":
      return real.metal(0xd38a5a, 0.28)
    case "cfrp":
      return Object.assign(filament("carbon", "#16181b"), { clearcoat: 0.9, clearcoatRoughness: 0.15 })
    case "oak":
      return real.ceramic(0x9b7246)
    case "concrete":
      return Object.assign(real.plastic(0x9a9893, 0.95), { bumpScale: 0.6 })
    case "pla":
      return filament("pla", "#d9dde2")
    case "petg":
      return filament("petg", "#3a6ea5")
    case "abs":
      return filament("matte", "#e8e3d8")
    case "nylon":
      return filament("matte", "#ece8de")
    case "pla_cf":
      return filament("carbon")
    case "resin":
      return filament("resin", "#8f9aa6")
    default:
      return filament("pla")
  }
}
