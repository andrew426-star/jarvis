"use client"

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import {
  DownloadIcon,
  EraserIcon,
  EyeIcon,
  EyeOffIcon,
  FingerprintIcon,
  HighlighterIcon,
  Loader2Icon,
  MinusIcon,
  PaintBucketIcon,
  PaintbrushIcon,
  PipetteIcon,
  Redo2Icon,
  SparklesIcon,
  SprayCanIcon,
  Trash2Icon,
  Undo2Icon,
  WindIcon,
  XIcon,
} from "lucide-react"

// The Paint Studio: paint over a frozen frame of the workshop view (or over
// a render) and have Gemini render the paint job for real. The frame is the
// base layer and is never changed; strokes go on a paint layer above it,
// marker and tape strokes on a scratch layer until they land. Every tool is
// plain 2D canvas, stamped dab by dab, so pen pressure, flow and hardness
// behave as they do in a paint program.
//
//   brush     hard-to-soft round dabs; flow builds up where strokes overlap
//   airbrush  a soft, low-flow spray that keeps building while held still
//   spray     a spray can's speckle: random droplets inside the nozzle
//   marker    one even coat per stroke, however often it crosses itself
//   tape      straight masking-tape lines (drag from end to end)
//   fill      a bucket fill of the area under the click, to a tolerance
//   smudge    drags the colour under the brush along the stroke
//   glow      additive light: emissive accents, a repulsor's flare
//   eraser    takes paint off (never the frame under it)
//   picker    takes a colour from the picture

export type PaintTool = "brush" | "airbrush" | "spray" | "marker" | "tape" | "fill" | "smudge" | "glow" | "eraser" | "picker"

const TOOLS: { id: PaintTool; label: string; key: string; icon: React.ReactNode; hint: string }[] = [
  { id: "brush", label: "BRUSH", key: "b", icon: <PaintbrushIcon size={14} />, hint: "Round brush: hardness sets the edge, flow builds up (B)" },
  { id: "airbrush", label: "AIRBRUSH", key: "a", icon: <WindIcon size={14} />, hint: "Soft spray that keeps building while you hold still (A)" },
  { id: "spray", label: "SPRAY CAN", key: "s", icon: <SprayCanIcon size={14} />, hint: "Speckled droplets, like a rattle can (S)" },
  { id: "marker", label: "MARKER", key: "m", icon: <HighlighterIcon size={14} />, hint: "One even coat per stroke (M)" },
  { id: "tape", label: "TAPE LINE", key: "l", icon: <MinusIcon size={14} />, hint: "Straight masked line: drag from end to end (L)" },
  { id: "fill", label: "FILL", key: "g", icon: <PaintBucketIcon size={14} />, hint: "Fill the area under the click (G)" },
  { id: "smudge", label: "SMUDGE", key: "u", icon: <FingerprintIcon size={14} />, hint: "Drag colour along: blends and weathers (U)" },
  { id: "glow", label: "GLOW", key: "w", icon: <SparklesIcon size={14} />, hint: "Additive light for emissive parts (W)" },
  { id: "eraser", label: "ERASER", key: "e", icon: <EraserIcon size={14} />, hint: "Takes paint off, never the frame (E)" },
  { id: "picker", label: "PICKER", key: "i", icon: <PipetteIcon size={14} />, hint: "Take a colour from the picture (I)" },
]

/** Paints, by name, the way a builder buys them. */
const SWATCHES: { name: string; hex: string }[] = [
  { name: "Hot-rod red", hex: "#a8151b" },
  { name: "Gold titanium", hex: "#d4a23c" },
  { name: "Gunmetal", hex: "#4a4f57" },
  { name: "Chrome", hex: "#c9ced4" },
  { name: "Arc blue", hex: "#8fd8ff" },
  { name: "Stark white", hex: "#efefea" },
  { name: "Matte black", hex: "#1b1c21" },
  { name: "Ultron grey", hex: "#b4bac2" },
  { name: "Signal amber", hex: "#ff8a1a" },
  { name: "Weathering brown", hex: "#5c3a1e" },
]

const FINISHES = ["gloss automotive", "metallic", "candy (translucent over metallic)", "satin", "matte", "chrome"] as const
type Finish = (typeof FINISHES)[number]

const MAX_UNDO = 30

interface Props {
  /** The frame to paint on: a data URL (the workshop view, or a render). */
  base: string
  rendering: boolean
  onRender: (pngDataUrl: string, direction: string) => void
  onClose: () => void
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
}

