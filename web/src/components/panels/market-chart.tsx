"use client"

import { useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ExternalLinkIcon, MessageSquareIcon, XIcon } from "lucide-react"

import type { Candle, ChartAnnotation, MarketHistory } from "@/lib/jarvis-client"
import { TIME_ZONE } from "@/lib/time"
import { AnimatedValue, signedPct, usd } from "./hud-kit"

// The Markets panel's price chart: close as an area, volume underneath,
// the reference (previous close, or where the range opened) as a dashed
// line, and Jarvis's explanations pinned as numbered markers. Hover reads
// a bar exactly; click one to hold it and ask Jarvis why it looks that way.

type Asset = NonNullable<MarketHistory["asset_class"]>

const INTRADAY = new Set(["1Min", "5Min", "30Min", "1Hour"])

export function formatPrice(n: number, asset: Asset = "stock"): string {
  if (asset === "fx") return n.toFixed(n >= 20 ? 3 : 5)
  if (n < 1) return usd(n, 6)
  if (n < 10 && asset === "crypto") return usd(n, 4)
  return usd(n, 2)
}

function compactVolume(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 })
}

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, ...options })
const TIME = fmt({ hour: "2-digit", minute: "2-digit", hour12: false })
const DAY_TIME = fmt({ weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
const MONTH_DAY = fmt({ month: "short", day: "numeric" })
const FULL_INTRADAY = fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" })
// Daily bars are stamped at midnight Eastern; read them as their date, not a time.
const FULL_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", day: "numeric", month: "short", year: "numeric" })
const DAY_ONLY_MONTH_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })
const DAY_ONLY_MONTH_YEAR = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", year: "2-digit" })

function tickLabel(t: string, timeframe: string, range?: string): string {
  const d = new Date(t)
  if (timeframe === "1Min" || timeframe === "5Min") return TIME.format(d)
  if (timeframe === "30Min") return DAY_TIME.format(d)
  if (timeframe === "1Hour") return MONTH_DAY.format(d)
  return range === "1Y" ? DAY_ONLY_MONTH_YEAR.format(d) : DAY_ONLY_MONTH_DAY.format(d)
}

export function fullLabel(t: string, timeframe = "1Day"): string {
  return INTRADAY.has(timeframe) ? FULL_INTRADAY.format(new Date(t)) : FULL_DAY.format(new Date(t))
}

/** The bar nearest a moment, so a note made on one range sits right on another. */
function nearestBar(candles: Candle[], t: string): Candle | null {
  const target = new Date(t).getTime()
  let best: Candle | null = null
  let gap = Infinity
  for (const c of candles) {
    const d = Math.abs(new Date(c.t).getTime() - target)
    if (d < gap) {
      gap = d
      best = c
    }
  }
  return best
}

