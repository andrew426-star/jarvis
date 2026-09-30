"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2Icon, PinIcon, SquareIcon, Volume2Icon } from "lucide-react"

import { ToolBadge } from "@/components/tool-badge"
import { startAudioAnalysis, stopAudioAnalysis } from "@/lib/audio-amplitude"
import { JarvisAuthError, speak } from "@/lib/jarvis-client"
import { clearNarration, registerNarration, stopNarration } from "@/lib/narration"
import { useSpatial } from "@/lib/spatial-store"
import { useTypewriter } from "@/lib/use-typewriter"

export interface ChatMessageData {
  id: string
  role: "user" | "assistant"
  content: string
  /** What gets read aloud. Absent means speak `content`. */
  spoken?: string
  time: string
  toolsUsed?: string[]
  autoPlay?: boolean
  reopenMicAfter?: boolean
}

interface ChatMessageProps {
  message: ChatMessageData
  token: string
  onAuthError: () => void
  onSpeakingChange?: (speaking: boolean) => void
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
  // or re-rendering the thread, must not restage the animation.
  const [shouldType] = useState(() => !isUser && Boolean(message.autoPlay))
  const { shown, done } = useTypewriter(message.content, shouldType)

  async function playSpeech(auto: boolean) {
    if (audioState === "loading") return
    // Routed through the shared handle so the local button and a
    // barge-in from the reactor take the same path and cannot leave the
    // registry pointing at dead audio.
    if (audioState === "playing") {
      stopNarration()
      return
    }

    setAudioState("loading")
    try {
      const blob = await speak(message.spoken ?? message.content, token)
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio

      // pause() deliberately does NOT fire onended, so onAutoPlayEnded
      // stays unfired and the mic is not reopened behind the barge-in
      // that is already opening it.
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
      // A failed narration should not strand a voice conversation.
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
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`} style={{ gap: "2px" }}>
      <div
        className="wrap-words"
        style={{
          maxWidth: "80%",
          padding: "var(--sp-2) var(--sp-3)",
          borderRadius: "var(--radius)",
          fontSize: "13px",
          lineHeight: 1.5,
          // The screen channel can carry line breaks now that the voice
          // line is written separately.
          whiteSpace: "pre-line",
          background: isUser ? "rgba(0, 64, 128, 0.25)" : "rgba(var(--accent-rgb), 0.06)",
          border: `1px solid rgba(var(--accent-rgb), ${isUser ? 0.12 : 0.25})`,
          color: isUser ? "var(--text-primary)" : "var(--accent)",
          boxShadow: isUser ? "none" : "0 0 12px rgba(var(--accent-rgb), 0.1)",
        }}
      >
        {isUser ? message.content : shown}
        {!isUser && !done && <span className="caret" aria-hidden />}
      </div>

      <div
        className={`flex items-center ${isUser ? "flex-row-reverse" : ""}`}
        style={{ gap: "var(--sp-1)" }}
      >
        <span className="t-time">{message.time}</span>
        {!isUser && (
          <>
            {message.toolsUsed?.map((tool) => (
              <ToolBadge key={tool} tool={tool} />
            ))}
            <button
              type="button"
              onClick={() => playSpeech(false)}
              aria-label={audioState === "playing" ? "Stop playback" : "Play reply"}
              className="cursor-pointer"
              style={{ background: "transparent", border: 0, color: "var(--text-secondary)" }}
            >
              {audioState === "loading" ? (
                <Loader2Icon size={11} className="animate-spin" />
              ) : audioState === "playing" ? (
                <SquareIcon size={11} />
              ) : (
                <Volume2Icon size={11} />
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                useSpatial.getState().addHologram({
                  kind: "note",
                  title: `JARVIS · ${message.time}`,
                  body: message.content,
                })
              }
              aria-label="Pin reply as a hologram"
              title="Pin to space"
              className="cursor-pointer"
              style={{ background: "transparent", border: 0, color: "var(--text-secondary)" }}
            >
              <PinIcon size={11} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
