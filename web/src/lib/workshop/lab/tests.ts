import type { LabMaterial } from "@/lib/workshop/lab/catalog"

// The material lab's tests, worked from the materials' figures with the
// textbook models - what a bench test would show, near enough to compare
// materials and pick one, not to certify a part.
//
//  - tensile: a dogbone (50 mm gauge, 10 x 4 mm) pulled to failure. Ductile
//    metals and polymers run elastic, yield, work-harden to their
//    ultimate strength and neck; brittle ones stay linear and snap;
//    rubber follows a hyperelastic (neo-Hookean) curve that stiffens as
//    its chains straighten.
//  - drop: a 20 mm ball dropped onto a hardened steel anvil. Hertz contact
//    gives the peak force and pressure; a brittle ball cracks when the
//    tensile ring stress at the contact's edge passes its strength (raised
//    for the tiny stressed area), a ductile one dents when the pressure
//    passes 1.6 x its yield, and what is left bounces by its restitution.
//  - bend: a 100 mm span three-point bend of a 10 x 4 mm bar - beam theory
//    to first yield, a plastic hinge after, fracture when the outer fibre
//    runs out of elongation.
//  - heat: a 60 mm cantilever with a 2 N tip load, heated 20 to 800 C; its
//    stiffness falls away through the softening point, and it is gone at
//    the melt (or char) point.

export const TESTS = ["tensile", "drop", "bend", "heat"] as const
export type LabTest = (typeof TESTS)[number]

export const TEST_LABEL: Record<LabTest, string> = { tensile: "TENSILE", drop: "DROP", bend: "3-POINT BEND", heat: "HEAT SAG" }

export interface LabParams {
  /** drop: metres. */
  dropHeight: number
  /** heat: top of the ramp, C. */
  maxTemp: number
}

export const DEFAULT_PARAMS: LabParams = { dropHeight: 1, maxTemp: 800 }

export interface LabResult {
  material: LabMaterial
  /** The chart's line: x, y in the test's units. */
  curve: [number, number][]
  /** Fraction of the run (0-1) at which it fails, or null if it never does. */
  breaksAt: number | null
  verdict: string
  figures: [string, string][]
  /** For the animation: the run's progress (0-1) to what the lane shows. */
  pose: (t: number) => LabPose
}

/** What a lane shows at a moment of the run. */
export interface LabPose {
  /** tensile: strain (0-); bend: deflection mm; heat: sag mm; drop: height of the ball, m. */
  value: number
  broken: boolean
  /** heat: temperature now, C. */
  temp?: number
  /** drop: the ball has deformed (a flat). */
  dented?: boolean
}

export interface Axis {
  x: string
  y: string
}

export const AXES: Record<LabTest, Axis> = {
  tensile: { x: "STRAIN %", y: "STRESS MPa" },
  drop: { x: "TIME s", y: "HEIGHT cm" },
  bend: { x: "DEFLECTION mm", y: "LOAD N" },
  heat: { x: "TEMPERATURE C", y: "SAG mm" },
}

const fmt = (v: number, unit: string, digits = 0) => {
  if (!Number.isFinite(v)) return "-"
  const abs = Math.abs(v)
  if (unit === "N" && abs >= 1000) return `${(v / 1000).toFixed(2)} kN`
  if (unit === "MPa" && abs >= 1000) return `${(v / 1000).toFixed(2)} GPa`
  return `${v.toFixed(abs < 10 && digits === 0 ? 1 : digits)} ${unit}`
}

// --- tensile ---------------------------------------------------------------------------

const AREA = 40 // mm^2

function stressAt(m: LabMaterial, strain: number): number {
  const E = m.E * 1000 // MPa
  const ef = m.elongation / 100
  if (m.behaviour === "brittle") return E * strain
  if (m.behaviour === "elastomer") {
    const G = E / 3
    const base = (l: number) => G * (l - 1 / (l * l))
    const lb = 1 + ef
    const c = Math.max(0, (m.uts / base(lb) - 1) / Math.pow(lb - 1, 3))
    const l = 1 + strain
    return base(l) * (1 + c * Math.pow(l - 1, 3))
  }
  const sy = m.yield ?? m.uts * 0.85
  const ey = sy / E
  if (strain <= ey) return E * strain
  const eu = ey + (ef - ey) * 0.7
  if (strain <= eu) return sy + (m.uts - sy) * ((1 - Math.exp((-3 * (strain - ey)) / (eu - ey))) / (1 - Math.exp(-3)))
  return m.uts * (1 - 0.15 * Math.pow((strain - eu) / Math.max(1e-9, ef - eu), 2))
}

