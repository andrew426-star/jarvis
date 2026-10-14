// J.A.R.V.I.S. Blueprint - the new tab as a holographic drafting sheet.
//
// Engineering plates draw themselves the way a draughtsman would: faint
// construction lines first, then the object's outlines, its hidden edges,
// the dimensions, and last the labels, with a lit pen tip at the head of
// the line. A plate holds once drawn, fades, and the next begins:
//   KIV-001  Kivaro's mark, three cubes, as an exploded isometric
//   KIV-002  a reactor core, front elevation and section A-A
//   KIV-003  Jarvis's sphere core, front and top views
// Plates are drawn in their own 1000 x 640 space and fitted to the window.
// ?plate=N&t=S draws plate N at S seconds into its cycle, still, for a look.

const TAU = Math.PI * 2
const LINE = "95, 212, 255"
const KIVARO = "63, 227, 154"
const TEXT = "207, 239, 255"
const FONT = '"JetBrains Mono", ui-monospace, monospace'
const DRAW_S = 14, HOLD_S = 8, FADE_S = 1.6
const CYCLE_S = DRAW_S + HOLD_S + FADE_S
const PEN_SPEED = 1 // reveal by length: every plate takes DRAW_S whatever its size
const LAUNCH = Date.UTC(2027, 0, 12, 6) // midnight, January 12, Central

// --- geometry ------------------------------------------------------------------

const circle = (cx, cy, r, from = 0, to = TAU, n = 96) => {
  const pts = []
  const steps = Math.max(8, Math.round((n * Math.abs(to - from)) / TAU))
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return pts
}

const ellipse = (cx, cy, rx, ry, n = 96) => {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const a = (TAU * i) / n
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return pts
}

const polygon = (pts) => [...pts, pts[0]]

class Plate {
  constructor(number, title) {
    this.number = number
    this.title = title
    this.strokes = []
  }

  add(kind, pts) {
    this.strokes.push({ kind, pts })
    return this
  }

  text(x, y, str, { align = "left", size = 13, kind = "text" } = {}) {
    this.strokes.push({ kind, text: str, x, y, align, size })
    return this
  }

  /** A dimension: extension lines from a and b, offset by `off` (signed,
   *  perpendicular), the dimension line with arrowheads, and its value. */
  dim(a, b, off, label) {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    const nx = -dy / len, ny = dx / len
    const a2 = [a[0] + nx * off, a[1] + ny * off]
    const b2 = [b[0] + nx * off, b[1] + ny * off]
    const ext = Math.sign(off) * 8
    this.add("dim", [[a[0] + nx * Math.sign(off) * 4, a[1] + ny * Math.sign(off) * 4], [a2[0] + nx * ext, a2[1] + ny * ext]])
    this.add("dim", [[b[0] + nx * Math.sign(off) * 4, b[1] + ny * Math.sign(off) * 4], [b2[0] + nx * ext, b2[1] + ny * ext]])
    this.add("dim", [a2, b2])
    const ux = dx / len, uy = dy / len, s = 9
    for (const [p, d] of [[a2, 1], [b2, -1]]) {
      this.add("dim", [
        [p[0] + (ux * d - nx * 0.35) * s, p[1] + (uy * d - ny * 0.35) * s],
        p,
        [p[0] + (ux * d + nx * 0.35) * s, p[1] + (uy * d + ny * 0.35) * s],
      ])
    }
    this.text((a2[0] + b2[0]) / 2 + nx * 14, (a2[1] + b2[1]) / 2 + ny * 14, label, { align: "center", size: 12 })
    return this
  }

  /** A leader from a feature to a note. */
  leader(from, to, label, align = "left") {
    const tail = align === "left" ? 40 : -40
    this.add("dim", [from, to, [to[0] + tail, to[1]]])
    this.add("dim", circle(from[0], from[1], 3, 0, TAU, 12))
    this.text(to[0] + tail + (align === "left" ? 8 : -8), to[1] + 4, label, { align, size: 12 })
    return this
  }

  /** Strokes in drafting order, each with its length, for the pen. */
  finish() {
    const order = { construct: 0, main: 1, kivaro: 1, hidden: 2, hatch: 2, dim: 3, text: 4 }
    this.strokes.sort((a, b) => order[a.kind] - order[b.kind])
    for (const s of this.strokes) {
      s.length = s.text ? s.text.length * 9 : s.pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - s.pts[i][0], p[1] - s.pts[i][1]), 0)
    }
    this.total = this.strokes.reduce((sum, s) => sum + s.length, 0)
    return this
  }
}

