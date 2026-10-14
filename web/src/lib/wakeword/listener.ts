"use client"

import { SAMPLE_RATE, WakeWordDetector, type SessionLike } from "@/lib/wakeword/detector"

// Always listening for "hey Jarvis", like the films. The mic is opened once
// and heard only by the detector's models, in this tab; nothing leaves the
// machine until the phrase is heard, and then the console opens the
// ordinary mic exactly as a tap on the core would.
//
// onnxruntime-web comes from the CDN at a pinned version, like MediaPipe's
// WASM (lib/face-scan.ts): it is not a dependency of the console, only of
// @huggingface/transformers, at a pre-release version.

const ORT_VERSION = "1.23.0"
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`
const MODELS = "/wakeword/"
// "Hey Jarvis" scores ~0.99; the closest miss tried ("hey Travis") ~0.4.
const THRESHOLD = 0.6
// After a detection the same words keep scoring high for a second or so.
const COOLDOWN_MS = 2500

interface OrtModule {
  env: { wasm: { wasmPaths: string; numThreads: number } }
  InferenceSession: { create(url: string, options?: object): Promise<SessionLike> }
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown
}

let ortPromise: Promise<OrtModule> | null = null

function loadOrt(): Promise<OrtModule> {
  ortPromise ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${ORT_BASE}ort.wasm.min.mjs`).then(
    (mod: OrtModule) => {
      mod.env.wasm.wasmPaths = ORT_BASE
      // One thread: threads need a cross-origin-isolated page, and these
      // models take a few milliseconds a chunk anyway.
      mod.env.wasm.numThreads = 1
      return mod
    }
  )
  return ortPromise
}

export interface WakeListener {
  stop(): void
}

export async function startWakeListener(onWake: () => void, onError?: (message: string) => void): Promise<WakeListener> {
  const ort = await loadOrt()
  const session = (name: string) => ort.InferenceSession.create(`${MODELS}${name}.onnx`, { executionProviders: ["wasm"] })
  const [mel, embedding, wake] = await Promise.all([
    session("melspectrogram"),
    session("embedding_model"),
    session("hey_jarvis_v0.1"),
  ])
  const detector = new WakeWordDetector({ mel, embedding, wake }, (data, dims) => new ort.Tensor("float32", data, dims))

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  // The context resamples the mic to 16 kHz, the rate the models expect.
  const context = new AudioContext({ sampleRate: SAMPLE_RATE })
  await context.audioWorklet.addModule(`${MODELS}capture-worklet.js`)
  const source = context.createMediaStreamSource(stream)
  const capture = new AudioWorkletNode(context, "wake-capture")
  source.connect(capture)

  let stopped = false
  let busy = false
  let queue: Float32Array[] = []
  let quietUntil = 0

  // Blocks are scored one after another; if scoring falls behind (a busy
  // tab), the oldest audio is dropped rather than letting a backlog grow.
  async function drain() {
    if (busy) return
    busy = true
    try {
      while (queue.length && !stopped) {
        if (queue.length > 8) queue = queue.slice(-4)
        const score = await detector.feed(queue.shift()!)
        if (score >= THRESHOLD && performance.now() > quietUntil) {
          quietUntil = performance.now() + COOLDOWN_MS
          detector.reset()
          queue = []
          onWake()
        }
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err))
    } finally {
      busy = false
    }
  }

  capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (stopped) return
    queue.push(event.data)
    void drain()
  }

  return {
    stop() {
      stopped = true
      capture.port.onmessage = null
      source.disconnect()
      capture.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      void context.close()
    },
  }
}
