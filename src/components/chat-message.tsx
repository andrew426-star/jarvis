"use client"

import { useEffect, useRef, useState } from "react"
import { BotIcon, Loader2Icon, PauseIcon, UserIcon, Volume2Icon } from "lucide-react"

import { ToolBadge } from "@/components/tool-badge"
import { Button } from "@/components/ui/button"
import { JarvisAuthError, speak } from "@/lib/jarvis-client"

export interface ChatMessageData {
  id: string
  role: "user" | "assistant"
  content: string
  toolsUsed?: string[]
  // Every assistant reply narrates itself once, unprompted — set on the
  // message at creation time in chat-thread.tsx, never toggled after.
  autoPlay?: boolean
  // Whether the *user's* turn that produced this reply came in by voice —
  // only then should the mic reopen once narration ends, so typing doesn't
  // unexpectedly start listening.
  reopenMicAfter?: boolean
}

interface ChatMessageProps {
  message: ChatMessageData
  token: string
  onAuthError: () => void
  onSpeakingChange?: (speaking: boolean) => void
  // Fires only after the *automatic* narration finishes (or fails) — not
  // after a manual replay — so chat-thread.tsx can reopen the mic for a
  // voice-initiated turn without reopening it every time an old message is
  // manually replayed.
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

  async function playSpeech(auto: boolean) {
    if (audioState === "loading") return
    if (audioState === "playing") {
      audioRef.current?.pause()
      setAudioState("idle")
      onSpeakingChange?.(false)
      return
    }

    setAudioState("loading")
    try {
      const blob = await speak(message.content, token)
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => {
        URL.revokeObjectURL(url)
        setAudioState("idle")
        onSpeakingChange?.(false)
        if (auto) onAutoPlayEnded?.()
      }
      await audio.play()
      setAudioState("playing")
      onSpeakingChange?.(true)
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setAudioState("error")
      setTimeout(() => setAudioState("idle"), 2500)
      // Narration failing shouldn't strand a voice conversation — let the
      // mic reopen anyway so the user isn't stuck.
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
    <div className={`animate-fade-up flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-secondary text-secondary-foreground"
            : "glow-green bg-primary/10 text-primary"
        }`}
      >
        {isUser ? <UserIcon className="size-4" /> : <BotIcon className="size-4" />}
      </div>
      <div className={`flex max-w-[80%] flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`glow-border rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
            isUser ? "bg-secondary text-secondary-foreground" : "bg-card text-card-foreground"
          }`}
        >
          {message.content}
        </div>
        {!isUser && (
          <div className="flex flex-wrap items-center gap-1.5">
            {message.toolsUsed?.map((tool) => (
              <ToolBadge key={tool} tool={tool} />
            ))}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => playSpeech(false)}
              aria-label={audioState === "playing" ? "Stop playback" : "Play reply"}
            >
              {audioState === "loading" ? (
                <Loader2Icon className="animate-spin" />
              ) : audioState === "playing" ? (
                <PauseIcon />
              ) : (
                <Volume2Icon />
              )}
            </Button>
            {audioState === "error" && (
              <span className="text-xs text-destructive">Playback failed</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