// --- the plates ------------------------------------------------------------------

function kivaroMark() {
  const plate = new Plate("KIV-001", "KIVARO MARK — EXPLODED ISOMETRIC")
  const cx = 470, cy = 345, k = 104
  const c30 = Math.cos(Math.PI / 6)
  const iso = ([x, y, z]) => [cx + (x - z) * c30 * k, cy + (-y + (x + z) * 0.5) * k]

  // Construction: the isometric axes, and each cube's line of explosion.
  plate.add("construct", [iso([-2.2, 0, 0]), iso([2.4, 0, 0])])
  plate.add("construct", [iso([0, 0, -2.2]), iso([0, 0, 2.4])])
  plate.add("construct", [iso([0, -1.6, 0]), iso([0, 2.4, 0])])

  const spacing = 1.14, edge = 0.92, explode = 0.32, h = edge / 2
  const centroid = spacing / 3
  const centres = [[0, spacing, 0], [spacing, 0, 0], [0, 0, spacing]].map((c) => {
    const v = c.map((x) => x - centroid)
    const len = Math.hypot(...v)
    return v.map((x) => x + (x / len) * explode)
  })
  centres.forEach((c) => plate.add("construct", [iso([0, 0, 0]), iso(c)]))

  for (const c of centres) {
    const corner = (sx, sy, sz) => [c[0] + sx * h, c[1] + sy * h, c[2] + sz * h]
    // Twelve edges; the three that meet at the far corner (-,-,-) are hidden.
    for (const [a, b] of [
      [[-1, -1, -1], [1, -1, -1]], [[-1, -1, -1], [-1, 1, -1]], [[-1, -1, -1], [-1, -1, 1]],
      [[1, 1, 1], [-1, 1, 1]], [[1, 1, 1], [1, -1, 1]], [[1, 1, 1], [1, 1, -1]],
      [[1, -1, -1], [1, 1, -1]], [[1, -1, -1], [1, -1, 1]], [[-1, 1, -1], [1, 1, -1]],
      [[-1, 1, -1], [-1, 1, 1]], [[-1, -1, 1], [1, -1, 1]], [[-1, -1, 1], [-1, 1, 1]],
    ]) {
      const hidden = a.every((v) => v === -1) || b.every((v) => v === -1)
      plate.add(hidden ? "hidden" : "main", [iso(corner(...a)), iso(corner(...b))])
    }
    // The face plates inside each visible face: the logo's seams.
    const inset = 0.78
    for (const face of [
      [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]],
      [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
      [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]],
    ]) {
      plate.add("kivaro", polygon(face.map((s) => iso(corner(...s.map((v) => v * inset))))))
    }
  }

  // Dimensions and notes.
  const right = centres[1]
  plate.dim(iso([right[0] - h, right[1] - h, right[2] + h]), iso([right[0] + h, right[1] - h, right[2] + h]), 34, "0.92")
  plate.dim(iso(centres[2]), iso(centres[1]), 150, "1.14 C/C")
  const top = centres[0]
  plate.leader(iso([top[0], top[1] + h, top[2]]), [cx + 230, cy - 230], "FACE PLATE, 6X PER CUBE")
  plate.leader(iso([top[0] + h, top[1], top[2] + h * 0.78]), [cx + 260, cy - 150], "SEAM 0.075 TYP.")
  plate.leader(iso([0, 0, 0]), [cx - 250, cy - 200], "EXPLODED 0.32 ALONG (1,1,1)", "right")
  plate.text(cx - 380, cy + 250, "LIME #CCE788  →  GREEN #70F087", { size: 12 })
  return plate.finish()
}

