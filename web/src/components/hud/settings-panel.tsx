"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDownIcon, ExternalLinkIcon, XIcon } from "lucide-react"

import { apiOrigin, type ConnectionStatus } from "@/lib/jarvis-client"
import { useJarvis } from "@/lib/store"

// Everything in this panel is either wired to something real or is not
// here at all.
//
// The v2 spec asked for seven sections - voice model, LLM provider, wake
// phrase, personality, integrations, memory stats, appearance. Five of
// them had nothing behind them: the model and provider are server-side
// config this app cannot set, there is no wake-word engine, and the
// memory counts were invented. A settings screen whose controls do
// nothing is worse than a short one, because it teaches you the app
// lies. What replaced them are the three things that genuinely exist and
// previously had no UI at all: the OAuth connect flows, the session, and
// live diagnostics.

interface Connection {
  key: string
  label: string
  path: string
  note: string
}

// These endpoints are real (app/api/routes/google_auth.py,
// spotify_auth.py, zoho_auth.py) and until now were reachable only by
// typing the URL by hand.
const CONNECTIONS: Connection[] = [
  { key: "google", label: "Google", path: "/auth/google/connect", note: "Gmail, Calendar, Drive" },
  { key: "spotify", label: "Spotify", path: "/auth/spotify/connect", note: "Playback control" },
  { key: "zoho", label: "Zoho Mail", path: "/auth/zoho/connect", note: "Inbox, read-only" },
]

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between" style={{ gap: "var(--sp-2)" }}>
      <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span
        className="truncate-1"
        style={{
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: "12px",
          color: color ?? "var(--text-primary)",
          maxWidth: "60%",
          textAlign: "right",
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

const STATUS_STYLE: Record<ConnectionStatus, { color: string; text: string }> = {
  connected: { color: "var(--success)", text: "LINKED" },
  disconnected: { color: "var(--warning)", text: "NOT LINKED" },
  not_configured: { color: "var(--text-secondary)", text: "NO CREDS" },
  unknown: { color: "var(--text-secondary)", text: "UNKNOWN" },
}

function Connections() {
  const connections = useJarvis((state) => state.connections)

  return (
    <>
      {CONNECTIONS.map((connection) => {
        const live = connections?.find((entry) => entry.provider === connection.key)
        const status: ConnectionStatus | null = live?.status ?? null
        const style = status ? STATUS_STYLE[status] : null
        // Nothing to connect to when the server has no credentials for
        // it - offering the link would just walk into a 500.
        const linkable = status !== "not_configured"

        return (
          <div key={connection.key} className="flex flex-col" style={{ gap: "var(--sp-1)" }}>
            <div className="flex min-w-0 items-center justify-between" style={{ gap: "var(--sp-2)" }}>
              <div className="flex min-w-0 items-center" style={{ gap: "var(--sp-1)" }}>
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: style?.color ?? "var(--text-secondary)" }}
                />
                <span
                  className="truncate-1"
                  style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-primary)" }}
                >
                  {connection.label}
                </span>
              </div>
              <span
                className="t-label truncate-1 shrink-0"
                style={{ color: style?.color ?? "var(--text-secondary)" }}
              >
                {connections === null ? "CHECKING" : (style?.text ?? "UNKNOWN")}
              </span>
            </div>

            <span
              className="t-label truncate-1"
              style={{ color: "var(--text-secondary)" }}
              title={live?.account ?? connection.note}
            >
              {live?.account ?? connection.note}
            </span>

            {linkable && (
              <a
                href={`${apiOrigin()}${connection.path}`}
                className="btn"
                style={{ justifyContent: "space-between", padding: "4px var(--sp-2)" }}
              >
                <span className="truncate-1">
                  {status === "connected" ? "Reconnect" : "Connect"}
                </span>
                <ExternalLinkIcon size={12} className="shrink-0" />
              </a>
            )}
          </div>
        )
      })}
      <p
        className="wrap-words"
        style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.4 }}
      >
        Live from GET /status. &quot;No creds&quot; means the server has no client ID for that
        provider - an environment variable, not a consent screen.
      </p>
    </>
  )
}

function Session({ sessionId, onSignOut }: { sessionId: string; onSignOut: () => void }) {
  const signals = useJarvis((state) => state.signals)
  return (
    <>
      <Row label="TURNS" value={`${signals.turns} / ${signals.contextWindow}`} color="var(--accent)" />
      <Row label="TOOLS" value={`${signals.toolsUsed.length}`} />
      <Row label="ID" value={sessionId.slice(0, 8) || "--"} />
      <button type="button" onClick={onSignOut} className="btn" style={{ padding: "6px 12px" }}>
        Sign Out
      </button>
    </>
  )
}

function Diagnostics() {
  const signals = useJarvis((state) => state.signals)
  const history = signals.latencyHistory
  const average = history.length
    ? Math.round(history.reduce((total, value) => total + value, 0) / history.length)
    : null

  return (
    <>
      <Row
        label="LINK"
        value={signals.link.toUpperCase()}
        color={
          signals.link === "up"
            ? "var(--success)"
            : signals.link === "down"
              ? "var(--error)"
              : "var(--text-secondary)"
        }
      />
      <Row label="LAST" value={signals.latencyMs === null ? "--" : `${signals.latencyMs}ms`} />
      <Row label="AVG" value={average === null ? "--" : `${average}ms`} />
      <Row label="PEAK" value={history.length ? `${Math.max(...history)}ms` : "--"} />
      <Row label="CALLS" value={`${history.length}`} />
      <Row label="API" value={apiOrigin() || "same-origin"} />
      <Row label="FPS" value={`${Math.round(signals.fps)}`} />
    </>
  )
}

