"use client"

import { AnimatePresence, motion } from "framer-motion"
import { XIcon } from "lucide-react"

import { useJarvis, type LogLevel } from "@/lib/store"

// Two sections, both flex-1, both scrolling. Equal height is the point:
// a log that grew to fill the panel while notifications sat in a stub at
// the bottom was the "dead space" complaint.

const LEVEL_COLOR: Record<LogLevel, string> = {
  OK: "var(--success)",
  WARN: "var(--warning)",
  ERR: "var(--error)",
  NONE: "var(--text-primary)",
}

const KIND_COLOR = {
  info: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
} as const

function SectionHeader({ title, count }: { title: string; count?: string }) {
  return (
    <div
      className="flex shrink-0 items-center justify-between"
      style={{
        gap: "var(--sp-2)",
        paddingBottom: "var(--sp-2)",
        borderBottom: "1px solid rgba(var(--accent-rgb), 0.15)",
      }}
    >
      <h2 className="t-panel-header truncate-1">{title}</h2>
      {count && (
        <span className="t-label shrink-0" style={{ color: "var(--text-secondary)" }}>
          {count}
        </span>
      )}
    </div>
  )
}

function SystemLog() {
  const logs = useJarvis((state) => state.logs)

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ gap: "var(--sp-2)" }}>
      <SectionHeader title="System Log" count={`${logs.length}`} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence initial={false}>
          {logs.map((entry) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex min-w-0 items-baseline"
              style={{ gap: "var(--sp-2)", padding: "4px 0", lineHeight: 1.45 }}
            >
              <span
                className="shrink-0"
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: "11px",
                  color: "var(--text-secondary)",
                }}
              >
                {entry.time}
              </span>
              {entry.level !== "NONE" && (
                <span
                  className="shrink-0"
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: "11px",
                    color: LEVEL_COLOR[entry.level],
                  }}
                >
                  {entry.level}
                </span>
              )}
              {/* Two lines, then an ellipsis: at this column width a single
                  line cut most entries off after a word or two. */}
              <span
                className="wrap-words clamp-2 flex-1"
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: "11px",
                  color: "var(--text-primary)",
                }}
                title={entry.message}
              >
                {entry.message}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  )
}

function Notifications() {
  const notifications = useJarvis((state) => state.notifications)
  const dismiss = useJarvis((state) => state.dismissNotification)

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ gap: "var(--sp-2)" }}>
      <SectionHeader title="Notifications" count={`${notifications.length}`} />
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        style={{ gap: "var(--sp-2)" }}
      >
        <AnimatePresence initial={false}>
          {notifications.map((item) => (
            <motion.article
              key={item.id}
              layout
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="card shrink-0"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                padding: "var(--sp-2) var(--sp-3)",
                borderLeft: `2px solid ${KIND_COLOR[item.kind]}`,
              }}
            >
              <div
                className="flex min-w-0 items-center justify-between"
                style={{ gap: "var(--sp-1)" }}
              >
                <span className="t-time shrink-0">{item.time}</span>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  aria-label={`Dismiss ${item.title}`}
                  className="flex shrink-0 cursor-pointer items-center justify-center"
                  style={{ width: 20, height: 20, margin: "-4px -6px -4px 0", color: "var(--text-secondary)", background: "transparent", border: 0 }}
                >
                  <XIcon size={12} />
                </button>
              </div>
              <div
                className="truncate-1"
                style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-primary)" }}
                title={item.title}
              >
                {item.title}
              </div>
              <div
                className="clamp-2 wrap-words"
                style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.45 }}
              >
                {item.description}
              </div>
            </motion.article>
          ))}
        </AnimatePresence>

        {notifications.length === 0 && (
          <p className="t-label" style={{ color: "var(--text-secondary)" }}>
            No active notifications.
          </p>
        )}
      </div>
    </section>
  )
}

export function RightPanel() {
  return (
    <aside
      className="panel flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{
        padding: "var(--sp-3)",
        gap: "var(--sp-3)",
        borderLeft: "1px solid rgba(var(--accent-rgb), 0.15)",
      }}
    >
      <SystemLog />
      <Notifications />
    </aside>
  )
}
