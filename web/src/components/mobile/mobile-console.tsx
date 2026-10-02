"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  ArrowUpIcon,
  GridIcon,
  Loader2Icon,
  MonitorIcon,
  MoreVerticalIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  SquareIcon,
} from "lucide-react"

import { AudioVisualizer } from "@/components/hud/audio-visualizer"
import { CoreCipher } from "@/components/hud/core-cipher"
import { GlobalEffects } from "@/components/hud/global-effects"
import { HolographicGrid } from "@/components/hud/holographic-grid"
import { MicButton, type MicButtonHandle } from "@/components/mic-button"
import { ThinkingIndicator } from "@/components/thinking-indicator"
import { ToolBadge } from "@/components/tool-badge"
import { BAND_COUNT, audioAmplitude, audioBands } from "@/lib/audio-amplitude"
import { resolveAuth, subscribeAuth } from "@/lib/auth-state"
import { emitCore } from "@/lib/core-events"
import {
  JarvisApiError,
  JarvisAuthError,
  JarvisNetworkError,
  getSessionContext,
  googleLoginUrl,
  invokeStream,
} from "@/lib/jarvis-client"
import { stopNarration } from "@/lib/narration"
import { SpeechQueue } from "@/lib/speech-queue"
import { clearSession, clearStoredToken, getOrCreateSessionId } from "@/lib/storage"
import { clockTime, useJarvis, type AgentStatus } from "@/lib/store"
import { centralTime } from "@/lib/time"
import { useBoot } from "@/lib/use-boot"
import { useClock } from "@/lib/use-clock"
import { setView } from "@/lib/view"

// The phone view of the console: the desktop's core, voice bars, grid,
// readouts and modes, arranged for one hand, around the conversation.
// What stays on the desktop is what needs a desk: the data panels, the
// workshop, the camera and hand tracking. Turns go out on the "mobile"
// channel, which keeps replies short and leaves out the console tools.

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

const SUGGESTIONS = ["Morning brief", "What's on my calendar today?", "Italian review", "How's the launch tracking?"]

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
          <a key={i} href={piece} target="_blank" rel="noreferrer" className="underline">
            {piece}
          </a>
        ) : (
          piece
        )
      )}
    </>
  )
}

// While Jarvis talks, the core and the voice bars move to a speech-shaped
// envelope rather than to the audio itself. Measuring the audio would mean
// routing it through Web Audio, and on iOS a suspended audio context then
// silences the voice outright; a decorative pulse is the safer trade. The
// mic side is real either way (mic-button.tsx feeds its own levels in).
function useSpeakingPulse(active: boolean) {
  useEffect(() => {
    if (!active) return
    let frame = 0
    const started = performance.now()
    const tick = (now: number) => {
      const t = (now - started) / 1000
      // Syllables at ~4.5Hz under a slower phrase-level swell.
      const syllable = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 4.5)
      const phrase = 0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 0.6 + 1)
      const energy = syllable * phrase
      audioAmplitude.current = 0.12 + 0.45 * energy
      for (let band = 0; band < BAND_COUNT; band++) {
        const shape = Math.exp(-band / 8)
        audioBands.current[band] = Math.min(1, energy * shape * (0.7 + 0.3 * Math.sin(t * 9 + band * 1.7)))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      audioAmplitude.current = 0
      audioBands.current.fill(0)
    }
  }, [active])
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
      className="relative flex flex-col items-center justify-center gap-6 px-6"
      style={{ height: "100dvh", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <HolographicGrid serious={false} visible />
      <GlobalEffects />
      <Reactor size={88} />
      <div className="relative text-center">
        <h1 className="t-header text-glow" style={{ fontSize: 20, color: "var(--accent)" }}>
          J.A.R.V.I.S.
        </h1>
        <p className="t-label mt-1" style={{ color: "var(--text-secondary)" }}>
          Authentication required
        </p>
      </div>
      {loginError && (
        <p className="relative text-center" style={{ color: "var(--error)", fontSize: 14 }}>
          {loginError === "not_allowed"
            ? "That Google account is not authorised for this instance."
            : "Sign-in failed. Try again."}
        </p>
      )}
      <button
        type="button"
        className="btn relative w-full max-w-xs"
        style={{ height: 52, fontSize: 12 }}
        disabled={redirecting}
        onClick={() => {
          setRedirecting(true)
          window.location.href = googleLoginUrl()
        }}
      >
        {redirecting && <Loader2Icon size={16} className="animate-spin" />}
        {redirecting ? "REDIRECTING" : "AUTHENTICATE WITH GOOGLE"}
      </button>
    </main>
  )
}

