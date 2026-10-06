// Builds the workshop's component library: the catalog's parts as real
// models, from KiCad's 3D library (CC-BY-SA 4.0), converted from STEP with
// OpenCascade (occt-import-js) and merged by material - a handful of draw
// calls a part. Each model is moved into the frame its stand-in in
// components3d.ts uses (millimetres, z up, centred on its pins, z = 0 where
// a board's top surface would be), and its pins are found from the model
// itself - the tips of its legs - so a wire always lands on a real leg.
//
//   node scripts/build-part-models.mjs
//
// Writes public/models/parts/<type>.glb and public/models/parts/
// manifest.json (each part's pins, by name, and its bounds), read by
// lib/workshop/project/library.ts. Downloads are cached in
// node_modules/.cache/part-models. Run it again only to change a model.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import occtimportjs from "occt-import-js"

import { loadStep, materialFor, useCache, writeGlb } from "./lib/kicad-step.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const web = path.resolve(here, "..")
const out = path.join(web, "public", "models", "parts")
useCache(path.join(web, "node_modules", ".cache", "part-models"))
fs.mkdirSync(out, { recursive: true })

const META = { generator: "jarvis build-part-models", copyright: "KiCad 3D library, CC-BY-SA 4.0 (gitlab.com/kicad/libraries/kicad-packages3D)." }

/**
 * Each part: the KiCad models it is made of and how they are placed, and
 * the names of its pins in the order they are read off the model.
 *
 *   order "x"        - leg tips left to right (then front to back)
 *   order "diagonal" - two names for opposite corners (a tact switch's
 *                      legs pair up, so either diagonal crosses the switch)
 *   order "ends"     - the two ends of a straightened axial part, left
 *                      then right, the wire leaving along the lead
 *
 * Every pin is written with its tip (where a plug goes on), the direction
 * a wire leaves it, and its root (where the leg leaves the body, on z = 0):
 * a tip buried in whatever the part sits on is soldered at the root.
 *
 * A piece's `at` is where its pin centre (or, with `centre: "bounds"`, its
 * bounding box centre) ends up; `turn` turns it about z first, `flip`
 * turns it over (a header soldered on from below). The piece marked
 * `pins` is the one the pins are read from (the first, if none is).
 */
const PARTS = {
  // Axial parts are wired point to point, not into a board: their legs,
  // bent down for a PCB in KiCad's model, are straightened back out.
  resistor: {
    pieces: [{ file: "Resistor_THT.3dshapes/R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal.step", straighten: true }],
    names: ["1", "2"],
    order: "ends",
  },
  led: { pieces: [{ file: "LED_THT.3dshapes/LED_D5.0mm.step" }], names: ["K", "A"] },
  rgb_led: { pieces: [{ file: "LED_THT.3dshapes/LED_D5.0mm-4_RGB.step" }], names: ["R", "COM", "G", "B"] },
  button: { pieces: [{ file: "Button_Switch_THT.3dshapes/SW_PUSH_6mm.step" }], names: ["1", "2"], order: "diagonal" },
  piezo: { pieces: [{ file: "Buzzer_Beeper.3dshapes/Buzzer_12x9.5RM7.6.step" }], names: ["+", "-"] },
  diode: { pieces: [{ file: "Diode_THT.3dshapes/D_DO-35_SOD27_P7.62mm_Horizontal.step", straighten: true }], names: ["K", "A"], order: "ends" },
  // PN2222A and A3144 pinouts, flat face forward.
  npn: { pieces: [{ file: "Package_TO_SOT_THT.3dshapes/TO-92_Inline.step" }], names: ["E", "B", "C"] },
  hall: { pieces: [{ file: "Package_TO_SOT_THT.3dshapes/TO-92_Inline.step" }], names: ["VCC", "GND", "OUT"] },
  // IRLZ44N / IRF520: gate, drain (and tab), source.
  mosfet: { pieces: [{ file: "Package_TO_SOT_THT.3dshapes/TO-220-3_Vertical.step" }], names: ["G", "D", "S"] },
  photoresistor: { pieces: [{ file: "OptoDevice.3dshapes/R_LDR_5.1x4.3mm_P3.4mm_Vertical.step" }], names: ["1", "2"] },
  // The GY-61 breakout: the ADXL335 (a 4 x 4 mm LFCSP; KiCad's QFN-16 is
  // the same body), its decoupling caps, and the 5-pin header soldered on
  // from below. The board itself is drawn by library.ts.
  adxl335: {
    pieces: [
      { file: "Package_DFN_QFN.3dshapes/QFN-16-1EP_4x4mm_P0.65mm_EP2.1x2.1mm.step", centre: "bounds", at: [0, 1.5, 1.6] },
      { file: "Capacitor_SMD.3dshapes/C_0603_1608Metric.step", centre: "bounds", at: [-5.5, 2, 1.6] },
      { file: "Capacitor_SMD.3dshapes/C_0603_1608Metric.step", centre: "bounds", at: [5.5, 2, 1.6], turn: 90 },
      { file: "Capacitor_SMD.3dshapes/C_0603_1608Metric.step", centre: "bounds", at: [0, -4.2, 1.6] },
      { file: "Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x05_P2.54mm_Vertical.step", turn: 90, flip: true, at: [0, -8.7, 0], pins: true },
    ],
    names: ["VCC", "X", "Y", "Z", "GND"],
  },
}