function reactor() {
  const plate = new Plate("KIV-002", "REACTOR CORE — FRONT ELEVATION / SECTION A-A")
  const cx = 330, cy = 320

  // Centre lines and the bolt circle.
  plate.add("construct", [[cx - 270, cy], [cx + 270, cy]])
  plate.add("construct", [[cx, cy - 270], [cx, cy + 270]])
  plate.add("construct", circle(cx, cy, 218))

  for (const r of [235, 205, 150, 98, 56]) plate.add("main", circle(cx, cy, r))
  plate.add("main", polygon([0, 1, 2, 3, 4, 5].map((i) => [cx + Math.cos((TAU * i) / 6) * 38, cy + Math.sin((TAU * i) / 6) * 38])))
  // Ten coil blocks between the rings.
  for (let i = 0; i < 10; i++) {
    const a = (TAU * i) / 10 + TAU / 20
    const rot = (x, y) => [cx + Math.cos(a) * x - Math.sin(a) * y, cy + Math.sin(a) * x + Math.cos(a) * y]
    plate.add("main", polygon([rot(157, -17), rot(198, -21), rot(198, 21), rot(157, 17)]))
  }
  for (let i = 0; i < 8; i++) {
    const a = (TAU * i) / 8
    plate.add("main", circle(cx + Math.cos(a) * 218, cy + Math.sin(a) * 218, 6, 0, TAU, 20))
  }
  // The cutting plane, A-A.
  plate.add("construct", [[cx, cy - 262], [cx, cy + 262]])
  for (const y of [cy - 262, cy + 262]) plate.add("dim", [[cx, y], [cx + 26, y], [cx + 18, y - 5], [cx + 26, y], [cx + 18, y + 5]])
  plate.text(cx + 34, cy - 258, "A", { size: 14 })
  plate.text(cx + 34, cy + 270, "A", { size: 14 })

  // Section A-A, to the right: the stepped profile, hatched where cut.
  const sx = 760
  const steps = [
    [sx - 40, cy - 235, sx + 20, cy + 235],
    [sx + 20, cy - 205, sx + 52, cy + 205],
    [sx + 52, cy - 98, sx + 78, cy + 98],
    [sx + 78, cy - 56, sx + 92, cy + 56],
  ]
  for (const [x0, y0, x1, y1] of steps) plate.add("main", polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]))
  // Hatching at 45 degrees across the cut housing: each line is
  // (x - x0) + (y1 - y) = c, clipped to the rectangle.
  for (const [x0, y0, x1, y1] of [[sx - 40, cy - 235, sx + 20, cy - 98], [sx - 40, cy + 98, sx + 20, cy + 235]]) {
    const W = x1 - x0, H = y1 - y0
    for (let c = 10; c < W + H; c += 12) {
      plate.add("hatch", [
        [x0 + Math.max(0, c - H), y1 - Math.min(c, H)],
        [x0 + Math.min(c, W), y1 - Math.max(0, c - W)],
      ])
    }
  }
  plate.add("construct", [[sx - 60, cy], [sx + 112, cy]])
  plate.text(sx + 26, cy + 275, "SECTION A-A", { align: "center", size: 13 })

  plate.dim([cx - 235, cy], [cx + 235, cy], 262, "Ø470")
  plate.dim([cx - 56, cy], [cx + 56, cy], -78, "Ø112")
  plate.dim([sx - 40, cy - 235], [sx + 92, cy - 235], -24, "132")
  plate.leader([cx + Math.cos(Math.PI - 0.3) * 178, cy + Math.sin(Math.PI - 0.3) * 178], [cx - 260, cy + 215], "COIL, 10X EQ. SP.", "right")
  plate.leader([cx + Math.cos(Math.PI * 1.25) * 218, cy + Math.sin(Math.PI * 1.25) * 218], [cx - 250, cy - 230], "M6 ON Ø436 B.C., 8X", "right")
  return plate.finish()
}

