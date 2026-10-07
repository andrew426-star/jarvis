"use client"

import { useState } from "react"
import {
  BoxIcon,
  CopyIcon,
  CylinderIcon,
  CircleDotIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FilePlusIcon,
  FlipHorizontal2Icon,
  FolderOpenIcon,
  Loader2Icon,
  MagnetIcon,
  PlusIcon,
  Redo2Icon,
  SaveIcon,
  ShapesIcon,
  SquareIcon,
  Trash2Icon,
  TriangleIcon,
  Undo2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"

import type { StageItem } from "@/components/workshop/library-dock"
import { useJarvis } from "@/lib/store"
import { captureMesh } from "@/lib/workshop/modeler/capture"
import {
  attach,
  DERIVE_LABEL,
  derive,
  designBox,
  KIND_LABEL,
  MAX_ZONES,
  newPart,
  newPiece,
  SIZE_LABELS,
  toPrinted,
  uid,
  type Derive,
  type Design,
  type DesignPart,
  type Piece,
  type PieceKind,
  type Side,
  type Vec3,
} from "@/lib/workshop/modeler/design"
import { useModeler } from "@/lib/workshop/modeler/store"
import { compileScadCached } from "@/lib/workshop/openscad"
import { useProject } from "@/lib/workshop/project/store"
import { emptyProject, FILAMENTS, TEXTURES, type Filament } from "@/lib/workshop/project/types"

// The modeler, down the left of the stage: design parts by hand. Build
// from an object on the stage (a cradle, an enclosure of panels, a cover,
// a plate, or its own shape to rework), or from panels, blocks, rods,
// tubes and wedges; stretch any piece or the whole design at a plane;
// snap pieces flush onto one another; and give each part its own
// material. The stage shows it live, compiled; SAVE TO PROJECT puts the
// parts in the open project as printed parts.

export const MODELER_WIDTH = 360

/** What the server takes per printed part (app/tools/workshop_project.py). */
const MAX_SCAD_CHARS = 40_000
const MAX_PRINTED = 12

const ADD_KINDS: { kind: Exclude<PieceKind, "object">; icon: typeof BoxIcon; title: string }[] = [
  { kind: "panel", icon: SquareIcon, title: "A flat or curved panel: rounded corners, a hole grid" },
  { kind: "block", icon: BoxIcon, title: "A block, rounded or square" },
  { kind: "rod", icon: CylinderIcon, title: "A round rod or post" },
  { kind: "tube", icon: CircleDotIcon, title: "A tube: outer diameter and wall" },
  { kind: "wedge", icon: TriangleIcon, title: "A wedge: a gusset, a ramp" },
]

const SIDES: { side: Side; label: string }[] = [
  { side: "+z", label: "ON TOP" },
  { side: "-z", label: "UNDER" },
  { side: "-x", label: "LEFT" },
  { side: "+x", label: "RIGHT" },
  { side: "-y", label: "FRONT" },
  { side: "+y", label: "BACK" },
]

const field = {
  background: "rgba(0,0,0,0.4)",
  border: "1px solid rgba(var(--accent-rgb), 0.3)",
  color: "var(--text-primary)",
  fontSize: 11,
  padding: "3px 5px",
  userSelect: "text" as const,
  minWidth: 0,
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "part"

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function ModelerPanel({
  items,
  focusedId,
  capture,
}: {
  items: StageItem[]
  focusedId: string | null
  /** The stage's surface of an item (scene.captureMesh). */
  capture: (id: string) => { name: string; positions: Float32Array } | null
}) {
  const design = useModeler((s) => s.design)
  const selected = useModeler((s) => s.selected)
  const status = useModeler((s) => s.status)
  const canUndo = useModeler((s) => s.past.length > 0)
  const canRedo = useModeler((s) => s.future.length > 0)
  const { update, select, undo, redo, setOpen } = useModeler.getState()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const piece = design.pieces.find((p) => p.id === selected) ?? null

  const notify = useJarvis.getState().notify

  function addPiece(kind: Exclude<PieceKind, "object">) {
    const part = (piece?.op === "add" && piece.part) || design.parts[0]?.id
    if (!part) return
    const p = newPiece(kind, part, design.pieces.filter((x) => x.kind === kind).length)
    // Next to the design so far, not inside it.
    const box = designBox(design)
    if (!box.isEmpty()) p.pos = [Math.round(box.max.x + 10 + p.size[0] / 2), 0, 0]
    update((d) => ({ ...d, pieces: [...d.pieces, p] }))
    select(p.id)
  }

  return (
    <aside
      data-keepout
      className="holo-card flex flex-col"
      style={{ position: "absolute", top: 12, left: 12, bottom: 12, width: MODELER_WIDTH, zIndex: 4 }}
      aria-label="Modeler"
    >
      <header className="holo-card-header">
        <span className="t-label flex min-w-0 items-center" style={{ gap: 6 }}>
          <ShapesIcon size={12} className="shrink-0" /> MODELER
          {status.compiling && <Loader2Icon size={11} className="animate-spin shrink-0" />}
        </span>
        <span className="flex shrink-0" style={{ gap: 4 }}>
          <IconButton title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
            <Undo2Icon size={11} />
          </IconButton>
          <IconButton title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
            <Redo2Icon size={11} />
          </IconButton>
          <IconButton title="Designs kept in this browser" active={libraryOpen} onClick={() => setLibraryOpen(!libraryOpen)}>
            <FolderOpenIcon size={11} />
          </IconButton>
          <IconButton title="Close the modeler (the design stays on the stage)" onClick={() => setOpen(false)}>
            <XIcon size={11} />
          </IconButton>
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "var(--sp-2)" }}>
        {libraryOpen ? (
          <Library onDone={() => setLibraryOpen(false)} />
        ) : (
          <>
            <input
              value={design.name}
              onChange={(e) => update((d) => ({ ...d, name: e.target.value.slice(0, 48) }), "name")}
              aria-label="Design name"
              className="t-label w-full"
              style={{ ...field, fontSize: 12, padding: "5px 7px", width: "100%" }}
            />

            <FromObject items={items} focusedId={focusedId} capture={capture} />

            <Heading>ADD</Heading>
            <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
              {ADD_KINDS.map(({ kind, icon: Icon, title }) => (
                <button key={kind} type="button" className="btn flex flex-col items-center" style={{ gap: 2, padding: "5px 0", fontSize: 9 }} onClick={() => addPiece(kind)} title={title}>
                  <Icon size={13} /> {KIND_LABEL[kind]}
                </button>
              ))}
            </div>

            <Parts />
            <Pieces />
            {piece && <PieceEditor key={piece.id} piece={piece} />}
            <Zones />
          </>
        )}
      </div>

      <Footer notify={notify} />
    </aside>
  )
}

