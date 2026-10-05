"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  CircuitBoardIcon,
  CodeIcon,
  CpuIcon,
  DownloadIcon,
  FolderOpenIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SendIcon,
  ShoppingCartIcon,
} from "lucide-react"

import { Schematic } from "@/components/workshop/schematic"
import { listProjects, openProject, saveProject } from "@/lib/jarvis-client"
import { useJarvis } from "@/lib/store"
import { useProject, type ProjectTab } from "@/lib/workshop/project/store"
import { emptyProject, prop, type Part, type ProjectSummary } from "@/lib/workshop/project/types"
import { isRunning, resetSim, sendSerial, setSimInput, setSimSpeed, startSim, stopSim } from "@/lib/workshop/sim/controller"

// The workshop's project panel, down the right edge: what to buy and what
// is wrong (BUILD), the wiring (CIRCUIT), the sketch (CODE) and the live
// simulation (SIM). Jarvis fills it through his project tool; Andrew can
// edit the sketch and drive the simulation's inputs himself.

const TABS: { key: ProjectTab; label: string; icon: typeof CpuIcon }[] = [
  { key: "build", label: "BUILD", icon: ShoppingCartIcon },
  { key: "circuit", label: "CIRCUIT", icon: CircuitBoardIcon },
  { key: "code", label: "CODE", icon: CodeIcon },
  { key: "sim", label: "SIM", icon: CpuIcon },
]

const LEVEL_COLOR = { error: "var(--error, #ff4d4d)", warning: "var(--warning)", note: "var(--text-secondary)" } as const

export const PANEL_WIDTH = 420

export function ProjectPanel() {
  const project = useProject((s) => s.project)
  const open = useProject((s) => s.panelOpen)
  const tab = useProject((s) => s.tab)
  const setTab = useProject((s) => s.setTab)
  const setOpen = useProject((s) => s.setPanelOpen)
  const report = useProject((s) => s.report)
  const [picking, setPicking] = useState(false)

  if (!open || (!project && !picking)) {
    return (
      <button
        type="button"
        className="btn absolute flex items-center"
        style={{ top: 12, right: 12, zIndex: 3, gap: 6, padding: "6px 10px" }}
        onClick={() => {
          setOpen(true)
          if (!project) setPicking(true)
        }}
        title="Open the project panel"
      >
        <CpuIcon size={13} /> {project ? project.name.toUpperCase().slice(0, 28) : "PROJECTS"}
      </button>
    )
  }

  const errors = report?.checks.filter((c) => c.level === "error").length ?? 0

  return (
    <aside
      className="holo-card flex flex-col"
      style={{ position: "absolute", top: 12, right: 12, bottom: 12, width: PANEL_WIDTH, zIndex: 3 }}
      aria-label="Workshop project"
    >
      <header className="holo-card-header">
        <span className="t-label flex min-w-0 items-center" style={{ gap: 6 }}>
          <CpuIcon size={12} className="shrink-0" />
          <span className="truncate-1">{project ? project.name.toUpperCase() : "PROJECTS"}</span>
        </span>
        <span className="flex shrink-0" style={{ gap: 4 }}>
          <button
            type="button"
            className="btn"
            style={{ width: 20, height: 20, padding: 0 }}
            data-active={picking}
            onClick={() => setPicking((p) => !p)}
            aria-label="Open or start a project"
            title="Open or start a project"
          >
            <FolderOpenIcon size={11} className="mx-auto" />
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 20, height: 20, padding: 0 }}
            onClick={() => {
              setOpen(false)
              setPicking(false)
            }}
            aria-label="Collapse the project panel"
          >
            <ChevronRightIcon size={12} className="mx-auto" />
          </button>
        </span>
      </header>

      {picking || !project ? (
        <Picker onDone={() => setPicking(false)} />
      ) : (
        <>
          <nav className="flex shrink-0" style={{ gap: 4, padding: "6px var(--sp-2)", borderBottom: "1px solid rgba(var(--accent-rgb), 0.2)" }}>
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                className="btn flex flex-1 items-center"
                style={{ gap: 5, padding: "4px 0" }}
                data-active={tab === key}
                onClick={() => setTab(key)}
              >
                <Icon size={12} /> {label}
                {key === "build" && errors > 0 && <span style={{ color: LEVEL_COLOR.error }}>· {errors}</span>}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "var(--sp-2)" }}>
            {tab === "build" && <BuildTab />}
            {tab === "circuit" && <CircuitTab />}
            {tab === "code" && <CodeTab />}
            {tab === "sim" && <SimTab />}
          </div>
        </>
      )}
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

