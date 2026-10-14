// Drawing shared by the three wallpapers: Jarvis's console (cyan, the
// sphere core, HUD rings, the hex grid) and Kivaro AI's mark (three
// isometric cubes, lime to green, drawn in its site's scanline dissolve).
//
// Everything is a pure function of t (seconds) and the wallpaper's period,
// and every motion repeats a whole number of times per period, so a video
// cut from one period loops with no seam.

export const TAU = Math.PI * 2

export const COLORS = {
  cyan: "#00d4ff",
  cyanRGB: "0, 212, 255",
  green: "#21d880", // Kivaro primary, hsl(152 76% 46%)
  greenRGB: "33, 216, 128",
  lime: "#cce788",
  logoGreen: "#70f087",
  ink: "#050508",
  kivaroInk: "#080c0a", // hsl(150 20% 4%)
}

export const FONT = '"JetBrains Mono", ui-monospace, monospace'

/** sin with `cycles` whole turns per period: loops seamlessly. */
export function wave(t, period, cycles = 1, phase = 0) {
  return Math.sin((TAU * cycles * t) / period + phase)
}

/** A flat-topped hex grid, faint, with a band of light sweeping through it. */
export function hexGrid(ctx, w, h, size, t, period, { rgb = COLORS.cyanRGB, base = 0.035, band = 0.11, top = 0, bottom = h } = {}) {
  const hw = size * Math.sqrt(3)
  const sweep = top + ((t / period) % 1) * (bottom - top + h * 0.4) - h * 0.2
  ctx.lineWidth = Math.max(1, size * 0.03)
  for (let row = -1, y = top; y < bottom + size; row++, y = top + row * size * 1.5) {
    for (let col = -1; col * hw < w + hw; col++) {
      const x = col * hw + (row % 2 ? hw / 2 : 0)
      const d = Math.abs(y - sweep) / (h * 0.12)
      const a = base + band * Math.max(0, 1 - d * d)
      ctx.strokeStyle = `rgba(${rgb}, ${a})`
      ctx.beginPath()
      for (let k = 0; k < 6; k++) {
        const ang = TAU * (k / 6) + Math.PI / 6
        const px = x + size * Math.cos(ang)
        const py = y + size * Math.sin(ang)
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
      }
      ctx.closePath()
      ctx.stroke()
    }
  }
}

/** A wireframe sphere of latitude and longitude lines, turning about its
 *  axis. Lines every 15 degrees, so a turn of 15k degrees per period loops. */
export function sphere(ctx, cx, cy, r, t, period, { rgb = COLORS.cyanRGB, turns = 2, tilt = 0.32, alpha = 0.55 } = {}) {
  const spin = (TAU * (15 / 360) * turns * t) / period
  const ct = Math.cos(tilt), st = Math.sin(tilt)
  const project = (lat, lon) => {
    const x0 = Math.cos(lat) * Math.sin(lon + spin)
    const y0 = Math.sin(lat)
    const z0 = Math.cos(lat) * Math.cos(lon + spin)
    const y = y0 * ct - z0 * st
    const z = y0 * st + z0 * ct
    return [cx + x0 * r, cy - y * r, z]
  }
  ctx.lineWidth = Math.max(1, r * 0.006)
  const seg = (a, b) => {
    const depth = (a[2] + b[2]) / 2
    ctx.strokeStyle = `rgba(${rgb}, ${alpha * (0.18 + 0.82 * Math.max(0, (depth + 1) / 2) ** 2)})`
    ctx.beginPath()
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
    ctx.stroke()
  }
  const step = Math.PI / 12
  for (let lat = -Math.PI / 2 + step; lat < Math.PI / 2 - 1e-6; lat += step) {
    let prev = project(lat, 0)
    for (let lon = TAU / 72; lon <= TAU + 1e-6; lon += TAU / 72) {
      const p = project(lat, lon)
      seg(prev, p)
      prev = p
    }
  }
  for (let lon = 0; lon < TAU - 1e-6; lon += step) {
    let prev = project(-Math.PI / 2, lon)
    for (let lat = -Math.PI / 2 + Math.PI / 36; lat <= Math.PI / 2 + 1e-6; lat += Math.PI / 36) {
      const p = project(lat, lon)
      seg(prev, p)
      prev = p
    }
  }
}

