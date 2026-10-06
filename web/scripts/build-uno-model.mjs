// Builds the workshop's genuine Arduino UNO R3: Arduino's own board file
// (A000066 CAD files, CC BY-SA 4.0) for where every part sits and for the
// board itself - outline, copper, pads, vias, silkscreen, holes - and
// KiCad's 3D library (CC-BY-SA 4.0) for the parts, converted from STEP with
// OpenCascade (occt-import-js), placed exactly, merged by material.
//
//   node scripts/build-uno-model.mjs
//
// Writes public/models/uno-r3.glb (the parts) and
// public/models/uno-r3-board.json (the board, drawn at run time by
// lib/workshop/project/genuine.ts). Downloads are cached in
// node_modules/.cache/uno-model. Run it again only to change the model.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

import occtimportjs from "occt-import-js"

import { KICAD, bounds, fetchCached, loadStep, materialFor, useCache, writeGlb } from "./lib/kicad-step.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const web = path.resolve(here, "..")
const cache = path.join(web, "node_modules", ".cache", "uno-model")
const out = path.join(web, "public", "models")
useCache(cache)
fs.mkdirSync(out, { recursive: true })

const ARDUINO_ZIP = "https://docs.arduino.cc/static/6bb7a3ca51ebee82a252f60c0b418787/A000066-cad-files.zip"

/** Eagle package -> KiCad models, and the turn (degrees) that lines the
 *  KiCad model's pins up with the Eagle package's. */
const MODELS = {
  // The ATmega328P stands in its socket, legs in the contacts.
  "DIL28-3": { files: ["Package_DIP.3dshapes/DIP-28_W7.62mm_Socket.step", "Package_DIP.3dshapes/DIP-28_W7.62mm.step"], turn: 90, lift: [0, 3.2] },
  "1X06": { files: ["Connector_PinSocket_2.54mm.3dshapes/PinSocket_1x06_P2.54mm_Vertical.step"], turn: 90 },
  "1X08": { files: ["Connector_PinSocket_2.54mm.3dshapes/PinSocket_1x08_P2.54mm_Vertical.step"], turn: 90 },
  "1X10": { files: ["Connector_PinSocket_2.54mm.3dshapes/PinSocket_1x10_P2.54mm_Vertical.step"], turn: 90 },
  "2X03": { files: ["Connector_PinHeader_2.54mm.3dshapes/PinHeader_2x03_P2.54mm_Vertical.step"], turn: 90 },
  "2X02": { files: ["Connector_PinHeader_2.54mm.3dshapes/PinHeader_2x02_P2.54mm_Vertical.step"], turn: 90 },
  "C0603-ROUND": { files: ["Capacitor_SMD.3dshapes/C_0603_1608Metric.step"], turn: 0 },
  "R0603-ROUND": { files: ["Resistor_SMD.3dshapes/R_0603_1608Metric.step"], turn: 0 },
  "CT/CN0603": { files: ["Resistor_SMD.3dshapes/R_0603_1608Metric.step"], turn: 0 },
  "0805": { files: ["Inductor_SMD.3dshapes/L_0805_2012Metric.step"], turn: 0 },
  "CHIP-LED0805": { files: ["LED_SMD.3dshapes/LED_0805_2012Metric.step"], turn: -90 },
  "CAY16": { files: ["Resistor_SMD.3dshapes/R_Array_Convex_4x0603.step"], turn: 90 },
  "PANASONIC_D": { files: ["Capacitor_SMD.3dshapes/CP_Elec_6.3x5.4.step"], turn: 180 },
  SMB: { files: ["Diode_SMD.3dshapes/D_SMB.step"], turn: 0 },
  MINIMELF: { files: ["Diode_SMD.3dshapes/D_MiniMELF.step"], turn: 0 },
  "SOT-23": { files: ["Package_TO_SOT_SMD.3dshapes/SOT-23.step"], turn: -90 },
  "SOT23-DBV": { files: ["Package_TO_SOT_SMD.3dshapes/SOT-23-5.step"], turn: 90 },
  SOT223: { files: ["Package_TO_SOT_SMD.3dshapes/SOT-223.step"], turn: 90 },
  MSOP08: { files: ["Package_SO.3dshapes/MSOP-8_3x3mm_P0.65mm.step"], turn: 90 },
  MLF32: { files: ["Package_DFN_QFN.3dshapes/QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm.step"], turn: 0 },
  RESONATOR: { files: ["Crystal.3dshapes/Resonator_SMD_Murata_CSTxExxV-3Pin_3.0x1.1mm.step"], turn: 0 },
  QS: { files: ["Crystal.3dshapes/Crystal_SMD_HC49-SD.step"], turn: 0 },
  TS42: { files: ["Button_Switch_SMD.3dshapes/SW_SPST_TL3342.step"], turn: 0 },
  "POWERSUPPLY_DC-21MM": { files: ["Connector_BarrelJack.3dshapes/BarrelJack_Horizontal.step"], turn: 0, edge: { overhang: 2 } },
}

