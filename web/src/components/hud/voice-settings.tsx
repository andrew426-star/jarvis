"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2Icon, MicIcon } from "lucide-react"

import { transcribe } from "@/lib/jarvis-client"
import { getMicDevice, listMics, looksLikeHeadset, openMic, setMicDevice, type MicOption } from "@/lib/microphone"

const TEST_MS = 5000

interface TestResult {
  label: string
  sampleRate?: number
  peak: number
  heard: string | null
  error?: string
  clip: string
}

// Settings > Voice: which mic Jarvis listens through, and a test that
// answers "is it the mic or the transcription?" - it records five
// seconds, plays back exactly what was captured, and shows what Whisper
// made of it. A clip that sounds bad is the mic; a clip that sounds fine
// but reads wrong is the transcription.
export function VoiceSettings({ token }: { token: string }) {
  const [mics, setMics] = useState<MicOption[]>([])
  const [chosen, setChosen] = useState<string>(() => getMicDevice() ?? "")
  const [testing, setTesting] = useState<"idle" | "recording" | "transcribing">("idle")
  const [result, setResult] = useState<TestResult | null>(null)
  const clipRef = useRef<string | null>(null)

  useEffect(() => {
    listMics().then(setMics).catch(() => setMics([]))
    return () => {
      if (clipRef.current) URL.revokeObjectURL(clipRef.current)
    }
  }, [])

  function choose(deviceId: string) {
    setChosen(deviceId)
    setMicDevice(deviceId || null)
    setResult(null)
  }

  async function test() {
    if (testing !== "idle") return
    setResult(null)
    let stream: MediaStream
    try {
      stream = await openMic()
    } catch {
      setResult({ label: "", peak: 0, heard: null, error: "The mic could not be opened. Check the browser's permission.", clip: "" })
      return
    }
    // Labels only exist once the mic has been allowed, so list again now.
    listMics().then(setMics).catch(() => {})
    setTesting("recording")

    const track = stream.getAudioTracks()[0]
    const settings = track?.getSettings() ?? {}
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    let peak = 0
    const meter = setInterval(() => {
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const value of samples) sum += ((value - 128) / 128) ** 2
      peak = Math.max(peak, Math.sqrt(sum / samples.length))
    }, 50)

    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onstop = async () => {
      clearInterval(meter)
      stream.getTracks().forEach((t) => t.stop())
      void context.close()
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
      if (clipRef.current) URL.revokeObjectURL(clipRef.current)
      clipRef.current = URL.createObjectURL(blob)
      const base = { label: track?.label ?? "", sampleRate: settings.sampleRate, peak, clip: clipRef.current }
      setTesting("transcribing")
      try {
        setResult({ ...base, heard: await transcribe(blob, token) })
      } catch (err) {
        setResult({ ...base, heard: null, error: err instanceof Error ? err.message : "Transcription failed." })
      } finally {
        setTesting("idle")
      }
    }
    recorder.start()
    setTimeout(() => recorder.state === "recording" && recorder.stop(), TEST_MS)
  }

  const headset = result ? looksLikeHeadset(result.label, result.sampleRate) : false
  const quiet = result && !result.error && result.peak < 0.03

  return (
    <>
      <label className="flex min-w-0 flex-col" style={{ gap: 4 }}>
        <span className="t-label" style={{ color: "var(--text-secondary)" }}>
          MICROPHONE
        </span>
        <select
          value={chosen}
          onChange={(event) => choose(event.target.value)}
          className="btn"
          style={{ padding: "4px 8px", textAlign: "left", textTransform: "none", letterSpacing: "normal" }}
        >
          <option value="">System default</option>
          {mics.map((mic) => (
            <option key={mic.deviceId} value={mic.deviceId}>
              {mic.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="btn flex items-center justify-center"
        onClick={test}
        disabled={testing !== "idle"}
        style={{ gap: 6, padding: "4px 12px" }}
      >
        {testing === "idle" ? <MicIcon size={13} /> : <Loader2Icon size={13} className="animate-spin" />}
        {testing === "recording" ? "SPEAK NOW (5s)" : testing === "transcribing" ? "TRANSCRIBING" : "TEST MIC"}
      </button>

      {result && (
        <div className="flex flex-col" style={{ gap: 6, fontSize: 11, lineHeight: 1.45, color: "var(--text-secondary)" }}>
          {result.label && (
            <span className="wrap-words">
              {result.label}
              {result.sampleRate ? ` · ${(result.sampleRate / 1000).toFixed(0)} kHz` : ""} · level{" "}
              {Math.round(result.peak * 100)}%
            </span>
          )}
          {result.clip && <audio controls src={result.clip} style={{ width: "100%", height: 32 }} />}
          {result.error ? (
            <span style={{ color: "var(--error)" }}>{result.error}</span>
          ) : (
            <span className="wrap-words" style={{ color: "var(--text-primary)" }}>
              Heard: {result.heard ? `“${result.heard}”` : "(nothing)"}
            </span>
          )}
          {headset && (
            <span className="wrap-words" style={{ color: "var(--warning, #f5a524)" }}>
              This is a Bluetooth headset mic, which runs at phone-call quality while it is open. For
              clearer recognition pick your laptop or a USB mic here; the earbuds still play Jarvis.
            </span>
          )}
          {quiet && (
            <span className="wrap-words" style={{ color: "var(--warning, #f5a524)" }}>
              Very little signal reached the browser. Check the mic is not muted and is the one you meant.
            </span>
          )}
        </div>
      )}
    </>
  )
}
