"use client"

import { useState, type KeyboardEvent } from "react"
import { SendIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface ChatInputProps {
  disabled?: boolean
  onSend: (message: string) => void
}

export function ChatInput({ disabled, onSend }: ChatInputProps) {
  const [value, setValue] = useState("")

  function submit() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue("")
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

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
      <Button type="button" size="icon" onClick={submit} disabled={disabled || !value.trim()}>
        <SendIcon />
      </Button>
    </div>
  )
}