// The dormant reactor of the sign-in screen: rings present, core unlit.
function Reactor({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className="relative">
      <circle cx="50" cy="50" r="44" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="2 5" opacity="0.5" />
      <circle cx="50" cy="50" r="32" fill="none" stroke="var(--accent)" strokeWidth="3" strokeDasharray="28 12" opacity="0.8" />
      <circle cx="50" cy="50" r="16" fill="none" stroke="var(--accent)" strokeWidth="1" opacity="0.6" />
      <circle cx="50" cy="50" r="8" fill="var(--accent)" opacity="0.35" />
    </svg>
  )
}

/** The desktop top bar's readouts, condensed to one line. */
function StatusStrip({ onMenu, menuOpen }: { onMenu: () => void; menuOpen: boolean }) {
  const { signals, mode } = useJarvis()
  const now = useClock()
  const linkColor = signals.link === "down" ? "var(--error)" : signals.link === "up" ? "var(--success)" : "var(--text-secondary)"
  const latency = signals.latencyMs
  const latencyColor = latency === null ? "var(--text-secondary)" : latency > 3000 ? "var(--error)" : latency > 1200 ? "var(--warning)" : "var(--success)"

  return (
    <header
      className="relative z-20 flex shrink-0 items-center gap-3 px-4"
      style={{ height: 48, borderBottom: "1px solid rgba(var(--accent-rgb), 0.15)", background: "rgba(5, 5, 8, 0.6)" }}
    >
      <span className="t-header text-glow" style={{ color: "var(--accent)" }}>
        J.A.R.V.I.S.
      </span>
      {mode === "serious" && <ShieldAlertIcon size={13} style={{ color: "var(--accent)" }} aria-label="Serious mode" />}
      <div className="t-label ml-auto flex items-center gap-2.5" style={{ color: "var(--text-secondary)" }}>
        <span className="flex items-center gap-1">
          <span className="inline-block size-1.5 rounded-full" style={{ background: linkColor, boxShadow: `0 0 6px ${linkColor}` }} />
          LINK
        </span>
        <span>
          LAT <span style={{ color: latencyColor }}>{latency === null ? "--" : `${latency}ms`}</span>
        </span>
        <span>
          CTX{" "}
          <span style={{ color: "var(--accent)" }}>
            {signals.turns}/{signals.contextWindow}
          </span>
        </span>
        <span className="t-time hidden min-[400px]:inline">{now ? centralTime(new Date(now), false) : ""}</span>
      </div>
      <button
        type="button"
        // Above the menu's backdrop, so the same button closes it.
        className="btn btn-icon relative z-30"
        style={{ width: 40, height: 40, border: "none" }}
        aria-label="Menu"
        aria-expanded={menuOpen}
        onClick={onMenu}
      >
        <MoreVerticalIcon size={18} />
      </button>
    </header>
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
  const [phase, setPhase] = useState("Thinking")
  const [elapsed, setElapsed] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  const [typing, setTyping] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [speech, setSpeech] = useState<SpeechMode>(() => readStorage<SpeechMode>(SPEECH_KEY, "voice"))

  const { mode, toggleMode, gridVisible, setGridVisible, setContext } = useJarvis()
  const boot = useBoot()
  const serious = mode === "serious"

  const micRef = useRef<MicButtonHandle>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const unlockedRef = useRef(false)

  const status: AgentStatus = listening ? "listening" : speaking ? "speaking" : pending ? "thinking" : "idle"
  useSpeakingPulse(speaking && !listening)

  // Only settled messages are kept; a reply cut off by a reload is dropped.
  useEffect(() => {
    writeStorage(
      THREAD_KEY,
      messages.filter((m) => !m.streaming).slice(-THREAD_LIMIT)
    )
  }, [messages])

  useEffect(() => writeStorage(SPEECH_KEY, speech), [speech])

  // The CTX readout, from the backend's own count for this session.
  useEffect(() => {
    getSessionContext(sessionId, token)
      .then((context) => {
        if (context.turns !== null) setContext(context.turns, context.window)
      })
      .catch(() => {})
  }, [sessionId, token, setContext])

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
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  // The core is the talk button, as on the desktop: tap to speak, tap
  // again to stop, tap while he talks to cut in.
  function handleCoreTap() {
    if (listening) {
      micRef.current?.stopRecording()
      return
    }
    stopNarration()
    micRef.current?.startRecording()
  }

  async function send(text: string, viaVoice: boolean) {
    const message = text.trim()
    if (!message || pending) return
    stopNarration()
    setDraft("")
    inputRef.current?.blur()
    requestAnimationFrame(autoGrow)
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: message, time: clockTime() }])
    setPending(true)
    setPhase("Thinking")
    setElapsed(0)
    emitCore({ kind: "send" })

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
        if (event.type === "status") setPhase(event.label)
        else if (event.type === "text") updateReply((m) => ({ ...m, content: m.content + event.delta }))
        else if (event.type === "reset") updateReply((m) => ({ ...m, content: "" }))
        else if (event.type === "spoken") voice?.push(event.delta)
        else if (event.type === "tool") emitCore({ kind: "tool", name: event.name })
      })
      voice?.finish(result.spoken)
      setContext(result.context_turns, result.context_window)
      emitCore({ kind: "reply" })
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
      emitCore({ kind: "error" })
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
    setContext(0, useJarvis.getState().signals.contextWindow)
    setMenuOpen(false)
  }

  const statusLine = listening
    ? "LISTENING"
    : pending
      ? `${phase.toUpperCase()} · ${elapsed}S`
      : speaking
        ? "SPEAKING"
        : "AWAITING INPUT"

  // The core gives way to the keyboard, and to a long conversation.
  const stageHeight = typing ? 92 : messages.length > 0 ? "clamp(150px, 28dvh, 260px)" : "clamp(200px, 40dvh, 360px)"

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{ height: "100dvh", paddingTop: "env(safe-area-inset-top)" }}
      onClickCapture={unlockAudio}
    >
      <HolographicGrid serious={serious} visible={gridVisible && boot.grid} />
      <GlobalEffects />

      {/* Boot: a single line draws across the centre before the chrome. */}
      {!boot.chrome && (
        <div className="pointer-events-none fixed top-1/2 right-0 left-0" style={{ zIndex: 40 }} aria-hidden>
          <div
            style={{
              height: "1px",
              background: "var(--accent)",
              boxShadow: "0 0 12px var(--accent)",
              transform: `scaleX(${boot.line ? 1 : 0})`,
              transition: "transform 300ms ease-in-out",
            }}
          />
        </div>
      )}

      <div
        className="relative z-10 flex min-h-0 flex-1 flex-col"
        style={{ opacity: boot.chrome ? 1 : 0, transition: "opacity 400ms ease" }}
      >
        <StatusStrip onMenu={() => setMenuOpen((open) => !open)} menuOpen={menuOpen} />

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} aria-hidden />
            <div
              className="absolute right-3 z-30 flex w-64 flex-col gap-1 p-2"
              style={{
                top: 52,
                background: "var(--bg-base)",
                border: "1px solid rgba(var(--accent-rgb), 0.35)",
                borderRadius: "var(--radius)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 16px rgba(var(--accent-rgb), 0.12)",
              }}
            >
              <div className="t-label px-2 pt-1" style={{ color: "var(--text-secondary)" }}>
                Speak replies
              </div>
              <div className="flex gap-1 px-1 pb-2">
                {(Object.keys(SPEECH_LABEL) as SpeechMode[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="btn flex-1"
                    style={{ height: 36, fontSize: 10, padding: 0 }}
                    data-active={speech === option}
                    onClick={() => setSpeech(option)}
                  >
                    {SPEECH_LABEL[option]}
                  </button>
                ))}
              </div>
              <MenuItem
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect()
                  setMenuOpen(false)
                  toggleMode({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
                }}
                icon={<ShieldAlertIcon size={16} />}
                label={serious ? "Normal mode" : "Serious mode"}
              />
              <MenuItem
                onClick={() => setGridVisible(!gridVisible)}
                icon={<GridIcon size={16} />}
                label={gridVisible ? "Hide grid" : "Show grid"}
              />
              <MenuItem onClick={newConversation} icon={<RotateCcwIcon size={16} />} label="New conversation" />
              <MenuItem onClick={() => setView("desktop")} icon={<MonitorIcon size={16} />} label="Desktop console" />
              <MenuItem onClick={onSignOut} label="Sign out" danger />
            </div>
          </>
        )}

        {/* The stage: the 3D core (tap to talk), its state, the voice bars. */}
        <section
          className="relative flex shrink-0 flex-col items-center justify-center"
          style={{ height: stageHeight, transition: "height 350ms ease" }}
        >
          <div className="relative flex min-h-0 flex-1 items-center justify-center" style={{ aspectRatio: "1 / 1", maxWidth: "100%" }}>
            <CoreCipher status={status} onToggle={handleCoreTap} ringsRevealed={boot.rings} />
          </div>
          {!typing && (
            <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center">
              <span className="t-label text-glow" style={{ color: "var(--accent)" }}>
                {statusLine}
              </span>
            </div>
          )}
        </section>
        {!typing && (
          <div className="shrink-0 px-4" style={{ height: 40, overflow: "hidden" }}>
            <div style={{ transform: "translateY(-12px)" }}>
              <AudioVisualizer status={status} visible={boot.visualizer} />
            </div>
          </div>
        )}

        {/* Comms: the conversation, in the desktop's message language. */}
        <section
          className="relative mx-3 mb-2 flex min-h-0 flex-1 flex-col"
          style={{
            border: "1px solid rgba(var(--accent-rgb), 0.18)",
            borderRadius: "var(--radius)",
            background: "rgba(10, 14, 26, 0.55)",
            opacity: boot.chat ? 1 : 0,
            transition: "opacity 400ms ease",
          }}
        >
          <div
            className="flex shrink-0 items-center justify-between px-3"
            style={{ height: 30, borderBottom: "1px solid rgba(var(--accent-rgb), 0.12)" }}
          >
            <span className="t-panel-header" style={{ color: "var(--accent)" }}>
              COMMS
            </span>
            {speaking && (
              <button type="button" className="btn" style={{ height: 24, padding: "0 8px", fontSize: 10 }} onClick={() => stopNarration()}>
                <SquareIcon size={10} /> STOP
              </button>
            )}
          </div>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {messages.length === 0 && !pending ? (
              <div className="flex flex-col gap-3">
                <p className="t-body" style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                  Awaiting input, sir. Tap the core to speak, or type below.
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="btn"
                      style={{ height: 36, padding: "0 12px", fontFamily: "var(--font-inter)", fontSize: 13, letterSpacing: 0 }}
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
                {pending && !messages.some((m) => m.streaming && m.content) && <ThinkingIndicator />}
              </div>
            )}
          </div>
        </section>

        {/* Composer, as the desktop's command line. */}
        <form
          className="flex shrink-0 items-end gap-2 px-3 pt-1"
          style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}
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
          <div
            className="flex min-w-0 flex-1 items-start"
            style={{
              border: "1px solid rgba(var(--accent-rgb), 0.3)",
              borderRadius: "var(--radius)",
              background: "rgba(5, 5, 8, 0.75)",
            }}
          >
            <span className="font-mono" style={{ color: "var(--accent)", padding: "11px 0 0 10px", fontSize: 15, lineHeight: "22px" }} aria-hidden>
              &gt;
            </span>
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              enterKeyHint="send"
              placeholder={listening ? "Listening…" : "Enter command or speak…"}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
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
              className="min-w-0 flex-1 resize-none bg-transparent outline-none"
              style={{
                // 16px or iOS zooms the page on focus.
                fontSize: 16,
                lineHeight: "22px",
                padding: "11px 10px 11px 8px",
                minHeight: 44,
                color: "var(--text-primary)",
              }}
            />
          </div>
          <button
            type="submit"
            className="btn btn-circle"
            style={{ width: 46, height: 46 }}
            disabled={pending || !draft.trim()}
            aria-label="Send"
            // Keep the keyboard's focus on the box, so tapping send does
            // not blur it (and collapse the core) before the send lands.
            onPointerDown={(e) => e.preventDefault()}
          >
            {pending ? <Loader2Icon size={18} className="animate-spin" /> : <ArrowUpIcon size={20} />}
          </button>
        </form>
      </div>
    </div>
  )
}

