"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, DownloadIcon, PinIcon, XIcon } from "lucide-react"
import katex from "katex"
import "katex/dist/katex.min.css"

import { useShowcase, type ShowcaseItem } from "@/lib/showcase-store"
import { useSpatial } from "@/lib/spatial-store"

// The showcase window: what Jarvis put on screen for Andrew to look at
// (app/tools/showcase.py). It floats over the centre of the console
// without a backdrop, so the reactor and the chat stay in view while he
// talks it through, and steps back through earlier items with the arrows.

function tex(source: string, display: boolean): string {
  return katex.renderToString(source, { displayMode: display, throwOnError: false, output: "html" })
}

// $$display$$ and $inline$ math inside ordinary text, rendered; the rest
// stays text. KaTeX's own escaping covers the math, and the text parts go
// through React, so nothing here can inject markup.
function MathText({ text }: { text: string }) {
  const pieces = useMemo(() => text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g), [text])
  return (
    <>
      {pieces.map((piece, index) => {
        if (piece.startsWith("$$") && piece.endsWith("$$") && piece.length > 4) {
          return <div key={index} className="showcase-math" dangerouslySetInnerHTML={{ __html: tex(piece.slice(2, -2), true) }} />
        }
        if (piece.startsWith("$") && piece.endsWith("$") && piece.length > 2) {
          return <span key={index} dangerouslySetInnerHTML={{ __html: tex(piece.slice(1, -1), false) }} />
        }
        return <span key={index}>{piece}</span>
      })}
    </>
  )
}

