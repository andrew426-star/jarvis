"use client"

import { useRef, useState, useEffect } from "react"
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  CircuitBoardIcon,
  CodeIcon,
  CpuIcon,
  DownloadIcon,
  FileTextIcon,
  LayersIcon,
  Move3dIcon,
  Loader2Icon,
  PackageIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SaveIcon,
  SendIcon,
} from "lucide-react"

import { HoloViewer } from "@/components/workshop/holo-viewer"
import { STATUS_LABEL } from "@/components/workshop/project-gallery"
import { RigTab } from "@/components/workshop/rig-tab"
import { Schematic } from "@/components/workshop/schematic"
import { useJarvis } from "@/lib/store"
import { compileScadCached } from "@/lib/workshop/openscad"
import { partThumb, printedThumb } from "@/lib/workshop/project/part-thumbs"
import { useProject, type ProjectTab } from "@/lib/workshop/project/store"
import { PARTS, STATUSES, prop, type BomLine, type Part, type PrintedPart } from "@/lib/workshop/project/types"
import { isRunning, resetSim, sendSerial, setSimInput, setSimSpeed, startSim, stopSim } from "@/lib/workshop/sim/controller"

// The open project's folder, down the right edge of the workshop: the
// finished product, status, notes and files (OVERVIEW); every part by
// sub-assembly with what it costs and where to get it (PARTS); the wiring
// (CIRCUIT); the sketch (CODE); and the live simulation (SIM). Jarvis fills
// it through his project tool; the gallery opens any other project.

const TABS: { key: ProjectTab; label: string; icon: typeof CpuIcon }[] = [
  { key: "overview", label: "OVERVIEW", icon: FileTextIcon },
  { key: "parts", label: "PARTS", icon: PackageIcon },
  { key: "rig", label: "RIG", icon: Move3dIcon },
  { key: "circuit", label: "CIRCUIT", icon: CircuitBoardIcon },
  { key: "code", label: "CODE", icon: CodeIcon },
  { key: "sim", label: "SIM", icon: CpuIcon },
]

const LEVEL_COLOR = { error: "var(--error, #ff4d4d)", warning: "var(--warning)", note: "var(--text-secondary)" } as const

export const PANEL_WIDTH = 420

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "part"

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function ProjectPanel() {
  const project = useProject((s) => s.project)
  const open = useProject((s) => s.panelOpen)
  const tab = useProject((s) => s.tab)
  const setTab = useProject((s) => s.setTab)
  const setOpen = useProject((s) => s.setPanelOpen)
  const setGallery = useProject((s) => s.setGalleryOpen)
  const report = useProject((s) => s.report)

  if (!open || !project) {
    return (
      <button
        type="button"
        data-keepout
        className="btn absolute flex items-center"
        style={{ top: 12, right: 12, zIndex: 3, gap: 6, padding: "6px 10px" }}
        onClick={() => (project ? setOpen(true) : setGallery(true))}
        title={project ? "Open the project folder" : "Open the project gallery"}
      >
        {project ? <CpuIcon size={13} /> : <LayersIcon size={13} />} {project ? project.name.toUpperCase().slice(0, 28) : "PROJECTS"}
      </button>
    )
  }

  const errors = report?.checks.filter((c) => c.level === "error").length ?? 0

  return (
    <aside
      data-keepout
      className="holo-card flex flex-col"
      style={{ position: "absolute", top: 12, right: 12, bottom: 12, width: PANEL_WIDTH, zIndex: 3 }}
      aria-label="Project folder"
    >
      <header className="holo-card-header">
        <span className="t-label flex min-w-0 items-center" style={{ gap: 6 }}>
          <CpuIcon size={12} className="shrink-0" />
          <span className="truncate-1">{project.name.toUpperCase()}</span>
          <span className="t-time shrink-0">· {STATUS_LABEL[project.status] ?? ""}</span>
        </span>
        <span className="flex shrink-0" style={{ gap: 4 }}>
          <button
            type="button"
            className="btn"
            style={{ width: 20, height: 20, padding: 0 }}
            onClick={() => setGallery(true)}
            aria-label="Project gallery"
            title="All projects (gallery)"
          >
            <LayersIcon size={11} className="mx-auto" />
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 20, height: 20, padding: 0 }}
            onClick={() => setOpen(false)}
            aria-label="Collapse the project folder"
          >
            <ChevronRightIcon size={12} className="mx-auto" />
          </button>
        </span>
      </header>

      <nav className="flex shrink-0" style={{ gap: 3, padding: "6px var(--sp-2)", borderBottom: "1px solid rgba(var(--accent-rgb), 0.2)" }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className="btn flex flex-1 items-center"
            style={{ gap: 4, padding: "4px 0", letterSpacing: "0.04em" }}
            data-active={tab === key}
            onClick={() => setTab(key)}
            title={label}
          >
            <Icon size={11} /> {label}
            {key === "overview" && errors > 0 && <span style={{ color: LEVEL_COLOR.error }}>·{errors}</span>}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "var(--sp-2)" }}>
        {tab === "overview" && <OverviewTab />}
        {tab === "parts" && <PartsTab />}
        {tab === "rig" && <RigTab />}
        {tab === "circuit" && <CircuitTab />}
        {tab === "code" && <CodeTab />}
        {tab === "sim" && <SimTab />}
      </div>
    </aside>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="t-label" style={{ margin: "var(--sp-2) 0 6px", color: "var(--accent)", letterSpacing: "0.12em" }}>
      {children}
    </h3>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "4px 0" }}>{children}</p>
}