function Heading({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between" style={{ margin: "var(--sp-3) 0 5px" }}>
      <h3 className="t-label" style={{ margin: 0, color: "var(--accent)", letterSpacing: "0.12em" }}>
        {children}
      </h3>
      {right}
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "3px 0", lineHeight: 1.4 }}>{children}</p>
}

function IconButton({ children, title, onClick, disabled, active }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" className="btn" style={{ width: 20, height: 20, padding: 0 }} onClick={onClick} disabled={disabled} data-active={active} title={title} aria-label={title}>
      <span className="mx-auto flex justify-center">{children}</span>
    </button>
  )
}

/** A number that can be typed, or dragged sideways on its label. */
function Num({ label, value, onChange, step = 1, min, max, unit }: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  unit?: string
}) {
  // What is typed, while it is being typed; the value otherwise.
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
  const round = (n: number) => Math.round(n / step) * step
  return (
    <label className="flex min-w-0 flex-col" style={{ gap: 1 }}>
      <span
        className="t-time"
        style={{ cursor: "ew-resize", userSelect: "none" }}
        onPointerDown={(e) => {
          e.preventDefault()
          const x0 = e.clientX
          const v0 = value
          const target = e.currentTarget
          target.setPointerCapture(e.pointerId)
          const move = (ev: PointerEvent) => onChange(clamp(Number(round(v0 + ((ev.clientX - x0) / 4) * step).toFixed(3))))
          const up = () => {
            target.removeEventListener("pointermove", move)
            target.removeEventListener("pointerup", up)
          }
          target.addEventListener("pointermove", move)
          target.addEventListener("pointerup", up)
        }}
      >
        {label}
        {unit ? ` ${unit}` : ""}
      </span>
      <input
        type="number"
        value={draft ?? String(value)}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== "" && Number.isFinite(n)) onChange(clamp(n))
        }}
        onBlur={() => setDraft(null)}
        style={{ ...field, width: "100%" }}
      />
    </label>
  )
}