export function MarketChart({
  history,
  annotations,
  loading,
  onAsk,
}: {
  history: MarketHistory
  annotations: ChartAnnotation[]
  loading: boolean
  onAsk?: (question: string) => void
}) {
  const candles = useMemo(() => history.candles ?? [], [history.candles])
  const asset: Asset = history.asset_class ?? "stock"
  const timeframe = history.timeframe ?? "1Day"
  const [held, setHeld] = useState<number | null>(null)
  const [openNote, setOpenNote] = useState<number | null>(null)

  const stats = useMemo(() => {
    const last = candles[candles.length - 1]
    const ref = history.reference ?? candles[0]?.open ?? 0
    let high = candles[0]
    let low = candles[0]
    for (const c of candles) {
      if (c.high > high.high) high = c
      if (c.low < low.low) low = c
    }
    return {
      last: last?.close ?? 0,
      ref,
      change: last ? last.close - ref : 0,
      pct: ref ? ((last.close - ref) / ref) * 100 : 0,
      high,
      low,
      maxVolume: Math.max(1, ...candles.map((c) => c.volume)),
    }
  }, [candles, history.reference])

  // Notes pinned to this range's bars; ones outside it are left off.
  const pinned = useMemo(() => {
    if (!candles.length) return []
    const first = new Date(candles[0].t).getTime() - 86_400_000
    const last = new Date(candles[candles.length - 1].t).getTime() + 86_400_000
    return annotations
      .filter((a) => {
        const at = new Date(a.t).getTime()
        return at >= first && at <= last
      })
      .map((a) => ({ ...a, bar: nearestBar(candles, a.t) }))
      .filter((a): a is ChartAnnotation & { bar: Candle } => a.bar !== null)
  }, [annotations, candles])

  const up = stats.pct >= 0
  const color = up ? "var(--success)" : "var(--error)"
  const gradientId = `hist-${history.symbol.replace(/[^A-Za-z0-9]/g, "")}`
  const refLabel = history.range === "1D" ? "PREV CLOSE" : "OPEN"
  const heldBar = held !== null ? candles[held] : null
  const volumeShown = asset !== "fx"

  return (
    <div className="flex flex-col" style={{ gap: "var(--sp-2)", opacity: loading ? 0.5 : 1, transition: "opacity 200ms" }}>
      <div className="flex flex-wrap items-baseline justify-between" style={{ gap: "var(--sp-2)" }}>
        <div className="flex flex-wrap items-baseline" style={{ gap: "var(--sp-2)" }}>
          <span className="t-header text-glow" style={{ color: "var(--accent)" }}>
            {history.symbol}
          </span>
          <AnimatedValue value={stats.last} format={(n) => formatPrice(n, asset)} className="t-value" style={{ fontSize: 18 }} />
          <span className="t-label" style={{ color }}>
            {up ? "+" : "−"}
            {formatPrice(Math.abs(stats.change), asset).replace("$", asset === "fx" ? "" : "$")} ({signedPct(stats.pct)})
          </span>
          <span className="t-label" style={{ color: "var(--text-secondary)" }}>
            vs {refLabel.toLowerCase()} {formatPrice(stats.ref, asset)}
          </span>
        </div>
        <span className="t-label" style={{ color: "var(--text-secondary)" }}>
          H {formatPrice(stats.high.high, asset)}{" "}
          <span style={{ opacity: 0.7 }}>{tickLabel(stats.high.t, timeframe, history.range)}</span> · L{" "}
          {formatPrice(stats.low.low, asset)} <span style={{ opacity: 0.7 }}>{tickLabel(stats.low.t, timeframe, history.range)}</span>
        </span>
      </div>

      <motion.div
        key={`${history.symbol}-${history.range}-${candles.length}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <div className="h-[240px] @4xl:h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={candles}
              margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
              onClick={(state) => {
                const index = Number(state?.activeTooltipIndex)
                if (Number.isInteger(index) && index >= 0) setHeld(index === held ? null : index)
              }}
              style={{ cursor: "crosshair" }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(var(--accent-rgb), 0.08)" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={(t: string) => tickLabel(t, timeframe, history.range)}
                tick={{ fontSize: 10, fill: "var(--text-secondary)", fontFamily: "var(--font-jetbrains)" }}
                tickLine={false}
                axisLine={{ stroke: "rgba(var(--accent-rgb), 0.15)" }}
                minTickGap={40}
              />
              <YAxis
                yAxisId="price"
                orientation="right"
                domain={["auto", "auto"]}
                tickFormatter={(n: number) => formatPrice(n, asset).replace("$", "")}
                tick={{ fontSize: 10, fill: "var(--text-secondary)", fontFamily: "var(--font-jetbrains)" }}
                tickLine={false}
                axisLine={false}
                width={asset === "fx" ? 60 : 56}
              />
              {/* Volume on its own axis, scaled so it fills the bottom fifth. */}
              <YAxis yAxisId="volume" hide domain={[0, stats.maxVolume * 5]} />
              <Tooltip
                cursor={{ stroke: "rgba(var(--accent-rgb), 0.5)", strokeDasharray: "2 2" }}
                content={({ active, payload }) => (
                  <BarTooltip
                    active={active}
                    bar={payload?.[0]?.payload as Candle | undefined}
                    asset={asset}
                    timeframe={timeframe}
                    reference={stats.ref}
                  />
                )}
              />
              {volumeShown && (
                <Bar yAxisId="volume" dataKey="volume" fill="rgba(var(--accent-rgb), 0.18)" isAnimationActive={false} />
              )}
              <ReferenceLine
                yAxisId="price"
                y={stats.ref}
                stroke="rgba(var(--accent-rgb), 0.45)"
                strokeDasharray="4 4"
                label={{ value: refLabel, position: "insideTopLeft", fill: "var(--text-secondary)", fontSize: 9 }}
              />
              <Area
                yAxisId="price"
                type="linear"
                dataKey="close"
                stroke={color}
                fill={`url(#${gradientId})`}
                strokeWidth={1.5}
                animationDuration={700}
                activeDot={{ r: 3, stroke: color, fill: "var(--bg-base)" }}
              />
              {heldBar && (
                <ReferenceLine yAxisId="price" x={heldBar.t} stroke="var(--accent)" strokeOpacity={0.7} />
              )}
              {pinned.map((note, i) => (
                <ReferenceDot
                  key={`${note.t}-${i}`}
                  yAxisId="price"
                  x={note.bar.t}
                  y={note.bar.close}
                  r={8}
                  fill="var(--bg-base)"
                  stroke="var(--warning)"
                  strokeWidth={1.5}
                  label={{ value: String(i + 1), fill: "var(--warning)", fontSize: 9, fontWeight: 700 }}
                  onClick={() => setOpenNote(openNote === i ? null : i)}
                  style={{ cursor: "pointer" }}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      <div className="t-label flex flex-wrap justify-between" style={{ color: "var(--text-secondary)", gap: "var(--sp-2)" }}>
        <span>
          {candles.length} bars · {timeframe.replace("Min", "-min").replace("1Hour", "hourly").replace("1Day", "daily")}
          {asset === "stock" && INTRADAY.has(timeframe) ? " · regular session" : ""}
        </span>
        <span>{history.delayed_note ?? "Click the chart to hold a point"}</span>
      </div>

      {heldBar && (
        <div
          className="flex flex-wrap items-center"
          style={{
            gap: "var(--sp-2)",
            padding: "var(--sp-2) var(--sp-3)",
            border: "1px solid rgba(var(--accent-rgb), 0.3)",
            borderRadius: "var(--radius)",
            background: "rgba(10, 14, 26, 0.6)",
          }}
        >
          <BarReadout bar={heldBar} asset={asset} timeframe={timeframe} reference={stats.ref} />
          <div className="ml-auto flex" style={{ gap: "var(--sp-1)" }}>
            {onAsk && (
              <button
                type="button"
                className="btn"
                style={{ height: 26, padding: "0 var(--sp-2)" }}
                onClick={() =>
                  onAsk(
                    `Why does ${history.symbol} look the way it does at ${fullLabel(heldBar.t, timeframe)} on the ${history.range} chart? ` +
                      `Explain it and pin it on the chart. (Bar at ${heldBar.t})`
                  )
                }
              >
                <MessageSquareIcon className="size-3" /> ASK JARVIS WHY
              </button>
            )}
            <button type="button" className="btn btn-icon" style={{ width: 26, height: 26 }} aria-label="Let go of this point" onClick={() => setHeld(null)}>
              <XIcon className="size-3" />
            </button>
          </div>
        </div>
      )}

      {pinned.length > 0 && (
        <ol className="flex flex-col" style={{ gap: "var(--sp-1)" }}>
          {pinned.map((note, i) => (
            <li key={`${note.t}-${i}`}>
              <button
                type="button"
                onClick={() => setOpenNote(openNote === i ? null : i)}
                className="flex w-full cursor-pointer items-start text-left"
                style={{
                  gap: "var(--sp-2)",
                  padding: "var(--sp-2)",
                  border: `1px solid ${openNote === i ? "var(--warning)" : "rgba(var(--accent-rgb), 0.15)"}`,
                  borderRadius: "var(--radius)",
                  background: "rgba(10, 14, 26, 0.5)",
                }}
              >
                <span
                  className="t-label inline-flex shrink-0 items-center justify-center rounded-full"
                  style={{ width: 18, height: 18, border: "1px solid var(--warning)", color: "var(--warning)" }}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline" style={{ gap: "var(--sp-2)" }}>
                    <span style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 500 }}>{note.title}</span>
                    <span className="t-label" style={{ color: "var(--text-secondary)" }}>
                      {fullLabel(note.bar.t, timeframe)} · {formatPrice(note.bar.close, asset)}
                    </span>
                  </span>
                  {(openNote === i || pinned.length <= 2) && (
                    <span className="block" style={{ color: "var(--text-secondary)", fontSize: 12.5, lineHeight: 1.45, marginTop: 2 }}>
                      {note.note}
                      {note.source && (
                        <a
                          href={note.source}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1 inline-flex items-center"
                          style={{ color: "var(--accent)", gap: 2 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          source <ExternalLinkIcon className="size-3" />
                        </a>
                      )}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function BarReadout({ bar, asset, timeframe, reference }: { bar: Candle; asset: Asset; timeframe: string; reference: number }) {
  const pct = reference ? ((bar.close - reference) / reference) * 100 : 0
  const p = (n: number) => formatPrice(n, asset)
  return (
    <div className="t-label flex flex-col" style={{ gap: 2, color: "var(--text-secondary)" }}>
      <span style={{ color: "var(--text-primary)" }}>{fullLabel(bar.t, timeframe)}</span>
      <span>
        O {p(bar.open)} · H {p(bar.high)} · L {p(bar.low)} · C <span style={{ color: "var(--text-primary)" }}>{p(bar.close)}</span>
      </span>
      <span>
        <span style={{ color: pct >= 0 ? "var(--success)" : "var(--error)" }}>{signedPct(pct)}</span> vs reference
        {asset !== "fx" && bar.volume ? ` · Vol ${compactVolume(bar.volume)}` : ""}
      </span>
    </div>
  )
}

function BarTooltip({
  active,
  bar,
  asset,
  timeframe,
  reference,
}: {
  active?: boolean
  bar?: Candle
  asset: Asset
  timeframe: string
  reference: number
}) {
  if (!active || !bar) return null
  return (
    <div
      style={{
        padding: "6px 8px",
        background: "rgba(5, 5, 10, 0.95)",
        border: "1px solid rgba(var(--accent-rgb), 0.4)",
        borderRadius: 2,
        fontFamily: "var(--font-jetbrains)",
        fontSize: 11,
      }}
    >
      <BarReadout bar={bar} asset={asset} timeframe={timeframe} reference={reference} />
    </div>
  )
}
