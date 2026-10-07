"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, animate, motion } from "framer-motion"
import { ChevronLeftIcon, ChevronRightIcon, FolderOpenIcon, LayersIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react"

import { getGallery, openProject, saveProject } from "@/lib/jarvis-client"
import { sfx } from "@/lib/sfx"
import type { GalleryScene } from "@/lib/workshop/project/gallery-scene"
import { useProject } from "@/lib/workshop/project/store"
import { emptyProject, type GalleryProject } from "@/lib/workshop/project/types"

// The project gallery, over the workshop stage: a revolving ring of every
// project, each one's finished product projected as a hologram. The card
// under the ring describes the one at the front; OPEN FOLDER loads it into
// the project panel and onto the stage.

export const STATUS_LABEL: Record<string, string> = {
  idea: "IDEA",
  design: "DESIGNING",
  simulate: "SIMULATING",
  build: "BUILDING",
  complete: "COMPLETE",
}

export function ProjectGallery() {
  const token = useProject((s) => s.token)
  const setOpen = useProject((s) => s.setGalleryOpen)
  const load = useProject((s) => s.load)
  const setTab = useProject((s) => s.setTab)
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<GalleryScene | null>(null)
  const [projects, setProjects] = useState<GalleryProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState("")
  const press = useRef<{ x: number; y: number } | null>(null)
  const [hovered, setHovered] = useState(-1)
  const [grabbing, setGrabbing] = useState(false)
  // Which way the ring last turned (1 on, -1 back), for the card's slide.
  const [direction, setDirection] = useState(0)

  useEffect(() => {
    if (!token) return
    getGallery(token)
      .then((r) => (r.ok ? setProjects(r.projects ?? []) : setError(r.error ?? "Could not load the gallery.")))
      .catch((err) => setError(String(err)))
  }, [token])

  // The ring itself, once the projects are in.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !projects?.length) return
    let disposed = false
    const openId = useProject.getState().project?.id
    import("@/lib/workshop/project/gallery-scene").then(({ GalleryScene }) => {
      if (disposed) return
      let last = -1
      const scene = new GalleryScene(host, (i) => {
        // The short way round, as the ring itself turns.
        const n = projects.length
        const step = last < 0 ? 0 : (((i - last) % n) + n) % n
        setDirection(step === 0 ? 0 : step <= n / 2 ? 1 : -1)
        last = i
        setSelected(i)
      })
      scene.setProjects(projects, Math.max(0, projects.findIndex((p) => p.id === openId)))
      sceneRef.current = scene
    })
    return () => {
      disposed = true
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [projects])

  async function openFolder(id: string) {
    if (!token || busy) return
    setBusy(true)
    const r = await openProject(id, token).catch((err) => ({ ok: false as const, error: String(err) }))
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    sfx.click()
    load(r.project, r.report)
    setTab("overview")
    setOpen(false)
  }

  async function create() {
    if (!token || !name.trim() || busy) return
    setBusy(true)
    const r = await saveProject(emptyProject(name.trim()), token).catch((err) => ({ ok: false as const, error: String(err) }))
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    load(r.project, r.report)
    setTab("overview")
    setOpen(false)
  }

  // Arrows turn the ring, Enter opens, Escape leaves.
  const latest = useRef({ projects, selected, openFolder })
  useEffect(() => {
    latest.current = { projects, selected, openFolder }
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea")) return
      if (event.key === "ArrowRight") sceneRef.current?.next()
      else if (event.key === "ArrowLeft") sceneRef.current?.previous()
      else if (event.key === "Enter") {
        const { projects: list, selected: i, openFolder: open } = latest.current
        if (list?.[i]) void open(list[i].id)
      } else if (event.key === "Escape") {
        event.stopPropagation()
        setOpen(false)
      } else return
      event.preventDefault()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [setOpen])

  const current = projects?.[selected]

  return (
    <div className="absolute inset-0 flex flex-col" style={{ zIndex: 5, background: "#02050a" }}>
      <div
        ref={hostRef}
        className="absolute inset-0"
        style={{ touchAction: "none", cursor: grabbing ? "grabbing" : hovered < 0 ? "grab" : "pointer" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          press.current = { x: e.clientX, y: e.clientY }
          sceneRef.current?.dragStart(e.clientX, e.clientY)
          setGrabbing(true)
          setHovered(-1)
        }}
        onPointerMove={(e) => {
          const scene = sceneRef.current
          if (press.current) scene?.dragMove(e.clientX)
          // The cursor says what a press would do: grab the ring, or pick.
          const over = scene?.hover(e.clientX, e.clientY) ?? -1
          if (over !== hovered) setHovered(over)
        }}
        onPointerLeave={() => {
          sceneRef.current?.hover(null, null)
          setHovered(-1)
        }}
        onPointerUp={(e) => {
          const start = press.current
          press.current = null
          setGrabbing(false)
          const moved = sceneRef.current?.dragEnd()
          if (moved || !start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return
          // A click: on the front project opens it, on another brings it round.
          const hit = sceneRef.current?.pick(e.clientX, e.clientY) ?? -1
          if (hit < 0) return
          if (hit === selected && projects?.[hit]) void openFolder(projects[hit].id)
          else sceneRef.current?.select(hit)
        }}
        onWheel={(e) => sceneRef.current?.wheel(Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY)}
      />

      <header className="relative flex items-center justify-between" style={{ padding: "12px 16px", pointerEvents: "none" }}>
        <span className="t-header flex items-center" style={{ gap: 8, color: "var(--accent)" }}>
          <LayersIcon size={14} /> PROJECT GALLERY
          {projects && <span className="t-time">{projects.length} PROJECTS</span>}
        </span>
        <span className="flex items-center" style={{ gap: 6, pointerEvents: "auto" }}>
          {naming ? (
            <form
              className="flex"
              style={{ gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault()
                void create()
              }}
            >
              <input
                autoFocus
                className="t-label"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
                style={{ width: 200, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(var(--accent-rgb), 0.4)", color: "var(--text-primary)", padding: "4px 8px", userSelect: "text" }}
              />
              <button type="submit" className="btn" style={{ padding: "4px 10px" }} disabled={!name.trim() || busy}>
                START
              </button>
            </form>
          ) : (
            <button type="button" className="btn flex items-center" style={{ gap: 5, padding: "4px 10px" }} onClick={() => setNaming(true)}>
              <PlusIcon size={12} /> NEW PROJECT
            </button>
          )}
          <button type="button" className="btn" style={{ width: 28, height: 28, padding: 0 }} onClick={() => setOpen(false)} aria-label="Close the gallery" title="Back to the stage (Esc)">
            <XIcon className="mx-auto size-4" />
          </button>
        </span>
      </header>

      {!projects && !error && (
        <p className="t-label relative m-auto flex items-center" style={{ gap: 8, color: "var(--text-secondary)" }}>
          <Loader2Icon size={14} className="animate-spin" /> PROJECTING...
        </p>
      )}
      {error && <p className="relative m-auto" style={{ color: "var(--warning)", fontSize: 13 }}>{error}</p>}
      {projects?.length === 0 && (
        <p className="relative m-auto" style={{ color: "var(--text-secondary)", fontSize: 13, textAlign: "center", maxWidth: 360 }}>
          No projects yet. Start one above, or tell Jarvis what you want to build and he will draw it up.
        </p>
      )}

      {projects && projects.length > 1 && (
        <>
          <button type="button" className="btn absolute" style={{ left: 16, top: "45%", width: 40, height: 40, padding: 0 }} onClick={() => sceneRef.current?.previous()} aria-label="Previous project">
            <ChevronLeftIcon className="mx-auto size-5" />
          </button>
          <button type="button" className="btn absolute" style={{ right: 16, top: "45%", width: 40, height: 40, padding: 0 }} onClick={() => sceneRef.current?.next()} aria-label="Next project">
            <ChevronRightIcon className="mx-auto size-5" />
          </button>
        </>
      )}

      {/* The card for the one at the front: the old one slides out the way
          the ring turned and the new one in after it. */}
      <div className="pointer-events-none absolute" style={{ left: "50%", bottom: 20, transform: "translateX(-50%)", width: "min(560px, calc(100% - 32px))" }}>
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
      {current && (
        <motion.section
          key={current.id}
          custom={direction}
          variants={{
            enter: (dir: number) => ({ opacity: 0, x: dir * 60, filter: "blur(4px)" }),
            show: { opacity: 1, x: 0, filter: "blur(0px)" },
            leave: (dir: number) => ({ opacity: 0, x: dir * -60, filter: "blur(4px)" }),
          }}
          initial="enter"
          animate="show"
          exit="leave"
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="holo-card pointer-events-auto"
          aria-live="polite"
        >
          <header className="holo-card-header">
            <span className="t-label truncate-1">{current.name.toUpperCase()}</span>
            <span className="t-time shrink-0" style={{ color: current.status === "complete" ? "var(--success)" : "var(--accent)" }}>
              {STATUS_LABEL[current.status] ?? current.status.toUpperCase()}
            </span>
          </header>
          <div className="holo-card-body" style={{ padding: "8px 10px" }}>
            {current.goal && <p className="clamp-2" style={{ fontSize: 13, margin: "0 0 8px", color: "var(--text-primary)" }}>{current.goal}</p>}
            <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 8 }}>
              <Stat label="PARTS" count={current.parts.length} />
              <Stat label="PRINTED" count={current.printed.length} />
              <Stat label="EST. COST" count={current.estimated_total} format={(n) => `$${n.toFixed(2)}`} />
              <Stat label="CHECKS" value={current.errors ? `${current.errors} ERR` : "CLEAR"} warn={current.errors > 0} />
            </div>
            {current.groups.length > 0 && (
              <p className="t-time truncate-1" style={{ margin: "0 0 8px" }}>SUB-ASSEMBLIES · {current.groups.join(" · ").toUpperCase()}</p>
            )}
            <div className="flex items-center justify-between">
              <span className="t-time">
                {current.compiled ? "SKETCH COMPILED" : "NO COMPILED SKETCH"} · UPDATED {new Date(current.updated_at).toLocaleDateString()}
              </span>
              <button type="button" className="btn flex items-center" style={{ gap: 6, padding: "5px 14px" }} disabled={busy} onClick={() => void openFolder(current.id)}>
                {busy ? <Loader2Icon size={12} className="animate-spin" /> : <FolderOpenIcon size={12} />} OPEN FOLDER
              </button>
            </div>
          </div>
        </motion.section>
      )}
      </AnimatePresence>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  count,
  format = (n) => String(Math.round(n)),
  warn = false,
}: {
  label: string
  value?: string
  /** A number, counted up to as the card comes in. */
  count?: number
  format?: (n: number) => string
  warn?: boolean
}) {
  const counted = useCountUp(count ?? 0)
  return (
    <div>
      <div className="t-time">{label}</div>
      <div className="t-value" style={{ color: warn ? "var(--warning)" : "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
        {count === undefined ? value : format(counted)}
      </div>
    </div>
  )
}

/** A number eased up from nothing over half a second. */
function useCountUp(target: number) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    const controls = animate(0, target, { duration: 0.6, ease: [0.16, 1, 0.3, 1], onUpdate: setValue })
    return () => controls.stop()
  }, [target])
  return value
}