function Triple({ label, value, onChange, step, min, max, unit, labels = ["X", "Y", "Z"] }: {
  label: string
  value: Vec3
  onChange: (v: Vec3) => void
  step?: number
  min?: number
  max?: number
  unit?: string
  labels?: (string | null)[]
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div className="t-label" style={{ fontSize: 10, color: "var(--text-secondary)", marginBottom: 2 }}>{label}</div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
        {[0, 1, 2].map((k) =>
          labels[k] === null ? (
            <span key={k} />
          ) : (
            <Num
              key={k}
              label={labels[k] ?? "XYZ"[k]}
              value={value[k]}
              step={step}
              min={min}
              max={max}
              unit={unit}
              onChange={(n) => {
                const next = [...value] as Vec3
                next[k] = n
                onChange(next)
              }}
            />
          )
        )}
      </div>
    </div>
  )
}

// --- from an object on the stage ---------------------------------------------------------

function FromObject({ items, focusedId, capture }: { items: StageItem[]; focusedId: string | null; capture: (id: string) => { name: string; positions: Float32Array } | null }) {
  const design = useModeler((s) => s.design)
  const { update, select } = useModeler.getState()
  // Not the design itself: it is what is being built.
  const sources = items.filter((i) => !i.name.startsWith("DESIGN · "))
  const [source, setSource] = useState<string>("")
  const [clearance, setClearance] = useState(0.6)
  const [wall, setWall] = useState(2.4)
  const chosen = sources.find((i) => i.id === source) ?? sources.find((i) => i.id === focusedId) ?? sources[sources.length - 1]

  function build(kind: Derive) {
    if (!chosen) return
    const surface = capture(chosen.id)
    const mesh = surface && captureMesh(surface.name, surface.positions)
    if (!mesh) {
      useJarvis.getState().notify("warning", "Nothing to build from", `${chosen.name} has no surface the modeler can take.`)
      return
    }
    const part = design.parts[0] ?? newPart(0)
    const { pieces, parts } = derive(mesh, kind, part, { clearance, wall })
    // Beside what is there already, so a second build does not land in the first.
    const box = designBox(design)
    const shift = box.isEmpty() ? 0 : Math.round(box.max.x + 20 + mesh.size[0] / 2 + wall)
    update((d) => ({
      ...d,
      name: d.pieces.length ? d.name : `${mesh.source} ${DERIVE_LABEL[kind].label.toLowerCase()}`.slice(0, 48),
      parts: [...(d.parts.length ? d.parts : [part]), ...parts],
      pieces: [...d.pieces, ...pieces.map((p) => ({ ...p, pos: [p.pos[0] + shift, p.pos[1], p.pos[2]] as Vec3 }))],
    }))
    select(pieces[0]?.id ?? null)
  }

  return (
    <>
      <Heading>FROM AN OBJECT</Heading>
      {!sources.length ? (
        <Muted>Put something on the stage (a template, a project, a model) to design parts round it.</Muted>
      ) : (
        <>
          <select value={chosen?.id ?? ""} onChange={(e) => setSource(e.target.value)} aria-label="Object to build from" style={{ ...field, width: "100%", marginBottom: 5 }}>
            {sources.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 5 }}>
            <Num label="CLEARANCE" unit="mm" value={clearance} step={0.1} min={0} max={10} onChange={setClearance} />
            <Num label="WALL" unit="mm" value={wall} step={0.2} min={0.8} max={20} onChange={setWall} />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
            {(Object.keys(DERIVE_LABEL) as Derive[]).map((kind) => (
              <button key={kind} type="button" className="btn" style={{ padding: "5px 0", fontSize: 9 }} onClick={() => build(kind)} title={DERIVE_LABEL[kind].blurb}>
                {DERIVE_LABEL[kind].label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

// --- parts: one material each -----------------------------------------------------------

function Parts() {
  const design = useModeler((s) => s.design)
  const { update } = useModeler.getState()
  const setPart = (id: string, patch: Partial<DesignPart>, tag: string) =>
    update((d) => ({ ...d, parts: d.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) }), `${tag}:${id}`)

  return (
    <>
      <Heading
        right={
          <button
            type="button"
            className="btn flex items-center"
            style={{ gap: 3, padding: "1px 7px", fontSize: 10 }}
            onClick={() => update((d) => ({ ...d, parts: [...d.parts, newPart(d.parts.length)] }))}
            title="A new part: its own print, in its own material"
          >
            <PlusIcon size={10} /> PART
          </button>
        }
      >
        PARTS · MATERIALS
      </Heading>
      {design.parts.map((part) => {
        const used = design.pieces.filter((p) => p.part === part.id).length
        return (
          <div key={part.id} className="grid items-center" style={{ gridTemplateColumns: "22px 1fr 78px 64px 20px", gap: 4, marginBottom: 4 }}>
            <input type="color" value={part.color} onChange={(e) => setPart(part.id, { color: e.target.value }, "color")} aria-label={`${part.name} colour`} style={{ width: 22, height: 22, padding: 0, border: "none", background: "none" }} />
            <input value={part.name} onChange={(e) => setPart(part.id, { name: e.target.value.slice(0, 32) }, "pname")} aria-label="Part name" style={field} />
            <select value={part.material} onChange={(e) => setPart(part.id, { material: e.target.value as Filament }, "mat")} aria-label={`${part.name} material`} style={field}>
              {FILAMENTS.map((m) => (
                <option key={m} value={m}>
                  {m.replace("_", " ").toUpperCase()}
                </option>
              ))}
            </select>
            <select value={part.texture} onChange={(e) => setPart(part.id, { texture: e.target.value as DesignPart["texture"] }, "tex")} aria-label={`${part.name} finish`} style={field}>
              {TEXTURES.map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </select>
            <IconButton
              title={used ? `${used} piece(s) use this part` : "Remove this part"}
              disabled={!!used || design.parts.length < 2}
              onClick={() => update((d) => ({ ...d, parts: d.parts.filter((p) => p.id !== part.id) }))}
            >
              <Trash2Icon size={10} />
            </IconButton>
          </div>
        )
      })}
    </>
  )
}

// --- pieces ---------------------------------------------------------------------------

function Pieces() {
  const design = useModeler((s) => s.design)
  const selected = useModeler((s) => s.selected)
  const { update, select } = useModeler.getState()
  const partOf = (p: Piece) => (p.part === "*" ? null : design.parts.find((x) => x.id === p.part))
  const setPiece = (id: string, patch: Partial<Piece>) => update((d) => ({ ...d, pieces: d.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))

  return (
    <>
      <Heading>PIECES · {design.pieces.length}</Heading>
      {!design.pieces.length && <Muted>Add a piece above, or build from an object on the stage.</Muted>}
      <div className="flex flex-col" style={{ gap: 2 }}>
        {design.pieces.map((p) => {
          const part = partOf(p)
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => select(selected === p.id ? null : p.id)}
              onKeyDown={(e) => e.key === "Enter" && select(selected === p.id ? null : p.id)}
              className="flex items-center"
              data-active={selected === p.id}
              style={{
                gap: 6,
                padding: "3px 5px",
                fontSize: 11,
                cursor: "pointer",
                border: `1px solid rgba(var(--accent-rgb), ${selected === p.id ? 0.6 : 0.12})`,
                background: selected === p.id ? "rgba(var(--accent-rgb), 0.12)" : "transparent",
                opacity: p.hidden ? 0.45 : 1,
              }}
            >
              <span style={{ width: 9, height: 9, flexShrink: 0, background: p.op === "add" ? part?.color ?? "#888" : "transparent", border: p.op === "add" ? "none" : `1px dashed ${p.op === "cut" ? "#ff7a45" : "#9fe8ff"}` }} />
              <span className="truncate-1 min-w-0 flex-1" style={{ color: "var(--text-primary)" }}>{p.name}</span>
              <span className="t-time shrink-0" style={{ color: p.op === "cut" ? "#ff7a45" : p.op === "ghost" ? "#9fe8ff" : undefined }}>
                {p.op === "add" ? KIND_LABEL[p.kind] : p.op.toUpperCase()}
              </span>
              <IconButton title={p.hidden ? "Show" : "Hide (left out of the build)"} onClick={() => setPiece(p.id, { hidden: !p.hidden })}>
                {p.hidden ? <EyeOffIcon size={10} /> : <EyeIcon size={10} />}
              </IconButton>
            </div>
          )
        })}
      </div>
    </>
  )
}

function PieceEditor({ piece }: { piece: Piece }) {
  const design = useModeler((s) => s.design)
  const { update, select } = useModeler.getState()
  const [target, setTarget] = useState<string>("")
  const [gap, setGap] = useState(0)
  const others = design.pieces.filter((p) => p.id !== piece.id)
  const onto = others.find((p) => p.id === target) ?? others[others.length - 1]
  const set = (patch: Partial<Piece>, tag: string) =>
    update((d) => ({ ...d, pieces: d.pieces.map((p) => (p.id === piece.id ? { ...p, ...patch } : p)) }), `${tag}:${piece.id}`)
  const labels = SIZE_LABELS[piece.kind]
  const stretched = piece.stretch.some((k) => k !== 1)

  return (
    <section style={{ marginTop: 8, padding: "4px 8px 8px", border: "1px solid rgba(var(--accent-rgb), 0.35)" }}>
      <Heading
        right={
          <span className="flex" style={{ gap: 4 }}>
            <IconButton
              title="Duplicate"
              onClick={() => {
                const copy = { ...piece, id: uid(), name: `${piece.name} copy`, pos: [piece.pos[0] + 10, piece.pos[1], piece.pos[2]] as Vec3 }
                update((d) => ({ ...d, pieces: [...d.pieces, copy] }))
                select(copy.id)
              }}
            >
              <CopyIcon size={10} />
            </IconButton>
            <IconButton
              title="Mirrored copy across the design's middle (x to -x)"
              onClick={() => {
                const copy = { ...piece, id: uid(), name: `${piece.name} (mirror)`, mirror: !piece.mirror }
                update((d) => ({ ...d, pieces: [...d.pieces, copy] }))
                select(copy.id)
              }}
            >
              <FlipHorizontal2Icon size={10} />
            </IconButton>
            <IconButton
              title="Delete the piece"
              onClick={() => {
                update((d) => ({ ...d, pieces: d.pieces.filter((p) => p.id !== piece.id) }))
                select(null)
              }}
            >
              <Trash2Icon size={10} />
            </IconButton>
          </span>
        }
      >
        {KIND_LABEL[piece.kind]}
      </Heading>

      <input value={piece.name} onChange={(e) => set({ name: e.target.value.slice(0, 40) }, "name")} aria-label="Piece name" style={{ ...field, width: "100%", marginBottom: 6 }} />

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 6 }}>
        <div className="flex" style={{ gap: 2 }} role="radiogroup" aria-label="What the piece does">
          {(["add", "cut", "ghost"] as const).map((op) => (
            <button
              key={op}
              type="button"
              role="radio"
              aria-checked={piece.op === op}
              className="btn flex-1"
              style={{ padding: "3px 0", fontSize: 10 }}
              data-active={piece.op === op}
              onClick={() => set({ op, part: op === "cut" && piece.op !== "cut" ? "*" : op === "add" && piece.part === "*" ? design.parts[0]?.id ?? "*" : piece.part }, "op")}
              title={op === "add" ? "Solid: fused into its part" : op === "cut" ? "Cuts away: a socket, a slot, a window" : "Shown to fit against, never printed"}
            >
              {op.toUpperCase()}
            </button>
          ))}
        </div>
        {piece.op !== "ghost" && (
          <select
            value={piece.part}
            onChange={(e) => set({ part: e.target.value }, "part")}
            aria-label={piece.op === "cut" ? "Cuts from" : "Part"}
            style={field}
          >
            {piece.op === "cut" && <option value="*">CUTS EVERY PART</option>}
            {design.parts.map((p) => (
              <option key={p.id} value={p.id}>
                {piece.op === "cut" ? `CUTS ${p.name.toUpperCase()}` : `${p.name} · ${p.material.toUpperCase()}`}
              </option>
            ))}
          </select>
        )}
      </div>

      {piece.kind === "object" ? (
        <>
          <Muted>
            From {piece.mesh?.source ?? "an object"}: {piece.mesh ? `${piece.mesh.size.map((n) => n.toFixed(0)).join(" × ")} mm, ${piece.mesh.faces.length} faces` : "no shape"}.
          </Muted>
          <div className="flex" style={{ gap: 2, marginBottom: 6 }}>
            {(["mesh", "hull"] as const).map((form) => (
              <button
                key={form}
                type="button"
                className="btn flex-1"
                style={{ padding: "3px 0", fontSize: 10 }}
                data-active={(piece.form ?? "hull") === form}
                onClick={() => set({ form }, "form")}
                title={form === "mesh" ? "Its own surface, thinned to print" : "Wrapped: the convex shape round it (always compiles)"}
              >
                {form === "mesh" ? "EXACT SHAPE" : "WRAPPED"}
              </button>
            ))}
          </div>
        </>
      ) : (
        <Triple label="SIZE" unit="mm" labels={labels} value={piece.size} step={0.5} min={0.2} max={2000} onChange={(size) => set({ size }, "size")} />
      )}

      <Triple
        label={stretched ? "STRETCH ×  (scaled from its floor and middle)" : "STRETCH ×"}
        value={piece.stretch}
        step={0.05}
        min={0.05}
        max={20}
        onChange={(stretch) => set({ stretch }, "stretch")}
      />
      <div className="flex" style={{ gap: 3, marginBottom: 6 }}>
        {[0.5, 0.9, 1.1, 1.5, 2].map((k) => (
          <button key={k} type="button" className="btn flex-1" style={{ padding: "2px 0", fontSize: 10 }} onClick={() => set({ stretch: piece.stretch.map((s) => Math.round(s * k * 100) / 100) as Vec3 }, "stretch-all")} title={`Scale every axis by ${k}`}>
            ×{k}
          </button>
        ))}
        <button type="button" className="btn flex-1" style={{ padding: "2px 0", fontSize: 10 }} disabled={!stretched} onClick={() => set({ stretch: [1, 1, 1] }, "stretch-reset")}>
          1:1
        </button>
      </div>

      <Triple label="POSITION" unit="mm" value={piece.pos} step={0.5} onChange={(pos) => set({ pos }, "pos")} />
      <Triple label="TURN" unit="°" value={piece.rot} step={5} min={-360} max={360} onChange={(rot) => set({ rot }, "rot")} />

      {(piece.kind === "panel" || piece.kind === "block") && (
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 6 }}>
          <Num label="CORNER R" unit="mm" value={piece.radius ?? 0} step={0.5} min={0} max={200} onChange={(radius) => set({ radius }, "radius")} />
          {piece.kind === "panel" && <Num label="CURVE" unit="°" value={piece.curve ?? 0} step={5} min={-350} max={350} onChange={(curve) => set({ curve }, "curve")} />}
        </div>
      )}
      {piece.kind === "panel" && (
        <>
          <label className="flex items-center" style={{ gap: 6, fontSize: 11, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={!!piece.holes}
              onChange={(e) => set({ holes: e.target.checked ? { d: 3.2, pitch: 10, margin: 6 } : null }, "holes")}
            />
            HOLE GRID {Math.abs(piece.curve ?? 0) >= 1 && piece.holes ? "(flat panels only)" : ""}
          </label>
          {piece.holes && (
            <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 4, marginBottom: 6 }}>
              <Num label="DIA" unit="mm" value={piece.holes.d} step={0.1} min={0.5} max={100} onChange={(d) => set({ holes: { ...piece.holes!, d } }, "holes-d")} />
              <Num label="PITCH" unit="mm" value={piece.holes.pitch} step={0.5} min={1} max={500} onChange={(pitch) => set({ holes: { ...piece.holes!, pitch } }, "holes-p")} />
              <Num label="MARGIN" unit="mm" value={piece.holes.margin} step={0.5} min={0} max={200} onChange={(margin) => set({ holes: { ...piece.holes!, margin } }, "holes-m")} />
            </div>
          )}
        </>
      )}

      {others.length > 0 && (
        <>
          <div className="t-label flex items-center" style={{ fontSize: 10, color: "var(--text-secondary)", gap: 4, margin: "4px 0 3px" }}>
            <MagnetIcon size={10} /> SNAP FLUSH ONTO
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 64px", gap: 4, marginBottom: 4 }}>
            <select value={onto?.id ?? ""} onChange={(e) => setTarget(e.target.value)} aria-label="Piece to snap onto" style={field}>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Num label="GAP" unit="mm" value={gap} step={0.1} min={-200} max={200} onChange={setGap} />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 3 }}>
            {SIDES.map(({ side, label }) => (
              <button
                key={side}
                type="button"
                className="btn"
                style={{ padding: "3px 0", fontSize: 10 }}
                disabled={!onto}
                onClick={() => onto && set({ pos: attach(piece, onto, side, gap) }, `attach-${side}`)}
                title={`Put it flush against ${onto?.name ?? "the piece"}, ${label.toLowerCase()}, centred on it`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

// --- stretch zones ------------------------------------------------------------------------

function Zones() {
  const design = useModeler((s) => s.design)
  const { update } = useModeler.getState()
  const box = designBox(design)
  const setZone = (id: string, patch: Partial<Design["zones"][number]>, tag: string) =>
    update((d) => ({ ...d, zones: d.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) }), `${tag}:${id}`)

  return (
    <>
      <Heading
        right={
          <button
            type="button"
            className="btn flex items-center"
            style={{ gap: 3, padding: "1px 7px", fontSize: 10 }}
            disabled={box.isEmpty() || design.zones.length >= MAX_ZONES}
            onClick={() => {
              const mid = box.getCenter(box.min.clone())
              update((d) => ({ ...d, zones: [...d.zones, { id: uid(), axis: 0, at: Math.round(mid.x), by: 20 }] }))
            }}
            title="Lengthen the whole design at a plane, its ends kept as they are"
          >
            <PlusIcon size={10} /> ZONE
          </button>
        }
      >
        STRETCH THE DESIGN
      </Heading>
      {!design.zones.length ? (
        <Muted>A zone cuts the design at a plane and moves everything past it out, filling the gap with the cross-section there: a longer case with the same ends, a taller bracket with the same feet.</Muted>
      ) : (
        design.zones.map((zone) => (
          <div key={zone.id} className="grid items-end" style={{ gridTemplateColumns: "70px 1fr 1fr 20px", gap: 4, marginBottom: 4 }}>
            <select value={zone.axis} onChange={(e) => setZone(zone.id, { axis: Number(e.target.value) as 0 | 1 | 2 }, "axis")} aria-label="Along" style={field}>
              <option value={0}>ALONG X</option>
              <option value={1}>ALONG Y</option>
              <option value={2}>ALONG Z</option>
            </select>
            <Num label="AT" unit="mm" value={zone.at} step={1} onChange={(at) => setZone(zone.id, { at }, "at")} />
            <Num label="BY" unit="mm" value={zone.by} step={1} min={-500} max={2000} onChange={(by) => setZone(zone.id, { by }, "by")} />
            <IconButton title="Remove the zone" onClick={() => update((d) => ({ ...d, zones: d.zones.filter((z) => z.id !== zone.id) }))}>
              <Trash2Icon size={10} />
            </IconButton>
          </div>
        ))
      )}
    </>
  )
}

// --- the library of designs, and getting parts out -------------------------------------------

function Library({ onDone }: { onDone: () => void }) {
  const library = useModeler((s) => s.library)
  const design = useModeler((s) => s.design)
  const { keep, start, forget } = useModeler.getState()
  return (
    <>
      <div className="flex" style={{ gap: 4 }}>
        <button type="button" className="btn flex flex-1 items-center justify-center" style={{ gap: 4, padding: "4px 0" }} onClick={keep} title="Keep this design in the library">
          <SaveIcon size={11} /> KEEP “{design.name.slice(0, 18)}”
        </button>
        <button
          type="button"
          className="btn flex flex-1 items-center justify-center"
          style={{ gap: 4, padding: "4px 0" }}
          onClick={() => {
            keep()
            start()
            onDone()
          }}
          title="Keep this one, then start a new design"
        >
          <FilePlusIcon size={11} /> NEW DESIGN
        </button>
      </div>
      <Heading>KEPT IN THIS BROWSER</Heading>
      {!library.length && <Muted>Nothing kept yet.</Muted>}
      {library.map((entry) => (
        <div key={entry.id} className="flex items-center" style={{ gap: 6, padding: "3px 0", borderBottom: "1px solid rgba(var(--accent-rgb), 0.1)", fontSize: 11 }}>
          <span className="min-w-0 flex-1">
            <span className="truncate-1" style={{ color: "var(--text-primary)", display: "block" }}>{entry.name}</span>
            <span className="t-time">{entry.design.pieces.length} pieces · {new Date(entry.saved).toLocaleDateString()}</span>
          </span>
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 8px", fontSize: 10 }}
            onClick={() => {
              if (design.pieces.length && design.id !== entry.id) keep()
              start(structuredClone(entry.design))
              onDone()
            }}
          >
            OPEN
          </button>
          <IconButton title="Remove from the library" onClick={() => forget(entry.id)}>
            <Trash2Icon size={10} />
          </IconButton>
        </div>
      ))}
    </>
  )
}

function Footer({ notify }: { notify: ReturnType<typeof useJarvis.getState>["notify"] }) {
  const design = useModeler((s) => s.design)
  const status = useModeler((s) => s.status)
  const project = useProject((s) => s.project)
  const saving = useProject((s) => s.saving)
  const [busy, setBusy] = useState(false)
  const printed = toPrinted(design)
  const tooLong = printed.filter((p) => p.code.length > MAX_SCAD_CHARS)

  async function saveToProject() {
    if (!printed.length) return
    if (tooLong.length) {
      notify("warning", "Too detailed to save", `${tooLong.map((p) => p.name).join(", ")}: over ${MAX_SCAD_CHARS / 1000}k characters of OpenSCAD. Use WRAPPED for captured shapes, or fewer of them.`)
      return
    }
    const store = useProject.getState()
    if (!store.project) store.load(emptyProject(design.name), null)
    const current = useProject.getState().project!
    // An earlier save of this design is replaced, not added to.
    const prefix = `${design.name} · `
    const kept = current.printed.filter((p) => !p.name.startsWith(prefix))
    if (kept.length + printed.length > MAX_PRINTED) {
      notify("warning", "Too many printed parts", `A project holds ${MAX_PRINTED}; this would make ${kept.length + printed.length}.`)
      return
    }
    const layout = Object.fromEntries(Object.entries(current.layout).filter(([name]) => !name.startsWith(prefix)))
    for (const p of printed) layout[p.name] = { pos: [0, 0, 0], rot: [0, 0, 0] }
    const ok = await store.save({ printed: [...kept, ...printed], layout })
    if (ok) notify("success", "Saved to the project", `${printed.length} printed part${printed.length === 1 ? "" : "s"} in ${useProject.getState().project?.name ?? "the project"}.`)
  }

  async function downloadAll() {
    setBusy(true)
    for (const part of printed) {
      try {
        const stl = await compileScadCached(part.code)
        download(`${slug(part.name)}.stl`, new Blob([stl.slice()], { type: "model/stl" }))
      } catch (err) {
        notify("warning", `${part.name} did not compile`, String(err).slice(0, 160))
      }
      download(`${slug(part.name)}.scad`, new Blob([part.code], { type: "text/plain" }))
    }
    setBusy(false)
  }

  return (
    <footer style={{ padding: "6px var(--sp-2)", borderTop: "1px solid rgba(var(--accent-rgb), 0.2)" }}>
      {status.errors.map((e) => (
        <p key={e.part} className="wrap-words" style={{ fontSize: 11, color: "var(--error, #ff4d4d)", margin: "0 0 4px" }} title={e.error}>
          {e.part}: {e.error.split("\n")[0].slice(0, 140)}
        </p>
      ))}
      <div className="flex" style={{ gap: 4 }}>
        <button
          type="button"
          className="btn flex flex-1 items-center justify-center"
          style={{ gap: 4, padding: "5px 0" }}
          disabled={!printed.length || saving}
          onClick={() => void saveToProject()}
          title={project ? `Put the parts in ${project.name} as printed parts` : "Start a project with these parts"}
        >
          {saving ? <Loader2Icon size={11} className="animate-spin" /> : <UploadIcon size={11} />} {project ? "SAVE TO PROJECT" : "NEW PROJECT"}
        </button>
        <button type="button" className="btn flex items-center justify-center" style={{ gap: 4, padding: "5px 10px" }} disabled={!printed.length || busy} onClick={() => void downloadAll()} title="Every part as STL and its OpenSCAD">
          {busy ? <Loader2Icon size={11} className="animate-spin" /> : <DownloadIcon size={11} />} STL
        </button>
      </div>
      <p className="t-time" style={{ margin: "4px 0 0" }}>
        {printed.length} PART{printed.length === 1 ? "" : "S"} TO PRINT
        {printed.length ? ` · ${[...new Set(printed.map((p) => p.material?.toUpperCase()))].join(" + ")}` : ""}
      </p>
    </footer>
  )
}
