"use client"

import { useMemo, useState } from "react"

import { PARTS, prop, type Project } from "@/lib/workshop/project/types"
import type { SimSnapshot } from "@/lib/workshop/sim/runner"

// The project's wiring, drawn: the UNO down the left, every other part
// down the right, and each net as its own coloured lane between them with
// a stub to every pin on it. Lanes are packed so nets that never overlap
// vertically share one. Hover a lane or a pin to light its whole net;
// while the simulation runs, UNO pins show HIGH/LOW and LEDs their glow.

const ROW = 15
const HEAD = 18
const GAP = 10
const UNO_W = 64
const PART_W = 132
const LANE = 7

const PALETTE = ["#4fd1ff", "#ffb84f", "#7cff7c", "#d68cff", "#ff8cc6", "#ffe36e", "#6ea8ff", "#58e0c4", "#ff9f6e", "#b4ff6e"]
const UNO_ORDER = [...Array.from({ length: 14 }, (_, i) => `D${i}`), ...Array.from({ length: 6 }, (_, i) => `A${i}`), "5V", "3V3", "VIN", "GND"]

interface PinSpot {
  ref: string
  x: number
  y: number
  side: "left" | "right"
}

export function Schematic({ project, sim }: { project: Project; sim: SimSnapshot | null }) {
  const [hover, setHover] = useState<number | null>(null)
  const width = 400

  const layout = useMemo(() => {
    // Nets by union-find over the wires.
    const parent = new Map<string, string>()
    const find = (r: string): string => {
      while (parent.get(r) !== r) r = parent.get(r)!
      return r
    }
    for (const part of project.parts) for (const pin of Object.keys(PARTS[part.type]?.pins ?? {})) parent.set(`${part.id}.${pin}`, `${part.id}.${pin}`)
    for (const w of project.wires) if (parent.has(w.a) && parent.has(w.b)) parent.set(find(w.a), find(w.b))
    const members = new Map<string, string[]>()
    for (const ref of parent.keys()) members.set(find(ref), [...(members.get(find(ref)) ?? []), ref])
    const wired = (ref: string) => (members.get(find(ref))?.length ?? 0) > 1

    const spots = new Map<string, PinSpot>()
    const blocks: { id: string; title: string; x: number; y: number; w: number; h: number; pins: string[]; side: "left" | "right"; type: string }[] = []

    // The controller on the left: the UNO, or an ESP32 board in its own pin order.
    const uno = project.parts.find((p) => PARTS[p.type]?.kind === "mcu")
    let leftH = 0
    if (uno) {
      const order = uno.type === "uno" ? UNO_ORDER : Object.keys(PARTS[uno.type]?.pins ?? {})
      const pins = order.filter((p) => wired(`${uno.id}.${p}`))
      const h = HEAD + Math.max(1, pins.length) * ROW + 6
      blocks.push({ id: uno.id, title: uno.type === "uno" ? uno.id : `${uno.id} · ${uno.type === "esp32" ? "ESP32" : "ESP32-S3"}`, x: 4, y: 4, w: UNO_W, h, pins, side: "right", type: uno.type })
      pins.forEach((p, i) => spots.set(`${uno.id}.${p}`, { ref: `${uno.id}.${p}`, x: 4 + UNO_W, y: 4 + HEAD + i * ROW + ROW / 2, side: "right" }))
      leftH = h + 8
    }

    let y = 4
    for (const part of project.parts) {
      const spec = PARTS[part.type]
      if (!spec || part.id === uno?.id || !spec.pins) continue
      const pins = Object.keys(spec.pins)
      const h = HEAD + pins.length * ROW + 6
      const x = width - PART_W - 4
      const detail =
        part.type === "resistor" ? `${prop(part, "ohms", 1000)} Ω` : part.type === "led" ? String(prop(part, "color", "red")) : spec.label
      blocks.push({ id: part.id, title: `${part.id} · ${detail}`, x, y, w: PART_W, h, pins, side: "left", type: part.type })
      pins.forEach((p, i) => spots.set(`${part.id}.${p}`, { ref: `${part.id}.${p}`, x, y: y + HEAD + i * ROW + ROW / 2, side: "left" }))
      y += h + GAP
    }
    const height = Math.max(leftH, y) + 4

    // Lanes: nets with two or more placed pins, packed by vertical span.
    const nets = [...members.values()]
      .map((refs) => refs.filter((r) => spots.has(r)))
      .filter((refs) => refs.length > 1)
      .map((refs) => {
        const ys = refs.map((r) => spots.get(r)!.y)
        return { refs, top: Math.min(...ys), bottom: Math.max(...ys) }
      })
      .sort((a, b) => a.top - b.top)
    const laneEnds: number[] = []
    const placed = nets.map((net) => {
      let lane = laneEnds.findIndex((end) => end < net.top - 4)
      if (lane < 0) {
        lane = laneEnds.length
        laneEnds.push(net.bottom)
      } else laneEnds[lane] = net.bottom
      const isGround = net.refs.some((r) => r.endsWith(".GND") || r.endsWith(".-"))
      const isPower = net.refs.some((r) => /\.(5V|3V3|VIN|12V|\+|VMOT|VCC|VDD|V\+)$/.test(r)) && !isGround
      return { ...net, lane, isGround, isPower }
    })
    const left = 4 + (uno ? UNO_W : 0) + 12
    const right = width - PART_W - 4 - 12
    const step = Math.min(LANE, (right - left) / Math.max(1, laneEnds.length))
    return {
      blocks,
      spots,
      height,
      nets: placed.map((n, i) => ({
        ...n,
        x: left + n.lane * step,
        color: n.isGround ? "#8a93a0" : n.isPower ? "#ff5a5a" : PALETTE[i % PALETTE.length],
      })),
    }
  }, [project])

  const pinLevel = (ref: string) => {
    const [, pin] = ref.split(".")
    return sim?.pins[pin]
  }
  const glow = new Map((sim?.parts ?? []).map((p) => [p.id, p.glow]))

  if (!project.parts.length) {
    return <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 8 }}>No parts yet. Ask Jarvis to design the circuit.</p>
  }

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${layout.height}`} style={{ display: "block", fontFamily: "var(--font-jetbrains), monospace" }}>
      {layout.nets.map((net, i) => {
        const lit = hover === null || hover === i
        return (
          <g key={i} opacity={lit ? 1 : 0.18} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <title>{net.refs.join(" · ")}</title>
            <line x1={net.x} x2={net.x} y1={net.top} y2={net.bottom} stroke={net.color} strokeWidth={hover === i ? 2.5 : 1.5} />
            {net.refs.map((ref) => {
              const s = layout.spots.get(ref)!
              return (
                <g key={ref}>
                  <line x1={s.x} x2={net.x} y1={s.y} y2={s.y} stroke={net.color} strokeWidth={hover === i ? 2.5 : 1.5} />
                  <circle cx={net.x} cy={s.y} r={2.2} fill={net.color} />
                </g>
              )
            })}
          </g>
        )
      })}
      {layout.blocks.map((b) => {
        const lit = glow.get(b.id)?.some((g) => g > 0.02)
        return (
          <g key={b.id}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={3}
              fill={b.type === "uno" ? "rgba(15,94,140,0.35)" : "rgba(5,10,20,0.85)"}
              stroke={lit ? "#ffe36e" : "rgba(var(--accent-rgb), 0.55)"}
              strokeWidth={lit ? 2 : 1}
            />
            <text x={b.x + 5} y={b.y + 12} fontSize={11} fill="var(--accent)">
              {b.title.length > 20 ? `${b.title.slice(0, 19)}…` : b.title}
            </text>
            {b.pins.map((pin, i) => {
              const s = layout.spots.get(`${b.id}.${pin}`)!
              const level = b.type === "uno" ? pinLevel(`${b.id}.${pin}`) : undefined
              return (
                <g key={pin}>
                  <text
                    x={b.side === "right" ? b.x + b.w - 5 : b.x + 5}
                    y={b.y + HEAD + i * ROW + ROW / 2 + 3.5}
                    fontSize={11}
                    textAnchor={b.side === "right" ? "end" : "start"}
                    fill="var(--text-primary)"
                  >
                    {pin}
                  </text>
                  {level && level.mode === "out" && (
                    <circle cx={b.x + 8} cy={s.y} r={3} fill={level.duty > 0.5 ? "#7cff7c" : level.duty > 0.02 ? "#ffd02a" : "#334"}>
                      <title>{`${pin}: ${level.volts.toFixed(2)} V, ${level.ma.toFixed(1)} mA${level.duty > 0.02 && level.duty < 0.98 ? `, ${(level.duty * 100).toFixed(0)}% PWM` : ""}`}</title>
                    </circle>
                  )}
                  {level && level.mode !== "out" && (
                    <rect x={b.x + 5} y={s.y - 3} width={6} height={6} fill="none" stroke={level.volts > 2.5 ? "#7cff7c" : "#556"}>
                      <title>{`${pin}: input${level.mode === "pullup" ? " (pull-up)" : ""}, ${level.volts.toFixed(2)} V`}</title>
                    </rect>
                  )}
                  <circle cx={s.x} cy={s.y} r={2.5} fill="var(--bg-base, #02050a)" stroke="var(--accent)" />
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}