function MenuItem({
  onClick,
  icon,
  label,
  danger,
}: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
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
  // Same palette as the desktop's chat-message.tsx: his lines in deep
  // blue, Jarvis's in the accent with a faint glow.
  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <div
        className="wrap-words max-w-[90%]"
        style={{
          whiteSpace: "pre-line",
          fontSize: 15,
          lineHeight: 1.5,
          padding: "8px 12px",
          borderRadius: "var(--radius)",
          color: message.failed ? "var(--error)" : isUser ? "var(--text-primary)" : "var(--accent)",
          background: message.failed
            ? "rgba(255, 51, 51, 0.06)"
            : isUser
              ? "rgba(0, 64, 128, 0.25)"
              : "rgba(var(--accent-rgb), 0.06)",
          border: `1px solid ${
            message.failed ? "rgba(255, 51, 51, 0.4)" : `rgba(var(--accent-rgb), ${isUser ? 0.12 : 0.25})`
          }`,
          boxShadow: isUser || message.failed ? "none" : "0 0 12px rgba(var(--accent-rgb), 0.1)",
        }}
      >
        <Linkified text={message.content} />
        {message.streaming && <span className="caret" aria-hidden />}
      </div>
      <div className={`flex flex-wrap items-center gap-1.5 ${isUser ? "flex-row-reverse" : ""}`}>
        <span className="t-time">{message.time}</span>
        {message.tools?.map((tool) => <ToolBadge key={tool} tool={tool} />)}
        {message.failed && (
          <button
            type="button"
            className="btn"
            style={{ height: 28, padding: "0 10px" }}
            disabled={disabled}
            onClick={() => onRetry(message.failed!.retry)}
          >
            <RotateCcwIcon size={12} /> RETRY
          </button>
        )}
      </div>
    </div>
  )
}
