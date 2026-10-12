"use client"

import { useEffect, useState } from "react"

import { getGallery, openProject } from "@/lib/jarvis-client"
import { sfx } from "@/lib/sfx"
import { useSpatial } from "@/lib/spatial-store"
import { useJarvis } from "@/lib/store"
import { STATUSES, type GalleryProject } from "@/lib/workshop/project/types"
import { useProject } from "@/lib/workshop/project/store"
import type { UltronAppProps } from "@/components/ultron/ultron-bay"

// U-02, the Legion: every build in the workshop as a unit of Ultron's
// fleet - how far along it is (idea to complete, as a five-stage rail), its
// faults, its controller, parts and cost - with the fleet's totals across
// the top. OPEN loads one onto the bench (the workshop); AUDIT has him
// take it apart with his engineering tool.

const STAGE: Record<string, string> = { idea: "CONCEPT", design: "DESIGN", simulate: "SIMULATION", build: "FABRICATION", complete: "OPERATIONAL" }

export function LegionPanel({ token, onAuthError, onAsk }: UltronAppProps) {
  const [units, setUnits] = useState<GalleryProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const openId = useProject((s) => s.project?.id)

  useEffect(() => {
    let live = true
    getGallery(token)
      .then((r) => {
        if (!live) return
        if (r.ok) setUnits(r.projects ?? [])
        else setError(r.error ?? "The fleet did not answer.")
      })
      .catch((err) => {
        if (!live) return
        if (String(err).includes("401")) onAuthError()
        setError(String(err))
      })
    return () => {
      live = false
    }
  }, [token, onAuthError])

  async function open(id: string) {
    setBusy(id)
    const r = await openProject(id, token).catch((err) => ({ ok: false as const, error: String(err) }))
    setBusy(null)
    if (!r.ok) {
      setError(r.error)
      return
    }
    sfx.click()
    useProject.getState().load(r.project, r.report)
    useJarvis.getState().setActiveTab(null)
    useSpatial.getState().setWorkshopOpen(true)
  }

  if (error) return <p className="u-code" style={{ color: "var(--warning)" }}>LEGION LINK FAULT · {error}</p>
  if (!units) {
    return (
      <div className="flex items-center" style={{ gap: 10, padding: 20 }}>
        <span className="u-led" data-state="active" />
        <span className="u-stencil">RAISING THE LEGION…</span>
      </div>
    )
  }

  const faults = units.filter((u) => u.errors > 0).length
  const operational = units.filter((u) => u.status === "complete").length
  const fabricating = units.filter((u) => u.status === "build").length
  const cost = units.reduce((sum, u) => sum + (u.estimated_total || 0), 0)

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      <section className="u-plate relative grid" style={{ padding: "14px 18px", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
        {[
          ["UNITS", `${units.length}`],
          ["OPERATIONAL", `${operational}`],
          ["IN FABRICATION", `${fabricating}`],
          ["FAULTS", `${faults}`],
          ["FLEET COST", `$${cost.toFixed(0)}`],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col" style={{ gap: 4 }}>
            <span className="u-code" style={{ opacity: 0.75 }}>{label}</span>
            <span className="u-stencil" style={{ fontSize: 22, letterSpacing: "0.08em", color: label === "FAULTS" && faults ? "var(--error)" : "#fff" }}>{value}</span>
          </div>
        ))}
      </section>

      <div className="grid" style={{ gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
        {units.map((u, i) => {
          const stage = Math.max(0, STATUSES.indexOf(u.status))
          return (
            <article key={u.id} className="u-plate relative flex flex-col" style={{ padding: "12px 14px 14px", gap: 9, boxShadow: u.id === openId ? "inset 0 0 0 1px var(--accent), 0 0 18px rgba(var(--accent-rgb), 0.35)" : undefined }}>
              <header className="flex items-center justify-between" style={{ gap: 8 }}>
                <span className="u-code">UNIT {String(i + 1).padStart(2, "0")}{u.board ? ` · ${u.board.toUpperCase()}` : ""}</span>
                <span className="u-led" data-state={u.errors ? "fault" : u.status === "complete" ? "done" : "active"} title={u.errors ? `${u.errors} fault(s)` : STAGE[u.status]} />
              </header>
              <h3 className="u-stencil" style={{ fontSize: 13, letterSpacing: "0.14em", margin: 0, textTransform: "none", lineHeight: 1.35 }}>{u.name}</h3>
              {u.goal && <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{u.goal}</p>}
              {/* The stages, idea to complete. */}
              <div className="flex" style={{ gap: 3 }} title={STAGE[u.status]}>
                {STATUSES.map((s, k) => (
                  <span key={s} style={{ flex: 1, height: 5, background: k <= stage ? "var(--accent)" : "#2a1314", boxShadow: k === stage ? "0 0 8px var(--accent)" : "none" }} />
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between" style={{ gap: 6 }}>
                <span className="u-code" style={{ color: "#fff" }}>{STAGE[u.status]}</span>
                <span className="u-code" style={{ opacity: 0.8 }}>
                  {u.parts.length} PARTS · {u.printed.length} PRINTED · ${(u.estimated_total || 0).toFixed(0)}
                </span>
              </div>
              {u.errors > 0 && <span className="u-code" style={{ color: "var(--error)" }}>{u.errors} FAULT{u.errors > 1 ? "S" : ""} ON RECORD</span>}
              <div className="flex" style={{ gap: 6, marginTop: 2 }}>
                <button type="button" className="u-btn flex-1" disabled={busy === u.id} onClick={() => void open(u.id)}>
                  {busy === u.id ? "LOADING" : u.id === openId ? "ON THE BENCH" : "OPEN"}
                </button>
                <button type="button" className="u-btn flex-1" onClick={() => onAsk(`Audit the ${u.name} build: open it, run your engineering review on it, and tell me what fails first and how to fix it.`)}>
                  AUDIT
                </button>
              </div>
            </article>
          )
        })}
      </div>
      {!units.length && <p className="u-code">NO UNITS. Ask Ultron to design the first.</p>}
    </div>
  )
}
