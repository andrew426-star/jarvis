"use client"

import { useRef, useState } from "react"
import { Loader2Icon, MicIcon, MicOffIcon, SquareIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { JarvisAuthError, transcribe } from "@/lib/jarvis-client"

type RecordState = "idle" | "recording" | "transcribing" | "error"

interface MicButtonProps {
  token: string
  disabled?: boolean
  onAuthError: () => void
  onTranscribed: (text: string) => void
}

export function MicButton({ token, disabled, onAuthError, onTranscribed }: MicButtonProps) {
  const [state, setState] = useState<RecordState>("idle")
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function startRecording() {
    if (state !== "idle" || disabled) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" })
        setState("transcribing")
        try {
          const text = await transcribe(audioBlob, token)
          setState("idle")
          if (text.trim()) onTranscribed(text.trim())
        } catch (err) {
          if (err instanceof JarvisAuthError) {
            onAuthError()
            return
          }
          setState("error")
          setTimeout(() => setState("idle"), 2500)
        }
      }

      recorderRef.current = recorder
      recorder.start()
      setState("recording")
    } catch {
      // getUserMedia rejected — permission denied or no mic available.
      setState("error")
      setTimeout(() => setState("idle"), 2500)
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
  }

  function handleClick() {
    if (state === "idle") startRecording()
    else if (state === "recording") stopRecording()
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleClick}
        disabled={disabled || state === "transcribing"}
        aria-label={state === "recording" ? "Stop recording" : "Record a voice message"}
      >
        {state === "transcribing" ? (
          <Loader2Icon className="animate-spin" />
        ) : state === "error" ? (
          <MicOffIcon className="text-destructive" />
        ) : state === "recording" ? (
          <SquareIcon className="text-destructive" />
        ) : (
          <MicIcon />
        )}
      </Button>
      {state === "recording" && (
        <span className="absolute top-1 right-1 size-2 animate-pulse rounded-full bg-destructive" />
      )}
    </div>
  )
}
