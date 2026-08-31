"use client"

import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react"
import { SendIcon } from "lucide-react"

import { MicButton, type MicButtonHandle } from "@/components/mic-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface ChatInputProps {
  disabled?: boolean
  token: string
  onAuthError: () => void
  onSend: (message: string, viaVoice: boolean) => void
}

export interface ChatInputHandle {
  startRecording: () => void
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { disabled, token, onAuthError, onSend },
  ref
) {
  const [value, setValue] = useState("")
  const micRef = useRef<MicButtonHandle>(null)

  function submit() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed, false)
    setValue("")
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      startRecording: () => micRef.current?.startRecording(),
    }),
    []
  )

  return (
    <div className="flex items-center gap-2 border-t border-border p-3">
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message J.A.R.V.I.S..."
        disabled={disabled}
        className="h-10"
      />
      <MicButton
        ref={micRef}
        token={token}
        disabled={disabled}
        onAuthError={onAuthError}
        onTranscribed={(text) => onSend(text, true)}
      />
      <Button type="button" size="icon" onClick={submit} disabled={disabled || !value.trim()}>
        <SendIcon />
      </Button>
    </div>
  )
})
