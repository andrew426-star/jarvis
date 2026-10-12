"use client"

import { useClock } from "@/lib/use-clock"
import { directiveProgress, useDirective, type StepStatus } from "@/lib/ultron/directive-store"
import type { UltronAppProps } from "@/components/ultron/ultron-bay"

// U-01, the Directive: what Ultron is driving on the engineering side and
// his plan for it (app/tools/directive.py) - the objective, the phases as a
// line of stations (lit as each completes), and every step with its status
// light. Andrew can move a step on himself by clicking its light.

const NEXT: Record<StepStatus, StepStatus> = { queued: "active", active: "done", done: "queued", blocked: "active" }
const LABEL: Record<StepStatus, string> = { queued: "QUEUED", active: "IN PROGRESS", done: "COMPLETE", blocked: "BLOCKED" }

function since(ms: number, now: number) {
  if (!now) return ""
  const m = Math.max(0, Math.round((now - ms) / 60000))
  if (m < 60) return `T+${m}M`
  const h = Math.floor(m / 60)
  return h < 48 ? `T+${h}H ${m % 60}M` : `T+${Math.floor(h / 24)}D`
}

export function DirectivePanel({ onAsk }: UltronAppProps) {
  const directive = useDirective((s) => s.directive)
  const flash = useDirective((s) => s.flash)
  const setStatus = useDirective((s) => s.setStatus)
  const now = useClock()

  if (!directive) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center" style={{ gap: 14, minHeight: 320 }}>
        <span className="u-led" data-state="active" />
        <span className="u-stencil" style={{ fontSize: 14, letterSpacing: "0.4em" }}>NO DIRECTIVE</span>
        <p style={{ maxWidth: 420, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
          Nothing is being driven. Give Ultron an objective - a build, a mechanism, a problem - and he lays out the plan here, phase by phase, and keeps it true as the work lands.
        </p>
        <button type="button" className="u-btn" onClick={() => onAsk("Look at my builds and propose the directive you would drive next: the objective and a phased plan. Set it.")}>
          PROPOSE A DIRECTIVE
        </button>
      </div>
    )
  }

  const { done, total } = directiveProgress(directive)
  const blocked = directive.phases.flatMap((p) => p.steps).filter((s) => s.status === "blocked").length
  const phaseDone = directive.phases.map((p) => p.steps.every((s) => s.status === "done"))
  const current = phaseDone.findIndex((d) => !d)

  return (
    <div className="flex flex-col" style={{ gap: 18 }}>
      {/* The objective. */}
      <section className="u-plate relative" style={{ padding: "16px 20px" }}>
        <div className="flex flex-wrap items-center justify-between" style={{ gap: 10 }}>
          <span className="u-code">PRIME DIRECTIVE{now ? ` · ${since(directive.since, now)}` : ""}</span>
          <span className="u-code" style={{ color: blocked ? "var(--warning)" : undefined }}>
            {done}/{total} STEPS{blocked ? ` · ${blocked} BLOCKED` : ""}
          </span>
        </div>
        <h2 className="u-stencil" style={{ fontSize: 20, letterSpacing: "0.12em", lineHeight: 1.35, margin: "10px 0 12px", textTransform: "none" }}>
          {directive.objective}
        </h2>
        <div className="u-gauge" style={{ "--fill": total ? done / total : 0 } as React.CSSProperties} />
      </section>

      {/* The phases as stations along a conduit. */}
      <div className="relative flex items-start" style={{ gap: 0, padding: "4px 6px" }}>
        {directive.phases.map((p, i) => (
          <div key={i} className="relative flex flex-1 flex-col items-center" style={{ gap: 6, minWidth: 0 }}>
            {i > 0 && (
              <div className="absolute" style={{ top: 9, right: "50%", width: "100%", height: 2, background: phaseDone[i - 1] ? "var(--accent)" : "rgba(var(--accent-rgb), 0.18)", boxShadow: phaseDone[i - 1] ? "0 0 8px var(--accent)" : "none" }} />
            )}
            <span
              className="relative"
              style={{
                width: 20,
                height: 20,
                transform: "rotate(45deg)",
                background: phaseDone[i] ? "var(--accent)" : i === current ? "rgba(var(--accent-rgb), 0.35)" : "#1d0d0e",
                boxShadow: `inset 0 0 0 1px ${i <= current || phaseDone[i] ? "var(--accent)" : "rgba(var(--accent-rgb), 0.3)"}${phaseDone[i] || i === current ? ", 0 0 12px rgba(var(--accent-rgb), 0.6)" : ""}`,
              }}
            />
            <span className="u-code truncate" style={{ maxWidth: "100%", color: i === current ? "#fff" : undefined }}>
              P{i + 1} · {p.name.toUpperCase()}
            </span>
          </div>
        ))}
      </div>

      {/* Every step. */}
      <div className="grid" style={{ gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {directive.phases.map((p, i) => (
          <section key={i} className="u-plate relative" style={{ padding: "12px 14px 14px" }}>
            <header className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <span className="u-stencil">{`P${i + 1} // ${p.name}`}</span>
              <span className="u-code">{p.steps.filter((s) => s.status === "done").length}/{p.steps.length}</span>
            </header>
            <ol className="flex flex-col" style={{ gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
              {p.steps.map((s, j) => {
                const lit = flash === `${i + 1}.${j + 1}`
                return (
                  <li
                    key={j}
                    className="flex items-start"
                    style={{
                      gap: 10,
                      padding: "6px 8px",
                      background: lit ? "rgba(var(--accent-rgb), 0.22)" : s.status === "active" ? "rgba(var(--accent-rgb), 0.07)" : "transparent",
                      boxShadow: s.status === "blocked" ? "inset 3px 0 0 var(--warning)" : s.status === "active" ? "inset 3px 0 0 var(--accent)" : "none",
                      transition: "background 300ms steps(4)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setStatus(i + 1, j + 1, NEXT[s.status])}
                      title={`${LABEL[s.status]} - click to move it on`}
                      aria-label={`Step ${j + 1}: ${LABEL[s.status]}. Move it on.`}
                      style={{ background: "transparent", border: 0, padding: "4px 0 0", cursor: "pointer" }}
                    >
                      <span className="u-led" data-state={s.status === "queued" ? undefined : s.status} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div style={{ fontSize: 13, lineHeight: 1.45, color: s.status === "done" ? "var(--text-secondary)" : "var(--text-primary)", textDecoration: s.status === "done" ? "line-through" : "none", textDecorationColor: "rgba(var(--accent-rgb), 0.6)" }}>
                        {s.text}
                      </div>
                      {s.note && <div className="u-code" style={{ marginTop: 3, color: s.status === "blocked" ? "var(--warning)" : "var(--text-secondary)", letterSpacing: 0 }}>{s.note}</div>}
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>

      <div className="flex flex-wrap" style={{ gap: 8 }}>
        <button type="button" className="u-btn" onClick={() => onAsk("Status of the directive: where does it stand, what is next, and what is blocking it?")}>
          STATUS REPORT
        </button>
        <button type="button" className="u-btn" onClick={() => onAsk("Advance the directive: take the active step, do the engineering for it now, and update the plan.")}>
          ADVANCE
        </button>
        <button type="button" className="u-btn" onClick={() => onAsk("Re-plan the directive from where it stands: what would you change, and why? Then set it.")}>
          RE-PLAN
        </button>
      </div>
    </div>
  )
}
