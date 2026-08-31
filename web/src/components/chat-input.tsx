"use client"

import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react"
import { CornerDownLeftIcon } from "lucide-react"

import { MicButton, type MicButtonHandle } from "@/components/mic-button"

interface ChatInputProps {
  disabled?: boolean
  token: string
  onAuthError: () => void
  onSend: (message: string, viaVoice: boolean) => void
  onRecordingChange?: (recording: boolean) => void
}

export interface ChatInputHandle {
  startRecording: () => void
  stopRecording: () => void
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { disabled, token, onAuthError, onSend, onRecordingChange },
  ref
) {
  const [value, setValue] = useState("")
  const [focused, setFocused] = useState(false)
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
      stopRecording: () => micRef.current?.stopRecording(),
    }),
    []
  )

  return (
    <div
      className="flex items-center gap-2 px-3 py-2.5 transition-colors duration-300"
      style={{
        borderTop: "1px solid hsl(var(--hue) 70% 55% / 0.28)",
        background: focused ? "hsl(var(--hue-alt) 60% 10% / 0.5)" : "transparent",
      }}
    >
      <span className="readout text-sm select-none" style={{ color: "var(--hud)" }}>
        &gt;
      </span>

      {/* Deliberately not the shadcn <Input>: that carries a border,
          radius and ring this design has no use for. A bare input on the
          panel background is the terminal. */}
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={disabled ? "Standby..." : "Enter command"}
        disabled={disabled}
        aria-label="Message J.A.R.V.I.S."
        className="readout min-w-0 flex-1 bg-transparent text-[0.8rem] outline-none placeholder:opacity-45 disabled:opacity-50"
        style={{ color: "var(--foreground)" }}
      />

      <MicButton
        ref={micRef}
        token={token}
        disabled={disabled}
        onAuthError={onAuthError}
        onTranscribed={(text) => onSend(text, true)}
        onRecordingChange={onRecordingChange}
      />

      <button
        type="button"
        onClick={submit}
        disabled={disabled || !value.trim()}
        aria-label="Send"
        className="bracket-frame flex size-7 items-center justify-center transition-colors duration-200 disabled:opacity-30"
        style={{ ["--tick" as string]: "5px", color: "var(--hud)" }}
      >
        <CornerDownLeftIcon className="size-3.5" />
      </button>
    </div>
  )
})
