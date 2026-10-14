// "Hey Jarvis", heard on the device. openWakeWord's three small models
// (web/public/wakeword/, from github.com/dscripka/openWakeWord v0.5.1)
// run in a chain, exactly as its Python reference does:
//
//   16 kHz audio, 1280 samples (80 ms) at a time, with 480 of context
//     -> melspectrogram.onnx: 8 frames of 32 mel bins, scaled x/10 + 2
//   the last 76 mel frames
//     -> embedding_model.onnx: one 96-value speech embedding per chunk
//   the last 16 embeddings (about 1.3 s)
//     -> hey_jarvis_v0.1.onnx: the chance it was "hey jarvis", 0..1
//
// Nothing is sent anywhere: the mic is only heard by these models until
// the phrase is, and then the ordinary mic (and /transcribe) take over.
//
// This file has no browser or Node imports, so the same code runs in the
// console (onnxruntime-web) and in its test (onnxruntime-node).

export const SAMPLE_RATE = 16000
export const CHUNK = 1280
const CONTEXT = 480
const MEL_BINS = 32
const MEL_WINDOW = 76
const EMBEDDING = 96
const EMBEDDING_WINDOW = 16

interface TensorLike {
  data: unknown
  dims: readonly number[]
}

export interface SessionLike {
  inputNames: readonly string[]
  outputNames: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, TensorLike>>
}

export type MakeTensor = (data: Float32Array, dims: number[]) => unknown

export interface WakeModels {
  mel: SessionLike
  embedding: SessionLike
  wake: SessionLike
}

export class WakeWordDetector {
  private context = new Float32Array(CONTEXT)
  private pending: number[] = []
  private mel: Float32Array[] = []
  private features: Float32Array[] = []
  private models: WakeModels
  private tensor: MakeTensor

  constructor(models: WakeModels, tensor: MakeTensor) {
    this.models = models
    this.tensor = tensor
  }

  /** Forget everything heard, e.g. after a detection, so the same words
   *  do not fire it again. */
  reset() {
    this.context = new Float32Array(CONTEXT)
    this.pending = []
    this.mel = []
    this.features = []
  }

  /** Audio at 16 kHz, scaled like 16-bit samples (-32768..32767). Returns
   *  the highest score of the chunks it completed, or 0 if none. */
  async feed(samples: Float32Array): Promise<number> {
    for (const s of samples) this.pending.push(s)
    let best = 0
    while (this.pending.length >= CHUNK) {
      const chunk = Float32Array.from(this.pending.splice(0, CHUNK))
      best = Math.max(best, await this.step(chunk))
    }
    return best
  }

  private async step(chunk: Float32Array): Promise<number> {
    const audio = new Float32Array(CONTEXT + CHUNK)
    audio.set(this.context)
    audio.set(chunk, CONTEXT)
    this.context = audio.slice(audio.length - CONTEXT)

    const melOut = await this.run(this.models.mel, audio, [1, audio.length])
    const values = melOut.data as Float32Array
    for (let i = 0; i + MEL_BINS <= values.length; i += MEL_BINS) {
      const frame = new Float32Array(MEL_BINS)
      for (let j = 0; j < MEL_BINS; j++) frame[j] = values[i + j] / 10 + 2
      this.mel.push(frame)
    }
    if (this.mel.length > MEL_WINDOW) this.mel.splice(0, this.mel.length - MEL_WINDOW)
    if (this.mel.length < MEL_WINDOW) return 0

    const window = new Float32Array(MEL_WINDOW * MEL_BINS)
    this.mel.forEach((frame, i) => window.set(frame, i * MEL_BINS))
    const embedOut = await this.run(this.models.embedding, window, [1, MEL_WINDOW, MEL_BINS, 1])
    this.features.push(Float32Array.from(embedOut.data as Float32Array))
    if (this.features.length > EMBEDDING_WINDOW) this.features.shift()
    if (this.features.length < EMBEDDING_WINDOW) return 0

    const stacked = new Float32Array(EMBEDDING_WINDOW * EMBEDDING)
    this.features.forEach((feature, i) => stacked.set(feature, i * EMBEDDING))
    const wakeOut = await this.run(this.models.wake, stacked, [1, EMBEDDING_WINDOW, EMBEDDING])
    return (wakeOut.data as Float32Array)[0]
  }

  private async run(session: SessionLike, data: Float32Array, dims: number[]): Promise<TensorLike> {
    const out = await session.run({ [session.inputNames[0]]: this.tensor(data, dims) })
    return out[session.outputNames[0]]
  }
}