function jarvisCore() {
  const plate = new Plate("KIV-003", "J.A.R.V.I.S. CORE — FRONT AND TOP VIEWS")
  const fx = 320, fy = 330, r = 200
  const tx = 770, ty = 330, tr = 150

  // Projection lines between the views.
  for (const y of [fy - r, fy, fy + r]) plate.add("construct", [[fx + r + 20, y], [tx - tr - 20, y]])
  plate.add("construct", [[fx - r - 30, fy], [fx + r + 30, fy]])
  plate.add("construct", [[fx, fy - r - 30], [fx, fy + r + 30]])
  plate.add("construct", [[tx - tr - 30, ty], [tx + tr + 30, ty]])
  plate.add("construct", [[tx, ty - tr - 30], [tx, ty + tr + 30]])

  // Front view: the outline, latitudes as chords, longitudes as ellipses.
  plate.add("main", circle(fx, fy, r))
  for (let lat = -75; lat <= 75; lat += 15) {
    if (lat === 0) continue
    const y = fy - Math.sin((lat * Math.PI) / 180) * r
    const half = Math.cos((lat * Math.PI) / 180) * r
    plate.add("main", [[fx - half, y], [fx + half, y]])
  }
  plate.add("main", [[fx - r, fy], [fx + r, fy]])
  for (let lon = 15; lon < 90; lon += 15) {
    const rx = Math.sin((lon * Math.PI) / 180) * r
    plate.add("main", ellipse(fx, fy, rx, r))
  }
  plate.add("main", [[fx, fy - r], [fx, fy + r]])

  // Top view: latitudes as circles, longitudes as radials.
  plate.add("main", circle(tx, ty, tr))
  for (let lat = 15; lat < 90; lat += 15) plate.add("main", circle(tx, ty, Math.cos((lat * Math.PI) / 180) * tr))
  for (let lon = 0; lon < 360; lon += 15) {
    const a = (lon * Math.PI) / 180
    plate.add(lon % 90 ? "main" : "kivaro", [[tx, ty], [tx + Math.cos(a) * tr, ty + Math.sin(a) * tr]])
  }

  plate.dim([fx - r, fy + r], [fx + r, fy + r], 44, "Ø400")
  plate.dim([tx - tr, ty + tr], [tx + tr, ty + tr], 44, "Ø300 (TOP)")
  plate.add("dim", circle(tx, ty, tr + 26, 0, Math.PI / 12, 12))
  plate.text(tx + tr + 44, ty + 18, "15° TYP.", { size: 12 })
  plate.leader([fx + Math.cos(-0.9) * r, fy + Math.sin(-0.9) * r], [fx + 250, fy - 250], "LAT/LONG GRID, 15°")
  plate.leader([fx - 60, fy - Math.sin(Math.PI / 4) * r], [fx - 240, fy - 250], "DISPLAY TILT 18°", "right")
  plate.text(tx, ty - tr - 52, "TOP", { align: "center", size: 13 })
  plate.text(fx, fy - r - 52, "FRONT", { align: "center", size: 13 })
  return plate.finish()
}

const PLATES = [kivaroMark(), reactor(), jarvisCore()]

// --- drawing -----------------------------------------------------------------------

const canvas = document.getElementById("sheet")
const ctx = canvas.getContext("2d")
let grid = null
let dpr = 1

function drawGrid(w, h) {
  const g = document.createElement("canvas")
  g.width = w
  g.height = h
  const c = g.getContext("2d")
  const glow = c.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, Math.max(w, h) * 0.75)
  glow.addColorStop(0, "#082339")
  glow.addColorStop(1, "#020a12")
  c.fillStyle = glow
  c.fillRect(0, 0, w, h)
  const minor = 24 * dpr, major = minor * 5
  for (let x = 0; x < w; x += minor) {
    c.fillStyle = `rgba(${LINE}, ${Math.round(x / minor) % 5 === 0 ? 0.1 : 0.04})`
    c.fillRect(x, 0, Math.max(1, dpr * 0.6), h)
  }
  for (let y = 0; y < h; y += minor) {
    c.fillStyle = `rgba(${LINE}, ${Math.round(y / minor) % 5 === 0 ? 0.1 : 0.04})`
    c.fillRect(0, y, w, Math.max(1, dpr * 0.6))
  }
  // The sheet's border with its zone marks, like a drawing frame.
  const m = 14 * dpr
  c.strokeStyle = `rgba(${LINE}, 0.35)`
  c.lineWidth = dpr
  c.strokeRect(m, m, w - 2 * m, h - 2 * m)
  c.font = `${10 * dpr}px ${FONT}`
  c.fillStyle = `rgba(${LINE}, 0.45)`
  c.textAlign = "center"
  c.textBaseline = "middle"
  const cols = Math.max(4, Math.round(w / (major * 2)))
  for (let i = 0; i < cols; i++) {
    const x = m + ((w - 2 * m) * (i + 0.5)) / cols
    c.fillText(String(i + 1), x, m / 2 + 1)
    c.fillText(String(i + 1), x, h - m / 2)
    if (i) c.fillRect(m + ((w - 2 * m) * i) / cols, m, dpr, 6 * dpr)
  }
  const rows = Math.max(3, Math.round(h / (major * 2)))
  for (let i = 0; i < rows; i++) {
    const y = m + ((h - 2 * m) * (i + 0.5)) / rows
    c.fillText(String.fromCharCode(65 + i), m / 2 + 1, y)
    c.fillText(String.fromCharCode(65 + i), w - m / 2, y)
  }
  return g
}

