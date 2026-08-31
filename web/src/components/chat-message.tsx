"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2Icon, SquareIcon, Volume2Icon } from "lucide-react"

import { ToolBadge } from "@/components/tool-badge"
import { startAudioAnalysis, stopAudioAnalysis } from "@/lib/audio-amplitude"
import { JarvisAuthError, speak } from "@/lib/jarvis-client"
import { clearNarration, registerNarration, stopNarration } from "@/lib/narration"
import { useTypewriter } from "@/lib/use-typewriter"

export interface ChatMessageData {
  id: string
  role: "user" | "assistant"
  content: string
  toolsUsed?: string[]
  // Every assistant reply narrates itself once, unprompted - set on the
  // message at creation time in chat-thread.tsx, never toggled after.
  autoPlay?: boolean
  // Whether the *user's* turn that produced this reply came in by voice -
  // only then should the mic reopen once narration ends, so typing does
  // not unexpectedly start listening.
  reopenMicAfter?: boolean
}

interface ChatMessageProps {
  message: ChatMessageData
  token: string
  onAuthError: () => void
  onSpeakingChange?: (speaking: boolean) => void
  // Fires only after the *automatic* narration finishes (or fails) - not
  // after a manual replay - so chat-thread.tsx can reopen the mic for a
  // voice-initiated turn without reopening it every time an old message
  // is replayed by hand.
  onAutoPlayEnded?: () => void
}

type AudioState = "idle" | "loading" | "playing" | "error"

export function ChatMessage({
  message,
  token,
  onAuthError,
  onSpeakingChange,
  onAutoPlayEnded,
}: ChatMessageProps) {
  const isUser = message.role === "user"
  const [audioState, setAudioState] = useState<AudioState>("idle")
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const hasAutoPlayedRef = useRef(false)

  // Only a freshly-arrived reply types itself out. Replaying an old one,
  // or re-rendering the thread, must not restage the animation - which
  // is what autoPlay already marks.
  const [shouldType] = useState(() => !isUser && Boolean(message.autoPlay))
  const { shown, done } = useTypewriter(message.content, shouldType)

  async function playSpeech(auto: boolean) {
    if (audioState === "loading") return
    // Routed through the shared handle rather than pausing directly, so
    // the local button and a barge-in from the reactor take the same
    // path and cannot leave the registry pointing at dead audio.
    if (audioState === "playing") {
      stopNarration()
      return
    }

    setAudioState("loading")
    try {
      const blob = await speak(message.content, token)
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio

      // Interrupted from outside: pause() deliberately does NOT fire
      // onended, so onAutoPlayEnded stays unfired and the mic is not
      // reopened behind the barge-in that is already opening it.
      const stopPlayback = () => {
        audio.pause()
        URL.revokeObjectURL(url)
        stopAudioAnalysis()
        setAudioState("idle")
        onSpeakingChange?.(false)
      }

      audio.onended = () => {
        clearNarration(stopPlayback)
        URL.revokeObjectURL(url)
        stopAudioAnalysis()
        setAudioState("idle")
        onSpeakingChange?.(false)
        if (auto) onAutoPlayEnded?.()
      }
      await audio.play()
      registerNarration(stopPlayback)
      startAudioAnalysis(audio)
      setAudioState("playing")
      onSpeakingChange?.(true)
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setAudioState("error")
      setTimeout(() => setAudioState("idle"), 2500)
      // Narration failing should not strand a voice conversation - let
      // the mic reopen anyway so the user is not stuck.
      if (auto) onAutoPlayEnded?.()
    }
  }

  useEffect(() => {
    if (message.autoPlay && !hasAutoPlayedRef.current) {
      hasAutoPlayedRef.current = true
      playSpeech(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="boot-up space-y-1">
      <div className="flex items-center gap-2">
        <span
          className="label-hud"
          style={{ color: isUser ? "var(--hud-dim)" : "var(--hud)" }}
        >
          {isUser ? "> Operator" : "// J.A.R.V.I.S."}
        </span>
        {!isUser && audioState === "playing" && (
          <span className="label-hud animate-pulse-dot" style={{ color: "var(--hud)" }}>
            Transmitting
          </span>
        )}
      </div>

      <div
        className="terminal-line readout text-[0.8rem] leading-relaxed whitespace-pre-wrap"
        style={{
          color: isUser ? "var(--muted-foreground)" : "var(--foreground)",
          borderLeftColor: isUser
            ? "hsl(var(--hue) 40% 45% / 0.2)"
            : "hsl(var(--hue) 70% 55% / 0.4)",
        }}
      >
        {isUser ? message.content : shown}
        {!isUser && !done && <span className="terminal-caret" />}
      </div>

      {!isUser && (
        <div className="flex flex-wrap items-center gap-1.5 pl-[0.85rem]">
          {message.toolsUsed?.map((tool) => (
            <ToolBadge key={tool} tool={tool} />
          ))}
          <button
            type="button"
            onClick={() => playSpeech(false)}
            aria-label={audioState === "playing" ? "Stop playback" : "Play reply"}
            className="flex size-5 items-center justify-center transition-colors duration-200"
            style={{ color: "var(--hud-dim)" }}
          >
            {audioState === "loading" ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : audioState === "playing" ? (
              <SquareIcon className="size-3" />
            ) : (
              <Volume2Icon className="size-3" />
            )}
          </button>
          {audioState === "error" && (
            <span className="label-hud" style={{ color: "var(--destructive)" }}>
              Playback failed
            </span>
          )}
        </div>
      )}
    </div>
  )
}
