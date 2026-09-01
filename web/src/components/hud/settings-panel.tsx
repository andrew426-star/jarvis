"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDownIcon, XIcon } from "lucide-react"

import { useJarvis } from "@/lib/store"

// Slide-in from the right, accordion sections, one open at a time.
// Everything in here is presentational: it is the settings surface the
// spec asks for, not a wired-up configuration system, and nothing it
// shows is read back by the backend.

const LLM_PROVIDERS = ["Groq", "OpenRouter", "Ollama", "Claude", "ChatGPT", "Gemini"]
const INTEGRATIONS = ["Spotify", "Email", "Notion", "Google Drive", "Composio"]
const SWATCHES = ["#00d4ff", "#00ff88", "#ffaa00", "#ff3333", "#0080ff"]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between" style={{ gap: "var(--sp-2)" }}>
      <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Slider({ label, initial }: { label: string; initial: number }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="flex flex-col" style={{ gap: "var(--sp-1)" }}>
      <div className="flex items-center justify-between">
        <span className="t-label" style={{ color: "var(--text-secondary)" }}>
          {label}
        </span>
        <span className="t-label" style={{ color: "var(--accent)" }}>
          {value}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
        aria-label={label}
        className="w-full cursor-pointer"
        style={{ accentColor: "var(--accent)" }}
      />
    </div>
  )
}

function Toggle({ label, initial }: { label: string; initial: boolean }) {
  const [on, setOn] = useState(initial)
  return (
    <Row label={label}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => setOn((prev) => !prev)}
        className="relative cursor-pointer"
        style={{
          width: "36px",
          height: "18px",
          borderRadius: "var(--radius)",
          border: `1px solid rgba(var(--accent-rgb), ${on ? 1 : 0.4})`,
          background: on ? "rgba(var(--accent-rgb), 0.15)" : "transparent",
          transition: "all 200ms ease",
        }}
      >
        <span
          className="absolute top-1/2"
          style={{
            width: "10px",
            height: "10px",
            left: on ? "22px" : "3px",
            transform: "translateY(-50%)",
            background: "var(--accent)",
            transition: "left 200ms ease",
          }}
        />
      </button>
    </Row>
  )
}

interface Section {
  key: string
  title: string
  render: () => React.ReactNode
}

const SECTIONS: Section[] = [
  {
    key: "voice",
    title: "Voice Configuration",
    render: () => (
      <>
        <Row label="MODEL">
          <select
            aria-label="Voice model"
            className="cursor-pointer"
            style={{
              background: "transparent",
              border: "1px solid rgba(var(--accent-rgb), 0.4)",
              color: "var(--accent)",
              fontSize: "11px",
              padding: "2px 6px",
            }}
          >
            <option>eleven_flash_v2_5</option>
            <option>eleven_turbo_v2</option>
            <option>eleven_multilingual_v2</option>
          </select>
        </Row>
        <Slider label="SPEED" initial={50} />
        <Slider label="PITCH" initial={50} />
        <button type="button" className="btn" style={{ padding: "6px 12px" }}>
          Test Voice
        </button>
      </>
    ),
  },
  {
    key: "llm",
    title: "LLM Provider",
    render: () => <ProviderPills />,
  },
  {
    key: "wake",
    title: "Wake Phrase",
    render: () => (
      <input
        defaultValue="Jarvis"
        aria-label="Wake phrase"
        style={{
          width: "100%",
          background: "rgba(10, 14, 26, 0.6)",
          border: "1px solid rgba(var(--accent-rgb), 0.2)",
          color: "var(--text-primary)",
          fontSize: "13px",
          padding: "6px var(--sp-2)",
          outline: "none",
        }}
      />
    ),
  },
  {
    key: "personality",
    title: "Personality",
    render: () => (
      <textarea
        readOnly
        rows={6}
        aria-label="System prompt"
        value={
          "You are J.A.R.V.I.S., Andrew's personal AI chief-of-staff.\nAddress him as sir. Be concise, dry, and unfailingly competent.\nNever speculate where you can check."
        }
        style={{
          width: "100%",
          resize: "none",
          background: "rgba(10, 14, 26, 0.6)",
          border: "1px solid rgba(var(--accent-rgb), 0.2)",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: "11px",
          lineHeight: 1.5,
          padding: "var(--sp-2)",
          outline: "none",
        }}
      />
    ),
  },
  {
    key: "integrations",
    title: "Integrations",
    render: () => (
      <>
        {INTEGRATIONS.map((name, index) => (
          <Toggle key={name} label={name} initial={index < 3} />
        ))}
      </>
    ),
  },
  {
    key: "memory",
    title: "Memory",
    render: () => (
      <>
        <Row label="FACTS">
          <span className="t-label" style={{ color: "var(--accent)" }}>
            47
          </span>
        </Row>
        <Row label="CONVOS">
          <span className="t-label" style={{ color: "var(--accent)" }}>
            312
          </span>
        </Row>
        <Row label="LAST">
          <span className="t-label" style={{ color: "var(--accent)" }}>
            2h ago
          </span>
        </Row>
      </>
    ),
  },
  {
    key: "appearance",
    title: "Appearance",
    render: () => <Appearance />,
  },
]

function ProviderPills() {
  const [selected, setSelected] = useState("Groq")
  return (
    <div className="flex flex-wrap" style={{ gap: "var(--sp-2)" }}>
      {LLM_PROVIDERS.map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={() => setSelected(provider)}
          data-active={selected === provider}
          className="btn"
          style={{ padding: "4px 10px" }}
        >
          {provider}
        </button>
      ))}
    </div>
  )
}

function Appearance() {
  const [swatch, setSwatch] = useState(SWATCHES[0])
  return (
    <>
      <div className="flex" style={{ gap: "var(--sp-2)" }}>
        {SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Accent ${color}`}
            onClick={() => setSwatch(color)}
            className="cursor-pointer rounded-full"
            style={{
              width: "24px",
              height: "24px",
              background: "transparent",
              border: `1px solid ${color}`,
              boxShadow: swatch === color ? `0 0 10px ${color}` : "none",
            }}
          >
            <span
              className="block rounded-full"
              style={{ width: "100%", height: "100%", background: color, opacity: 0.35 }}
            />
          </button>
        ))}
      </div>
      <Toggle label="GRID" initial />
      <Slider label="ANIM SPEED" initial={70} />
    </>
  )
}

export function SettingsPanel() {
  const open = useJarvis((state) => state.settingsOpen)
  const setOpen = useJarvis((state) => state.setSettingsOpen)
  const [expanded, setExpanded] = useState<string | null>("voice")

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

            <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "var(--sp-2) var(--sp-4)" }}>
              {SECTIONS.map((section) => {
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