function fit() {
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  // A tab opened in the background can report no size until it is shown.
  canvas.width = Math.max(1, Math.round(innerWidth * dpr))
  canvas.height = Math.max(1, Math.round(innerHeight * dpr))
  grid = drawGrid(canvas.width, canvas.height)
}

function styleFor(kind, alpha) {
  ctx.setLineDash([])
  ctx.shadowBlur = 0
  if (kind === "construct") {
    ctx.strokeStyle = `rgba(${LINE}, ${0.22 * alpha})`
    ctx.lineWidth = dpr * 0.8
    ctx.setLineDash([6 * dpr, 5 * dpr])
  } else if (kind === "main") {
    ctx.strokeStyle = `rgba(${LINE}, ${0.92 * alpha})`
    ctx.lineWidth = dpr * 1.5
    ctx.shadowColor = `rgba(${LINE}, ${0.8 * alpha})`
    ctx.shadowBlur = 8 * dpr
  } else if (kind === "kivaro") {
    ctx.strokeStyle = `rgba(${KIVARO}, ${0.85 * alpha})`
    ctx.lineWidth = dpr * 1.2
    ctx.shadowColor = `rgba(${KIVARO}, ${0.7 * alpha})`
    ctx.shadowBlur = 6 * dpr
  } else if (kind === "hidden") {
    ctx.strokeStyle = `rgba(${LINE}, ${0.5 * alpha})`
    ctx.lineWidth = dpr
    ctx.setLineDash([10 * dpr, 6 * dpr])
  } else {
    ctx.strokeStyle = `rgba(${LINE}, ${(kind === "hatch" ? 0.3 : 0.6) * alpha})`
    ctx.lineWidth = dpr * 0.9
  }
}

/** Draws a polyline up to `upto` of its length; returns the pen's position. */
function trace(pts, upto, map) {
  ctx.beginPath()
  let [x, y] = map(pts[0])
  ctx.moveTo(x, y)
  let left = upto
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    if (left >= seg) {
      ;[x, y] = map(pts[i])
      ctx.lineTo(x, y)
      left -= seg
    } else {
      const f = seg ? left / seg : 0
      ;[x, y] = map([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f])
      ctx.lineTo(x, y)
      break
    }
  }
  ctx.stroke()
  return [x, y]
}

// `full`: the plate over the whole sheet (the GX Mod's video, where Opera
// draws its own clock and search). `steady`: no flicker, and a scan band
// that divides the three-plate loop, so the video restarts with no seam.
const LOOP_S = CYCLE_S * PLATES.length

