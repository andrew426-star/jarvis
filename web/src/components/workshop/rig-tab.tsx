"use client"

import { useEffect, useState } from "react"
import { CableIcon, Loader2Icon, Move3dIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"

import { useProject } from "@/lib/workshop/project/store"
import { ARM_X, CONTROLLER, limitsOf, rigOf, type RigSegment } from "@/lib/workshop/project/rig"
import { editSegment, saveRigSoon, setRig } from "@/lib/workshop/project/rig-edit"
import { ANCHORS, type Anchor } from "@/lib/workshop/project/types"
import { JUMPER_MM } from "@/lib/workshop/project/wires3d"

// The open project's rig (lib/workshop/project/rig.ts): the pieces that
// move on their own. Pick one to put the stage's move gizmo on it; move
// it along X, Y and Z (the controller onto a mount off the build - the
// wires follow), set its joint and how far it is turned, and the body
// point it follows in the try-on (a gauntlet's hand plate on the hand
// while the bracer stays on the wrist). Every edit shows on the stage at
// once and saves a moment later.

const AXES = ["X", "Y", "Z"] as const
const AXIS_COLOR = ["#ff5a5a", "#5aff8c", "#5aa8ff"]
const JOINT_AXIS = ["ROLL (X)", "PITCH (Y)", "YAW (Z)"]
const ANCHOR_LABEL: Record<Anchor, string> = {
  face: "Face",
  chest: "Chest",
  shoulder: "Shoulder",
  upper_arm: "Upper arm",
  forearm: "Forearm",
  wrist: "Wrist",
  hand: "Hand",
  desk: "Desk",
}

const field = {
  background: "rgba(0,0,0,0.4)",
  border: "1px solid rgba(var(--accent-rgb), 0.35)",
  color: "var(--text-primary)",
  padding: "3px 6px",
  userSelect: "text" as const,
}

const v3 = (v?: number[]) => [v?.[0] ?? 0, v?.[1] ?? 0, v?.[2] ?? 0]

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="t-label" style={{ margin: "var(--sp-2) 0 6px", color: "var(--accent)", letterSpacing: "0.12em" }}>
      {children}
    </h3>
  )
}

/** Three millimetre fields with nudge buttons, X red, Y green, Z blue. */
function Vec({ value, onChange, step = 5 }: { value: number[]; onChange: (v: number[]) => void; step?: number }) {
  const set = (i: number, n: number) => onChange(value.map((x, j) => (j === i ? n : x)))
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
      {AXES.map((axis, i) => (
        <div key={axis} className="flex items-center" style={{ gap: 2 }}>
          <span className="t-label shrink-0" style={{ color: AXIS_COLOR[i], width: 12 }}>{axis}</span>
          <button type="button" className="btn shrink-0" style={{ width: 18, padding: 0 }} onClick={() => set(i, value[i] - step)} aria-label={`${axis} minus ${step} mm`}>−</button>
          <input
            className="t-label min-w-0 flex-1"
            type="number"
            step={0.5}
            value={Math.round(value[i] * 10) / 10}
            onChange={(e) => Number.isFinite(e.target.valueAsNumber) && set(i, e.target.valueAsNumber)}
            style={{ ...field, textAlign: "right", padding: "3px 2px" }}
            aria-label={`${axis} mm`}
          />
          <button type="button" className="btn shrink-0" style={{ width: 18, padding: 0 }} onClick={() => set(i, value[i] + step)} aria-label={`${axis} plus ${step} mm`}>+</button>
        </div>
      ))}
    </div>
  )
}