/** A soft or hard round dab, its colour at alpha fading to 0 at the rim. */
function dab(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: [number, number, number], alpha: number, hardness: number) {
  if (r <= 0.3 || alpha <= 0) return
  const [cr, cg, cb] = rgb
  if (hardness >= 0.98) {
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`)
  g.addColorStop(Math.max(0.001, Math.min(0.999, hardness)), `rgba(${cr},${cg},${cb},${alpha})`)
  g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

export function PaintStudio({ base, rendering, onRender, onClose }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const paintRef = useRef<HTMLCanvasElement>(null)
  const scratchRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<[number, number] | null>(null)
  // The frame's size on screen: as large as the stage allows, at its aspect.
  const [fit, setFit] = useState<[number, number]>([0, 0])

  const [tool, setTool] = useState<PaintTool>("airbrush")
  const [color, setColor] = useState(SWATCHES[0].hex)
  const [radius, setRadius] = useState(28)
  const [flow, setFlow] = useState(0.35)
  const [hardness, setHardness] = useState(0.4)
  const [tolerance, setTolerance] = useState(36)
  const [finish, setFinish] = useState<Finish>("gloss automotive")
  const [direction, setDirection] = useState("")
  const [showPaint, setShowPaint] = useState(true)
  const [undoCount, setUndoCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)

  const undo = useRef<ImageData[]>([])
  const redo = useRef<ImageData[]>([])
  const stroke = useRef<{
    active: boolean
    x: number
    y: number
    sx: number
    sy: number
    pressure: number
    carry: number
    raf: number
    smudge: HTMLCanvasElement | null
  }>({ active: false, x: 0, y: 0, sx: 0, sy: 0, pressure: 1, carry: 0, raf: 0, smudge: null })

  // Load the frame; the canvases take its pixel size.
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      for (const c of [baseRef.current, paintRef.current, scratchRef.current]) {
        if (!c) continue
        c.width = w
        c.height = h
      }
      baseRef.current?.getContext("2d")?.drawImage(img, 0, 0)
      undo.current = []
      redo.current = []
      setUndoCount(0)
      setRedoCount(0)
      setSize([w, h])
    }
    img.src = base
  }, [base])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !size) return
    const place = () => {
      const r = wrap.getBoundingClientRect()
      const w = Math.max(1, r.width - 32)
      const h = Math.max(1, r.height - 32)
      const k = Math.min(w / size[0], h / size[1])
      setFit([Math.floor(size[0] * k), Math.floor(size[1] * k)])
    }
    place()
    const view = wrap.ownerDocument.defaultView ?? window
    const ro = new view.ResizeObserver(place)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [size])

  const paintCtx = () => paintRef.current?.getContext("2d", { willReadFrequently: true }) ?? null
  const scratchCtx = () => scratchRef.current?.getContext("2d") ?? null

  /** Frame and paint together, as one picture. */
  const composite = useCallback((): HTMLCanvasElement | null => {
    const b = baseRef.current
    const p = paintRef.current
    if (!b || !p) return null
    const out = document.createElement("canvas")
    out.width = b.width
    out.height = b.height
    const ctx = out.getContext("2d", { willReadFrequently: true })!
    ctx.drawImage(b, 0, 0)
    ctx.drawImage(p, 0, 0)
    return out
  }, [])

  const pushUndo = () => {
    const ctx = paintCtx()
    const p = paintRef.current
    if (!ctx || !p) return
    undo.current.push(ctx.getImageData(0, 0, p.width, p.height))
    if (undo.current.length > MAX_UNDO) undo.current.shift()
    redo.current = []
    setUndoCount(undo.current.length)
    setRedoCount(0)
  }

  const step = (from: "undo" | "redo") => {
    const ctx = paintCtx()
    const p = paintRef.current
    if (!ctx || !p) return
    const src = from === "undo" ? undo.current : redo.current
    const dst = from === "undo" ? redo.current : undo.current
    const prev = src.pop()
    if (!prev) return
    dst.push(ctx.getImageData(0, 0, p.width, p.height))
    ctx.putImageData(prev, 0, 0)
    setUndoCount(undo.current.length)
    setRedoCount(redo.current.length)
  }

  const clear = () => {
    const ctx = paintCtx()
    const p = paintRef.current
    if (!ctx || !p) return
    pushUndo()
    ctx.clearRect(0, 0, p.width, p.height)
  }

  // --- the tools ------------------------------------------------------------

  /** Pointer to canvas pixels (the canvas is scaled to fit the stage). */
  const toCanvas = (e: { clientX: number; clientY: number }): [number, number] => {
    const c = paintRef.current!
    const r = c.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height]
  }

  const pixelsPerCss = () => {
    const c = paintRef.current
    if (!c) return 1
    return c.width / Math.max(1, c.getBoundingClientRect().width)
  }

  /** One dab of the current tool at (x, y). */
  const stamp = (x: number, y: number, pressure: number) => {
    const ctx = paintCtx()
    if (!ctx) return
    const rgb = hexToRgb(color)
    const r = radius * pixelsPerCss() * (0.35 + 0.65 * pressure)
    switch (tool) {
      case "brush":
        dab(ctx, x, y, r, rgb, flow * 0.6, hardness)
        break
      case "airbrush":
        dab(ctx, x, y, r * 1.4, rgb, flow * 0.05, 0)
        break
      case "glow":
        ctx.save()
        ctx.globalCompositeOperation = "lighter"
        dab(ctx, x, y, r * 1.6, rgb, flow * 0.12, 0)
        ctx.restore()
        break
      case "eraser":
        ctx.save()
        ctx.globalCompositeOperation = "destination-out"
        dab(ctx, x, y, r, [0, 0, 0], Math.max(0.15, flow), hardness)
        ctx.restore()
        break
      case "spray": {
        const [cr, cg, cb] = rgb
        const drops = Math.round(6 + r * 0.9 * flow)
        for (let i = 0; i < drops; i += 1) {
          // Denser in the middle, as a nozzle throws it.
          const a = Math.random() * Math.PI * 2
          const d = r * Math.sqrt(Math.random()) * (0.4 + 0.6 * Math.random())
          const s = (0.5 + Math.random() * 1.4) * pixelsPerCss()
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.35 + 0.5 * Math.random()})`
          ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, s, s)
        }
        break
      }
      case "marker": {
        const s = scratchCtx()
        if (!s) return
        s.globalCompositeOperation = "source-over"
        dab(s, x, y, r, rgb, 1, 0.92)
        break
      }
      case "smudge": {
        const st = stroke.current
        const buf = st.smudge
        if (!buf) return
        const d = buf.width
        // Lay the carried colour down here, then pick up what is under it.
        ctx.save()
        ctx.globalAlpha = Math.min(0.9, 0.35 + flow * 0.6)
        ctx.drawImage(buf, x - d / 2, y - d / 2)
        ctx.restore()
        // Just the patch under the brush, from the frame and the paint.
        const pick = buf.getContext("2d")!
        pick.save()
        pick.globalAlpha = 0.35
        pick.globalCompositeOperation = "source-atop"
        for (const layer of [baseRef.current, paintRef.current]) if (layer) pick.drawImage(layer, x - d / 2, y - d / 2, d, d, 0, 0, d, d)
        pick.restore()
        break
      }
    }
  }

  /** Dabs along the segment, spaced by the brush size (with carry-over). */
  const strokeTo = (x: number, y: number, pressure: number) => {
    const st = stroke.current
    const dx = x - st.x
    const dy = y - st.y
    const dist = Math.hypot(dx, dy)
    const r = Math.max(1, radius * pixelsPerCss())
    const spacing = tool === "spray" ? r * 0.5 : tool === "smudge" ? r * 0.12 : Math.max(1, r * 0.18)
    let t = spacing - st.carry
    while (t <= dist) {
      const k = t / Math.max(dist, 1e-6)
      stamp(st.x + dx * k, st.y + dy * k, st.pressure + (pressure - st.pressure) * k)
      t += spacing
    }
    st.carry = dist - (t - spacing)
    st.x = x
    st.y = y
    st.pressure = pressure
  }

  /** Bucket fill of the composite's region under (x, y), onto the paint layer. */
  const fill = (x: number, y: number) => {
    const comp = composite()
    const ctx = paintCtx()
    if (!comp || !ctx) return
    const w = comp.width
    const h = comp.height
    const src = comp.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data
    const sx = Math.floor(x)
    const sy = Math.floor(y)
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return
    const at = (sy * w + sx) * 4
    const target = [src[at], src[at + 1], src[at + 2]]
    const tol = tolerance * tolerance * 3
    const seen = new Uint8Array(w * h)
    const out = ctx.createImageData(w, h)
    const [cr, cg, cb] = hexToRgb(color)
    const a = Math.round(255 * Math.min(1, flow + 0.4))
    const match = (i: number) => {
      const p = i * 4
      const dr = src[p] - target[0]
      const dg = src[p + 1] - target[1]
      const db = src[p + 2] - target[2]
      return dr * dr + dg * dg + db * db <= tol
    }
    // Scanline flood fill.
    const stack = [sy * w + sx]
    while (stack.length) {
      let i = stack.pop()!
      const row = Math.floor(i / w)
      while (i % w > 0 && !seen[i - 1] && match(i - 1)) i -= 1
      let up = false
      let down = false
      while (i < (row + 1) * w && !seen[i] && match(i)) {
        seen[i] = 1
        const p = i * 4
        out.data[p] = cr
        out.data[p + 1] = cg
        out.data[p + 2] = cb
        out.data[p + 3] = a
        if (row > 0) {
          const u = i - w
          if (!seen[u] && match(u)) {
            if (!up) {
              stack.push(u)
              up = true
            }
          } else up = false
        }
        if (row < h - 1) {
          const d = i + w
          if (!seen[d] && match(d)) {
            if (!down) {
              stack.push(d)
              down = true
            }
          } else down = false
        }
        i += 1
      }
    }
    const tmp = document.createElement("canvas")
    tmp.width = w
    tmp.height = h
    tmp.getContext("2d")!.putImageData(out, 0, 0)
    ctx.drawImage(tmp, 0, 0)
  }

  const pick = (x: number, y: number) => {
    const comp = composite()
    if (!comp) return
    const d = comp.getContext("2d", { willReadFrequently: true })!.getImageData(Math.floor(x), Math.floor(y), 1, 1).data
    setColor(rgbToHex(d[0], d[1], d[2]))
  }

  // --- pointer --------------------------------------------------------------

  const pressureOf = (e: ReactPointerEvent) => (e.pointerType === "pen" ? Math.max(0.05, e.pressure || 0.5) : 1)

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!size || rendering) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = toCanvas(e)
    if (tool === "picker") {
      pick(x, y)
      return
    }
    pushUndo()
    if (tool === "fill") {
      fill(x, y)
      return
    }
    const st = stroke.current
    Object.assign(st, { active: true, x, y, sx: x, sy: y, pressure: pressureOf(e), carry: 0 })
    if (tool === "smudge") {
      // The brush's load: the picture under it where the stroke starts.
      const d = Math.max(4, Math.round(radius * pixelsPerCss() * 2))
      const buf = document.createElement("canvas")
      buf.width = d
      buf.height = d
      const bctx = buf.getContext("2d")!
      const comp = composite()
      if (comp) bctx.drawImage(comp, x - d / 2, y - d / 2, d, d, 0, 0, d, d)
      // A soft round tip.
      bctx.globalCompositeOperation = "destination-in"
      const g = bctx.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2)
      g.addColorStop(0, "rgba(0,0,0,1)")
      g.addColorStop(Math.max(0.05, hardness), "rgba(0,0,0,0.9)")
      g.addColorStop(1, "rgba(0,0,0,0)")
      bctx.fillStyle = g
      bctx.fillRect(0, 0, d, d)
      st.smudge = buf
    }
    if (tool !== "tape") stamp(x, y, st.pressure)
    // The airbrush and the spray can keep going while held still.
    if (tool === "airbrush" || tool === "spray" || tool === "glow") {
      const tick = () => {
        if (!stroke.current.active) return
        stamp(stroke.current.x, stroke.current.y, stroke.current.pressure)
        stroke.current.raf = requestAnimationFrame(tick)
      }
      st.raf = requestAnimationFrame(tick)
    }
  }

  const moveCursor = (e: ReactPointerEvent) => {
    const el = cursorRef.current
    const wrap = wrapRef.current
    if (!el || !wrap) return
    const r = wrap.getBoundingClientRect()
    const d = tool === "picker" || tool === "fill" ? 10 : radius * 2 * (tool === "airbrush" ? 1.4 : tool === "glow" ? 1.6 : 1)
    el.style.width = el.style.height = `${d}px`
    el.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`
    el.style.opacity = "1"
  }

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    moveCursor(e)
    const st = stroke.current
    if (!st.active) return
    const [x, y] = toCanvas(e)
    if (tool === "tape") {
      const s = scratchCtx()
      const c = scratchRef.current
      if (!s || !c) return
      s.clearRect(0, 0, c.width, c.height)
      s.strokeStyle = color
      s.lineCap = "butt"
      s.lineWidth = Math.max(1, radius * pixelsPerCss())
      s.beginPath()
      s.moveTo(st.sx, st.sy)
      s.lineTo(x, y)
      s.stroke()
      st.x = x
      st.y = y
      return
    }
    // Coalesced events: every sample a fast pen produced, not one a frame.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    for (const ev of events) {
      const [cx, cy] = toCanvas(ev)
      strokeTo(cx, cy, e.pointerType === "pen" ? Math.max(0.05, ev.pressure || 0.5) : 1)
    }
  }

  const onUp = () => {
    const st = stroke.current
    if (!st.active) return
    st.active = false
    cancelAnimationFrame(st.raf)
    st.smudge = null
    if (tool === "marker" || tool === "tape") {
      // The scratch stroke lands as one even coat.
      const ctx = paintCtx()
      const c = scratchRef.current
      if (ctx && c) {
        ctx.save()
        ctx.globalAlpha = tool === "marker" ? Math.min(1, flow + 0.25) : Math.min(1, flow + 0.5)
        ctx.drawImage(c, 0, 0)
        ctx.restore()
        scratchCtx()?.clearRect(0, 0, c.width, c.height)
      }
    }
  }

  // Keys: tools, [ ] for size, Ctrl+Z / Ctrl+Y (Shift+Ctrl+Z).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return
      // While painting, the keys are the studio's: none reach the workshop's shortcuts.
      e.stopPropagation()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        step(e.shiftKey ? "redo" : "undo")
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault()
        step("redo")
        return
      }
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === "[") setRadius((r) => Math.max(1, Math.round(r / 1.2)))
      else if (e.key === "]") setRadius((r) => Math.min(240, Math.round(r * 1.2 + 1)))
      else {
        const found = TOOLS.find((x) => x.key === e.key.toLowerCase())
        if (found && !e.ctrlKey && !e.metaKey && !e.altKey) setTool(found.id)
      }
    }
    // The studio's own window: the workshop may be popped out into another.
    const win = wrapRef.current?.ownerDocument?.defaultView ?? window
    win.addEventListener("keydown", onKey, true)
    return () => win.removeEventListener("keydown", onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  // --- out --------------------------------------------------------------------

  const exportPng = () => composite()?.toDataURL("image/png") ?? null

  const save = () => {
    const url = exportPng()
    if (!url) return
    const a = document.createElement("a")
    a.href = url
    a.download = `paint-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.png`
    wrapRef.current?.ownerDocument.body.appendChild(a)
    a.click()
    a.remove()
  }

  const renderPainted = () => {
    const url = exportPng()
    if (!url) return
    const extra = direction.trim()
    const text =
      `The coloured paint on the part is its real paint job: render it as a ${finish} finish exactly where it is painted, ` +
      "airbrushed fades as smooth gradients, speckle as spray texture, tape lines as crisp masked edges, glow strokes as emitted light. " +
      "Unpainted areas keep a neutral printed finish. Studio product lighting." +
      (extra ? ` ${extra}` : "")
    onRender(url, text.slice(0, 600))
  }

  const toolInfo = TOOLS.find((t) => t.id === tool)!
  const showsHardness = tool === "brush" || tool === "eraser" || tool === "smudge"

  return (
    <div className="paint-studio" role="dialog" aria-label="Paint studio">
      <header className="paint-head">
        <span className="t-label flex items-center" style={{ gap: 6 }}>
          <PaintbrushIcon size={12} /> PAINT STUDIO
        </span>
        <span className="t-time truncate-1 paint-hint">{toolInfo.hint}</span>
        <span className="flex" style={{ gap: 4 }}>
          <button type="button" className="btn paint-icon" onClick={() => step("undo")} disabled={!undoCount} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Undo2Icon size={13} />
          </button>
          <button type="button" className="btn paint-icon" onClick={() => step("redo")} disabled={!redoCount} title="Redo (Ctrl+Y)" aria-label="Redo">
            <Redo2Icon size={13} />
          </button>
          <button type="button" className="btn paint-icon" onClick={() => setShowPaint((v) => !v)} title={showPaint ? "Hide the paint (compare)" : "Show the paint"} aria-label="Toggle the paint layer">
            {showPaint ? <EyeIcon size={13} /> : <EyeOffIcon size={13} />}
          </button>
          <button type="button" className="btn paint-icon" onClick={clear} title="Clear all paint" aria-label="Clear all paint">
            <Trash2Icon size={13} />
          </button>
          <button type="button" className="btn paint-icon" onClick={save} title="Save the painted picture as PNG" aria-label="Save PNG">
            <DownloadIcon size={13} />
          </button>
          <button type="button" className="btn paint-icon" onClick={onClose} title="Close the studio (Esc)" aria-label="Close the paint studio">
            <XIcon size={13} />
          </button>
        </span>
      </header>

      <div className="paint-body">
        <nav className="paint-tools" aria-label="Paint tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn paint-tool"
              data-active={tool === t.id}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
              title={t.hint}
            >
              {t.icon}
              <span className="paint-label">{t.label}</span>
            </button>
          ))}
        </nav>

        <div ref={wrapRef} className="paint-stage" onPointerLeave={() => cursorRef.current && (cursorRef.current.style.opacity = "0")}>
          {!size && <Loader2Icon size={18} className="animate-spin" style={{ color: "var(--accent)" }} />}
          <div className="paint-canvases" style={size ? { width: fit[0], height: fit[1] } : { display: "none" }}>
            <canvas ref={baseRef} className="paint-layer" />
            <canvas ref={paintRef} className="paint-layer" style={{ opacity: showPaint ? 1 : 0 }} />
            <canvas
              ref={scratchRef}
              className="paint-layer paint-input"
              style={{ opacity: tool === "marker" ? Math.min(1, flow + 0.25) : 1, cursor: tool === "picker" ? "copy" : "none" }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
          </div>
          <div ref={cursorRef} className="paint-cursor" aria-hidden />
          {rendering && (
            <div className="paint-busy t-label">
              <Loader2Icon size={14} className="animate-spin" /> RENDERING THE PAINT JOB...
            </div>
          )}
        </div>

        <aside className="paint-side" aria-label="Paint settings">
          <div className="t-time">PAINT</div>
          <div className="paint-swatches">
            {SWATCHES.map((s) => (
              <button
                key={s.hex}
                type="button"
                className="paint-swatch"
                data-active={color.toLowerCase() === s.hex}
                style={{ background: s.hex }}
                onClick={() => setColor(s.hex)}
                title={s.name}
                aria-label={s.name}
              />
            ))}
            <label className="paint-swatch paint-custom" title="Any colour" style={{ background: color }}>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom colour" />
            </label>
          </div>
          <Range label="SIZE" value={radius} min={1} max={240} step={1} unit=" px" onChange={setRadius} />
          <Range label={tool === "marker" || tool === "tape" || tool === "fill" ? "OPACITY" : "FLOW"} value={flow} min={0.02} max={1} step={0.01} unit="" pct onChange={setFlow} />
          {showsHardness && <Range label="HARDNESS" value={hardness} min={0} max={1} step={0.01} unit="" pct onChange={setHardness} />}
          {tool === "fill" && <Range label="TOLERANCE" value={tolerance} min={0} max={128} step={1} unit="" onChange={setTolerance} />}

          <div className="t-time" style={{ marginTop: 10 }}>FINISH</div>
          <select className="paint-select" value={finish} onChange={(e) => setFinish(e.target.value as Finish)} aria-label="Paint finish">
            {FINISHES.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
          <textarea
            className="paint-direction"
            rows={3}
            placeholder="Art direction (optional): workshop bench at night, rim light..."
            value={direction}
            maxLength={220}
            onChange={(e) => setDirection(e.target.value)}
          />
          <button type="button" className="btn paint-render" disabled={!size || rendering} onClick={renderPainted} title="Gemini renders the paint job as a real finish">
            {rendering ? <Loader2Icon size={13} className="animate-spin" /> : <SparklesIcon size={13} />} RENDER THE PAINT JOB
          </button>
          <p className="t-time" style={{ marginTop: 6, lineHeight: 1.5 }}>
            [ ] SIZE · CTRL+Z UNDO · PEN PRESSURE SETS SIZE
          </p>
        </aside>
      </div>
    </div>
  )
}

function Range({
  label,
  value,
  min,
  max,
  step,
  unit,
  pct,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  pct?: boolean
  onChange: (v: number) => void
}) {
  return (
    <label className="paint-range">
      <span className="t-time">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="t-time paint-value">{pct ? `${Math.round(value * 100)}%` : `${value}${unit}`}</span>
    </label>
  )
}
