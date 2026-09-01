"use client"

import { useEffect, useRef } from "react"
import { WifiOffIcon } from "lucide-react"

import { ChatMessage, type ChatMessageData } from "@/components/hud/chat-message"
import { ThinkingIndicator } from "@/components/thinking-indicator"

// The comms terminal. Occupies the lower region of the centre column,
// above the visualiser and below the reactor.
//
// Only the last six messages render. Older ones are dropped rather than
// hidden, so the scroll container never grows unbounded behind a
// max-height and quietly cost memory for a session nobody scrolls back
// through.
const MAX_VISIBLE = 6

interface ChatInterfaceProps {
  messages: ChatMessageData[]
  pending: boolean
  error: string | null
  token: string
  onAuthError: () => void
  onSpeakingChange: (speaking: boolean) => void
  onReopenMic: () => void
}

export function ChatInterface({
  messages,
  pending,
  error,
  token,
  onAuthError,
  onSpeakingChange,
  onReopenMic,
}: ChatInterfaceProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // scrollTop rather than scrollIntoView: the latter walks up the tree
    // and can scroll an ancestor the layout relies on staying put.
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages, pending])

  const visible = messages.slice(-MAX_VISIBLE)

  return (
    <div
      ref={scrollRef}
      className="min-h-0 w-full overflow-y-auto"
      style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}
    >
      {visible.length === 0 && !pending && (
        <p className="t-body" style={{ color: "var(--text-secondary)" }}>
          Awaiting input, sir. Speak, or type below.
        </p>
      )}

      {visible.map((message) => (
        <ChatMessage
          key={message.id}
          message={message}
          token={token}
          onAuthError={onAuthError}
          onSpeakingChange={onSpeakingChange}
          onAutoPlayEnded={message.reopenMicAfter ? onReopenMic : undefined}
        />
      ))}

      {pending && <ThinkingIndicator />}

      {error && (
        <div
          className="wrap-words flex items-center"
          style={{ gap: "var(--sp-1)", color: "var(--error)", fontSize: "13px" }}
        >
          <WifiOffIcon size={14} className="shrink-0" />
          {error}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