function OverviewTab() {
  const project = useProject((s) => s.project)!
  const version = useProject((s) => s.version)
  const report = useProject((s) => s.report)
  const saving = useProject((s) => s.saving)
  const save = useProject((s) => s.save)
  const [files, setFiles] = useState<string | null>(null)

  async function downloadPrinted() {
    setFiles("Compiling printed parts...")
    for (const part of project.printed) {
      try {
        const stl = await compileScadCached(part.code)
        download(`${slug(part.name)}.stl`, new Blob([stl.slice()], { type: "model/stl" }))
      } catch (err) {
        useJarvis.getState().notify("warning", `${part.name} did not compile`, String(err).slice(0, 160))
      }
      download(`${slug(part.name)}.scad`, new Blob([part.code], { type: "text/plain" }))
    }
    setFiles(null)
  }

  function downloadAll() {
    // The compiled HEX is the server's to rebuild; the rest is the project.
    const json = JSON.stringify(project, (key, value) => (key === "hex" || key === "compiled_code" ? undefined : value), 2)
    download(`${slug(project.name)}.json`, new Blob([json], { type: "application/json" }))
  }

  const b = report?.bom
  return (
    <>
      <HoloViewer project={project} version={version} />

      <div className="flex" style={{ gap: 3, margin: "8px 0" }} role="radiogroup" aria-label="Project status">
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={project.status === status}
            className="btn flex-1"
            style={{ padding: "3px 0", letterSpacing: "0.04em" }}
            data-active={project.status === status}
            disabled={saving}
            onClick={() => project.status !== status && void save({ status })}
          >
            {STATUS_LABEL[status]}
          </button>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 6 }}>
        <Stat label="PARTS" value={String(project.parts.length)} />
        <Stat label="PRINTED" value={String(project.printed.length)} />
        <Stat label="WIRES" value={String(project.wires.length)} />
        <Stat label="EST. COST" value={b ? `$${b.estimated_total.toFixed(2)}` : "-"} />
      </div>

      <Heading>GOAL</Heading>
      <EditableText key={`goal-${version}`} value={project.goal} rows={2} placeholder="What it is for." onSave={(goal) => save({ goal })} />

      <Heading>CHECKS</Heading>
      {!report ? (
        <Muted>Not checked yet.</Muted>
      ) : report.checks.length === 0 ? (
        <Muted>No problems found in the wiring or the sketch.</Muted>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {report.checks.map((c, i) => (
            <li key={i} className="flex" style={{ gap: 6, fontSize: 12, marginBottom: 5, lineHeight: 1.35 }}>
              <AlertTriangleIcon size={12} className="shrink-0" style={{ color: LEVEL_COLOR[c.level], marginTop: 2 }} />
              <span className="wrap-words" style={{ color: c.level === "note" ? "var(--text-secondary)" : "var(--text-primary)" }}>{c.text}</span>
            </li>
          ))}
        </ul>
      )}
      {report?.dropped.length ? (
        <>
          <Heading>NOT UNDERSTOOD</Heading>
          {report.dropped.map((d) => <Muted key={d}>{d}</Muted>)}
        </>
      ) : null}

      <Heading>NOTES</Heading>
      <EditableText
        key={`notes-${version}`}
        value={project.notes}
        rows={6}
        placeholder="Decisions, measurements, what was tried, what is left."
        onSave={(notes) => save({ notes })}
      />

      <Heading>FILES</Heading>
      <div className="flex flex-wrap" style={{ gap: 6 }}>
        <button type="button" className="btn flex items-center" style={{ gap: 4, padding: "3px 8px" }} disabled={!project.code} onClick={() => download(`${slug(project.name)}.ino`, new Blob([project.code], { type: "text/plain" }))}>
          <DownloadIcon size={11} /> SKETCH .INO
        </button>
        <button type="button" className="btn flex items-center" style={{ gap: 4, padding: "3px 8px" }} disabled={!b?.lines.length} onClick={() => b && download(`${slug(project.name)}-parts.csv`, bomCsv(b.lines, b.subtotal, b.estimated_total))}>
          <DownloadIcon size={11} /> PARTS .CSV
        </button>
        <button type="button" className="btn flex items-center" style={{ gap: 4, padding: "3px 8px" }} disabled={!project.printed.length || !!files} onClick={() => void downloadPrinted()}>
          {files ? <Loader2Icon size={11} className="animate-spin" /> : <DownloadIcon size={11} />} PRINTED .STL + .SCAD
        </button>
        <button type="button" className="btn flex items-center" style={{ gap: 4, padding: "3px 8px" }} onClick={downloadAll}>
          <DownloadIcon size={11} /> PROJECT .JSON
        </button>
      </div>
      {files && <Muted>{files}</Muted>}
    </>
  )
}