/** Leg tips: the model's lowest vertices, gathered into clusters. */
function legTips(points) {
  let zmin = Infinity
  for (const p of points) zmin = Math.min(zmin, p[2])
  const low = points.filter((p) => p[2] < zmin + 0.25)
  const clusters = []
  for (const [x, y] of low) {
    const c = clusters.find((k) => Math.hypot(k.x / k.n - x, k.y / k.n - y) < 0.9)
    if (c) {
      c.x += x
      c.y += y
      c.n += 1
    } else clusters.push({ x, y, n: 1 })
  }
  return { zmin, tips: clusters.map((c) => [c.x / c.n, c.y / c.n]) }
}

/** KiCad's horizontal axial model has its leads bent down at the pin
 *  pitch. Straighten them: every vertex of a vertical leg turns 90 degrees
 *  about its bend, outward, so the lead carries on along the body's axis. */
function straighten(pieces) {
  // The lead axis: the body's centre height; the bends: the pins' x.
  const all = []
  for (const p of pieces) for (const i of p.tri) all.push([p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]])
  const { tips } = legTips(all)
  const xs = tips.map((t) => t[0]).sort((a, b) => a - b)
  const [left, right] = [xs[0], xs[xs.length - 1]]
  const mid = (left + right) / 2
  // Everything between the bends is body and lead; its height span
  // centres on the axis (a cylinder has no vertices mid-body to sample).
  const zs = all.filter((v) => v[0] > left + 0.8 && v[0] < right - 0.8).map((v) => v[2])
  const axis = (Math.min(...zs) + Math.max(...zs)) / 2
  // Below the lead's own radius under the axis is the vertical leg.
  const below = axis - 0.6
  return pieces.map((p) => {
    const pos = Float32Array.from(p.pos)
    const nor = p.nor ? Float32Array.from(p.nor) : null
    for (let i = 0; i < pos.length / 3; i += 1) {
      const x = pos[i * 3]
      const z = pos[i * 3 + 2]
      const sx = x > mid ? 1 : -1
      const bend = sx > 0 ? right : left
      // Only the leg itself: low, and right at its bend's x (the body
      // never reaches that far out).
      if (z >= below || Math.abs(x - bend) > 0.6) continue
      // Relative to the bend: straight down becomes straight out.
      const rx = x - bend
      const rz = z - axis
      pos[i * 3] = bend + sx * -rz
      pos[i * 3 + 2] = axis + sx * rx
      if (nor) {
        const nx = nor[i * 3]
        const nz = nor[i * 3 + 2]
        nor[i * 3] = sx * -nz
        nor[i * 3 + 2] = sx * nx
      }
    }
    return { ...p, pos, nor }
  })
}

/** A piece's vertices moved into place: turn about z, flip over, centre, lift. */
function placer(piece, pieces) {
  const turn = ((piece.turn ?? 0) * Math.PI) / 180
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  const flip = piece.flip ? -1 : 1
  // x, y and z after the turn and flip, before the move.
  const raw = (x, y, z) => [x * c - y * s, flip * (x * s + y * c), flip * z]
  const all = []
  for (const p of pieces) for (const i of p.tri) all.push(raw(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]))
  let cx
  let cy
  // A straightened part has no legs below it to centre on: its bounds do.
  if (piece.centre === "bounds" || piece.straighten) {
    const xs = all.map((v) => v[0])
    const ys = all.map((v) => v[1])
    cx = (Math.min(...xs) + Math.max(...xs)) / 2
    cy = (Math.min(...ys) + Math.max(...ys)) / 2
  } else {
    const { tips } = legTips(all)
    cx = tips.reduce((sum, t) => sum + t[0], 0) / tips.length
    cy = tips.reduce((sum, t) => sum + t[1], 0) / tips.length
  }
  // Flipped, the piece's top (once its bottom) goes where z was 0.
  const zs = all.map((v) => v[2])
  const dz = piece.flip ? -Math.max(...zs) : 0
  const [ax, ay, az] = piece.at ?? [0, 0, 0]
  return {
    point: (x, y, z) => {
      const [rx, ry, rz] = raw(x, y, z)
      return [rx - cx + ax, ry - cy + ay, rz + dz + az]
    },
    normal: (x, y, z) => {
      const [rx, ry, rz] = raw(x, y, z)
      return [rx, ry, rz]
    },
  }
}