function tensile(m: LabMaterial): LabResult {
  const E = m.E * 1000
  const breakStrain = m.behaviour === "brittle" ? m.uts / E : m.elongation / 100
  const n = 120
  const curve: [number, number][] = []
  let toughness = 0
  let peak = 0
  for (let i = 0; i <= n; i += 1) {
    const e = (breakStrain * i) / n
    const s = stressAt(m, e)
    if (i) toughness += ((s + curve[i - 1][1]) / 2) * (breakStrain / n)
    peak = Math.max(peak, s)
    curve.push([e * 100, s])
  }
  const verdict =
    m.behaviour === "brittle"
      ? `Snaps at ${fmt(m.uts, "MPa")} with ${fmt(breakStrain * 100, "%", 2)} stretch: no warning before it goes.`
      : m.behaviour === "elastomer"
        ? `Stretches to ${(1 + breakStrain).toFixed(1)}x its length before tearing at ${fmt(peak, "MPa")}.`
        : `Yields at ${fmt(m.yield ?? m.uts * 0.85, "MPa")}, peaks at ${fmt(m.uts, "MPa")}, necks and breaks at ${fmt(breakStrain * 100, "%")} elongation.`
  return {
    material: m,
    curve,
    breaksAt: 1,
    verdict,
    figures: [
      ["Young's modulus", m.E < 0.1 ? fmt(m.E * 1000, "MPa", 1) : fmt(m.E, "GPa", 0)],
      ["Yield", m.behaviour === "ductile" ? fmt(m.yield ?? m.uts * 0.85, "MPa") : "-"],
      ["Ultimate", fmt(peak, "MPa")],
      ["Elongation", fmt(breakStrain * 100, "%", breakStrain < 0.01 ? 2 : 0)],
      ["Break load", fmt(peak * AREA, "N")],
      ["Toughness", fmt(toughness, "MJ/m3", 2)],
    ],
    pose: (t) => ({ value: Math.min(t, 1) * breakStrain, broken: t >= 1 }),
  }
}

// --- drop -------------------------------------------------------------------------------

const G = 9.81
const BALL_R = 0.01 // m
const ANVIL = { E: 210e9, poisson: 0.3 }

