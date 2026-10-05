"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { FlaskConicalIcon, LampIcon, PlayIcon, SunMoonIcon, XIcon } from "lucide-react"

import { forFilament, MATERIALS, type LabMaterial } from "@/lib/workshop/lab/catalog"
import type { LabScene } from "@/lib/workshop/lab/lab-scene"
import { MAX_LANES, useLab } from "@/lib/workshop/lab/store"
import { AXES, TEST_LABEL, TESTS, type LabResult, type LabTest } from "@/lib/workshop/lab/tests"
import { useProject } from "@/lib/workshop/project/store"

// The material lab, over the workshop stage: pick materials (rubber, glass,
// metals, wood, every filament - or the ones the open project prints in),
// pick a test, run it, and watch them go through it side by side on the
// bench while their curves draw on the chart and the results come in.

const COLORS = ["#4fd1ff", "#ff7a45", "#7cf29a", "#ffd25a", "#c58bff", "#ff5d8f"]
const DURATION: Record<LabTest, number> = { tensile: 4, drop: 2.5, bend: 4, heat: 6 }
const FAMILIES = [...new Set(MATERIALS.map((m) => m.family))]

export function MaterialLab() {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<LabScene | null>(null)
  const drag = useRef<number | null>(null)
  const materials = useLab((s) => s.materials)
  const test = useLab((s) => s.test)
  const params = useLab((s) => s.params)
  const results = useLab((s) => s.results)
  const run = useLab((s) => s.run)
  const { toggle, setTest, setParams, start, setOpen, setMaterials } = useLab.getState()
  const project = useProject((s) => s.project)
  const [progress, setProgress] = useState(1)
  const [log, setLog] = useState(true)
  const light = useLab((s) => s.light)
  const uv = useLab((s) => s.uv)
  const setRoom = useLab((s) => s.setRoom)
  useEffect(() => sceneRef.current?.setLighting(light, uv), [light, uv])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    import("@/lib/workshop/lab/lab-scene").then(({ LabScene }) => {
      if (disposed) return
      sceneRef.current = new LabScene(host)
      sceneRef.current.setLighting(useLab.getState().light, useLab.getState().uv)
      const { results: last, ranTest: lastTest } = useLab.getState()
      if (last.length) {
        sceneRef.current.load(lastTest, last)
        sceneRef.current.setProgress(1)
      }
    })
    return () => {
      disposed = true
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [])

  // A run: load the lanes and play it through.
  useEffect(() => {
    if (!run) return
    const { results: now, ranTest: which } = useLab.getState()
    let raf = 0
    let cancelled = false
    const begin = () => {
      const scene = sceneRef.current
      if (!scene) {
        raf = requestAnimationFrame(begin)
        return
      }
      scene.load(which, now)
      const t0 = performance.now()
      const step = () => {
        if (cancelled) return
        const t = Math.min(1, (performance.now() - t0) / 1000 / DURATION[which])
        scene.setProgress(t)
        setProgress(t)
        if (t < 1) raf = requestAnimationFrame(step)
      }
      step()
    }
    begin()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [run])

  const shownTest = useLab((s) => s.ranTest)
  const fromProject = useMemo(() => {
    if (!project?.printed.length) return []
    return [...new Set(project.printed.map((p) => forFilament(p.material).id))]
  }, [project])

  const pill = { background: "rgba(2, 3, 6, 0.85)", border: "1px solid rgba(var(--accent-rgb), 0.25)", borderRadius: "var(--radius)" }

  return (
    <div className="absolute inset-0 flex flex-col" style={{ zIndex: 6, background: "#05080d" }}>
      <header className="relative flex flex-wrap items-center justify-between" style={{ padding: "10px 16px", gap: 10, borderBottom: "1px solid rgba(var(--accent-rgb), 0.25)" }}>
        <span className="t-header flex items-center" style={{ gap: 8, color: "var(--accent)" }}>
          <FlaskConicalIcon size={14} /> MATERIAL LAB
        </span>
        <div className="flex items-center" style={{ gap: 4 }} role="radiogroup" aria-label="Test">
          {TESTS.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={test === t} className="btn" data-active={test === t} style={{ padding: "4px 10px" }} onClick={() => setTest(t)}>
              {TEST_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          {test === "drop" && (
            <label className="t-label flex items-center" style={{ gap: 6 }}>
              HEIGHT
              <input type="range" min={0.1} max={3} step={0.1} value={params.dropHeight} onChange={(e) => setParams({ dropHeight: +e.target.value })} />
              <span className="t-time">{params.dropHeight.toFixed(1)} m</span>
            </label>
          )}
          {test === "heat" && (
            <label className="t-label flex items-center" style={{ gap: 6 }}>
              TO
              <input type="range" min={100} max={1200} step={50} value={params.maxTemp} onChange={(e) => setParams({ maxTemp: +e.target.value })} />
              <span className="t-time">{params.maxTemp} C</span>
            </label>
          )}
          <button
            type="button"
            className="btn flex items-center"
            style={{ gap: 6, padding: "4px 10px" }}
            onClick={() => setRoom({ light: light > 0.5 ? 0.3 : light > 0.1 ? 0.02 : 1 })}
            title="Room light: bright, dim, dark (glow-in-the-dark filament shows in the dark)"
          >
            <SunMoonIcon size={12} /> {light > 0.5 ? "BRIGHT" : light > 0.1 ? "DIM" : "DARK"}
          </button>
          <button type="button" className="btn flex items-center" style={{ gap: 6, padding: "4px 10px" }} data-active={uv} onClick={() => setRoom({ uv: !uv })} title="A UV (blacklight) lamp over the bench: UV-reactive filament fluoresces">
            <LampIcon size={12} /> UV LAMP
          </button>
          <button type="button" className="btn flex items-center" style={{ gap: 6, padding: "4px 14px" }} disabled={!materials.length} onClick={start} title="Run the test on every material on the bench">
            <PlayIcon size={12} /> RUN
          </button>
          <button type="button" className="btn" style={{ width: 28, height: 28, padding: 0 }} onClick={() => setOpen(false)} aria-label="Close the lab">
            <XIcon className="mx-auto size-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex shrink-0 flex-col overflow-y-auto" style={{ width: 230, padding: 12, gap: 10, borderRight: "1px solid rgba(var(--accent-rgb), 0.15)" }}>
          <span className="t-label">ON THE BENCH {materials.length}/{MAX_LANES}</span>
          {fromProject.length > 0 && (
            <button type="button" className="btn" style={{ padding: "4px 8px" }} onClick={() => setMaterials(fromProject)} title="The materials the open project's printed parts are printed in">
              {project?.name.toUpperCase()}&apos;S FILAMENTS
            </button>
          )}
          {FAMILIES.map((family) => (
            <div key={family} className="flex flex-col" style={{ gap: 4 }}>
              <span className="t-time">{family.toUpperCase()}</span>
              <div className="flex flex-wrap" style={{ gap: 4 }}>
                {MATERIALS.filter((m) => m.family === family).map((m) => {
                  const lane = materials.indexOf(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className="btn"
                      data-active={lane >= 0}
                      style={{ padding: "3px 7px", fontSize: 10, borderColor: lane >= 0 ? COLORS[lane] : undefined }}
                      onClick={() => toggle(m.id)}
                      title={m.note ?? m.name}
                    >
                      {m.name}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={hostRef}
            className="relative min-h-0 flex-1"
            style={{ cursor: "grab", touchAction: "none" }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = e.clientX
            }}
            onPointerMove={(e) => {
              if (drag.current === null) return
              sceneRef.current?.orbit(e.clientX - drag.current)
              drag.current = e.clientX
            }}
            onPointerUp={() => (drag.current = null)}
          >
            {!results.length && (
              <p className="t-label pointer-events-none absolute inset-0 m-auto flex items-center justify-center" style={{ color: "var(--text-secondary)" }}>
                PICK MATERIALS, PICK A TEST, RUN
              </p>
            )}
          </div>

          {results.length > 0 && (
            <div className="flex shrink-0" style={{ height: 250, gap: 12, padding: 12, borderTop: "1px solid rgba(var(--accent-rgb), 0.15)" }}>
              <div className="flex flex-col" style={{ flex: "1 1 45%", minWidth: 0, ...pill, padding: 8 }}>
                <div className="flex items-center justify-between">
                  <span className="t-label">{TEST_LABEL[shownTest]}</span>
                  {(shownTest === "tensile" || shownTest === "bend") && (
                    <button type="button" className="btn" data-active={log} style={{ padding: "1px 6px", fontSize: 10 }} onClick={() => setLog(!log)} title="Log scale: rubber and steel on one chart">
                      LOG
                    </button>
                  )}
                </div>
                <Chart results={results} test={shownTest} progress={progress} log={log && (shownTest === "tensile" || shownTest === "bend")} />
              </div>
              <div className="flex overflow-x-auto" style={{ flex: "1 1 55%", gap: 8 }}>
                {results.map((r, i) => (
                  <ResultCard key={r.material.id} result={r} color={COLORS[i]} done={r.breaksAt === null ? progress >= 1 : progress >= Math.min(1, r.breaksAt) || progress >= 1} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ResultCard({ result, color, done }: { result: LabResult; color: string; done: boolean }) {
  const m: LabMaterial = result.material
  return (
    <div className="flex shrink-0 flex-col" style={{ width: 210, padding: 8, gap: 6, background: "rgba(2, 3, 6, 0.85)", border: `1px solid ${color}`, borderRadius: "var(--radius)" }}>
      <span className="t-label" style={{ color }}>{m.name.toUpperCase()}</span>
      <span style={{ fontSize: 12, lineHeight: 1.35, color: "var(--text-primary)", opacity: done ? 1 : 0.35 }}>{result.verdict}</span>
      <dl className="m-0 grid" style={{ gridTemplateColumns: "1fr auto", gap: "2px 8px", fontSize: 11 }}>
        {result.figures.map(([k, v]) => (
          <div key={k} className="contents">
            <dt style={{ color: "var(--text-secondary)" }}>{k}</dt>
            <dd className="m-0" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v}</dd>
          </div>
        ))}
      </dl>
      {m.note && <span className="t-time">{m.note}</span>}
    </div>
  )
}

function Chart({ results, test, progress, log }: { results: LabResult[]; test: LabTest; progress: number; log: boolean }) {
  const W = 520
  const H = 180
  const pad = { l: 46, r: 8, t: 6, b: 22 }
  const all = results.flatMap((r) => r.curve)
  // A tensile run spans glass's 0.07 % to rubber's 650 %: log both axes.
  const logX = log && test === "tensile"
  const xMax = Math.max(1e-6, ...all.map((p) => p[0]))
  const xPos = all.map((p) => p[0]).filter((v) => v > 0)
  const xMin = logX ? Math.max(1e-4, Math.min(...xPos, xMax) / 2) : 0
  const yPos = all.map((p) => p[1]).filter((v) => v > 0)
  const yMax = Math.max(1e-6, ...all.map((p) => p[1]))
  const yMin = log ? Math.max(1e-3, Math.min(...yPos, yMax) / 2) : 0
  const sx = (x: number) => {
    const f = logX ? (Math.log10(Math.max(x, xMin)) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin) || 1) : x / xMax
    return pad.l + f * (W - pad.l - pad.r)
  }
  const sy = (y: number) => {
    const f = log ? (Math.log10(Math.max(y, yMin)) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin) || 1) : y / yMax
    return H - pad.b - f * (H - pad.t - pad.b)
  }
  const ticks = log
    ? Array.from({ length: Math.floor(Math.log10(yMax)) - Math.ceil(Math.log10(yMin)) + 1 }, (_, i) => 10 ** (Math.ceil(Math.log10(yMin)) + i))
    : [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax)
  const axis = AXES[test]
  const label = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toPrecision(1))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="min-h-0 w-full flex-1" preserveAspectRatio="none" role="img" aria-label={`${axis.y} against ${axis.x}`}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} stroke="rgba(255,255,255,0.08)" />
          <text x={pad.l - 4} y={sy(v) + 3} fontSize={9} textAnchor="end" fill="rgba(255,255,255,0.5)">{label(v)}</text>
        </g>
      ))}
      <text x={pad.l} y={H - 4} fontSize={9} fill="rgba(255,255,255,0.5)">{axis.x}{logX ? ` (LOG ${label(xMin)}–${label(xMax)})` : ` → ${label(xMax)}`}</text>
      <text x={W - pad.r} y={H - 4} fontSize={9} textAnchor="end" fill="rgba(255,255,255,0.5)">{axis.y}{log ? " (LOG)" : ""}</text>
      {results.map((r, i) => {
        const n = Math.max(2, Math.ceil(r.curve.length * progress))
        const pts = r.curve.slice(0, n).filter((p) => !logX || p[0] > 0)
        if (pts.length < 2) return null
        const d = pts.map((p, k) => `${k ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("")
        const end = pts[pts.length - 1]
        const broke = r.breaksAt !== null && progress >= 1 && test !== "drop" && test !== "heat"
        return (
          <g key={r.material.id}>
            <path d={d} fill="none" stroke={COLORS[i]} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
            {broke && <text x={sx(end[0])} y={sy(end[1]) - 4} fontSize={11} textAnchor="middle" fill={COLORS[i]}>×</text>}
          </g>
        )
      })}
    </svg>
  )
}
