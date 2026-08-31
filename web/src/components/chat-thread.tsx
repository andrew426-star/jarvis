"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { WifiOffIcon } from "lucide-react"

import { ChatInput, type ChatInputHandle } from "@/components/chat-input"
import { ChatMessage, type ChatMessageData } from "@/components/chat-message"
import { ThinkingIndicator } from "@/components/thinking-indicator"
import {
  JarvisApiError,
  JarvisAuthError,
  JarvisNetworkError,
  invoke,
  type ToolResult,
} from "@/lib/jarvis-client"

interface ChatThreadProps {
  token: string
  sessionId: string
  onAuthError: () => void
  onToolResults?: (results: ToolResult[]) => void
  onSpeakingChange?: (speaking: boolean) => void
  onPendingChange?: (pending: boolean) => void
  onRecordingChange?: (recording: boolean) => void
  /** Completed exchanges, for the SESSION gauge on the status ring. */
  onTurnsChange?: (turns: number) => void
}

// The mic lives at the bottom of this component, but the thing you click
// to talk is the reactor, several levels up in jarvis-stage.tsx - so the
// recording controls are re-exposed here rather than staying private.
export interface ChatThreadHandle {
  startRecording: () => void
  stopRecording: () => void
}

export const ChatThread = forwardRef<ChatThreadHandle, ChatThreadProps>(function ChatThread(
  {
    token,
    sessionId,
    onAuthError,
    onToolResults,
    onSpeakingChange,
    onPendingChange,
    onRecordingChange,
    onTurnsChange,
  },
  ref
) {
  const [messages, setMessages] = useState<ChatMessageData[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const chatInputRef = useRef<ChatInputHandle>(null)

  useImperativeHandle(
    ref,
    () => ({
      startRecording: () => chatInputRef.current?.startRecording(),
      stopRecording: () => chatInputRef.current?.stopRecording(),
    }),
    []
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, pending])

  useEffect(() => {
    onPendingChange?.(pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  useEffect(() => {
    onTurnsChange?.(messages.filter((message) => message.role === "assistant").length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  async function handleSend(text: string, viaVoice: boolean) {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text }])
    setPending(true)
    setError(null)

    try {
      const result = await invoke(text, sessionId, token)
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.response,
          toolsUsed: result.tools_used,
          autoPlay: true,
          reopenMicAfter: viaVoice,
        },
      ])
      if (result.tool_results.length > 0) onToolResults?.(result.tool_results)
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      if (err instanceof JarvisNetworkError || err instanceof JarvisApiError) {
        setError(err.message)
      } else {
        setError("Something went wrong.")
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="hud-panel flex h-full w-full flex-col overflow-hidden">
      <div
        className="flex shrink-0 items-center justify-between px-3 py-1.5"
        style={{ borderBottom: "1px solid hsl(var(--hue) 70% 55% / 0.22)" }}
      >
        <span className="label-hud">Comms Channel</span>
        <span className="label-hud">{messages.length} LOG</span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="readout text-[0.75rem]" style={{ color: "var(--muted-foreground)" }}>
            Awaiting input. Speak, or type below.
          </p>
        )}
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            token={token}
            onAuthError={onAuthError}
            onSpeakingChange={onSpeakingChange}
            onAutoPlayEnded={
              message.reopenMicAfter ? () => chatInputRef.current?.startRecording() : undefined
            }
          />
        ))}
        {pending && <ThinkingIndicator />}
        {error && (
          <div
            className="readout flex items-center gap-1.5 text-[0.75rem]"
            style={{ color: "var(--destructive)" }}
          >
            <WifiOffIcon className="size-3.5" />
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <ChatInput
        ref={chatInputRef}
        disabled={pending}
        token={token}
        onAuthError={onAuthError}
        onSend={handleSend}
        onRecordingChange={onRecordingChange}
      />
    </div>
  )
})