// --- the board file ---------------------------------------------------------------------

/** The one file we need out of Arduino's zip (stored or deflated). */
function unzipEntry(zip, wanted) {
  let i = zip.length - 22
  while (zip.readUInt32LE(i) !== 0x06054b50) i -= 1
  let p = zip.readUInt32LE(i + 16)
  const count = zip.readUInt16LE(i + 10)
  for (let n = 0; n < count; n += 1) {
    const method = zip.readUInt16LE(p + 10)
    const size = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const extra = zip.readUInt16LE(p + 30)
    const comment = zip.readUInt16LE(p + 32)
    const local = zip.readUInt32LE(p + 42)
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen)
    if (name === wanted) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const data = zip.subarray(start, start + size)
      return method === 8 ? zlib.inflateRawSync(data) : data
    }
    p += 46 + nameLen + extra + comment
  }
  throw new Error(`${wanted} not in the zip`)
}

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
const num = (v, d = 0) => (v === undefined ? d : Number(v))

/** Eagle rotation "R90" / "MR180" -> degrees and mirror. */
function rotation(rot = "R0") {
  const m = /^(M?)(S?)R(-?[\d.]+)$/.exec(rot) || []
  return { deg: Number(m[3] ?? 0), mirror: m[1] === "M" }
}

function transform(x, y, el) {
  const { deg, mirror } = rotation(el.rot)
  const xm = mirror ? -x : x
  const a = (deg * Math.PI) / 180
  return [num(el.x) + xm * Math.cos(a) - y * Math.sin(a), num(el.y) + xm * Math.sin(a) + y * Math.cos(a)]
}