function render(seconds, { still = false, full = false, steady = false } = {}) {
  const w = canvas.width, h = canvas.height
  const index = Math.floor(seconds / CYCLE_S) % PLATES.length
  const plate = PLATES[index]
  const local = seconds % CYCLE_S
  const drawn = still ? 1 : Math.min(1, (local / DRAW_S) * PEN_SPEED)
  const fade = local > DRAW_S + HOLD_S ? (local - DRAW_S - HOLD_S) / FADE_S : 0
  const flicker = still || steady ? 1 : 0.94 + 0.06 * Math.sin(seconds * 37) * Math.sin(seconds * 11.3)
  const alpha = (1 - fade) * flicker

  ctx.drawImage(grid, 0, 0)

  // The plate, fitted below the clock and search box.
  const top = full ? h * 0.12 : h * 0.43, bottom = full ? h * 0.94 : h * 0.97
  const scale = Math.min((w * 0.86) / 1000, (bottom - top) / 640)
  const ox = (w - 1000 * scale) / 2 + (fade ? Math.sin(seconds * 90) * fade * 6 * dpr : 0)
  const oy = top + (bottom - top - 640 * scale) / 2
  const map = ([x, y]) => [ox + x * scale, oy + y * scale]

  let budget = drawn * plate.total
  let pen = null
  for (const s of plate.strokes) {
    if (budget <= 0) break
    const part = Math.min(1, budget / s.length)
    budget -= s.length
    if (s.text) {
      const shown = s.text.slice(0, Math.ceil(s.text.length * part))
      const [x, y] = map([s.x, s.y])
      ctx.setLineDash([])
      ctx.shadowBlur = 0
      ctx.font = `${Math.max(9, s.size * scale * 1.1) * (dpr / Math.max(dpr, 1))}px ${FONT}`
      ctx.textAlign = s.align
      ctx.fillStyle = `rgba(${TEXT}, ${0.85 * alpha})`
      ctx.fillText(shown, x, y)
      if (part < 1) pen = [x + ctx.measureText(shown).width * (s.align === "left" ? 1 : s.align === "center" ? 0.5 : 0), y - 4 * dpr]
    } else {
      styleFor(s.kind, alpha)
      const p = trace(s.pts, s.length * part, map)
      if (part < 1) pen = p
    }
  }
  ctx.setLineDash([])

  // The pen tip, while drawing.
  if (pen && !still && drawn < 1) {
    const g = ctx.createRadialGradient(pen[0], pen[1], 0, pen[0], pen[1], 18 * dpr)
    g.addColorStop(0, "rgba(255, 255, 255, 0.95)")
    g.addColorStop(0.25, `rgba(${LINE}, 0.7)`)
    g.addColorStop(1, `rgba(${LINE}, 0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(pen[0], pen[1], 18 * dpr, 0, TAU)
    ctx.fill()
  }

  // A hologram's scan band, drifting down the sheet.
  if (!still) {
    const band = ((seconds / (steady ? LOOP_S / 10 : 7)) % 1) * (h + 200 * dpr) - 100 * dpr
    const g = ctx.createLinearGradient(0, band - 90 * dpr, 0, band + 90 * dpr)
    g.addColorStop(0, `rgba(${LINE}, 0)`)
    g.addColorStop(0.5, `rgba(${LINE}, 0.05)`)
    g.addColorStop(1, `rgba(${LINE}, 0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, band - 90 * dpr, w, 180 * dpr)
  }
  return { index, plate }
}

// --- the page around it -------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0")
let lastPlate = -1

function titleBlock(index) {
  if (index === lastPlate) return
  lastPlate = index
  document.getElementById("tb-number").textContent = PLATES[index].number
  document.getElementById("tb-title").textContent = PLATES[index].title
  document.getElementById("tb-sheet").textContent = `SHEET ${index + 1} OF ${PLATES.length}`
}

function clock() {
  const now = new Date()
  document.getElementById("time").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  document.getElementById("date").textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
  const left = LAUNCH - now.getTime()
  document.getElementById("launch").textContent = left > 0
    ? `KIVARO AI · LAUNCH T-${Math.floor(left / 86400000)}D ${pad(Math.floor((left % 86400000) / 3600000))}H`
    : "KIVARO AI · LAUNCHED"
}

document.getElementById("search").addEventListener("submit", (event) => {
  event.preventDefault()
  const text = document.getElementById("query").value.trim()
  if (!text) return
  // The browser's own search engine, as the extension's "search" permission allows.
  if (globalThis.chrome?.search?.query) chrome.search.query({ text, disposition: "CURRENT_TAB" })
  else location.href = `https://www.google.com/search?q=${encodeURIComponent(text)}`
})

async function start() {
  try {
    await document.fonts.load(`13px ${FONT}`)
  } catch {
    // The system monospace will do.
  }
  fit()
  addEventListener("resize", fit)
  clock()
  setInterval(clock, 1000)

  const params = new URLSearchParams(location.search)
  if (params.has("capture")) {
    // The GX Mod's video (wallpapers/render.py): exact frames of the whole
    // three-plate loop, at 1920 x 1080, the sheet alone.
    document.body.classList.add("capture")
    removeEventListener("resize", fit)
    dpr = 1
    canvas.width = 1920
    canvas.height = 1080
    canvas.style.width = "100%"
    canvas.style.height = "auto"
    grid = drawGrid(1920, 1080)
    window.WALL = { width: 1920, height: 1080, period: LOOP_S, // Starting where the first plate stands finished, so the still Opera
    // shows before the video plays (its first frame) is a drawing, not an
    // empty sheet; the loop is the same from any start.
    frame: (t) => render(t + DRAW_S + 4, { full: true, steady: true }) }
    return
  }
  if (params.has("plate")) {
    const plate = Number(params.get("plate")) || 0
    const t = Number(params.get("t") ?? DRAW_S)
    const still = () => titleBlock(render(plate * CYCLE_S + t).index)
    still()
    addEventListener("resize", still)
    return
  }

  // A new tab starts on a different plate each time, partway drawn.
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
  const offset = Math.floor(Math.random() * PLATES.length) * CYCLE_S
  const begin = performance.now()
  const frame = (now) => {
    const seconds = offset + (now - begin) / 1000
    const { index } = reduced ? render(Math.floor(seconds / 60) * CYCLE_S, { still: true }) : render(seconds)
    titleBlock(index)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

start()
