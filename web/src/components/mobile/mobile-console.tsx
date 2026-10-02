"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { ArrowUpIcon, Loader2Icon, MonitorIcon, MoreVerticalIcon, RotateCcwIcon, SquareIcon } from "lucide-react"

import { MicButton, type MicButtonHandle } from "@/components/mic-button"
import { ToolBadge } from "@/components/tool-badge"
import { resolveAuth, subscribeAuth } from "@/lib/auth-state"
import {
  JarvisApiError,
  JarvisAuthError,
  JarvisNetworkError,
  googleLoginUrl,
  invokeStream,
} from "@/lib/jarvis-client"
import { stopNarration } from "@/lib/narration"
import { SpeechQueue } from "@/lib/speech-queue"
import { clearSession, clearStoredToken, getOrCreateSessionId } from "@/lib/storage"
import { clockTime } from "@/lib/store"
import { setView } from "@/lib/view"

// The phone view of the console. Same backend, same memory, same voice,
// none of the desktop's instruments: no panels, workshop, camera or
// ambience, so it loads fast on a phone connection and fits one hand.
// Turns go out on the "mobile" channel, which keeps replies short and
// leaves out the tools that operate the desktop console.

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  time: string
  tools?: string[]
  streaming?: boolean
  /** A failed turn: shown in the error colour, with a retry. */
  failed?: { retry: string }
}

type SpeechMode = "voice" | "always" | "off"

const THREAD_KEY = "jarvis_mobile_thread"
const SPEECH_KEY = "jarvis_mobile_speech"
const THREAD_LIMIT = 40

const SUGGESTIONS = [
  "Morning brief",
  "What's on my calendar today?",
  "Italian review",
  "How's the launch tracking?",
]

const SPEECH_LABEL: Record<SpeechMode, string> = {
  voice: "When I speak",
  always: "Always",
  off: "Never",
}

// A zero-length WAV. Playing it inside a tap is what unlocks the shared
// audio element on iOS for the replies that arrive seconds later.
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or a full quota: the thread just won't survive a reload.
  }
}

const URL_PATTERN = /(https?:\/\/[^\s)]+)/g

// Replies are plain text; the only thing worth making tappable is a link.
function Linkified({ text }: { text: string }) {
  const pieces = text.split(URL_PATTERN)
  return (
    <>
      {pieces.map((piece, i) =>
        i % 2 === 1 ? (
          <a key={i} href={piece} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>
            {piece}
          </a>
        ) : (
          piece
        )
      )}
    </>
  )
}

export function MobileConsole() {
  const auth = useSyncExternalStore(subscribeAuth, resolveAuth, () => null)
  const [signedOut, setSignedOut] = useState(false)

  if (auth === null) return <div style={{ height: "100dvh" }} />
  if (signedOut || auth.status === "unauthenticated") {
    return <MobileSignIn loginError={auth.status === "unauthenticated" ? auth.loginError : null} />
  }

  function signOut() {
    clearStoredToken()
    clearSession()
    try {
      window.localStorage.removeItem(THREAD_KEY)
    } catch {}
    setSignedOut(true)
  }

  return <MobileChat token={auth.token} initialSessionId={auth.sessionId} onSignOut={signOut} />
}