function parseBoard(xml) {
  const section = (name) => {
    const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)
    return m ? m[1] : ""
  }
  // Packages: their pads and silkscreen, by name.
  const packages = {}
  // Every library in the file has its own <packages>: read them all.
  for (const m of xml.matchAll(/<package name="([^"]+)"[^>]*>([\s\S]*?)<\/package>/g)) {
    const body = m[2]
    packages[m[1]] = {
      pads: [...body.matchAll(/<pad [^>]*>/g)].map((t) => attrs(t[0])),
      smds: [...body.matchAll(/<smd [^>]*>/g)].map((t) => attrs(t[0])),
      silk: [...body.matchAll(/<wire [^>]*layer="21"[^>]*>/g)].map((t) => attrs(t[0])),
      circles: [...body.matchAll(/<circle [^>]*layer="21"[^>]*>/g)].map((t) => attrs(t[0])),
      holes: [...body.matchAll(/<hole [^>]*>/g)].map((t) => attrs(t[0])),
    }
  }
  const elements = [...section("elements").matchAll(/<element [^>]*>/g)].map((t) => attrs(t[0]))
  const plain = section("plain")
  const board = { outline: [], copper: [], pours: [], pads: [], vias: [], silk: [], text: [], holes: [], parts: [] }

  // The outline: dimension-layer segments, arcs approximated.
  for (const t of plain.matchAll(/<wire [^>]*layer="20"[^>]*>/g)) {
    const w = attrs(t[0])
    board.outline.push(arcPoints(num(w.x1), num(w.y1), num(w.x2), num(w.y2), num(w.curve)))
  }
  for (const t of plain.matchAll(/<wire [^>]*layer="21"[^>]*>/g)) {
    const w = attrs(t[0])
    board.silk.push([num(w.x1), num(w.y1), num(w.x2), num(w.y2), num(w.width, 0.15)])
  }
  for (const t of plain.matchAll(/<text ([^>]*layer="(21|25)"[^>]*)>([^<]*)<\/text>/g)) {
    const a = attrs(t[1])
    board.text.push({ x: num(a.x), y: num(a.y), size: num(a.size, 1), rot: rotation(a.rot).deg, align: a.align ?? "bottom-left", text: decode(t[3]) })
  }
  for (const t of plain.matchAll(/<hole [^>]*>/g)) {
    const h = attrs(t[0])
    board.holes.push([num(h.x), num(h.y), num(h.drill)])
  }

  // Copper on top, and the vias through.
  for (const s of section("signals").matchAll(/<signal [^>]*>([\s\S]*?)<\/signal>/g)) {
    for (const t of s[1].matchAll(/<wire [^>]*>/g)) {
      const w = attrs(t[0])
      if (w.layer === "1") board.copper.push([num(w.x1), num(w.y1), num(w.x2), num(w.y2), num(w.width, 0.3)])
    }
    for (const t of s[1].matchAll(/<via [^>]*>/g)) {
      const v = attrs(t[0])
      board.vias.push([num(v.x), num(v.y), num(v.drill, 0.4)])
    }
    for (const p of s[1].matchAll(/<polygon ([^>]*layer="1"[^>]*)>([\s\S]*?)<\/polygon>/g)) {
      board.pours.push([...p[2].matchAll(/<vertex [^>]*>/g)].map((v) => [num(attrs(v[0]).x), num(attrs(v[0]).y)]))
    }
  }

  // Each part: its pads and silkscreen onto the board, and where its model goes.
  for (const el of elements) {
    const pkg = packages[el.package]
    if (!pkg) continue
    const { deg, mirror } = rotation(el.rot)
    if (mirror) continue // the underside: nothing to see from above
    for (const p of pkg.pads) {
      const [x, y] = transform(num(p.x), num(p.y), el)
      board.pads.push({ x, y, drill: num(p.drill), d: num(p.diameter, num(p.drill) * 1.8), shape: p.shape ?? "round" })
    }
    for (const s of pkg.smds) {
      const [x, y] = transform(num(s.x), num(s.y), el)
      const r = ((num(rotation(s.rot).deg) + deg) % 180 + 180) % 180
      board.pads.push({ x, y, w: num(s.dx), h: num(s.dy), rot: r, round: num(s.roundness) })
    }
    for (const w of pkg.silk) {
      const [x1, y1] = transform(num(w.x1), num(w.y1), el)
      const [x2, y2] = transform(num(w.x2), num(w.y2), el)
      board.silk.push([x1, y1, x2, y2, num(w.width, 0.15)])
    }
    for (const h of pkg.holes) {
      const [x, y] = transform(num(h.x), num(h.y), el)
      board.holes.push([x, y, num(h.drill)])
    }
    // Where the pads are, for lining the model up.
    const all = [...pkg.pads, ...pkg.smds].map((p) => [num(p.x), num(p.y)])
    if (!all.length) continue
    const cx = (Math.min(...all.map((p) => p[0])) + Math.max(...all.map((p) => p[0]))) / 2
    const cy = (Math.min(...all.map((p) => p[1])) + Math.max(...all.map((p) => p[1]))) / 2
    const [px, py] = transform(cx, cy, el)
    board.parts.push({ name: el.name, package: el.package, x: num(el.x), y: num(el.y), rot: deg, padX: px, padY: py })
  }
  return board
}

function decode(s) {
  return s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
}

