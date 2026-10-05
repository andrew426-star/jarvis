"use client"

import { useState } from "react"
import { ChevronLeftIcon, LibraryIcon, WrenchIcon, XIcon } from "lucide-react"

import { useSpatial } from "@/lib/spatial-store"
import { SCAD_TEMPLATES } from "@/lib/workshop/openscad"
import type { ItemMode } from "@/lib/workshop/scene"

export interface StageItem {
  id: string
  name: string
  mode: ItemMode
}

interface LibraryDockProps {
  ready: boolean
  compiling: boolean
  items: StageItem[]
  focusedId: string | null
  onTemplate: (label: string, code: string) => void
  onFocus: (id: string) => void
  onDiscard: (id: string) => void
}

const STORAGE_KEY = "jarvis_workshop_dock"

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "closed"
  } catch {
    return true
  }
}

// The workshop's library, docked down the left edge in place of a strip of
// buttons in the header: the printable templates, and what is on the
// stage right now. Projects have their own gallery. Every control is an
// ordinary button, so hands reach it with an air tap like anything else.
export function LibraryDock(props: LibraryDockProps) {
  const [open, setOpen] = useState(readOpen)
  // The camera panel sits over the bottom-left corner while it is on.
  const cameraOn = useSpatial((state) => state.cameraOn)

  function toggle(next: boolean) {
    setOpen(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? "open" : "closed")
    } catch {
      // Remembered for this session only.
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn absolute flex items-center"
        style={{ top: 12, left: 12, zIndex: 2, gap: 6, padding: "6px 10px" }}
        onClick={() => toggle(true)}
        title="Open the library"
      >
        <LibraryIcon size={13} /> LIBRARY
      </button>
    )
  }

  return (
    <aside
      className="holo-card flex flex-col"
      style={{
        // Inline, not the `absolute` class: .holo-card sets position:
        // relative outside Tailwind's layers, which beats the utility.
        position: "absolute",
        top: 12,
        left: 12,
        width: 244,
        zIndex: 2,
        maxHeight: cameraOn ? "calc(100% - 24px - 250px)" : "calc(100% - 24px)",
      }}
      aria-label="Workshop library"
    >
      <header className="holo-card-header">
        <span className="t-label flex items-center" style={{ gap: 6 }}>
          <LibraryIcon size={12} /> LIBRARY
        </span>
        <button
          type="button"
          className="btn"
          style={{ width: 20, height: 20, padding: 0 }}
          onClick={() => toggle(false)}
          aria-label="Collapse the library"
        >
          <ChevronLeftIcon size={12} className="mx-auto" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "var(--sp-2)" }}>
        <Section title="PRINTABLE PARTS">
          <div className="flex flex-col" style={{ gap: 4 }}>
            {SCAD_TEMPLATES.map((template) => (
              <button
                key={template.key}
                type="button"
                className="library-row"
                disabled={!props.ready || props.compiling}
                onClick={() => props.onTemplate(template.label, template.code)}
                title={`Compile a ${template.label.toLowerCase()} in OpenSCAD`}
              >
                <WrenchIcon size={13} className="shrink-0" style={{ color: "var(--accent)" }} />
                <span className="flex min-w-0 flex-col" style={{ textAlign: "left" }}>
                  <span className="t-label truncate-1" style={{ color: "var(--text-primary)" }}>
                    {template.label.toUpperCase()}
                  </span>
                  <span className="truncate-1" style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                    {template.blurb}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Section>

        <Section title={`ON STAGE · ${props.items.length}`}>
          {props.items.length === 0 ? (
            <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: 0 }}>
              Nothing yet. Open a project from the gallery, pick a part, or ask Jarvis to build one.
            </p>
          ) : (
            <div className="flex flex-col" style={{ gap: 4 }}>
              {props.items.map((item) => (
                <div key={item.id} className="library-row" data-active={item.id === props.focusedId}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center"
                    style={{ gap: 6, background: "transparent", border: 0, color: "inherit", cursor: "pointer", padding: 0 }}
                    onClick={() => props.onFocus(item.id)}
                    title="Select"
                  >
                    <span className="truncate-1 t-label" style={{ color: "var(--text-primary)" }}>
                      {item.name.toUpperCase()}
                    </span>
                    <span className="t-time shrink-0">{item.mode === "wire" ? "HOLO" : "SOLID"}</span>
                  </button>
                  <button
                    type="button"
                    className="shrink-0"
                    style={{ background: "transparent", border: 0, color: "var(--text-secondary)", cursor: "pointer", padding: 0 }}
                    onClick={() => props.onDiscard(item.id)}
                    aria-label={`Discard ${item.name}`}
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "var(--sp-3)" }}>
      <h3 className="t-label" style={{ margin: "0 0 6px", color: "var(--accent)", letterSpacing: "0.12em" }}>
        {title}
      </h3>
      {children}
    </section>
  )
}