function MobileSignIn({ loginError }: { loginError: string | null }) {
  const [redirecting, setRedirecting] = useState(false)
  return (
    <main
      className="flex flex-col items-center justify-center gap-6 px-6"
      style={{ height: "100dvh", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <Reactor size={72} busy={false} />
      <div className="text-center">
        <h1 className="t-header" style={{ fontSize: 20, color: "var(--accent)" }}>
          J.A.R.V.I.S.
        </h1>
        <p className="t-label mt-1" style={{ color: "var(--text-secondary)" }}>
          Authentication required
        </p>
      </div>
      {loginError && (
        <p className="text-center" style={{ color: "var(--error)", fontSize: 14 }}>
          {loginError === "not_allowed"
            ? "That Google account is not authorised for this instance."
            : "Sign-in failed. Try again."}
        </p>
      )}
      <button
        type="button"
        className="btn w-full max-w-xs"
        style={{ height: 52, fontSize: 13 }}
        disabled={redirecting}
        onClick={() => {
          setRedirecting(true)
          window.location.href = googleLoginUrl()
        }}
      >
        {redirecting && <Loader2Icon size={16} className="animate-spin" />}
        {redirecting ? "Redirecting" : "Sign in with Google"}
      </button>
    </main>
  )
}

function Reactor({ size, busy }: { size: number; busy: boolean }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className={busy ? "anim-breathe" : undefined}>
      <circle cx="50" cy="50" r="44" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="3 6" opacity="0.5" />
      <circle cx="50" cy="50" r="32" fill="none" stroke="var(--accent)" strokeWidth="4" strokeDasharray="28 12" opacity="0.85" />
      <circle cx="50" cy="50" r="13" fill="var(--accent)" opacity={busy ? 0.9 : 0.45} />
    </svg>
  )
}

function MobileChat({
  token,
  initialSessionId,
  onSignOut,
}: {
  token: string
  initialSessionId: string
  onSignOut: () => void
}) {
  const [sessionId, setSessionId] = useState(initialSessionId)
  const [messages, setMessages] = useState<Message[]>(() => readStorage<Message[]>(THREAD_KEY, []))
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState("Thinking")
  const [elapsed, setElapsed] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [speech, setSpeech] = useState<SpeechMode>(() => readStorage<SpeechMode>(SPEECH_KEY, "voice"))

  const micRef = useRef<MicButtonHandle>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const unlockedRef = useRef(false)

  // Only settled messages are kept; a reply cut off by a reload is dropped.
  useEffect(() => {
    writeStorage(
      THREAD_KEY,
      messages.filter((m) => !m.streaming).slice(-THREAD_LIMIT)
    )
  }, [messages])

  useEffect(() => writeStorage(SPEECH_KEY, speech), [speech])

  // Follow the conversation down as it grows.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  // A visible clock while waiting: a slow reply that says how slow it is
  // reads as working, not as hung.
  useEffect(() => {
    if (!pending) return
    const started = performance.now()
    const id = setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1000)), 500)
    return () => clearInterval(id)
  }, [pending])

  function unlockAudio() {
    if (unlockedRef.current) return
    unlockedRef.current = true
    const audio = new Audio()
    audio.setAttribute("playsinline", "")
    audio.src = SILENCE
    audio.play().catch(() => {})
    audioRef.current = audio
  }

  function autoGrow() {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }

  async function send(text: string, viaVoice: boolean) {
    const message = text.trim()
    if (!message || pending) return
    stopNarration()
    setDraft("")
    requestAnimationFrame(autoGrow)
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: message, time: clockTime() }])
    setPending(true)
    setStatus("Thinking")
    setElapsed(0)

    const replyId = crypto.randomUUID()
    let shown = false
    const updateReply = (change: (m: Message) => Message) => {
      if (!shown) {
        shown = true
        setMessages((prev) => [
          ...prev,
          change({ id: replyId, role: "assistant", content: "", time: clockTime(), streaming: true }),
        ])
        return
      }
      setMessages((prev) => prev.map((m) => (m.id === replyId ? change(m) : m)))
    }

    const speakIt = speech === "always" || (speech === "voice" && viaVoice)
    const voice = speakIt
      ? new SpeechQueue(
          token,
          {
            onStart: () => setSpeaking(true),
            onEnd: (completed) => {
              setSpeaking(false)
              // Spoken to, so keep the conversation going hands-free.
              if (completed && viaVoice) micRef.current?.startRecording()
            },
            onAuthError: onSignOut,
          },
          audioRef.current ?? undefined
        )
      : null

    try {
      const result = await invokeStream(message, sessionId, token, { channel: "mobile" }, (event) => {
        if (event.type === "status") setStatus(event.label)
        else if (event.type === "text") updateReply((m) => ({ ...m, content: m.content + event.delta }))
        else if (event.type === "reset") updateReply((m) => ({ ...m, content: "" }))
        else if (event.type === "spoken") voice?.push(event.delta)
      })
      voice?.finish(result.spoken)
      updateReply((m) => ({
        ...m,
        content: result.response,
        tools: [...new Set(result.tools_used)],
        streaming: false,
      }))
    } catch (err) {
      voice?.stop()
      if (err instanceof JarvisAuthError) {
        onSignOut()
        return
      }
      const reason =
        err instanceof JarvisNetworkError
          ? "Lost the connection. If the app was in the background, the reply may have been cut off."
          : err instanceof JarvisApiError
            ? err.message
            : "Something went wrong."
      // A partial reply stays; the failure is added after it.
      if (shown) updateReply((m) => ({ ...m, streaming: false }))
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: reason, time: clockTime(), failed: { retry: message } },
      ])
    } finally {
      setPending(false)
    }
  }

  function newConversation() {
    stopNarration()
    clearSession()
    setSessionId(getOrCreateSessionId())
    setMessages([])
    setMenuOpen(false)
  }

  const busy = pending || listening

  return (
    <div
      className="flex flex-col"
      style={{ height: "100dvh", paddingTop: "env(safe-area-inset-top)" }}
      onClickCapture={unlockAudio}
    >
      {/* Header */}
      <header
        className="relative flex shrink-0 items-center gap-3 px-4"
        style={{ height: 56, borderBottom: "1px solid rgba(var(--accent-rgb), 0.15)" }}
      >
        <Reactor size={28} busy={busy || speaking} />
        <div className="min-w-0 flex-1">
          <div className="t-header" style={{ color: "var(--accent)", fontSize: 14 }}>
            J.A.R.V.I.S.
          </div>
          <div className="t-label truncate" style={{ color: "var(--text-secondary)" }}>
            {listening ? "Listening" : pending ? `${status} · ${elapsed}s` : speaking ? "Speaking" : "Online"}
          </div>
        </div>
        {speaking && (
          <button type="button" className="btn" style={{ height: 36, padding: "0 12px" }} onClick={() => stopNarration()}>
            <SquareIcon size={12} /> Stop
          </button>
        )}
        <button
          type="button"
          // Above the menu's backdrop, so the same button closes it.
          className="btn btn-icon relative z-30"
          style={{ width: 44, height: 44, border: "none" }}
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreVerticalIcon size={20} />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
            <div
              className="absolute right-3 z-20 flex w-64 flex-col gap-1 p-2"
              style={{
                top: 52,
                background: "var(--bg-base)",
                border: "1px solid rgba(var(--accent-rgb), 0.3)",
                borderRadius: "var(--radius)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              }}
            >
              <div className="t-label px-2 pt-1" style={{ color: "var(--text-secondary)" }}>
                Speak replies
              </div>
              <div className="flex gap-1 px-1 pb-2">
                {(Object.keys(SPEECH_LABEL) as SpeechMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className="btn flex-1"
                    style={{ height: 36, fontSize: 10, padding: 0 }}
                    data-active={speech === mode}
                    onClick={() => setSpeech(mode)}
                  >
                    {SPEECH_LABEL[mode]}
                  </button>
                ))}
              </div>
              <MenuItem onClick={newConversation} icon={<RotateCcwIcon size={16} />} label="New conversation" />
              <MenuItem onClick={() => setView("desktop")} icon={<MonitorIcon size={16} />} label="Desktop console" />
              <MenuItem onClick={onSignOut} label="Sign out" danger />
            </div>
          </>
        )}
      </header>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {messages.length === 0 && !pending ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
            <Reactor size={88} busy={false} />
            <p style={{ color: "var(--text-secondary)", fontSize: 15 }}>At your service, sir.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="btn"
                  style={{ height: 40, padding: "0 14px", fontFamily: "var(--font-inter)", fontSize: 13, letterSpacing: 0 }}
                  onClick={() => send(s, false)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <Bubble key={m.id} message={m} onRetry={(text) => send(text, false)} disabled={pending} />
            ))}
            {pending && !messages.some((m) => m.streaming) && (
              <div className="flex items-center gap-2 py-1" style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                <Loader2Icon size={14} className="animate-spin" style={{ color: "var(--accent)" }} />
                {status}…
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        className="flex shrink-0 items-end gap-2 px-3 pt-2"
        style={{
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          borderTop: "1px solid rgba(var(--accent-rgb), 0.15)",
          background: "rgba(5, 5, 8, 0.85)",
        }}
        onSubmit={(e) => {
          e.preventDefault()
          send(draft, false)
        }}
      >
        <div className="mobile-mic shrink-0">
          <MicButton
            ref={micRef}
            token={token}
            disabled={pending}
            onAuthError={onSignOut}
            onTranscribed={(text) => send(text, true)}
            onRecordingChange={(recording) => {
              if (recording) stopNarration()
              setListening(recording)
            }}
          />
        </div>
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          enterKeyHint="send"
          placeholder={listening ? "Listening…" : "Message Jarvis"}
          onChange={(e) => {
            setDraft(e.target.value)
            autoGrow()
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send(draft, false)
            }
          }}
          className="min-w-0 flex-1 resize-none outline-none"
          style={{
            // 16px or iOS zooms the page on focus.
            fontSize: 16,
            lineHeight: "22px",
            padding: "11px 12px",
            minHeight: 46,
            color: "var(--text-primary)",
            background: "rgba(var(--accent-rgb), 0.05)",
            border: "1px solid rgba(var(--accent-rgb), 0.3)",
            borderRadius: 4,
          }}
        />
        <button
          type="submit"
          className="btn btn-circle"
          style={{ width: 46, height: 46 }}
          disabled={pending || !draft.trim()}
          aria-label="Send"
        >
          {pending ? <Loader2Icon size={18} className="animate-spin" /> : <ArrowUpIcon size={20} />}
        </button>
      </form>
    </div>
  )
}