const occt = await occtimportjs()
const steps = new Map()
const manifest = { version: 2, source: META.copyright, types: {} }

for (const [type, spec] of Object.entries(PARTS)) {
  const groups = new Map()
  let pinPoints = null
  for (const [index, piece] of spec.pieces.entries()) {
    if (!steps.has(piece.file)) steps.set(piece.file, await loadStep(occt, piece.file))
    const pieces = piece.straighten ? straighten(steps.get(piece.file)) : steps.get(piece.file)
    const place = placer(piece, pieces)
    const placed = []
    for (const p of pieces) {
      const mat = materialFor(p.color)
      let g = groups.get(mat.key)
      if (!g) groups.set(mat.key, (g = { mat, pos: [], nor: [], idx: [] }))
      const remap = new Map()
      const base = g.pos.length / 3
      for (const i of p.tri) {
        let j = remap.get(i)
        if (j === undefined) {
          j = remap.size
          remap.set(i, j)
          const v = place.point(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2])
          g.pos.push(...v)
          placed.push(v)
          g.nor.push(...(p.nor ? place.normal(p.nor[i * 3], p.nor[i * 3 + 1], p.nor[i * 3 + 2]) : [0, 0, 1]))
        }
        g.idx.push(base + j)
      }
    }
    if (piece.pins || (index === 0 && !spec.pieces.some((x) => x.pins))) pinPoints = placed
  }

  // The pins, named: tip, the way out, and the root on z = 0.
  const r3 = (v) => v.map((n) => +n.toFixed(3))
  let pins
  if (spec.order === "ends") {
    let lo = null
    let hi = null
    for (const v of pinPoints) {
      if (!lo || v[0] < lo[0]) lo = v
      if (!hi || v[0] > hi[0]) hi = v
    }
    const zs = pinPoints.filter((v) => Math.abs(v[0] - hi[0]) < 0.3).map((v) => v[2])
    const z = (Math.min(...zs) + Math.max(...zs)) / 2
    pins = {
      [spec.names[0]]: { tip: r3([lo[0], 0, z]), dir: [-1, 0, 0], root: r3([lo[0], 0, z]) },
      [spec.names[1]]: { tip: r3([hi[0], 0, z]), dir: [1, 0, 0], root: r3([hi[0], 0, z]) },
    }
  } else {
    const { zmin, tips } = legTips(pinPoints)
    let named
    if (spec.order === "diagonal") {
      const by = [...tips].sort((a, b) => a[0] + a[1] - (b[0] + b[1]))
      named = [by[0], by[by.length - 1]]
    } else {
      named = [...tips].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    }
    if (spec.order !== "diagonal" && named.length !== spec.names.length) {
      throw new Error(`${type}: found ${named.length} leg tips, expected ${spec.names.length}`)
    }
    pins = Object.fromEntries(spec.names.map((name, i) => [name, { tip: r3([named[i][0], named[i][1], zmin]), dir: [0, 0, -1], root: r3([named[i][0], named[i][1], 0]) }]))
  }

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const g of groups.values()) for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k += 1) {
    min[k] = Math.min(min[k], g.pos[i + k])
    max[k] = Math.max(max[k], g.pos[i + k])
  }
  const glb = writeGlb(groups, META)
  fs.writeFileSync(path.join(out, `${type}.glb`), glb)
  const tris = [...groups.values()].reduce((sum, g) => sum + g.idx.length / 3, 0)
  manifest.types[type] = {
    file: `${type}.glb`,
    pins,
    bounds: [min.map((v) => +v.toFixed(2)), max.map((v) => +v.toFixed(2))],
    triangles: tris,
    models: spec.pieces.map((p) => p.file),
  }
  console.log(`${type.padEnd(14)} ${String(tris).padStart(6)} tris  ${groups.size} materials  ${(glb.length / 1024).toFixed(0)} KB  pins ${Object.entries(pins).map(([n, p]) => `${n}(${p.tip.join(",")})`).join(" ")}`)
}

fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 1))
