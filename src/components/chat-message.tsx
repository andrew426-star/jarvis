"use client"

import { useRef, useState } from "react"
import { BotIcon, Loader2Icon, PauseIcon, UserIcon, Volume2Icon } from "lucide-react"

import { ToolBadge } from "@/components/tool-badge"
import { Button } from "@/components/ui/button"
import { JarvisAuthError, speak } from "@/lib/jarvis-client"

export interface ChatMessageData {
  id: string
  role: "user" | "assistant"
  content: string
  toolsUsed?: string[]
}

interface ChatMessageProps {
  message: ChatMessageData
  token: string
  onAuthError: () => void
  onSpeakingChange?: (speaking: boolean) => void
}

type AudioState = "idle" | "loading" | "playing" | "error"

export function ChatMessage({ message, token, onAuthError, onSpeakingChange }: ChatMessageProps) {
  const isUser = message.role === "user"
  const [audioState, setAudioState] = useState<AudioState>("idle")
  const audioRef = useRef<HTMLAudioElement | null>(null)

  async function handleSpeak() {
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
    }
  }

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
              onClick={handleSpeak}
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