function bomCsv(lines: BomLine[], subtotal: number, total: number): Blob {
  const rows = [["Item", "Buy", "Unit", "Price", "Cost", "Where", "Part #", "For", "Link"]]
  for (const l of lines) rows.push([l.item, String(l.buy), l.unit, l.price.toFixed(2), l.cost.toFixed(2), l.where, l.part_number, l.for.join(" "), l.url ?? ""])
  rows.push(["Subtotal", "", "", "", subtotal.toFixed(2)], ["Estimated (campus with tax x1.13, online before shipping)", "", "", "", total.toFixed(2)])
  return new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" })
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="t-time">{label}</div>
      <div className="t-value" style={{ color: "var(--text-primary)", fontSize: 13 }}>{value}</div>
    </div>
  )
}

function EditableText({ value, rows, placeholder, onSave }: { value: string; rows: number; placeholder: string; onSave: (v: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const changed = draft !== value
  return (
    <div className="flex flex-col" style={{ gap: 4 }}>
      <textarea
        value={draft}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        style={{ resize: "vertical", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(var(--accent-rgb), 0.25)", color: "var(--text-primary)", fontSize: 12, lineHeight: 1.45, padding: 6, userSelect: "text" }}
      />
      {changed && (
        <button
          type="button"
          className="btn flex items-center self-end"
          style={{ gap: 4, padding: "2px 10px" }}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await onSave(draft)
            setBusy(false)
          }}
        >
          {busy ? <Loader2Icon size={11} className="animate-spin" /> : <SaveIcon size={11} />} SAVE
        </button>
      )}
    </div>
  )
}

/** A part's kind for the folder: electronics, hardware, or printed. */
function shelf(part: Part): "electronics" | "hardware" {
  return PARTS[part.type]?.kind === "mech" ? "hardware" : "electronics"
}

function describe(part: Part): string {
  const spec = PARTS[part.type]
  const bits = [part.label || spec?.label || part.type]
  if (part.type === "resistor") bits.push(`${prop(part, "ohms", 1000)} Ω`)
  if (part.type === "led") bits.push(String(prop(part, "color", "red")))
  if (prop<number | null>(part, "length", null)) bits.push(`${prop(part, "length", 0)} mm`)
  return bits.join(" · ")
}

/** A part's picture, drawn in 3D at a three-quarter view (part-thumbs.ts).
 *  Drawn once per mount: give it a key that changes with what it shows. */
function PartThumb({ load, alt, size = 52 }: { load: () => Promise<string | null>; alt: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const loadRef = useRef(load)
  useEffect(() => {
    let live = true
    void loadRef.current().then((url) => {
      if (!live) return
      setSrc(url)
      setFailed(!url)
    })
    return () => {
      live = false
    }
  }, [])
  return (
    <span
      className="flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size * 0.75,
        background: "radial-gradient(ellipse at 50% 60%, rgba(var(--accent-rgb), 0.14), rgba(0,0,0,0.35) 70%)",
        border: "1px solid rgba(var(--accent-rgb), 0.18)",
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL drawn in the browser
        <img src={src} alt={alt} title={alt} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      ) : failed ? (
        <PackageIcon size={14} style={{ color: "var(--text-secondary)" }} />
      ) : (
        <Loader2Icon size={12} className="animate-spin" style={{ color: "var(--text-secondary)" }} />
      )}
    </span>
  )
}

function PartsTab() {
  const project = useProject((s) => s.project)!
  const report = useProject((s) => s.report)
  const b = report?.bom
  const lineFor = (id: string) => b?.lines.find((l) => l.for.includes(id))

  // Sub-assemblies in the order they first appear; ungrouped things last.
  const names: string[] = []
  for (const x of [...project.parts, ...project.printed]) if (x.group && !names.includes(x.group)) names.push(x.group)
  const ungrouped = project.parts.some((p) => !p.group) || project.printed.some((p) => !p.group)
  const groups = [...names, ...(ungrouped ? [null] : [])]

  return (
    <>
      {groups.length === 0 && <Muted>No parts yet. Tell Jarvis what you want to build.</Muted>}
      {groups.map((group) => {
        const parts = project.parts.filter((p) => (p.group ?? null) === group)
        const printed = project.printed.filter((p) => (p.group ?? null) === group)
        const cost = parts.reduce((sum, p) => {
          const l = lineFor(p.id)
          return sum + (l ? l.cost / Math.max(1, l.for.length) : 0)
        }, 0)
        return (
          <section key={group ?? "_"} style={{ marginBottom: 10, border: "1px solid rgba(var(--accent-rgb), 0.18)", padding: "4px 8px 6px" }}>
            <div className="flex items-center justify-between">
              <Heading>
                <LayersIcon size={11} style={{ display: "inline", marginRight: 4 }} />
                {(group ?? (names.length ? "Everything else" : "All parts")).toUpperCase()}
              </Heading>
              <span className="t-time">≈ ${cost.toFixed(2)}</span>
            </div>
            {(["electronics", "hardware"] as const).map((kind) => {
              const list = parts.filter((p) => shelf(p) === kind)
              if (!list.length) return null
              return (
                <div key={kind}>
                  <div className="t-time" style={{ margin: "2px 0" }}>{kind.toUpperCase()}</div>
                  {list.map((p) => {
                    const l = lineFor(p.id)
                    return (
                      <div key={p.id} className="flex items-center" style={{ gap: 8, fontSize: 12, padding: "3px 0", borderBottom: "1px solid rgba(var(--accent-rgb), 0.08)" }}>
                        <PartThumb key={`${p.type}${JSON.stringify(p.props ?? {})}`} load={() => partThumb(p)} alt={describe(p)} />
                        <span className="t-label shrink-0" style={{ width: 44, color: "var(--accent)" }}>{p.id}</span>
                        <span className="min-w-0 flex-1">
                          <span className="wrap-words" style={{ color: "var(--text-primary)" }}>{describe(p)}</span>
                          <span className="t-time" style={{ display: "block" }}>{l ? `${l.where} · $${l.price.toFixed(2)} / ${l.unit}` : "Not stocked at Tech or online"}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {printed.length > 0 && (
              <div>
                <div className="t-time" style={{ margin: "2px 0" }}>PRINTED</div>
                {printed.map((p: PrintedPart) => (
                  <div key={p.name} className="flex items-center" style={{ gap: 8, fontSize: 12, padding: "3px 0", borderBottom: "1px solid rgba(var(--accent-rgb), 0.08)" }}>
                    <PartThumb key={`${p.material}${p.color}${p.color2}${p.texture}${p.code}`} load={() => printedThumb(p, compileScadCached)} alt={p.name} />
                    <span className="min-w-0 flex-1">
                      <span style={{ color: "var(--text-primary)" }}>{p.name}</span>
                      {p.notes.length > 0 && <span className="t-time" style={{ display: "block" }}>{p.notes.join(" · ")}</span>}
                    </span>
                    <button
                      type="button"
                      className="btn shrink-0"
                      style={{ width: 22, height: 22, padding: 0 }}
                      title="Download STL and SCAD"
                      aria-label={`Download ${p.name}`}
                      onClick={async () => {
                        try {
                          const stl = await compileScadCached(p.code)
                          download(`${slug(p.name)}.stl`, new Blob([stl.slice()], { type: "model/stl" }))
                        } catch (err) {
                          useJarvis.getState().notify("warning", `${p.name} did not compile`, String(err).slice(0, 160))
                        }
                        download(`${slug(p.name)}.scad`, new Blob([p.code], { type: "text/plain" }))
                      }}
                    >
                      <DownloadIcon size={11} className="mx-auto" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}

      <div className="flex items-center justify-between">
        <Heading>SHOPPING LIST</Heading>
        {b && b.lines.length > 0 && (
          <button type="button" className="btn flex items-center" style={{ gap: 4, padding: "2px 8px" }} onClick={() => download(`${slug(project.name)}-parts.csv`, bomCsv(b.lines, b.subtotal, b.estimated_total))}>
            <DownloadIcon size={11} /> CSV
          </button>
        )}
      </div>
      {!b || b.lines.length === 0 ? (
        <Muted>Nothing to buy yet.</Muted>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            {b.lines.map((l) => {
              const first = project.parts.find((p) => l.for.includes(p.id))
              return (
              <tr key={l.item + l.where} style={{ borderBottom: "1px solid rgba(var(--accent-rgb), 0.12)" }}>
                <td style={{ padding: "4px 6px 4px 0", verticalAlign: "top", width: 44 }}>
                  {first ? <PartThumb key={`${first.type}${JSON.stringify(first.props ?? {})}`} size={40} load={() => partThumb(first)} alt={l.item} /> : null}
                </td>
                <td style={{ padding: "4px 0", verticalAlign: "top" }}>
                  <div className="wrap-words" style={{ color: "var(--text-primary)" }}>{l.buy} × {l.item}</div>
                  <div className="t-time">
                    {l.where}
                    {l.part_number ? ` · ${l.part_number}` : ""}
                    {l.url ? (
                      <>
                        {" · "}
                        <a href={l.url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)", textDecoration: "underline" }}>
                          BUY
                        </a>
                      </>
                    ) : null}
                  </div>
                </td>
                <td className="t-label" style={{ padding: "4px 0 4px 8px", textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap" }}>${l.cost.toFixed(2)}</td>
              </tr>
              )
            })}
            <tr>
              <td />
              <td className="t-label" style={{ paddingTop: 6 }}>SUBTOTAL</td>
              <td className="t-label" style={{ paddingTop: 6, textAlign: "right" }}>${b.subtotal.toFixed(2)}</td>
            </tr>
            {b.online_subtotal ? (
              <tr>
                <td />
                <td className="t-time">CAMPUS ${(b.campus_subtotal ?? 0).toFixed(2)} · ONLINE ${b.online_subtotal.toFixed(2)} (+ SHIPPING)</td>
                <td />
              </tr>
            ) : null}
            <tr>
              <td />
              <td className="t-label" style={{ color: "var(--accent)" }}>{b.online_subtotal ? "ESTIMATED (CAMPUS ≈1.13× TAX + FEES)" : "WITH TAX + CARD FEES (≈1.13×)"}</td>
              <td className="t-label" style={{ textAlign: "right", color: "var(--accent)" }}>${b.estimated_total.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {b?.not_stocked.length ? (
        <>
          <Heading>NOT STOCKED (TECH OR ONLINE LIST)</Heading>
          {b.not_stocked.map((n) => <Muted key={n}>{n}</Muted>)}
        </>
      ) : null}
    </>
  )
}

function CircuitTab() {
  const project = useProject((s) => s.project)!
  const sim = useProject((s) => s.sim)
  return (
    <>
      <Schematic project={project} sim={sim} />
      <Muted>
        {project.wires.length} wires. Hover a lane to trace its net. To change the wiring, tell Jarvis what to move.
      </Muted>
    </>
  )
}

function CodeTab() {
  const version = useProject((s) => s.version)
  // A new copy from the server (Jarvis's edit, or this save) starts a fresh draft.
  return <CodeEditor key={version} />
}

function CodeEditor() {
  const project = useProject((s) => s.project)!
  const report = useProject((s) => s.report)
  const saving = useProject((s) => s.saving)
  const save = useProject((s) => s.save)
  const [draft, setDraft] = useState(project.code)
  const changed = draft !== project.code
  const compile = report?.compile

  return (
    <div className="flex h-full flex-col" style={{ gap: 6 }}>
      <div className="flex items-center justify-between">
        <span className="t-time">
          {compile?.skipped
            ? "ESP32 SKETCH · CHECKED · BUILD IN THE ARDUINO IDE"
            : compile?.ok
            ? `COMPILED · ${compile.flash_bytes ?? "?"} / 32256 B FLASH · ${compile.ram_bytes ?? "?"} / 2048 B RAM`
            : compile?.unavailable
              ? "NO COMPILER ON THIS SERVER"
              : project.code
                ? "NOT COMPILED"
                : "NO SKETCH YET"}
        </span>
        <button
          type="button"
          className="btn flex items-center"
          style={{ gap: 4, padding: "3px 10px" }}
          disabled={!changed || saving}
          onClick={() => void save({ code: draft })}
          title="Save the sketch; the server checks and compiles it"
        >
          {saving ? <Loader2Icon size={11} className="animate-spin" /> : <CodeIcon size={11} />} SAVE + COMPILE
        </button>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault()
            if (changed) void save({ code: draft })
          }
          if (e.key === "Tab") {
            e.preventDefault()
            const t = e.currentTarget
            const at = t.selectionStart
            setDraft(draft.slice(0, at) + "  " + draft.slice(t.selectionEnd))
            requestAnimationFrame(() => t.setSelectionRange(at + 2, at + 2))
          }
        }}
        placeholder="// The controller's sketch (UNO or ESP32). Ask Jarvis to write it, or write your own."
        style={{
          flex: 1,
          minHeight: 300,
          resize: "none",
          background: "rgba(0,0,0,0.45)",
          border: "1px solid rgba(var(--accent-rgb), 0.3)",
          color: "var(--text-primary)",
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: 12,
          lineHeight: 1.45,
          padding: 8,
          tabSize: 2,
          userSelect: "text",
          whiteSpace: "pre",
        }}
      />
      {compile && !compile.ok && compile.error && !compile.unavailable && (
        <pre
          className="wrap-words"
          style={{ margin: 0, maxHeight: 160, overflow: "auto", fontSize: 11, color: LEVEL_COLOR.error, whiteSpace: "pre-wrap", userSelect: "text" }}
        >
          {compile.error}
        </pre>
      )}
      {compile?.skipped && compile.note ? <Muted>{compile.note}</Muted> : null}
      {compile?.warnings?.length ? <Muted>{compile.warnings.join("\n")}</Muted> : null}
    </div>
  )
}

function SimTab() {
  const project = useProject((s) => s.project)!
  const sim = useProject((s) => s.sim)
  const [speed, setSpeed] = useState(1)
  const [line, setLine] = useState("")
  const serialRef = useRef<HTMLPreElement>(null)
  const running = sim?.running ?? false

  useEffect(() => {
    const el = serialRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sim?.serial])

  const inputs = project.parts.filter((p) =>
    ["button", "switch", "limit_switch", "hall", "pot", "photoresistor", "thermistor", "ping", "adxl335", "fuel_gauge"].includes(p.type)
  )

  return (
    <>
      <div className="flex items-center" style={{ gap: 6 }}>
        <button
          type="button"
          className="btn flex items-center"
          style={{ gap: 5, padding: "4px 12px" }}
          data-active={running}
          disabled={!project.hex}
          onClick={() => {
            if (isRunning()) stopSim()
            else {
              const error = startSim()
              if (error) useJarvis.getState().notify("warning", "Simulation", error)
            }
          }}
        >
          {running ? <PauseIcon size={12} /> : <PlayIcon size={12} />} {running ? "PAUSE" : "RUN"}
        </button>
        <button type="button" className="btn flex items-center" style={{ gap: 5, padding: "4px 10px" }} onClick={resetSim} title="Power-cycle: the sketch starts again from setup()">
          <RotateCcwIcon size={12} /> RESET
        </button>
        <select
          className="t-label"
          value={speed}
          onChange={(e) => {
            setSpeed(Number(e.target.value))
            setSimSpeed(Number(e.target.value))
          }}
          style={{ background: "rgba(0,0,0,0.4)", color: "var(--accent)", border: "1px solid rgba(var(--accent-rgb), 0.35)", padding: "3px 4px" }}
          aria-label="Simulation speed"
        >
          <option value={1}>1×</option>
          <option value={0.5}>0.5×</option>
          <option value={0.25}>0.25×</option>
          <option value={0.1}>0.1×</option>
        </select>
        <span className="t-time" style={{ marginLeft: "auto" }}>
          {sim ? `${sim.time_s.toFixed(2)} s${running && sim.speed < 0.95 ? ` · ${sim.speed.toFixed(2)}× REAL TIME` : ""}` : "STOPPED"}
        </span>
      </div>
      {!project.hex && <Muted>The sketch needs to compile before it can run (see CODE).</Muted>}
      {sim?.error && <p style={{ fontSize: 12, color: LEVEL_COLOR.error }}>{sim.error}</p>}

      {sim?.warnings.length ? (
        <>
          <Heading>LIVE WARNINGS</Heading>
          {sim.warnings.map((w) => (
            <p key={w} className="flex" style={{ gap: 6, fontSize: 12, margin: "0 0 4px", color: LEVEL_COLOR.warning }}>
              <AlertTriangleIcon size={12} className="shrink-0" style={{ marginTop: 2 }} /> {w}
            </p>
          ))}
        </>
      ) : null}

      {inputs.length > 0 && (
        <>
          <Heading>INPUTS</Heading>
          <div className="flex flex-col" style={{ gap: 6 }}>
            {inputs.map((part) => (
              <InputControl key={part.id} part={part} />
            ))}
          </div>
        </>
      )}

      <Heading>WHAT IT IS DOING</Heading>
      {sim?.parts.length ? (
        sim.parts.map((p) => (
          <p key={p.id} className="t-label" style={{ margin: "0 0 3px", color: "var(--text-primary)" }}>
            › {p.reading}
          </p>
        ))
      ) : (
        <Muted>Run it to see the parts respond.</Muted>
      )}

      <Heading>SERIAL MONITOR</Heading>
      <pre
        ref={serialRef}
        style={{
          margin: 0,
          height: 140,
          overflow: "auto",
          background: "rgba(0,0,0,0.5)",
          border: "1px solid rgba(var(--accent-rgb), 0.25)",
          padding: 6,
          fontSize: 11,
          fontFamily: "var(--font-jetbrains), monospace",
          color: "#9fe8ff",
          userSelect: "text",
          whiteSpace: "pre-wrap",
        }}
      >
        {sim?.serial || " "}
      </pre>
      <form
        className="flex"
        style={{ gap: 6, marginTop: 6 }}
        onSubmit={(e) => {
          e.preventDefault()
          sendSerial(line + "\n")
          setLine("")
        }}
      >
        <input
          className="t-label min-w-0 flex-1"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          placeholder="Send to the sketch's Serial..."
          style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(var(--accent-rgb), 0.35)", color: "var(--text-primary)", padding: "4px 8px", userSelect: "text" }}
        />
        <button type="submit" className="btn" style={{ width: 28, padding: 0 }} aria-label="Send">
          <SendIcon size={12} className="mx-auto" />
        </button>
      </form>
    </>
  )
}

function Slider({ label, min, max, step, value, unit, onChange }: {
  label: string
  min: number
  max: number
  step: number
  value: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center" style={{ gap: 8 }}>
      <span className="t-label shrink-0" style={{ width: 120 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1" />
      <span className="t-time shrink-0" style={{ width: 54, textAlign: "right" }}>
        {value}
        {unit}
      </span>
    </label>
  )
}

function InputControl({ part }: { part: Part }) {
  const [values, setValues] = useState<Record<string, number | boolean>>(() => ({
    pressed: Boolean(prop(part, "pressed", false)),
    on: Boolean(prop(part, "on", false)),
    magnet: Boolean(prop(part, "magnet", false)),
    value: Number(prop(part, "value", 0.5)),
    light: Number(prop(part, "light", 0.5)),
    temp_c: Number(prop(part, "temp_c", 25)),
    distance_cm: Number(prop(part, "distance_cm", 50)),
    percent: Number(prop(part, "percent", 76)),
    x_g: Number(prop(part, "x_g", 0)),
    y_g: Number(prop(part, "y_g", 0)),
    z_g: Number(prop(part, "z_g", 1)),
  }))
  const set = (key: string, value: number | boolean) => {
    setValues((v) => ({ ...v, [key]: value }))
    setSimInput(part.id, key, value)
  }
  const id = part.id

  switch (part.type) {
    case "button":
    case "limit_switch":
      return (
        <div className="flex items-center" style={{ gap: 8 }}>
          <span className="t-label" style={{ width: 120 }}>{id}</span>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 14px" }}
            data-active={values.pressed}
            onPointerDown={() => set("pressed", true)}
            onPointerUp={() => set("pressed", false)}
            onPointerLeave={() => values.pressed && set("pressed", false)}
          >
            HOLD TO PRESS
          </button>
          <button type="button" className="btn" style={{ padding: "4px 10px" }} onClick={() => set("pressed", !values.pressed)} title="Latch it pressed">
            {values.pressed ? "RELEASE" : "LATCH"}
          </button>
        </div>
      )
    case "switch":
    case "hall": {
      const key = part.type === "switch" ? "on" : "magnet"
      return (
        <div className="flex items-center" style={{ gap: 8 }}>
          <span className="t-label" style={{ width: 120 }}>{id}</span>
          <button type="button" className="btn" style={{ padding: "4px 14px" }} data-active={values[key]} onClick={() => set(key, !values[key])}>
            {part.type === "switch" ? (values.on ? "ON" : "OFF") : values.magnet ? "MAGNET NEAR" : "NO MAGNET"}
          </button>
        </div>
      )
    }
    case "pot":
      return <Slider label={`${id} KNOB`} min={0} max={1} step={0.01} value={values.value as number} unit="" onChange={(v) => set("value", v)} />
    case "photoresistor":
      return <Slider label={`${id} LIGHT`} min={0} max={1} step={0.01} value={values.light as number} unit="" onChange={(v) => set("light", v)} />
    case "thermistor":
      return <Slider label={`${id} TEMP`} min={-10} max={90} step={1} value={values.temp_c as number} unit=" °C" onChange={(v) => set("temp_c", v)} />
    case "ping":
      return <Slider label={`${id} DISTANCE`} min={2} max={300} step={1} value={values.distance_cm as number} unit=" cm" onChange={(v) => set("distance_cm", v)} />
    case "fuel_gauge":
      return <Slider label={`${id} BATTERY`} min={0} max={100} step={1} value={values.percent as number} unit=" %" onChange={(v) => set("percent", v)} />
    case "adxl335":
      return (
        <>
          {(["x_g", "y_g", "z_g"] as const).map((axis) => (
            <Slider key={axis} label={`${id} ${axis[0].toUpperCase()}`} min={-2} max={2} step={0.05} value={values[axis] as number} unit=" g" onChange={(v) => set(axis, v)} />
          ))}
        </>
      )
    default:
      return null
  }
}
