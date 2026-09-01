"use client"

import { useRef, useState, type KeyboardEvent } from "react"
import { BriefcaseIcon, MailIcon, SettingsIcon, TrendingUpIcon } from "lucide-react"

import { MicButton, type MicButtonHandle } from "@/components/mic-button"
import { useJarvis } from "@/lib/store"

// The spec's Search / Screenshot / Open App buttons had nothing behind
// them - a browser tab cannot screenshot itself or launch a desktop app,
// and "search" duplicates what the agent already does with web_research.
// These three are real one-shot prompts into /invoke instead, which is
// what a chief-of-staff HUD actually wants a hotkey for.
interface QuickAction {
  key: string
  label: string
  prompt: string
  Icon: typeof MailIcon
}

const ACTIONS: QuickAction[] = [
  {
    key: "brief",
    label: "Morning brief",
    prompt: "Give me my morning briefing: calendar, inbox, and anything urgent.",
    Icon: BriefcaseIcon,
  },
  {
    key: "markets",
    label: "Market check",
    prompt: "How are the markets doing right now, and how is my portfolio positioned?",
    Icon: TrendingUpIcon,
  },
  {
    key: "mail",
    label: "Inbox scan",
    prompt: "Anything in my inbox that actually needs me today?",
    Icon: MailIcon,
  },
]

function ActionButton({
  label,
  Icon,
  onClick,
  disabled,
}: {
  label: string
  Icon: typeof MailIcon
  onClick: () => void
  disabled?: boolean
}) {
  const [showTip, setShowTip] = useState(false)
  const timerRef = useRef<number | null>(null)

  function enter() {
    // 500ms delay, so sweeping the cursor across the row does not fire
    // every tooltip in sequence.
    timerRef.current = window.setTimeout(() => setShowTip(true), 500)
  }
  function leave() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    setShowTip(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={() => setShowTip(true)}
        onBlur={leave}
        aria-label={label}
        className="btn btn-icon"
      >
        <Icon size={16} />
      </button>
      {showTip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-[44px] left-1/2 -translate-x-1/2 whitespace-nowrap"
          style={{
            background: "rgba(5, 5, 10, 0.95)",
            border: "1px solid rgba(var(--accent-rgb), 0.3)",
            borderRadius: "var(--radius)",
            padding: "4px 8px",
            fontSize: "11px",
            color: "var(--text-primary)",
            zIndex: 50,
          }}
        >
          {label}
        </div>
      )}
    </div>
  )
}

interface BottomBarProps {
  token: string
  disabled: boolean
  onSend: (message: string, viaVoice: boolean) => void
  onAuthError: () => void
  micRef: React.RefObject<MicButtonHandle | null>
}

export function BottomBar({ token, disabled, onSend, onAuthError, micRef }: BottomBarProps) {
  const [value, setValue] = useState("")
  const [focused, setFocused] = useState(false)
  const setSettingsOpen = useJarvis((state) => state.setSettingsOpen)
  const setListening = useJarvis((state) => state.setListening)

  function submit() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed, false)
    setValue("")
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <footer
      className="flex items-center"
      style={{
        height: "56px",
        padding: "0 var(--sp-4)",
        gap: "var(--sp-3)",
        background: "rgba(5, 5, 10, 0.8)",
        backdropFilter: "blur(8px)",
        borderTop: "1px solid rgba(var(--accent-rgb), 0.3)",
      }}
    >
      <MicButton
        ref={micRef}
        token={token}
        disabled={disabled}
        onAuthError={onAuthError}
        onTranscribed={(text) => onSend(text, true)}
        onRecordingChange={setListening}
      />

      <div
        className="mx-auto flex min-w-0 flex-1 items-center"
        style={{
          maxWidth: "600px",
          gap: "var(--sp-2)",
          height: "36px",
          padding: "0 var(--sp-3)",
          background: "rgba(10, 14, 26, 0.6)",
          border: `1px solid rgba(var(--accent-rgb), ${focused ? 0.6 : 0.2})`,
          borderRadius: "var(--radius)",
          boxShadow: focused ? "0 0 12px rgba(var(--accent-rgb), 0.15)" : "none",
          transition: "border-color 200ms ease, box-shadow 200ms ease",
        }}
      >
        <span className="shrink-0" style={{ color: "var(--accent)", fontFamily: "var(--font-jetbrains), monospace" }}>
          &gt;
        </span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={disabled ? "Standby..." : "Enter command or speak..."}
          disabled={disabled}
          aria-label="Command input"
          className="min-w-0 flex-1"
          style={{
            background: "transparent",
            border: 0,
            outline: "none",
            fontSize: "13px",
            color: "var(--text-primary)",
          }}
        />
        {focused && value.length === 0 && <span className="caret shrink-0" aria-hidden />}
      </div>

      <div className="flex shrink-0 items-center" style={{ gap: "var(--sp-2)" }}>
        {ACTIONS.map((action) => (
          <ActionButton
            key={action.key}
            label={action.label}
            Icon={action.Icon}
            disabled={disabled}
            onClick={() => onSend(action.prompt, false)}
          />
        ))}
        <ActionButton
          label="Settings"
          Icon={SettingsIcon}
          onClick={() => setSettingsOpen(true)}
        />
      </div>
    </footer>
  )
}
