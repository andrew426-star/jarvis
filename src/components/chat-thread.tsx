"use client"

import { useEffect, useRef, useState } from "react"
import { WifiOffIcon } from "lucide-react"

import { ChatInput } from "@/components/chat-input"
import { ChatMessage, type ChatMessageData } from "@/components/chat-message"
import { ThinkingIndicator } from "@/components/thinking-indicator"
import { Card } from "@/components/ui/card"
import { JarvisApiError, JarvisAuthError, JarvisNetworkError, invoke } from "@/lib/jarvis-client"

interface ChatThreadProps {
  token: string
  sessionId: string
  onAuthError: () => void
}

export function ChatThread({ token, sessionId, onAuthError }: ChatThreadProps) {
  const [messages, setMessages] = useState<ChatMessageData[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, pending])

  async function handleSend(text: string) {
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
        },
      ])
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
    <Card className="glow-border flex h-[calc(100vh-9rem)] w-full max-w-2xl flex-col overflow-hidden py-0">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">Say something — J.A.R.V.I.S. is ready.</p>
        )}
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} token={token} onAuthError={onAuthError} />
        ))}
        {pending && <ThinkingIndicator />}
        {error && (
          <div className="flex items-center gap-1.5 text-sm text-destructive">
            <WifiOffIcon className="size-4" />
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <ChatInput disabled={pending} onSend={handleSend} />
    </Card>
  )
}