export function RigTab() {
  const project = useProject((s) => s.project)!
  const draft = useProject((s) => s.rigDraft) as RigSegment[] | null
  const editing = useProject((s) => s.rigEdit)
  const runs = useProject((s) => s.runs)
  const saving = useProject((s) => s.saving)
  const setEditing = useProject((s) => s.setRigEdit)
  const segments = draft ?? rigOf(project)
  const selected = segments.find((s) => s.name === editing) ?? null
  const main = project.wear?.anchor ?? null
  // The gizmo is for this tab: off when it closes.
  useEffect(() => () => useProject.getState().setRigEdit(null), [])

  const change = (name: string, fn: (s: RigSegment) => RigSegment) => {
    editSegment(name, fn)
    saveRigSoon()
  }

  return (
    <div>
      <p className="t-time" style={{ lineHeight: 1.5, margin: "2px 0 6px" }}>
        Parts that move on their own, each with its wiring attached. Pick one to drag it along the{" "}
        <span style={{ color: AXIS_COLOR[0] }}>X</span>, <span style={{ color: AXIS_COLOR[1] }}>Y</span> and{" "}
        <span style={{ color: AXIS_COLOR[2] }}>Z</span> arrows on the stage. Distances are in mm, in the layout&apos;s frame with Z up.
      </p>

      <Heading>SEGMENTS {saving && <Loader2Icon size={10} className="inline animate-spin" />}</Heading>
      {segments.length === 0 && <p className="t-time">No controller or segments yet. Add one below.</p>}
      <div className="flex flex-col" style={{ gap: 4 }}>
        {segments.map((s) => {
          const active = s.name === editing
          const depth = (() => {
            let d = 0
            for (let p = s.parent; p && d < 6; p = segments.find((x) => x.name === p)?.parent) d += 1
            return d
          })()
          return (
            <button
              key={s.name}
              type="button"
              className="btn flex items-center text-left"
              data-active={active}
              aria-pressed={active}
              onClick={() => setEditing(active ? null : s.name)}
              style={{ gap: 8, padding: "5px 8px", marginLeft: depth * 14 }}
              title={active ? "Take the move gizmo off it" : "Put the move gizmo on it"}
            >
              <Move3dIcon size={12} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="t-label" style={{ color: "var(--text-primary)" }}>{s.name.toUpperCase()}</span>
                <span className="t-time" style={{ display: "block" }}>
                  {s.members.join(", ") || "no members"}
                </span>
              </span>
              <span className="t-time shrink-0" style={{ textAlign: "right" }}>
                {s.anchor ? `TRACKS ${ANCHOR_LABEL[s.anchor].toUpperCase()}` : s.parent ? `ON ${s.parent.toUpperCase()}` : "WITH BUILD"}
                {s.auto && <span style={{ display: "block", color: "var(--accent)" }}>SUGGESTED</span>}
              </span>
            </button>
          )
        })}
      </div>

      {selected && <SegmentEditor key={selected.name} segment={selected} segments={segments} main={main} change={change} />}

      <NewSegment segments={segments} />

      <Heading>
        <CableIcon size={11} className="inline" /> WIRE RUNS
      </Heading>
      <Runs runs={runs} />
    </div>
  )
}