/** A ring of tick marks; `ticks` evenly spaced, every `major`-th long. It
 *  turns by whole major spacings (`turns` of them) per period, so the long
 *  ticks land where they started and it loops. */
export function tickRing(ctx, cx, cy, r, t, period, { ticks = 72, turns = 1, len = 0.04, major = 6, rgb = COLORS.cyanRGB, alpha = 0.6 } = {}) {
  const rot = (TAU / ticks) * major * turns * (t / period)
  ctx.lineWidth = Math.max(1, r * 0.006)
  for (let i = 0; i < ticks; i++) {
    const a = (TAU * i) / ticks + rot
    const l = r * len * (i % major === 0 ? 2.2 : 1)
    ctx.strokeStyle = `rgba(${rgb}, ${i % major === 0 ? alpha : alpha * 0.45})`
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    ctx.lineTo(cx + Math.cos(a) * (r - l), cy + Math.sin(a) * (r - l))
    ctx.stroke()
  }
}

/** `n` arc segments with gaps, turning by whole segments per period. */
export function arcRing(ctx, cx, cy, r, t, period, { n = 6, fill = 0.68, turns = -1, width = 0.012, rgb = COLORS.cyanRGB, alpha = 0.7 } = {}) {
  const span = TAU / n
  const rot = span * turns * (t / period)
  ctx.lineWidth = Math.max(1, r * width)
  ctx.lineCap = "butt"
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`
  for (let i = 0; i < n; i++) {
    const a = span * i + rot
    ctx.beginPath()
    ctx.arc(cx, cy, r, a, a + span * fill)
    ctx.stroke()
  }
}

/** Points orbiting at a radius, `turns` whole turns per period. */
export function orbiters(ctx, cx, cy, r, t, period, { count = 3, turns = 1, size = 3, rgb = COLORS.cyanRGB, alpha = 0.9, squash = 1 } = {}) {
  for (let i = 0; i < count; i++) {
    const a = (TAU * i) / count + (TAU * turns * t) / period
    ctx.fillStyle = `rgba(${rgb}, ${alpha})`
    ctx.shadowColor = `rgba(${rgb}, 1)`
    ctx.shadowBlur = size * 4
    ctx.beginPath()
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * squash, size, 0, TAU)
    ctx.fill()
  }
  ctx.shadowBlur = 0
}

/** Labels set around a circle. They hold still (turning them one slot a
 *  period would put a different word in each place when the loop restarts)
 *  and each brightens in turn, once a period. */
export function ringLabels(ctx, cx, cy, r, t, period, labels, { size = 12, rgb = COLORS.cyanRGB, alpha = 0.55, offset = -Math.PI / 2 } = {}) {
  const rot = offset
  ctx.font = `${size}px ${FONT}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  labels.forEach((label, i) => {
    const lit = Math.max(0, wave(t, period, 1, -(TAU * i) / labels.length))
    ctx.fillStyle = `rgba(${rgb}, ${alpha * (0.55 + 0.45 * lit)})`
    const a = (TAU * i) / labels.length + rot
    ctx.save()
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    ctx.rotate(a + Math.PI / 2)
    ctx.fillText(label, 0, 0)
    ctx.restore()
  })
}

// --- the Kivaro mark ----------------------------------------------------------

const C30 = Math.cos(Math.PI / 6), S30 = 0.5

/** 3D (x, y up, z) to the isometric screen, looking down (1, 1, 1). */
function iso(x, y, z) {
  return [(x - z) * C30, -y + (x + z) * S30]
}

/** The faces of one cube (edge e, centre c) as screen polygons: top (+y),
 *  left (+z) and right (+x), each inset to leave the logo's seams. */
