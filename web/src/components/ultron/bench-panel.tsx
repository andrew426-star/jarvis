"use client"

import { useBench, type BenchRun } from "@/lib/ultron/bench-store"
import { centralTime } from "@/lib/time"
import type { UltronAppProps } from "@/components/ultron/ultron-bay"

// U-03, the Bench: every calculation Ultron runs with his engineering tool
// (app/tools/engineering.py), newest first, as a readout - the joints of
// an arm against their servos, a project's rails against their supplies,
// a printed beam against its load, a review's failures in the order they
// would happen - with each verdict lit by how bad it is.

type Row = Record<string, unknown>
const num = (v: unknown) => (typeof v === "number" ? v : null)
const str = (v: unknown) => (typeof v === "string" ? v : "")

/** How bad a verdict reads: fails, marginal, or fine. */
function grade(text: string): "fault" | "blocked" | "done" {
  const t = text.toLowerCase()
  if (/fail|over|cannot|browns|brownout/.test(t)) return "fault"
  if (/marginal|tight|warn|creep|sag/.test(t)) return "blocked"
  return "done"
}

function Verdict({ text }: { text: string }) {
  const g = grade(text)
  return (
    <span className="flex items-start" style={{ gap: 8 }}>
      <span className="u-led" data-state={g} style={{ marginTop: 3 }} />
      <span style={{ fontSize: 12, lineHeight: 1.45, color: g === "fault" ? "var(--error)" : g === "blocked" ? "var(--warning)" : "var(--text-primary)" }}>{text}</span>
    </span>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col" style={{ gap: 2 }}>
      <span className="u-code" style={{ opacity: 0.7 }}>{label}</span>
      <span className="u-stencil" style={{ fontSize: 15, letterSpacing: "0.06em", color: "#fff" }}>{value}</span>
    </div>
  )
}