function MenuItem({
  onClick,
  icon,
  label,
  danger,
}: {
  onClick: () => void
  icon?: React.ReactNode
  label: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 px-2 text-left"
      style={{ height: 44, fontSize: 15, color: danger ? "var(--error)" : "var(--text-primary)" }}
    >
      {icon}
      {label}
    </button>
  )
}

function Bubble({
  message,
  onRetry,
  disabled,
}: {
  message: Message
  onRetry: (text: string) => void
  disabled: boolean
}) {
  const isUser = message.role === "user"
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className="max-w-[88%] whitespace-pre-wrap break-words"
        style={{
          fontSize: 15,
          lineHeight: 1.5,
          padding: "10px 13px",
          borderRadius: 6,
          color: message.failed ? "var(--error)" : "var(--text-primary)",
          background: isUser ? "rgba(var(--accent-rgb), 0.12)" : "rgba(10, 14, 26, 0.75)",
          border: `1px solid ${
            message.failed ? "rgba(255, 51, 51, 0.4)" : `rgba(var(--accent-rgb), ${isUser ? 0.35 : 0.15})`
          }`,
        }}
      >
        <Linkified text={message.content} />
        {message.streaming && <span className="caret" />}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1">
        <span className="t-time" style={{ color: "var(--text-secondary)" }}>
          {message.time}
        </span>
        {message.tools?.map((tool) => <ToolBadge key={tool} tool={tool} />)}
        {message.failed && (
          <button
            type="button"
            className="btn"
            style={{ height: 30, padding: "0 10px" }}
            disabled={disabled}
            onClick={() => onRetry(message.failed!.retry)}
          >
            <RotateCcwIcon size={12} /> Retry
          </button>
        )}
      </div>
    </div>
  )
}
