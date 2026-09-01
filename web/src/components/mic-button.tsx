"use client"

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react"
import { Loader2Icon, MicIcon, MicOffIcon, SquareIcon } from "lucide-react"

import { clearMicAmplitude, setMicAmplitude, setMicBands } from "@/lib/audio-amplitude"
import { JarvisAuthError, transcribe } from "@/lib/jarvis-client"

type RecordState = "idle" | "recording" | "transcribing" | "error"

export interface MicButtonHandle {
  startRecording: () => void
  stopRecording: () => void
}

interface MicButtonProps {
  token: string
  disabled?: boolean
  onAuthError: () => void
  onTranscribed: (text: string) => void
  // Lets the core render a "listening" state — the mic lives down here in
  // the chat dock, but the thing you click to talk is up in the stage.
  onRecordingChange?: (recording: boolean) => void
}

// Voice-activity heuristics — not physically calibrated against a real mic
// in this environment, so treat as a reasonable starting point rather than
// a tuned constant. SILENCE_THRESHOLD is an RMS amplitude (0-1) below which
// the input is considered quiet; SILENCE_DURATION_MS is how long that quiet
// has to hold, after real speech was already detected, before treating the
// turn as finished. MAX_RECORDING_MS is a hard safety cap so a stuck/very
// noisy input can't leave the mic recording forever.
const SILENCE_THRESHOLD = 0.02
const SILENCE_DURATION_MS = 1300
const MAX_RECORDING_MS = 30000

export const MicButton = forwardRef<MicButtonHandle, MicButtonProps>(function MicButton(
  { token, disabled, onAuthError, onTranscribed, onRecordingChange },
  ref
) {
  const [state, setState] = useState<RecordState>("idle")
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const vadFrameRef = useRef<number | null>(null)
  const hasSpokenRef = useRef(false)
  const silenceStartRef = useRef<number | null>(null)
  const recordingStartRef = useRef(0)

  // Single funnel for state changes, so the outward "is it listening"
  // signal can't drift from what the button itself is showing.
  function applyState(next: RecordState) {
    setState(next)
    onRecordingChange?.(next === "recording")
  }

  function stopVadLoop() {
    if (vadFrameRef.current !== null) cancelAnimationFrame(vadFrameRef.current)
    vadFrameRef.current = null
    clearMicAmplitude()
    audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
    analyserRef.current = null
  }

  function stopRecording() {
    recorderRef.current?.stop()
  }

  function runVadLoop() {
    const analyser = analyserRef.current
    if (!analyser) return
    const data = new Uint8Array(analyser.fftSize)
    // Separate buffer: frequencyBinCount is half fftSize, and the two
    // reads want different shapes off the same analyser.
    const bins = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      if (!analyserRef.current) return
      analyserRef.current.getByteTimeDomainData(data)
      let sumSquares = 0
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128
        sumSquares += normalized * normalized
      }
      const rms = Math.sqrt(sumSquares / data.length)
      // Same number the silence check below uses — also drives the core's
      // pulse, so the ring visibly answers your voice while listening.
      setMicAmplitude(rms)
      analyserRef.current.getByteFrequencyData(bins)
      setMicBands(bins)
      const now = performance.now()

      if (rms > SILENCE_THRESHOLD) {
        hasSpokenRef.current = true
        silenceStartRef.current = null
      } else if (hasSpokenRef.current) {
        if (silenceStartRef.current === null) {
          silenceStartRef.current = now
        } else if (now - silenceStartRef.current > SILENCE_DURATION_MS) {
          stopRecording()
          return
        }
      }

      if (now - recordingStartRef.current > MAX_RECORDING_MS) {
        stopRecording()
        return
      }

      vadFrameRef.current = requestAnimationFrame(tick)
    }
    vadFrameRef.current = requestAnimationFrame(tick)
  }

  const startRecording = useCallback(async () => {
    if (state !== "idle" || disabled) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      hasSpokenRef.current = false
      silenceStartRef.current = null
      recordingStartRef.current = performance.now()

      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioContext = new AudioContextClass()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      audioContextRef.current = audioContext
      analyserRef.current = analyser
      runVadLoop()

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        stopVadLoop()
        stream.getTracks().forEach((track) => track.stop())
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" })
        applyState("transcribing")
        try {
          const text = await transcribe(audioBlob, token)
          applyState("idle")
          if (text.trim()) onTranscribed(text.trim())
        } catch (err) {
          if (err instanceof JarvisAuthError) {
            onAuthError()
            return
          }
          applyState("error")
          setTimeout(() => applyState("idle"), 2500)
        }
      }

      recorderRef.current = recorder
      recorder.start()
      applyState("recording")
    } catch {
      // getUserMedia rejected — permission denied or no mic available.
      applyState("error")
      setTimeout(() => applyState("idle"), 2500)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, disabled, token])

  useImperativeHandle(ref, () => ({ startRecording, stopRecording }), [startRecording])

  function handleClick() {
    if (state === "idle") startRecording()
    else if (state === "recording") stopRecording()
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || state === "transcribing"}
        aria-label={state === "recording" ? "Stop recording" : "Record a voice message"}
        aria-pressed={state === "recording"}
        data-active={state === "recording"}
        className="btn btn-circle"
        style={state === "error" ? { color: "var(--error)", borderColor: "var(--error)" } : undefined}
      >
        {state === "transcribing" ? (
          <Loader2Icon size={16} className="animate-spin" />
        ) : state === "error" ? (
          <MicOffIcon size={16} />
        ) : state === "recording" ? (
          <SquareIcon size={14} />
        ) : (
          <MicIcon size={16} />
        )}
      </button>

      {/* Expanding ring while listening. Pure transform + opacity, and
          only mounted during recording, so it never counts against the
          three-concurrent-animation budget at rest. */}
      {state === "recording" && (
        <span
          className="anim-ping pointer-events-none absolute inset-0 rounded-full"
          style={{ border: "1px solid var(--accent)" }}
          aria-hidden
        />
      )}
    </div>
  )
})
