"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2Icon, PinIcon, SquareIcon, Volume2Icon } from "lucide-react"

import { ReplyCards } from "@/components/reply-cards"
import { ToolBadge } from "@/components/tool-badge"
import { startAudioAnalysis, stopAudioAnalysis } from "@/lib/audio-amplitude"
import { JarvisAuthError, speak, type Checklist, type InboxItem } from "@/lib/jarvis-client"
import { clearNarration, registerNarration, stopNarration } from "@/lib/narration"
import { currentVoiceId } from "@/lib/persona"
import { useSpatial } from "@/lib/spatial-store"
import { useTypewriter } from "@/lib/use-typewriter"

export interface ChatMessageData {
  id: string
  role: "user" | "assistant"
  content: string
  /** What gets read aloud. Absent means speak `content`. */
  spoken?: string
  /** The part of `spoken` heard so far. When set, the bubble shows this -
   *  what he actually says, as he says it - and `content` (the fuller
   *  screen text) only as details underneath. */
  said?: string
  time: string
  toolsUsed?: string[]
  autoPlay?: boolean
  /** Still arriving from /invoke/stream: shown as it grows, with a caret. */
  streaming?: boolean
  /** Files sent with a user message: names, and a thumbnail for images. */
  attachments?: { name: string; preview?: string }[]
  /** Checklists the reply made or changed, shown as cards to tick. */
  checklists?: Checklist[]
  /** Inbox items the reply listed (the inbox tool), to approve or decline. */
  inbox?: InboxItem[]
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

// What the voice line leaves out and is worth having in writing: figures,
// links, addresses, code, lists. Screen text without any of these is the
// same reply in more words, so it stays folded away.
const DETAIL = /https?:\/\/|\S+@\S+\.\w|```|[$€£]\s?\d|\d+(\.\d+)?\s?%|\d+\.\d+|\d{3,}|^\s*([-•*]|\d+[.)])\s/m

function hasDetail(text: string): boolean {
  return DETAIL.test(text)
}

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
  const [showFull, setShowFull] = useState(false)

  // Spoken replies show what has been said; the screen text becomes
  // details, shown when it carries something the voice left out.
  const voiced = !isUser && message.said !== undefined
  const details =
    voiced && !message.streaming && message.content.trim() && message.content.trim() !== message.spoken?.trim()
      ? message.content
      : null
  const detailWorthy = details !== null && hasDetail(details)
  const stillSaying = voiced && (message.said?.length ?? 0) < (message.spoken?.trim().length ?? 0)

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
      const blob = await speak(message.spoken ?? message.content, token, currentVoiceId())
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
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`} style={{ gap: "var(--sp-1)" }}>
      <div
        className="wrap-words"
        style={{
          maxWidth: "85%",
          padding: "10px var(--sp-4)",
          borderRadius: "var(--radius)",
          fontSize: "13px",
          lineHeight: 1.6,
          // The screen channel can carry line breaks now that the voice
          // line is written separately.
          whiteSpace: "pre-line",
          background: isUser ? "rgba(0, 64, 128, 0.25)" : "rgba(var(--accent-rgb), 0.06)",
          border: `1px solid rgba(var(--accent-rgb), ${isUser ? 0.12 : 0.25})`,
          color: isUser ? "var(--text-primary)" : "var(--accent)",
          boxShadow: isUser ? "none" : "0 0 12px rgba(var(--accent-rgb), 0.1)",
        }}
      >
        {message.attachments?.length ? (
          <div className="flex flex-wrap" style={{ gap: 6, marginBottom: message.content ? 6 : 0 }}>
            {message.attachments.map((file) =>
              file.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local data URL thumbnail
                <img
                  key={file.name}
                  src={file.preview}
                  alt={file.name}
                  title={file.name}
                  style={{ height: 64, borderRadius: "var(--radius)", border: "1px solid rgba(var(--accent-rgb), 0.3)" }}
                />
              ) : (
                <span key={file.name} className="t-label attachment-chip">
                  {file.name}
                </span>
              )
            )}
          </div>
        ) : null}
        {isUser ? message.content : voiced ? message.said : shown}
        {!isUser && (!done || message.streaming || stillSaying) && <span className="caret" aria-hidden />}
        {details && (detailWorthy || showFull) && (
          <div
            style={{
              marginTop: "var(--sp-2)",
              paddingTop: "var(--sp-2)",
              borderTop: "1px solid rgba(var(--accent-rgb), 0.15)",
              fontSize: "11.5px",
              color: "var(--text-secondary)",
            }}
          >
            <span className="t-label" style={{ display: "block", marginBottom: 2, color: "var(--accent)", opacity: 0.7 }}>
              DETAILS
            </span>
            {details}
          </div>
        )}
        <ReplyCards message={message} token={token} onAuthError={onAuthError} />
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
            {details && !detailWorthy && (
              <button
                type="button"
                onClick={() => setShowFull((open) => !open)}
                className="t-label cursor-pointer"
                style={{ background: "transparent", border: 0, color: "var(--text-secondary)", padding: "0 2px" }}
                aria-expanded={showFull}
                title="The written version of this reply"
              >
                {showFull ? "LESS" : "FULL TEXT"}
              </button>
            )}
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