function TextBody({ content }: { content: string }) {
  // Blocks are split on blank lines; "- " lines become a list.
  const blocks = content.split(/\n\s*\n/)
  return (
    <div className="flex flex-col" style={{ gap: "var(--sp-3)" }}>
      {blocks.map((block, index) => {
        const lines = block.split("\n")
        if (lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
          return (
            <ul key={index} className="flex flex-col" style={{ gap: 6, paddingLeft: 18, listStyle: "square" }}>
              {lines.map((line, i) => (
                <li key={i}>
                  <MathText text={line.replace(/^\s*[-*•]\s+/, "")} />
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={index} style={{ whiteSpace: "pre-wrap" }}>
            <MathText text={block} />
          </p>
        )
      })}
    </div>
  )
}

function Body({ item }: { item: ShowcaseItem }) {
  switch (item.kind) {
    case "equation":
      return (
        <div
          className="showcase-math flex min-h-[120px] items-center justify-center"
          style={{ fontSize: "1.6em" }}
          dangerouslySetInnerHTML={{ __html: tex(item.content ?? "", true) }}
        />
      )
    case "text":
      return <TextBody content={item.content ?? ""} />
    case "code":
    case "file":
      return (
        <div className="flex flex-col" style={{ gap: "var(--sp-2)" }}>
          {item.kind === "file" && (
            <span className="t-label">
              {item.filename} · {new Blob([item.content ?? ""]).size.toLocaleString()} BYTES
            </span>
          )}
          <pre
            className="overflow-x-auto"
            style={{
              margin: 0,
              padding: "var(--sp-3)",
              background: "rgba(0, 0, 0, 0.45)",
              border: "1px solid rgba(var(--accent-rgb), 0.2)",
              borderRadius: "var(--radius)",
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              fontSize: 12.5,
              lineHeight: 1.55,
              maxHeight: item.kind === "file" ? 360 : undefined,
            }}
          >
            {item.content}
          </pre>
        </div>
      )
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL; next/image has nothing to optimise
        <img
          src={`data:${item.mime ?? "image/png"};base64,${item.image_data}`}
          alt={item.caption || item.title}
          className="mx-auto block"
          style={{ maxWidth: "100%", maxHeight: "58vh", borderRadius: "var(--radius)" }}
        />
      )
  }
}

function download(item: ShowcaseItem) {
  let blob: Blob
  let name: string
  if (item.kind === "image" && item.image_data) {
    const bytes = Uint8Array.from(atob(item.image_data), (c) => c.charCodeAt(0))
    const mime = item.mime ?? "image/png"
    blob = new Blob([bytes], { type: mime })
    name = `${slug(item.title)}.${mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png"}`
  } else {
    blob = new Blob([item.content ?? ""], { type: item.mime ?? "text/plain" })
    name = item.filename ?? `${slug(item.title)}.${item.kind === "equation" ? "tex" : "txt"}`
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "jarvis"
}

const KIND_LABEL: Record<ShowcaseItem["kind"], string> = {
  equation: "EQUATION",
  text: "NOTES",
  code: "CODE",
  file: "FILE",
  image: "IMAGE",
}

// Where he has put the window. Null is the default: centred under the top
// bar. Dragged by its header and resized from its corner, it stays where
// it was left - across items and reloads - until a double-click on the
// header puts it back.
const BOX_KEY = "jarvis_showcase_window"
const TOP = 48
const BOTTOM = 56
const GUTTER = 8
const MIN_WIDTH = 300
const MIN_HEIGHT = 160

interface Box {
  x: number
  y: number
  width: number
  /** Null: as tall as its content, up to the space available. */
  height: number | null
}

function loadBox(): Box | null {
  try {
    const raw = localStorage.getItem(BOX_KEY)
    return raw ? clampBox(JSON.parse(raw) as Box) : null
  } catch {
    return null
  }
}

function saveBox(box: Box | null) {
  try {
    if (box) localStorage.setItem(BOX_KEY, JSON.stringify(box))
    else localStorage.removeItem(BOX_KEY)
  } catch {
    // Storage blocked: it stays put for this session.
  }
}

function clampBox(box: Box): Box {
  const width = Math.min(Math.max(MIN_WIDTH, box.width), window.innerWidth - GUTTER * 2)
  const maxHeight = window.innerHeight - TOP - BOTTOM - GUTTER * 2
  const height = box.height === null ? null : Math.min(Math.max(MIN_HEIGHT, box.height), maxHeight)
  return {
    width,
    height,
    x: Math.min(Math.max(GUTTER, box.x), window.innerWidth - width - GUTTER),
    // The header always stays reachable, between the bars.
    y: Math.min(Math.max(TOP + GUTTER, box.y), window.innerHeight - BOTTOM - GUTTER - (height ?? 80)),
  }
}

export function ShowcaseWindow() {
  const items = useShowcase((state) => state.items)
  const activeId = useShowcase((state) => state.activeId)
  const { show, close } = useShowcase.getState()
  const [copied, setCopied] = useState(false)
  const [box, setBox] = useState<Box | null>(() => (typeof window === "undefined" ? null : loadBox()))
  const [dragging, setDragging] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onResize = () => setBox((current) => (current ? clampBox(current) : current))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  /** Where the window is now, measured, so the first drag starts from the
   *  centred default without a jump. */
  function currentBox(): Box | null {
    if (box) return box
    const rect = sectionRef.current?.getBoundingClientRect()
    return rect ? { x: rect.left, y: rect.top, width: rect.width, height: null } : null
  }

  // Pointer capture keeps the gesture alive when the pointer outruns the
  // header or the grip; the result is saved once, on release.
  function track(event: React.PointerEvent, move: (start: Box, dx: number, dy: number) => Box) {
    const start = currentBox()
    if (!start) return
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    const origin = { x: event.clientX, y: event.clientY }
    let last = start
    setDragging(true)
    const onMove = (e: PointerEvent) => {
      last = clampBox(move(start, e.clientX - origin.x, e.clientY - origin.y))
      setBox(last)
    }
    const onEnd = () => {
      target.removeEventListener("pointermove", onMove)
      target.removeEventListener("pointerup", onEnd)
      target.removeEventListener("pointercancel", onEnd)
      setDragging(false)
      saveBox(last)
    }
    target.addEventListener("pointermove", onMove)
    target.addEventListener("pointerup", onEnd)
    target.addEventListener("pointercancel", onEnd)
  }

  function startDrag(event: React.PointerEvent) {
    if ((event.target as HTMLElement).closest("button")) return
    track(event, (start, dx, dy) => ({ ...start, x: start.x + dx, y: start.y + dy }))
  }

  function startResize(event: React.PointerEvent) {
    event.stopPropagation()
    const measured = sectionRef.current?.getBoundingClientRect().height ?? 300
    track(event, (start, dx, dy) => ({
      ...start,
      width: start.width + dx,
      height: (start.height ?? measured) + dy,
    }))
  }

  function recentre() {
    setBox(null)
    saveBox(null)
  }

  const index = items.findIndex((item) => item.id === activeId)
  const item = index >= 0 ? items[index] : null

  useEffect(() => {
    if (!item) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [item, close])

  async function copy() {
    if (!item?.content) return
    try {
      await navigator.clipboard.writeText(item.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked: the download button is still there.
    }
  }

  function pin() {
    if (!item) return
    useSpatial.getState().addHologram({
      kind: item.kind === "image" ? "vision" : "note",
      title: item.title.toUpperCase(),
      body: item.caption || item.content?.slice(0, 600) || "",
      image: item.kind === "image" && item.image_data ? `data:${item.mime};base64,${item.image_data}` : undefined,
    })
  }

  const canCopy = item && item.kind !== "image"
  const canPin = item && item.kind !== "file" && (item.kind !== "image" || (item.image_data?.length ?? 0) < 400_000)

  return (
    <AnimatePresence>
      {item && (
        <motion.section
          key="showcase"
          ref={sectionRef}
          role="dialog"
          aria-label={item.title}
          className="card glow-std fixed flex flex-col"
          style={{
            ...(box
              ? {
                  left: box.x,
                  top: box.y,
                  x: 0,
                  width: box.width,
                  height: box.height ?? undefined,
                  maxHeight: `calc(100vh - ${box.y}px - ${BOTTOM + GUTTER}px)`,
                }
              : {
                  top: 48 + 24,
                  left: "50%",
                  x: "-50%",
                  width: "min(760px, calc(100vw - 32px))",
                  maxHeight: "calc(100vh - 48px - 56px - 48px)",
                }),
            userSelect: dragging ? "none" : undefined,
            zIndex: 45,
            background: "rgba(5, 7, 14, 0.95)",
            borderColor: "rgba(var(--accent-rgb), 0.5)",
          }}
          initial={{ opacity: 0, scale: 0.96, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -8 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          <header
            className="relative flex shrink-0 items-center justify-between overflow-hidden"
            onPointerDown={startDrag}
            onDoubleClick={(event) => {
              if (!(event.target as HTMLElement).closest("button")) recentre()
            }}
            title="Drag to move · double-click to recentre"
            style={{
              padding: "var(--sp-2) var(--sp-3)",
              gap: "var(--sp-2)",
              borderBottom: "1px solid rgba(var(--accent-rgb), 0.2)",
              cursor: dragging ? "grabbing" : "grab",
              touchAction: "none",
            }}
          >
            <div className="bar-sweep" />
            <div className="flex min-w-0 items-center" style={{ gap: "var(--sp-2)" }}>
              <span className="t-label" style={{ color: "var(--accent)" }}>
                {KIND_LABEL[item.kind]}
              </span>
              <span className="t-header truncate-1" style={{ color: "var(--text-primary)" }}>
                {item.title}
              </span>
            </div>
            <div className="flex shrink-0 items-center" style={{ gap: "var(--sp-1)" }}>
              {items.length > 1 && (
                <>
                  <button
                    type="button"
                    className="btn"
                    style={{ width: 26, height: 26, padding: 0 }}
                    onClick={() => show(items[index - 1].id)}
                    disabled={index <= 0}
                    aria-label="Previous"
                  >
                    <ChevronLeftIcon size={14} />
                  </button>
                  <span className="t-time" style={{ minWidth: 34, textAlign: "center" }}>
                    {index + 1}/{items.length}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    style={{ width: 26, height: 26, padding: 0 }}
                    onClick={() => show(items[index + 1].id)}
                    disabled={index >= items.length - 1}
                    aria-label="Next"
                  >
                    <ChevronRightIcon size={14} />
                  </button>
                </>
              )}
              {canCopy && (
                <button type="button" className="btn" style={{ width: 26, height: 26, padding: 0 }} onClick={copy} aria-label="Copy" title="Copy">
                  {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                </button>
              )}
              <button
                type="button"
                className="btn"
                style={{ width: 26, height: 26, padding: 0 }}
                onClick={() => download(item)}
                aria-label="Download"
                title="Download"
              >
                <DownloadIcon size={13} />
              </button>
              {canPin && (
                <button type="button" className="btn" style={{ width: 26, height: 26, padding: 0 }} onClick={pin} aria-label="Pin as hologram" title="Pin as hologram">
                  <PinIcon size={13} />
                </button>
              )}
              <button
                type="button"
                className="btn"
                style={{ width: 26, height: 26, padding: 0 }}
                onClick={close}
                aria-label="Close"
                title="Close (Esc)"
              >
                <XIcon size={14} />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "var(--sp-4)", color: "var(--text-primary)", lineHeight: 1.6 }}>
            <Body item={item} />
            {item.caption && (
              <p className="t-time" style={{ marginTop: "var(--sp-3)", textTransform: "none", letterSpacing: "normal" }}>
                {item.caption}
              </p>
            )}
          </div>

          <div
            onPointerDown={startResize}
            className="absolute"
            style={{
              right: 0,
              bottom: 0,
              width: 16,
              height: 16,
              cursor: "nwse-resize",
              touchAction: "none",
              background:
                "linear-gradient(135deg, transparent 50%, rgba(var(--accent-rgb), 0.6) 50%, rgba(var(--accent-rgb), 0.6) 60%, transparent 60%, transparent 70%, rgba(var(--accent-rgb), 0.6) 70%, rgba(var(--accent-rgb), 0.6) 80%, transparent 80%)",
            }}
            aria-label="Resize the window"
            title="Drag to resize"
          />
        </motion.section>
      )}
    </AnimatePresence>
  )
}
