"use client"

import { useState } from "react"
import { CheckIcon, ListChecksIcon } from "lucide-react"

import { JarvisAuthError, setChecklistItem, type Checklist } from "@/lib/jarvis-client"

// A checklist Jarvis made (app/tools/checklist.py), as a card under his
// reply. One component for the desktop chat and the phone, so a list looks
// and ticks the same on both; sizes are in em, so it takes each bubble's
// type size. Ticks save straight away, without a model turn.

export function ChecklistCard({
  checklist,
  token,
  onAuthError,
}: {
  checklist: Checklist
  token: string
  onAuthError: () => void
}) {
  const [list, setList] = useState(checklist)
  const [failed, setFailed] = useState(false)
  const done = list.items.filter((item) => item.done).length

  async function toggle(itemId: string, next: boolean) {
    const before = list
    // Ticked on tap; put back if the save fails.
    setList({ ...list, items: list.items.map((i) => (i.id === itemId ? { ...i, done: next } : i)) })
    setFailed(false)
    try {
      setList(await setChecklistItem(list.id, itemId, next, token))
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setList(before)
      setFailed(true)
    }
  }

  return (
    <div
      className="w-full"
      style={{
        marginTop: "0.6em",
        padding: "0.5em 0.7em",
        border: "1px solid rgba(var(--accent-rgb), 0.3)",
        borderRadius: "var(--radius)",
        background: "rgba(5, 5, 8, 0.45)",
        whiteSpace: "normal",
      }}
    >
      <div className="flex items-center" style={{ gap: "0.4em", marginBottom: "0.35em" }}>
        <ListChecksIcon size="1.05em" style={{ color: "var(--accent)" }} aria-hidden />
        <span className="t-panel-header" style={{ color: "var(--accent)" }}>
          {list.title}
        </span>
        <span className="t-label ml-auto" style={{ color: done === list.items.length ? "var(--success)" : "var(--text-secondary)" }}>
          {done}/{list.items.length}
        </span>
      </div>
      <ul className="flex flex-col" style={{ gap: "0.15em" }}>
        {list.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="flex w-full cursor-pointer items-start text-left"
              style={{ gap: "0.55em", padding: "0.3em 0", background: "transparent", border: 0, minHeight: "2.2em" }}
              aria-pressed={item.done}
              onClick={() => void toggle(item.id, !item.done)}
            >
              <span
                className="inline-flex shrink-0 items-center justify-center"
                style={{
                  width: "1.15em",
                  height: "1.15em",
                  marginTop: "0.2em",
                  border: "1px solid rgba(var(--accent-rgb), 0.6)",
                  borderRadius: "var(--radius)",
                  background: item.done ? "rgba(var(--accent-rgb), 0.25)" : "transparent",
                  color: "var(--accent)",
                }}
                aria-hidden
              >
                {item.done && <CheckIcon size="0.85em" />}
              </span>
              <span
                style={{
                  color: item.done ? "var(--text-secondary)" : "var(--text-primary)",
                  textDecoration: item.done ? "line-through" : "none",
                }}
              >
                {item.text}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {failed && (
        <p className="t-label" style={{ color: "var(--error)", marginTop: "0.3em" }}>
          Could not save that tick. Try again.
        </p>
      )}
    </div>
  )
}

