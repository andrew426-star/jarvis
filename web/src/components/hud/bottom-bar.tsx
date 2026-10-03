"use client"

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react"
import {
  BriefcaseIcon,
  CameraIcon,
  CameraOffIcon,
  MailIcon,
  PaperclipIcon,
  SettingsIcon,
  TrendingUpIcon,
  XIcon,
} from "lucide-react"

import { MicButton, type MicButtonHandle } from "@/components/mic-button"
import { addAttachments, type Attachment } from "@/lib/attachments"
import { useSpatial } from "@/lib/spatial-store"
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
  onSend: (message: string, viaVoice: boolean, attachments?: Attachment[]) => void
  onAuthError: () => void
  micRef: React.RefObject<MicButtonHandle | null>
  onToggleCamera: () => void
}

export function BottomBar({
  token,
  disabled,
  onSend,
  onAuthError,
  micRef,
  onToggleCamera,
}: BottomBarProps) {
  const cameraOn = useSpatial((state) => state.cameraOn)
  const [value, setValue] = useState("")
  const [focused, setFocused] = useState(false)
  const setSettingsOpen = useJarvis((state) => state.setSettingsOpen)
  const setListening = useJarvis((state) => state.setListening)
  const notify = useJarvis((state) => state.notify)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Read through a ref by the window drop handler, which is bound once.
  const attachmentsRef = useRef(attachments)
  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  async function attach(files: File[]) {
    if (!files.length) return
    const { attachments: next, problems } = await addAttachments(attachmentsRef.current, files)
    setAttachments(next)
    for (const problem of problems) notify("warning", "Attachment skipped", problem)
  }

  // Files dropped anywhere on the console attach to the next message.
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return
      event.preventDefault()
      setDragging(true)
    }
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false)
    }
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return
      event.preventDefault()
      setDragging(false)
      void attach(Array.from(event.dataTransfer.files))
    }
    window.addEventListener("dragover", over)
    window.addEventListener("dragleave", leave)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragover", over)
      window.removeEventListener("dragleave", leave)
      window.removeEventListener("drop", drop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attach reads state through a ref
  }, [])

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const files = Array.from(event.clipboardData.files)
    if (!files.length) return
    event.preventDefault()
    void attach(files)
  }

  function submit() {
    const trimmed = value.trim()
    if ((!trimmed && !attachments.length) || disabled) return
    onSend(trimmed || "Take a look at what I've attached.", false, attachments)
    setValue("")
    setAttachments([])
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <footer
      className="relative flex items-center"
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
          onPaste={handlePaste}
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
        <button
          type="button"
          className="shrink-0 cursor-pointer"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          aria-label="Attach files"
          title="Attach images, PDFs or text files (or drop / paste them)"
          style={{ background: "transparent", border: 0, color: attachments.length ? "var(--accent)" : "var(--text-secondary)" }}
        >
          <PaperclipIcon size={15} />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept="image/*,.heic,.heif,.pdf,.txt,.md,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.js,.ts,.tsx,.py,.c,.cpp,.h,.ino,.java,.go,.rs,.sql,.log"
          onChange={(event) => {
            void attach(Array.from(event.target.files ?? []))
            event.target.value = ""
          }}
        />
      </div>

      {/* Pending attachments float just above the bar. */}
      {(attachments.length > 0 || dragging) && (
        <div
          className="absolute flex flex-wrap items-center"
          style={{ left: "50%", transform: "translateX(-50%)", bottom: 62, maxWidth: 600, gap: 6 }}
        >
          {dragging && <span className="t-label attachment-chip" data-drop>DROP TO ATTACH</span>}
          {attachments.map((file, index) => (
            <span key={`${file.name}-${index}`} className="t-label attachment-chip flex items-center" style={{ gap: 6 }}>
              {file.preview && (
                // eslint-disable-next-line @next/next/no-img-element -- a local data URL thumbnail
                <img src={file.preview} alt="" style={{ height: 18, borderRadius: 2 }} />
              )}
              {file.name}
              <button
                type="button"
                onClick={() => setAttachments((all) => all.filter((_, i) => i !== index))}
                aria-label={`Remove ${file.name}`}
                style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer", padding: 0 }}
              >
                <XIcon size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

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
          label={cameraOn ? "Turn camera off" : "Turn camera on"}
          Icon={cameraOn ? CameraOffIcon : CameraIcon}
          onClick={onToggleCamera}
        />
        <ActionButton
          label="Settings"
          Icon={SettingsIcon}
          onClick={() => setSettingsOpen(true)}
        />
      </div>
    </footer>
  )
}