function Readout({ run }: { run: BenchRun }) {
  const r = run.result
  if (r.ok === false) return <Verdict text={`FAULT: ${str(r.error)}`} />
  if (run.op === "torque") {
    const joints = (r.joints as Row[]) ?? []
    return (
      <div className="flex flex-col" style={{ gap: 8 }}>
        {joints.map((j) => (
          <div key={String(j.joint)} className="grid items-start" style={{ gridTemplateColumns: "70px 1fr", gap: 10 }}>
            <span className="u-stencil">J{String(j.joint)}</span>
            <div className="flex flex-col" style={{ gap: 4 }}>
              <span className="u-code" style={{ letterSpacing: 0 }}>
                {num(j.static_kgcm)} kg-cm static · {num(j.needed_with_margin_kgcm)} with margin · reach {num(j.reach_cm)} cm
                {j.servo ? ` · ${str(j.servo)} (${num(j.servo_kgcm)} kg-cm, ${num(j.load_pct_of_stall)}% of stall)` : ""}
              </span>
              {!!j.verdict && <Verdict text={str(j.verdict)} />}
              {!!j.smallest_that_holds && <span className="u-code" style={{ letterSpacing: 0, opacity: 0.8 }}>SMALLEST THAT HOLDS: {str(j.smallest_that_holds)}</span>}
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (run.op === "beam") {
    return (
      <div className="flex flex-col" style={{ gap: 10 }}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
          <Figure label="STRESS" value={`${num(r.stress_mpa)} MPa`} />
          <Figure label="ALLOWABLE" value={`${num(r.allowable_mpa)} MPa`} />
          <Figure label="SAFETY" value={`${num(r.safety_factor)}x`} />
          <Figure label="TIP SAG" value={`${num(r.tip_deflection_mm)} mm`} />
          <Figure label="FOR 3X" value={`${num(r.thickness_for_3x_mm)} mm`} />
        </div>
        <span className="u-code" style={{ letterSpacing: 0 }}>{str(r.material).toUpperCase()} · {str(r.orientation)}</span>
        {!!r.verdict && <Verdict text={str(r.verdict)} />}
        {!!r.creep && <Verdict text={`creep: ${str(r.creep)}`} />}
        {!!r.print_it && <Verdict text={str(r.print_it)} />}
      </div>
    )
  }
  if (run.op === "power") {
    const rails = (r.rails as Row[]) ?? []
    const runtime = (r.battery_runtime as Row[]) ?? []
    return (
      <div className="flex flex-col" style={{ gap: 8 }}>
        {rails.map((rail, i) => {
          const cap = num(rail.capacity_ma) ?? 0
          const peak = num(rail.one_stalled_ma) ?? 0
          return (
            <div key={i} className="flex flex-col" style={{ gap: 4 }}>
              <div className="flex justify-between" style={{ gap: 8 }}>
                <span className="u-stencil" style={{ textTransform: "none" }}>{str(rail.source)}</span>
                <span className="u-code" style={{ letterSpacing: 0 }}>{num(rail.typical_ma)} mA typ · {peak} mA one stalled / {cap} mA</span>
              </div>
              <div className="u-gauge" style={{ "--fill": cap ? Math.min(1, peak / cap) : 0 } as React.CSSProperties} />
              {!!rail.verdict && <Verdict text={str(rail.verdict)} />}
            </div>
          )
        })}
        {runtime.map((b, i) => (
          <Verdict key={`b${i}`} text={`${str(b.battery)}: ${num(b.hours_typical)} h typical at ${num(b.cell_draw_ma)} mA${b.warning ? ` - ${str(b.warning)}` : ""}`} />
        ))}
        {((r.unpowered_loads as string[]) ?? []).map((p) => <Verdict key={p} text={`${p}: no supply reaches it`} />)}
      </div>
    )
  }
  if (run.op === "review") {
    const fails = (r.first_to_fail as Row[]) ?? []
    const cost = (r.cost as Row) ?? {}
    return (
      <div className="flex flex-col" style={{ gap: 8 }}>
        <span className="u-code" style={{ letterSpacing: 0 }}>
          {str(r.project)} · ${num(cost.estimated_total)?.toFixed(2) ?? "?"} estimated · {((r.printed_parts as string[]) ?? []).length} printed parts
        </span>
        {fails.length ? fails.map((f, i) => <Verdict key={i} text={`${i + 1}. ${str(f.where)}: ${str(f.what)}`} />) : <Verdict text="Nothing fails on the numbers. It survives me." />}
      </div>
    )
  }
  return <pre className="u-code" style={{ whiteSpace: "pre-wrap", letterSpacing: 0 }}>{JSON.stringify(r, null, 1).slice(0, 1500)}</pre>
}

export function BenchPanel({ onAsk }: UltronAppProps) {
  const runs = useBench((s) => s.runs)
  const clear = useBench((s) => s.clear)
  if (!runs.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center" style={{ gap: 14, minHeight: 320 }}>
        <span className="u-stencil" style={{ fontSize: 14, letterSpacing: "0.4em" }}>BENCH IDLE</span>
        <p style={{ maxWidth: 440, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
          Every figure Ultron computes lands here - torque at each joint, every rail&apos;s current, a printed part under load, a whole build reviewed - with what fails first.
        </p>
        <button type="button" className="u-btn" onClick={() => onAsk("Review the build on the bench with your engineering tool: what fails first?")}>
          REVIEW THE OPEN BUILD
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div className="flex items-center justify-between">
        <span className="u-code">{runs.length} RUN{runs.length > 1 ? "S" : ""} LOGGED</span>
        <button type="button" className="u-btn" onClick={clear}>PURGE LOG</button>
      </div>
      {runs.map((run, i) => {
        const inputs = Object.entries(run.args).filter(([k]) => k !== "operation" && k !== "op")
        return (
          <article key={run.id} className="u-plate relative" style={{ padding: "12px 16px 14px" }}>
            <header className="flex flex-wrap items-center justify-between" style={{ gap: 8, marginBottom: 10 }}>
              <span className="flex items-center" style={{ gap: 10 }}>
                <span className="u-hazard" style={{ width: 18, height: 10 }} />
                <span className="u-stencil">{run.op}</span>
                <span className="u-code">RUN {String(runs.length - i).padStart(3, "0")}</span>
              </span>
              <span className="u-code">{centralTime(new Date(run.at))}</span>
            </header>
            {inputs.length > 0 && (
              <p className="u-code" style={{ letterSpacing: 0, opacity: 0.75, margin: "0 0 10px", overflowWrap: "anywhere" }}>
                IN: {inputs.map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ").slice(0, 400)}
              </p>
            )}
            <Readout run={run} />
          </article>
        )
      })}
    </div>
  )
}