function drop(m: LabMaterial, p: LabParams): LabResult {
  const h = p.dropHeight
  const v = Math.sqrt(2 * G * h)
  const mass = m.density * (4 / 3) * Math.PI * BALL_R ** 3
  const E = m.E * 1e9
  const Estar = 1 / ((1 - m.poisson ** 2) / E + (1 - ANVIL.poisson ** 2) / ANVIL.E)
  const delta = Math.pow((15 * mass * v * v) / (16 * Estar * Math.sqrt(BALL_R)), 0.4)
  const force = (4 / 3) * Estar * Math.sqrt(BALL_R) * Math.pow(delta, 1.5)
  const a = Math.sqrt(BALL_R * delta)
  const p0 = (3 * force) / (2 * Math.PI * a * a) / 1e6 // MPa
  const ring = ((1 - 2 * m.poisson) / 3) * p0
  // A contact stresses a tiny area, so few flaws see it: brittle materials
  // hold several times their bulk tensile strength there.
  const shatters = m.behaviour === "brittle" && ring > m.uts * 4
  const dents = !shatters && m.behaviour === "ductile" && p0 > 1.6 * (m.yield ?? m.uts * 0.85)
  const e = shatters ? 0 : m.bounce * (dents ? 0.8 : 1)
  // Flight: fall, then bounces of height e^2 each time, for 2.5 s.
  const flights: { t0: number; t1: number; h: number }[] = []
  const fall = Math.sqrt((2 * h) / G)
  let t = fall
  let hb = h * e * e
  while (hb > 0.002 && t < 2.5) {
    const dt = 2 * Math.sqrt((2 * hb) / G)
    flights.push({ t0: t, t1: t + dt, h: hb })
    t += dt
    hb *= e * e
  }
  const duration = 2.5
  const heightAt = (time: number) => {
    if (time < fall) return h - 0.5 * G * time * time
    for (const f of flights) {
      if (time >= f.t0 && time <= f.t1) {
        const u = time - f.t0
        const up = Math.sqrt(2 * G * f.h)
        return Math.max(0, up * u - 0.5 * G * u * u)
      }
    }
    return 0
  }
  const curve: [number, number][] = []
  for (let i = 0; i <= 150; i += 1) {
    const time = (duration * i) / 150
    curve.push([time, shatters && time > fall ? 0 : heightAt(time) * 100])
  }
  const bounceCm = h * e * e * 100
  const verdict = shatters
    ? `Shatters on impact: the contact ring stress (${fmt(ring, "MPa")}) beats its strength.`
    : dents
      ? `Takes a flat where it hit (contact pressure ${fmt(p0, "MPa")} passes yield) and bounces to ${bounceCm.toFixed(0)} cm.`
      : `Survives and bounces back to ${bounceCm.toFixed(0)} cm.`
  return {
    material: m,
    curve,
    breaksAt: shatters ? fall / duration : null,
    verdict,
    figures: [
      ["Ball mass", `${(mass * 1000).toFixed(1)} g`],
      ["Impact speed", `${v.toFixed(2)} m/s`],
      ["Peak force", fmt(force, "N")],
      ["Contact pressure", fmt(p0, "MPa")],
      ["Contact time", `${((2.94 * delta) / v * 1e6).toFixed(0)} us`],
      ["First bounce", shatters ? "-" : `${bounceCm.toFixed(0)} cm`],
    ],
    pose: (time01) => {
      const time = time01 * duration
      return { value: shatters && time > fall ? 0 : heightAt(time), broken: shatters && time > fall, dented: dents && time > fall }
    },
  }
}

// --- bend -------------------------------------------------------------------------------

const SPAN = 100
const BAR_B = 10
const BAR_H = 4
const BEND_MAX = 30 // mm, where the fixture runs out

function bend(m: LabMaterial): LabResult {
  const E = m.E * 1000
  const I = (BAR_B * BAR_H ** 3) / 12
  const c = BAR_H / 2
  const k = (48 * E * I) / SPAN ** 3 // N/mm
  const loadAt = (stress: number) => (4 * stress * I) / (SPAN * c)
  // Outer-fibre strain at a deflection (small-deflection beam theory).
  const fibre = (d: number) => (6 * BAR_H * d) / SPAN ** 2
  let breakAt: number | null = null
  let curveFn: (d: number) => number
  if (m.behaviour === "brittle") {
    // Flexural strength runs above tensile for brittle materials (only the
    // outer fibre sees the peak).
    const Ff = loadAt(m.uts * 1.5)
    breakAt = Math.min(BEND_MAX, Ff / k)
    curveFn = (d) => k * d
  } else if (m.behaviour === "elastomer") {
    curveFn = (d) => k * d
  } else {
    const Fy = loadAt(m.yield ?? m.uts * 0.85)
    const Fp = Fy * 1.5 // a rectangle's plastic hinge
    const dy = Fy / k
    curveFn = (d) => (d <= dy ? k * d : Fy + (Fp - Fy) * (1 - Math.exp(-(d - dy) / (dy * 2))))
    const dBreak = (m.elongation / 100) / fibre(1)
    if (dBreak < BEND_MAX) breakAt = dBreak
  }
  const end = breakAt ?? BEND_MAX
  const curve: [number, number][] = []
  for (let i = 0; i <= 100; i += 1) {
    const d = (end * i) / 100
    curve.push([d, curveFn(d)])
  }
  const peak = Math.max(...curve.map((pt) => pt[1]))
  const verdict =
    breakAt !== null
      ? `Breaks at ${fmt(peak, "N")} after ${breakAt.toFixed(1)} mm of bend.`
      : m.behaviour === "elastomer"
        ? `Flexes the full ${BEND_MAX} mm under ${fmt(peak, "N", 2)} and springs straight back.`
        : `Yields at ${fmt(loadAt(m.yield ?? m.uts * 0.85), "N")} and bends ${BEND_MAX} mm without breaking: it stays bent.`
  return {
    material: m,
    curve,
    breaksAt: breakAt !== null ? 1 : null,
    verdict,
    figures: [
      ["Stiffness", `${k < 1 ? k.toFixed(3) : k.toFixed(1)} N/mm`],
      ["Peak load", fmt(peak, "N", peak < 10 ? 2 : 0)],
      ["Deflection", breakAt !== null ? `${breakAt.toFixed(1)} mm at break` : `${BEND_MAX} mm, no break`],
      ["Outer strain", `${(fibre(end) * 100).toFixed(1)} %`],
    ],
    pose: (t) => ({ value: Math.min(t, 1) * end, broken: breakAt !== null && t >= 1 }),
  }
}

