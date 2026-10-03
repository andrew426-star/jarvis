"use client"

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react"
import { Loader2Icon, MicIcon, MicOffIcon, SquareIcon } from "lucide-react"

import { clearMicAmplitude, setMicAmplitude, setMicBands } from "@/lib/audio-amplitude"
import { JarvisAuthError, transcribe } from "@/lib/jarvis-client"
import { openMic } from "@/lib/microphone"

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

// Knowing when he has finished talking.
//
// A fixed loudness bar does not work: the browser's gain control turns the
// mic UP when he goes quiet, so the hiss of an empty room can sit above
// any bar picked in advance (and he is never "silent"), while a bar low
// enough for a quiet room cuts off a soft word. So the bar follows the
// room: the noise floor is tracked as he speaks, speech is anything well
// above it, and silence is anything close to it, with a gap between the
// two so a voice trailing off does not flicker between them.
const TICK_MS = 30
// Level smoothing (per tick): one loud click or a single quiet frame
// inside a word should not decide anything.
const SMOOTHING = 0.35
// The floor drops straight to any quieter level and rises slowly, so
// speech never drags it up but a room that gets noisier is followed.
const FLOOR_RISE = 0.004
const SPEECH_OVER_FLOOR = 2.6
const SILENCE_OVER_FLOOR = 1.6
// Absolute bounds for very quiet and very noisy rooms.
const MIN_SPEECH = 0.012
const MIN_SILENCE = 0.006
// Speech has to last this long to count, so a cough or a desk knock does
// not start the end-of-turn clock.
const MIN_SPEECH_MS = 250
// Quiet this long after real speech ends the turn: long enough for a
// breath mid-sentence, short enough not to feel like waiting.
const SILENCE_DURATION_MS = 1300
// Opened and nothing said (he asked a question and Andrew walked away):
// give up quietly rather than record silence and transcribe it.
const NO_SPEECH_MS = 8000
// A freshly opened mic can be dead air for a moment - a Bluetooth headset
// switching into its hands-free mode takes most of a second - and words
// spoken into that are lost. "Listening" is only shown once the signal
// arrives (anything above digital silence), or after this long regardless.
const LIVE_SIGNAL = 0.002
const LIVE_TIMEOUT_MS = 1500
const MAX_RECORDING_MS = 45000

export const MicButton = forwardRef<MicButtonHandle, MicButtonProps>(function MicButton(
  { token, disabled, onAuthError, onTranscribed, onRecordingChange },
  ref
) {
  const [state, setState] = useState<RecordState>("idle")
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasSpokenRef = useRef(false)
  // Set when the turn ended with nothing said: stop without transcribing.
  const discardRef = useRef(false)
  const silenceStartRef = useRef<number | null>(null)
  const recordingStartRef = useRef(0)
  const liveRef = useRef(false)

  // Single funnel for state changes, so the outward "is it listening"
  // signal can't drift from what the button itself is showing.
  function applyState(next: RecordState) {
    setState(next)
    // "recording" is announced by the VAD loop once the mic is actually live.
    if (next !== "recording") onRecordingChange?.(false)
  }

  function stopVadLoop() {
    if (vadTimerRef.current !== null) clearInterval(vadTimerRef.current)
    vadTimerRef.current = null
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

    let level = 0
    let floor: number | null = null
    let speechMs = 0
    let speaking = false
    let lastTick = performance.now()

    // A timer, not requestAnimationFrame: animation frames stop while the
    // console tab is out of sight, and then nothing would ever end the turn.
    const tick = () => {
      if (!analyserRef.current) return
      analyserRef.current.getByteTimeDomainData(data)
      let sumSquares = 0
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128
        sumSquares += normalized * normalized
      }
      const rms = Math.sqrt(sumSquares / data.length)
      // The raw level drives the core's pulse, so the ring visibly answers
      // your voice while listening.
      setMicAmplitude(rms)
      analyserRef.current.getByteFrequencyData(bins)
      setMicBands(bins)
      const now = performance.now()
      const elapsed = now - recordingStartRef.current
      // Real time since the last tick: a background tab runs timers about
      // once a second, not every TICK_MS.
      const step = now - lastTick
      lastTick = now

      if (!liveRef.current && (rms > LIVE_SIGNAL || elapsed > LIVE_TIMEOUT_MS)) {
        liveRef.current = true
        onRecordingChange?.(true)
      }
      // Dead air while the mic wakes up says nothing about the room.
      if (rms <= LIVE_SIGNAL && !liveRef.current) return

      level += (rms - level) * SMOOTHING
      if (floor === null) floor = level
      floor = level < floor ? level : floor + (level - floor) * FLOOR_RISE

      const speechBar = Math.max(MIN_SPEECH, floor * SPEECH_OVER_FLOOR)
      const silenceBar = Math.max(MIN_SILENCE, floor * SILENCE_OVER_FLOOR)
      if (level > speechBar) speaking = true
      else if (level < silenceBar) speaking = false
      // Between the bars: whatever it was, so a fading word is still a word.

      if (speaking) {
        speechMs += step
        if (speechMs >= MIN_SPEECH_MS) hasSpokenRef.current = true
        silenceStartRef.current = null
      } else if (hasSpokenRef.current) {
        if (silenceStartRef.current === null) silenceStartRef.current = now
        else if (now - silenceStartRef.current > SILENCE_DURATION_MS) {
          stopRecording()
          return
        }
      } else if (elapsed > NO_SPEECH_MS) {
        discardRef.current = true
        stopRecording()
        return
      }

      if (elapsed > MAX_RECORDING_MS) stopRecording()
    }
    vadTimerRef.current = setInterval(tick, TICK_MS)
  }

  const startRecording = useCallback(async () => {
    if (state !== "idle" || disabled) return
    try {
      const stream = await openMic()
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      hasSpokenRef.current = false
      discardRef.current = false
      liveRef.current = false
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
        // The recorder's own type: Safari records MP4, not WebM.
        // Nothing was said: close quietly, with no transcription to invent
        // words out of an empty room.
        if (discardRef.current) {
          applyState("idle")
          return
        }
        const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
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