function Picker({ onDone }: { onDone: () => void }) {
  const token = useProject((s) => s.token)
  const load = useProject((s) => s.load)
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    listProjects(token)
      .then((r) => (r.ok ? setProjects(r.projects ?? []) : setError(r.error ?? "Could not list projects.")))
      .catch((err) => setError(String(err)))
  }, [token])

  async function pick(id: string) {
    if (!token) return
    setBusy(true)
    const r = await openProject(id, token).catch((err) => ({ ok: false as const, error: String(err) }))
    setBusy(false)
    if (r.ok) {
      load(r.project, r.report)
      onDone()
    } else setError(r.error)
  }

  async function create() {
    if (!token || !name.trim()) return
    setBusy(true)
    const r = await saveProject(emptyProject(name.trim()), token).catch((err) => ({ ok: false as const, error: String(err) }))
    setBusy(false)
    if (r.ok) {
      load(r.project, r.report)
      onDone()
    } else setError(r.error)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "var(--sp-2)" }}>
      <Heading>NEW PROJECT</Heading>
      <form
        className="flex"
        style={{ gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <input
          className="t-label min-w-0 flex-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Desk fan controller"
          style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(var(--accent-rgb), 0.35)", color: "var(--text-primary)", padding: "4px 8px", userSelect: "text" }}
        />
        <button type="submit" className="btn flex items-center" style={{ gap: 4, padding: "4px 10px" }} disabled={busy || !name.trim()}>
          <PlusIcon size={12} /> START
        </button>
      </form>
      <Muted>Or just tell Jarvis what you want to build.</Muted>
      <Heading>SAVED</Heading>
      {error && <Muted>{error}</Muted>}
      {!projects && !error && <Muted>Loading...</Muted>}
      {projects?.length === 0 && <Muted>None yet.</Muted>}
      <div className="flex flex-col" style={{ gap: 4 }}>
        {projects?.map((p) => (
          <button key={p.id} type="button" className="library-row" disabled={busy} onClick={() => void pick(p.id)}>
            <span className="t-label truncate-1 flex-1" style={{ color: "var(--text-primary)", textAlign: "left" }}>
              {p.name.toUpperCase()}
            </span>
            <span className="t-time shrink-0">{p.parts} PARTS</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function BuildTab() {
  const project = useProject((s) => s.project)!
  const report = useProject((s) => s.report)

  function downloadBom() {
    if (!report) return
    const rows = [["Item", "Buy", "Unit", "Price", "Cost", "Where", "Part #", "For"]]
    for (const l of report.bom.lines) rows.push([l.item, String(l.buy), l.unit, l.price.toFixed(2), l.cost.toFixed(2), l.where, l.part_number, l.for.join(" ")])
    rows.push(["Subtotal", "", "", "", report.bom.subtotal.toFixed(2)], ["Estimated with tax (x1.13)", "", "", "", report.bom.estimated_total.toFixed(2)])
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${project.name.replace(/[^a-z0-9]+/gi, "-")}-parts.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  return (
    <>
      {project.goal && <p style={{ fontSize: 12, margin: "0 0 6px", color: "var(--text-primary)" }}>{project.goal}</p>}
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
              <span className="wrap-words" style={{ color: c.level === "note" ? "var(--text-secondary)" : "var(--text-primary)" }}>
                {c.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      {report?.dropped.length ? (
        <>
          <Heading>NOT UNDERSTOOD</Heading>
          {report.dropped.map((d) => (
            <Muted key={d}>{d}</Muted>
          ))}
        </>
      ) : null}

      <div className="flex items-center justify-between">
        <Heading>PARTS TO BUY</Heading>
        {report && report.bom.lines.length > 0 && (
          <button type="button" className="btn flex items-center" style={{ gap: 4, padding: "2px 8px" }} onClick={downloadBom}>
            <DownloadIcon size={11} /> CSV
          </button>
        )}
      </div>
      {!report || report.bom.lines.length === 0 ? (
        <Muted>No parts yet.</Muted>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            {report.bom.lines.map((l) => (
              <tr key={l.item + l.where} style={{ borderBottom: "1px solid rgba(var(--accent-rgb), 0.12)" }}>
                <td style={{ padding: "4px 0", verticalAlign: "top" }}>
                  <div className="wrap-words" style={{ color: "var(--text-primary)" }}>
                    {l.buy} × {l.item}
                  </div>
                  <div className="t-time">
                    {l.where}
                    {l.part_number ? ` · ${l.part_number}` : ""}
                    {l.for.length ? ` · ${l.for.join(", ")}` : ""}
                  </div>
                </td>
                <td className="t-label" style={{ padding: "4px 0 4px 8px", textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap" }}>
                  ${l.cost.toFixed(2)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="t-label" style={{ paddingTop: 6 }}>SUBTOTAL</td>
              <td className="t-label" style={{ paddingTop: 6, textAlign: "right" }}>${report.bom.subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td className="t-label" style={{ color: "var(--accent)" }}>WITH TAX + CARD FEES (≈1.13×)</td>
              <td className="t-label" style={{ textAlign: "right", color: "var(--accent)" }}>${report.bom.estimated_total.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {report?.bom.not_stocked.length ? (
        <>
          <Heading>NOT STOCKED AT TECH</Heading>
          {report.bom.not_stocked.map((n) => (
            <Muted key={n}>{n}</Muted>
          ))}
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
          {compile?.ok
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
        placeholder="// The UNO sketch. Ask Jarvis to write it, or write your own."
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
    ["button", "switch", "limit_switch", "hall", "pot", "photoresistor", "thermistor", "ping", "adxl335"].includes(p.type)
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