function cubeFaces([cx, cy, cz], e, inset) {
  const h = e / 2
  const face = (corners) => {
    const pts = corners.map(([x, y, z]) => iso(cx + x, cy + y, cz + z))
    const mx = pts.reduce((s, p) => s + p[0], 0) / 4
    const my = pts.reduce((s, p) => s + p[1], 0) / 4
    return pts.map(([x, y]) => [mx + (x - mx) * (1 - inset), my + (y - my) * (1 - inset)])
  }
  return {
    top: face([[-h, h, -h], [h, h, -h], [h, h, h], [-h, h, h]]),
    left: face([[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]]),
    right: face([[h, -h, -h], [h, -h, h], [h, h, h], [h, h, -h]]),
  }
}

const CUBES = [
  [0, 1.14, 0], // top
  [1.14, 0, 0], // lower right
  [0, 0, 1.14], // lower left
]
const CENTROID = 1.14 / 3

/** Polygons of the mark around (0,0), unit = one cube edge before scaling.
 *  `lift` per cube eases it out from the centre (the site's wave). */
export function markPolygons(lift = [0, 0, 0]) {
  const out = []
  CUBES.forEach((c, i) => {
    const centre = c.map((v) => v - CENTROID)
    const len = Math.hypot(...centre)
    const moved = centre.map((v) => v + (v / len) * lift[i])
    const faces = cubeFaces(moved, 0.92, 0.1)
    out.push({ shade: 1.0, pts: faces.top }, { shade: 0.74, pts: faces.left }, { shade: 0.5, pts: faces.right })
  })
  return out
}

/** The mark, solid, centred at (cx, cy), `size` = its overall width. */
export function drawMark(ctx, cx, cy, size, t, period, { glow = 1, waveCycles = 1, alpha = 1 } = {}) {
  const k = size / 2.9
  const lift = [0, 1, 2].map((i) => (wave(t, period, waveCycles, -(i * TAU) / 3) * 0.5 + 0.5) * 0.12)
  const grad = ctx.createLinearGradient(cx - size * 0.45, cy - size * 0.45, cx + size * 0.45, cy + size * 0.45)
  grad.addColorStop(0, COLORS.lime)
  grad.addColorStop(1, COLORS.logoGreen)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.shadowColor = `rgba(${COLORS.greenRGB}, ${0.85 * glow})`
  ctx.shadowBlur = size * 0.18 * glow
  for (const { shade, pts } of markPolygons(lift)) {
    ctx.beginPath()
    pts.forEach(([x, y], j) => (j ? ctx.lineTo(cx + x * k, cy + y * k) : ctx.moveTo(cx + x * k, cy + y * k)))
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()
    if (shade < 1) {
      ctx.shadowBlur = 0
      ctx.fillStyle = `rgba(5, 8, 6, ${1 - shade})`
      ctx.fill()
      ctx.shadowBlur = size * 0.18 * glow
    }
  }
  ctx.restore()
}

/** Is (x, y) - in mark units - inside the mark? For the scanline dissolve. */
export function insideMark(x, y, polygons) {
  for (const { pts, shade } of polygons) {
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    if (inside) return shade
  }
  return 0
}

/** Loads the wallpaper font before the first frame (a capture must not
 *  catch the fallback face). */
export async function ready() {
  try {
    await document.fonts.load(`16px ${FONT}`)
  } catch {
    // Falls back to the system monospace.
  }
}

/** Runs a wallpaper: live, at the screen's size, or - with ?capture - one
 *  frame at a time at a fixed size, for the video renderer. */
export async function run(draw, { width, height, period }) {
  await ready()
  const canvas = document.querySelector("canvas")
  const ctx = canvas.getContext("2d")
  const params = new URLSearchParams(location.search)

  if (params.has("capture")) {
    canvas.width = width
    canvas.height = height
    canvas.style.width = "100%"
    canvas.style.height = "auto"
    window.WALL = {
      width, height, period,
      frame(t) {
        // ?capture&live: a still of the live version (real clock and countdown).
        draw(ctx, width, height, t, { live: params.has("live") })
      },
    }
    return
  }

  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.round(innerWidth * dpr)
    canvas.height = Math.round(innerHeight * dpr)
  }
  fit()
  addEventListener("resize", fit)
  const start = performance.now()
  const tick = (now) => {
    // Every motion is periodic, so the clock wraps at the period without a jump.
    draw(ctx, canvas.width, canvas.height, ((now - start) / 1000) % period, { live: true })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