function Appearance() {
  const mode = useJarvis((state) => state.mode)
  const toggleMode = useJarvis((state) => state.toggleMode)
  const gridVisible = useJarvis((state) => state.gridVisible)
  const setGridVisible = useJarvis((state) => state.setGridVisible)

  return (
    <>
      <div className="flex min-w-0 items-center justify-between" style={{ gap: "var(--sp-2)" }}>
        <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
          MODE
        </span>
        <button
          type="button"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            toggleMode({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
          }}
          className="btn" style={{ padding: "4px 12px" }}>
          {mode === "serious" ? "Serious" : "Normal"}
        </button>
      </div>
      <div className="flex min-w-0 items-center justify-between" style={{ gap: "var(--sp-2)" }}>
        <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
          GRID
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={gridVisible}
          aria-label="Background grid"
          onClick={() => setGridVisible(!gridVisible)}
          className="relative cursor-pointer"
          style={{
            width: "36px",
            height: "18px",
            borderRadius: "var(--radius)",
            border: `1px solid rgba(var(--accent-rgb), ${gridVisible ? 1 : 0.4})`,
            background: gridVisible ? "rgba(var(--accent-rgb), 0.15)" : "transparent",
            transition: "all 200ms ease",
          }}
        >
          <span
            className="absolute top-1/2"
            style={{
              width: "10px",
              height: "10px",
              left: gridVisible ? "22px" : "3px",
              transform: "translateY(-50%)",
              background: "var(--accent)",
              transition: "left 200ms ease",
            }}
          />
        </button>
      </div>
      <p
        className="wrap-words"
        style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.4 }}
      >
        Serious mode turns the whole console red-hot: palette, grid, scanlines and edges. Both settings persist per browser.
      </p>
    </>
  )
}

interface SettingsPanelProps {
  sessionId: string
  onSignOut: () => void
}

export function SettingsPanel({ sessionId, onSignOut }: SettingsPanelProps) {
  const open = useJarvis((state) => state.settingsOpen)
  const setOpen = useJarvis((state) => state.setSettingsOpen)
  const [expanded, setExpanded] = useState<string | null>("connections")

  const sections = [
    { key: "connections", title: "Connections", render: () => <Connections /> },
    {
      key: "session",
      title: "Session",
      render: () => <Session sessionId={sessionId} onSignOut={onSignOut} />,
    },
    { key: "diagnostics", title: "Diagnostics", render: () => <Diagnostics /> },
    { key: "appearance", title: "Appearance", render: () => <Appearance /> },
  ]

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0"
            style={{ background: "rgba(0, 0, 0, 0.6)", zIndex: 99 }}
            aria-hidden
          />
          <motion.aside
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed top-0 right-0 bottom-0 flex flex-col overflow-hidden"
            style={{
              width: "320px",
              zIndex: 100,
              background: "rgba(5, 5, 10, 0.95)",
              backdropFilter: "blur(12px)",
              borderLeft: "1px solid rgba(var(--accent-rgb), 0.3)",
            }}
            role="dialog"
            aria-label="Settings"
          >
            <div
              className="flex shrink-0 items-center justify-between"
              style={{
                padding: "var(--sp-3) var(--sp-4)",
                borderBottom: "1px solid rgba(var(--accent-rgb), 0.15)",
              }}
            >
              <h2 className="t-header truncate-1" style={{ color: "var(--accent)" }}>
                Settings
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close settings"
                className="btn"
                style={{ width: "24px", height: "24px", padding: 0 }}
              >
                <XIcon size={13} />
              </button>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto"
              style={{ padding: "var(--sp-2) var(--sp-4)" }}
            >
              {sections.map((section) => {
                const isOpen = expanded === section.key
                return (
                  <div
                    key={section.key}
                    style={{ borderBottom: "1px solid rgba(var(--accent-rgb), 0.1)" }}
                  >
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : section.key)}
                      aria-expanded={isOpen}
                      className="flex w-full cursor-pointer items-center justify-between"
                      style={{
                        background: "transparent",
                        border: 0,
                        padding: "var(--sp-3) 0",
                        gap: "var(--sp-2)",
                      }}
                    >
                      <span
                        className="truncate-1"
                        style={{
                          fontFamily: "var(--font-orbitron), sans-serif",
                          fontSize: "12px",
                          fontWeight: 600,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          color: isOpen ? "var(--accent)" : "var(--text-secondary)",
                        }}
                      >
                        {section.title}
                      </span>
                      <ChevronDownIcon
                        size={14}
                        style={{
                          flex: "none",
                          color: "var(--text-secondary)",
                          transform: isOpen ? "rotate(180deg)" : "none",
                          transition: "transform 200ms ease",
                        }}
                      />
                    </button>

                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: "easeInOut" }}
                          style={{ overflow: "hidden" }}
                        >
                          <div
                            className="flex flex-col"
                            style={{ gap: "var(--sp-2)", padding: "0 0 var(--sp-3)" }}
                          >
                            {section.render()}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
