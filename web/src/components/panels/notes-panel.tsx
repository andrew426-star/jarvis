"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { ExternalLinkIcon, FileTextIcon, SearchIcon } from "lucide-react"

import { JarvisAuthError, getNote, getNotes, type NoteFile, type NotesResult } from "@/lib/jarvis-client"
import { useShowcase } from "@/lib/showcase-store"
import { clockTime, useJarvis } from "@/lib/store"
import { PanelSection, RefreshButton, ScanRows, itemVariants, listVariants, relativeTime, syncStamp } from "./hud-kit"

interface NotesPanelProps {
  token: string
  onAuthError: () => void
}

// NOTES: the .txt notes Jarvis saved to the Jarvis Notes folder in Drive
// whenever he put notes on screen (app/tools/notes.py). Opening one puts
// it back in the showcase window. Fetched each time the tab opens, so a
// note saved this session is already in the list.
export function NotesPanel({ token, onAuthError }: NotesPanelProps) {
  const [result, setResult] = useState<NotesResult | null>(null)
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  async function load(search = query) {
    setLoading(true)
    try {
      setResult(await getNotes(token, search.trim() || undefined))
      setSyncedAt(new Date())
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setResult({ ok: false, error: "Could not load notes." })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    getNotes(token)
      .then((fetched) => {
        setResult(fetched)
        setSyncedAt(new Date())
      })
      .catch((err) => {
        if (err instanceof JarvisAuthError) {
          onAuthError()
          return
        }
        setResult({ ok: false, error: "Could not load notes." })
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function open(note: NoteFile) {
    setOpening(note.id)
    setOpenError(null)
    try {
      const full = await getNote(note.id, token)
      if (!full.ok) {
        setOpenError(full.error ?? "Could not open that note.")
        return
      }
      // Jarvis saves "title, blank line, body"; the window has its own
      // title, so a heading like that moves up into it.
      const text = full.content ?? ""
      const heading = /^([^\r\n]{1,100})\r?\n\r?\n/.exec(text)
      useJarvis.getState().setActiveTab(null)
      useShowcase.getState().add({
        kind: "text",
        title: heading ? heading[1].trim() : note.title,
        content: (heading ? text.slice(heading[0].length) : text).trim(),
        filename: note.name,
        mime: "text/plain",
        drive_link: note.link ?? undefined,
        time: clockTime(),
      })
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setOpenError("Could not open that note.")
    } finally {
      setOpening(null)
    }
  }

  const notes = result?.notes ?? []

  return (
    <PanelSection
      title="Notes"
      meta={[syncStamp(syncedAt), result?.ok ? `${notes.length} FILES` : null].filter(Boolean).join(" · ")}
      action={
        <div className="flex items-center" style={{ gap: "var(--sp-1)" }}>
          {result?.folder_link && (
            <a
              href={result.folder_link}
              target="_blank"
              rel="noopener noreferrer"
              className="btn flex shrink-0 items-center"
              style={{ height: 28, padding: "0 var(--sp-2)", gap: 6 }}
              title="Open the Jarvis Notes folder in Drive"
            >
              DRIVE <ExternalLinkIcon size={12} />
            </a>
          )}
          <RefreshButton loading={loading} onClick={() => void load()} label="Refresh notes" />
        </div>
      }
    >
      <form
        className="flex items-center"
        style={{ gap: "var(--sp-2)" }}
        onSubmit={(event) => {
          event.preventDefault()
          void load()
        }}
      >
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            size={13}
            className="pointer-events-none absolute"
            style={{ left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }}
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search names and text"
            aria-label="Search notes"
            className="w-full"
            style={{
              height: 30,
              padding: "0 var(--sp-2) 0 30px",
              background: "rgba(0, 0, 0, 0.35)",
              border: "1px solid rgba(var(--accent-rgb), 0.25)",
              borderRadius: "var(--radius)",
              color: "var(--text-primary)",
              fontSize: 13,
            }}
          />
        </div>
        <button type="submit" className="btn shrink-0" style={{ height: 30, padding: "0 var(--sp-3)" }}>
          SEARCH
        </button>
      </form>

      {result?.ok === false && (
        <p className="t-body" style={{ color: "var(--error)" }}>
          {result.error}
        </p>
      )}
      {openError && (
        <p className="t-body" style={{ color: "var(--error)" }}>
          {openError}
        </p>
      )}
      {!result && loading ? <ScanRows rows={4} height={44} /> : null}
      {result?.ok && notes.length === 0 && (
        <p className="t-body" style={{ color: "var(--text-secondary)" }}>
          {query.trim()
            ? "No notes match that."
            : "No notes yet. Whenever Jarvis puts notes on screen, a .txt copy lands here."}
        </p>
      )}

      {notes.length > 0 && (
        <motion.div
          key={`${syncedAt?.getTime()}`}
          variants={listVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 @4xl:grid-cols-2"
          style={{ gap: "var(--sp-1) var(--sp-3)" }}
        >
          {notes.map((note) => (
            <motion.div
              key={note.id}
              variants={itemVariants}
              className="flex min-w-0 items-center"
              style={{
                gap: "var(--sp-2)",
                padding: "var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3)",
                borderLeft: "2px solid rgba(var(--accent-rgb), 0.25)",
              }}
            >
              <button
                type="button"
                onClick={() => void open(note)}
                disabled={opening === note.id}
                className="flex min-w-0 flex-1 items-center text-left hover:underline"
                style={{ gap: "var(--sp-2)", background: "none", border: 0, padding: 0, color: "inherit", cursor: "pointer" }}
                title="Open on screen"
              >
                <FileTextIcon size={14} className="shrink-0" style={{ color: "var(--accent)" }} />
                <span className="flex min-w-0 flex-col" style={{ gap: 2 }}>
                  <span className="t-body truncate-1">{note.title}</span>
                  <span className="t-time" style={{ fontSize: 11 }}>
                    {opening === note.id
                      ? "OPENING…"
                      : `${note.modified_at ? relativeTime(note.modified_at) : ""} · ${note.size.toLocaleString()} B`}
                  </span>
                </span>
              </button>
              {note.link && (
                <a
                  href={note.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn shrink-0"
                  style={{ width: 26, height: 26, padding: 0 }}
                  aria-label={`Open ${note.name} in Drive`}
                  title="Open in Drive"
                >
                  <ExternalLinkIcon size={12} />
                </a>
              )}
            </motion.div>
          ))}
        </motion.div>
      )}
    </PanelSection>
  )
}