/** A wire as points: straight, or an arc of `curve` degrees. */
function arcPoints(x1, y1, x2, y2, curve) {
  if (!curve) return [[x1, y1], [x2, y2]]
  // Eagle's curve: degrees swept from the first end to the second,
  // positive counter-clockwise. The centre sits left of the chord for a
  // counter-clockwise arc, right of it for a clockwise one.
  const a = (curve * Math.PI) / 180
  const dx = x2 - x1
  const dy = y2 - y1
  const chord = Math.hypot(dx, dy)
  const r = chord / (2 * Math.sin(Math.abs(a) / 2))
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const h = Math.sign(a) * r * Math.cos(Math.abs(a) / 2)
  const cx = mx - (dy / chord) * h
  const cy = my + (dx / chord) * h
  const a0 = Math.atan2(y1 - cy, x1 - cx)
  const steps = Math.max(4, Math.ceil(Math.abs(curve) / 10))
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = a0 + (a * i) / steps
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)]
  })
}

// --- the parts ------------------------------------------------------------------------

// --- build ---------------------------------------------------------------------------------

const BOARD_TOP = 1.6

const zip = await fetchCached(ARDUINO_ZIP, "A000066-cad-files.zip")
const board = parseBoard(unzipEntry(zip, "A000066-cad-files/UNO-TH_Rev3e.brd").toString("utf8"))
const occt = await occtimportjs()

const groups = new Map()
/** Add a piece's triangles: shared vertices stay shared. */
const add = (mat, pos, nor, tri) => {
  let g = groups.get(mat.key)
  if (!g) groups.set(mat.key, (g = { mat, pos: [], nor: [], idx: [] }))
  const base = g.pos.length / 3
  g.pos.push(...pos)
  g.nor.push(...nor)
  for (const i of tri) g.idx.push(base + i)
}

const models = new Map()
let placed = 0
const missing = new Set()
for (const part of board.parts) {
  const spec = MODELS[part.package]
  if (!spec) {
    missing.add(part.package)
    continue
  }
  for (const file of spec.files) {
    if (!models.has(file)) models.set(file, await loadStep(occt, file))
    const pieces = models.get(file)
    const b = bounds(models.get(spec.files[0]))
    // Centre the model on its pads (the first file sets it, so a chip sits in its socket).
    const cx = (b.min[0] + b.max[0]) / 2
    const cy = (b.min[1] + b.max[1]) / 2
    const turn = ((spec.turn + part.rot) * Math.PI) / 180
    const c = Math.cos(turn)
    const s = Math.sin(turn)
    const tx = part.padX
    const ty = part.padY
    for (const piece of pieces) {
      const mat = materialFor(piece.color)
      const pos = []
      const nor = []
      // Only the vertices this piece uses, renumbered.
      const remap = new Map()
      const tri = piece.tri.map((i) => {
        let j = remap.get(i)
        if (j === undefined) {
          j = remap.size
          remap.set(i, j)
        }
        return j
      })
      for (const i of remap.keys()) {
        const x = piece.pos[i * 3] - cx
        const y = piece.pos[i * 3 + 1] - cy
        const z = piece.pos[i * 3 + 2]
        pos.push(tx + x * c - y * s, ty + x * s + y * c, BOARD_TOP + z + (spec.lift?.[spec.files.indexOf(file)] ?? 0))
        const nx = piece.nor ? piece.nor[i * 3] : 0
        const ny = piece.nor ? piece.nor[i * 3 + 1] : 0
        const nz = piece.nor ? piece.nor[i * 3 + 2] : 1
        nor.push(nx * c - ny * s, nx * s + ny * c, nz)
      }
      add(mat, pos, nor, tri)
    }
  }
  placed += 1
}

const glb = writeGlb(groups)
fs.writeFileSync(path.join(out, "uno-r3.glb"), glb)
fs.writeFileSync(path.join(out, "uno-r3-board.json"), JSON.stringify(board))
const tris = [...groups.values()].reduce((s, g) => s + g.idx.length / 3, 0)
console.log(`placed ${placed} parts (${models.size} models), ${groups.size} materials, ${Math.round(tris / 1000)}k triangles, glb ${(glb.length / 1e6).toFixed(1)} MB`)
console.log("no 3D model for:", [...missing].join(", ") || "-")