function SegmentEditor({
  segment: s,
  segments,
  main,
  change,
}: {
  segment: RigSegment
  segments: RigSegment[]
  main: Anchor | null
  change: (name: string, fn: (s: RigSegment) => RigSegment) => void
}) {
  const limits = limitsOf(s)
  const pose = v3(s.pose)
  const descendants = (name: string): string[] => segments.filter((x) => x.parent === name).flatMap((x) => [x.name, ...descendants(x.name)])
  const parents = segments.filter((x) => x.name !== s.name && !descendants(s.name).includes(x.name))
  const remove = () => {
    setRig(segments.filter((x) => x.name !== s.name).map((x) => (x.parent === s.name ? { ...x, parent: s.parent } : x)))
    useProject.getState().setRigEdit(null)
    saveRigSoon(100)
  }
  // Where its own anchor sits, from the main one along the arm: the move
  // that puts it there.
  const restX = s.anchor && main && ARM_X[s.anchor] !== undefined && ARM_X[main] !== undefined ? ARM_X[s.anchor]! - ARM_X[main]! : null

  return (
    <section style={{ marginTop: 8, border: "1px solid rgba(var(--accent-rgb), 0.25)", padding: "4px 8px 8px" }}>
      <div className="flex items-center justify-between">
        <span className="t-label" style={{ color: "var(--accent)" }}>{s.name.toUpperCase()}</span>
        <span className="flex" style={{ gap: 4 }}>
          <button type="button" className="btn flex items-center" style={{ gap: 4, padding: "2px 8px" }} onClick={() => change(s.name, (x) => ({ ...x, move: [0, 0, 0], pose: [0, 0, 0] }))} title="Back where the layout puts it, joint straight">
            <RotateCcwIcon size={11} /> RESET
          </button>
          <button type="button" className="btn flex items-center" style={{ gap: 4, padding: "2px 8px" }} onClick={remove} title="Remove the segment (its parts go back to riding with the build)">
            <Trash2Icon size={11} />
          </button>
        </span>
      </div>

      <Heading>MOVE (MM)</Heading>
      <Vec value={v3(s.move)} onChange={(move) => change(s.name, (x) => ({ ...x, move }))} />
      {s.name === CONTROLLER && (
        <p className="t-time" style={{ marginTop: 4, lineHeight: 1.45 }}>
          Move the board where its mount will be. Wires longer than a {JUMPER_MM / 10} cm jumper need a longer lead or a splice.
        </p>
      )}

      <Heading>JOINT PIVOT (MM)</Heading>
      <Vec value={v3(s.pivot)} onChange={(pivot) => change(s.name, (x) => ({ ...x, pivot }))} />

      <Heading>JOINT ANGLE</Heading>
      <div className="flex flex-col" style={{ gap: 4 }}>
        {JOINT_AXIS.map((label, i) => (
          <label key={label} className="flex items-center" style={{ gap: 8 }}>
            <span className="t-label shrink-0" style={{ width: 70, color: AXIS_COLOR[i] }}>{label}</span>
            <input
              type="range"
              min={limits[i][0]}
              max={limits[i][1]}
              step={1}
              value={Math.max(limits[i][0], Math.min(limits[i][1], pose[i]))}
              onChange={(e) => change(s.name, (x) => ({ ...x, pose: pose.map((p, j) => (j === i ? Number(e.target.value) : p)) }))}
              className="min-w-0 flex-1"
            />
            <span className="t-time shrink-0" style={{ width: 70, textAlign: "right" }}>
              {pose[i]}° <span style={{ opacity: 0.6 }}>({limits[i][0]}…{limits[i][1]})</span>
            </span>
          </label>
        ))}
      </div>

      <Heading>HANGS FROM</Heading>
      <select
        className="t-label w-full"
        value={s.parent ?? ""}
        onChange={(e) => change(s.name, (x) => ({ ...x, parent: e.target.value || undefined }))}
        style={{ ...field, color: "var(--accent)" }}
        aria-label="Parent segment"
      >
        <option value="">The build itself</option>
        {parents.map((p) => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </select>

      <Heading>TRY-ON TRACKING</Heading>
      <select
        className="t-label w-full"
        value={s.anchor ?? ""}
        onChange={(e) => change(s.name, (x) => ({ ...x, anchor: (e.target.value || undefined) as Anchor | undefined }))}
        style={{ ...field, color: "var(--accent)" }}
        aria-label="Body point it follows in the try-on"
      >
        <option value="">Rides with {s.parent ?? "the build"}</option>
        {ANCHORS.filter((a) => a !== main).map((a) => (
          <option key={a} value={a}>Follows the {ANCHOR_LABEL[a].toLowerCase()} on its own</option>
        ))}
      </select>
      {s.anchor && (
        <p className="t-time" style={{ marginTop: 4, lineHeight: 1.45 }}>
          In the try-on it follows the {ANCHOR_LABEL[s.anchor].toLowerCase()} while the build stays on the {main ? ANCHOR_LABEL[main].toLowerCase() : "main anchor"}, and its wires stretch between them.
          {restX !== null && ` The ${ANCHOR_LABEL[s.anchor].toLowerCase()} sits about ${restX} mm along X from the build's origin.`}
          {restX !== null && Math.abs(v3(s.move)[0]) < 1 && s.name === CONTROLLER && (
            <button type="button" className="btn" style={{ marginLeft: 6, padding: "0 6px" }} onClick={() => change(s.name, (x) => ({ ...x, move: [restX, 0, 45] }))}>
              MOVE IT THERE
            </button>
          )}
        </p>
      )}
    </section>
  )
}

function NewSegment({ segments }: { segments: RigSegment[] }) {
  const project = useProject((s) => s.project)!
  const [name, setName] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const groups = [...new Set([...project.parts, ...project.printed].map((p) => p.group).filter(Boolean) as string[])]
  const choices = [
    ...groups.map((g) => ({ key: g, label: `${g} (group)` })),
    ...project.parts.map((p) => ({ key: p.id, label: `${p.id} · ${p.label ?? p.type}` })),
    ...project.printed.map((p) => ({ key: p.name, label: `${p.name} (printed)` })),
  ]
  const taken = new Set(segments.map((s) => s.name.toLowerCase()))
  const clean = name.trim().slice(0, 40)
  const ok = clean && !taken.has(clean.toLowerCase()) && picked.length > 0

  function add() {
    if (!ok) return
    // Members leave whatever segment held them.
    const without = segments.map((s) => ({ ...s, members: s.members.filter((m) => !picked.includes(m)) }))
    setRig([...without, { name: clean, members: picked }])
    useProject.getState().setRigEdit(clean)
    saveRigSoon(100)
    setName("")
    setPicked([])
  }

  return (
    <>
      <Heading>NEW SEGMENT</Heading>
      <div className="flex" style={{ gap: 6 }}>
        <input className="t-label min-w-0 flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Hand or Belt mount" style={field} />
        <button type="button" className="btn flex items-center" style={{ gap: 4, padding: "2px 10px" }} disabled={!ok} onClick={add}>
          <PlusIcon size={11} /> ADD
        </button>
      </div>
      <div className="flex flex-wrap" style={{ gap: 4, marginTop: 6 }}>
        {choices.map((c) => {
          const on = picked.includes(c.key)
          return (
            <button
              key={c.key}
              type="button"
              className="btn"
              data-active={on}
              aria-pressed={on}
              style={{ padding: "1px 6px", fontSize: 11 }}
              onClick={() => setPicked((p) => (on ? p.filter((k) => k !== c.key) : [...p, c.key]))}
            >
              {c.label}
            </button>
          )
        })}
      </div>
    </>
  )
}

function Runs({ runs }: { runs: { wire: string; mm: number }[] }) {
  if (!runs.length) return <p className="t-time">No wires yet.</p>
  const sorted = [...runs].sort((a, b) => b.mm - a.mm)
  const long = sorted.filter((r) => r.mm > JUMPER_MM)
  return (
    <>
      <p className="t-time" style={{ marginBottom: 4 }}>
        {long.length
          ? `${long.length} run${long.length > 1 ? "s" : ""} longer than a ${JUMPER_MM / 10} cm jumper: use longer leads, or crimp and splice.`
          : `Every run fits a ${JUMPER_MM / 10} cm jumper.`}
      </p>
      <table className="w-full" style={{ borderCollapse: "collapse", fontSize: 12 }}>
        <tbody>
          {sorted.slice(0, 8).map((r) => (
            <tr key={r.wire} style={{ borderBottom: "1px solid rgba(var(--accent-rgb), 0.08)" }}>
              <td className="wrap-words" style={{ padding: "2px 0", color: "var(--text-primary)" }}>{r.wire}</td>
              <td className="t-label" style={{ textAlign: "right", whiteSpace: "nowrap", color: r.mm > JUMPER_MM ? "var(--warning)" : undefined }}>
                {Math.round(r.mm)} mm
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