// --- heat --------------------------------------------------------------------------------

const ARM = 60
const TIP_LOAD = 2
const SAG_LIMIT = 2
const SAG_MAX = 60

function heat(m: LabMaterial, p: LabParams): LabResult {
  const I = (BAR_B * BAR_H ** 3) / 12
  const metal = m.family === "Metal" || m.family === "Glass" || m.family === "Ceramic"
  const width = metal ? Math.max(40, m.soften * 0.12) : Math.max(4, m.soften * 0.05)
  const residual = metal ? 0.25 : 0.01
  const modulus = (T: number) => m.E * 1000 * (residual + (1 - residual) / (1 + Math.exp((T - m.soften) / width)))
  const sagAt = (T: number) => (T >= m.melt ? SAG_MAX : Math.min(SAG_MAX, (TIP_LOAD * ARM ** 3) / (3 * modulus(T) * I)))
  const T0 = 20
  const T1 = Math.max(100, p.maxTemp)
  const curve: [number, number][] = []
  let limitT: number | null = null
  let meltT: number | null = null
  for (let i = 0; i <= 200; i += 1) {
    const T = T0 + ((T1 - T0) * i) / 200
    const sag = sagAt(T)
    if (limitT === null && sag > SAG_LIMIT) limitT = T
    if (meltT === null && T >= m.melt) meltT = T
    curve.push([T, sag])
  }
  const word = m.meltWord ?? "melts"
  const cold = sagAt(T0)
  const verdict =
    cold > SAG_LIMIT
      ? `Too soft to carry the load even at room temperature (${cold.toFixed(0)} mm sag)${meltT ? `; ${word} at ${m.melt} C` : ""}.`
      : limitT === null
        ? `Holds its shape all the way to ${T1} C.`
        : meltT !== null && limitT >= meltT
          ? `Holds its shape until it ${word} at ${m.melt} C.`
        : `Sags past ${SAG_LIMIT} mm at ${limitT.toFixed(0)} C${meltT ? ` and ${word} at ${m.melt} C` : ""}.`
  return {
    material: m,
    curve,
    breaksAt: meltT !== null ? (meltT - T0) / (T1 - T0) : null,
    verdict,
    figures: [
      ["Sag at 20 C", `${cold.toFixed(2)} mm`],
      ["Softens", `${m.soften} C`],
      [`${word[0].toUpperCase()}${word.slice(1)}`, `${m.melt} C`],
      [`${SAG_LIMIT} mm sag at`, limitT === null ? `> ${T1} C` : meltT !== null && limitT >= meltT ? "-" : `${limitT.toFixed(0)} C`],
    ],
    pose: (t) => {
      const T = T0 + (T1 - T0) * Math.min(1, t)
      return { value: sagAt(T), broken: T >= m.melt, temp: T }
    },
  }
}

export function runTest(test: LabTest, m: LabMaterial, p: LabParams = DEFAULT_PARAMS): LabResult {
  if (test === "tensile") return tensile(m)
  if (test === "drop") return drop(m, p)
  if (test === "bend") return bend(m)
  return heat(m, p)
}
