// Module-level singleton, not React state/context - this updates at
// animation-frame rate while audio runs, and routing it through React
// would re-render the whole console 60x/sec for no reason. Mirrors
// jarvis-core's old imperative-ref style, just crossing a file boundary
// via a module export, since the component that owns the <audio> and the
// components that visualise it have no convenient common ancestor.

/** Overall level, 0-1. Drives the reactor's pulse. */
export const audioAmplitude = { current: 0 }

/** Per-band levels, 0-1, low frequency first. Drives the EQ bars. */
export const BAND_COUNT = 24
export const audioBands = { current: new Float32Array(BAND_COUNT) }

let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let sourceEl: HTMLAudioElement | null = null
let freqData: Uint8Array<ArrayBuffer> | null = null
let rafId: number | null = null

// Shared by both sources so narration and microphone produce bars on the
// same scale. Averages each slice rather than point-sampling, so a bar
// reflects its whole band instead of one arbitrary bin.
function writeBands(bins: Uint8Array): void {
  const perBand = bins.length / BAND_COUNT
  for (let band = 0; band < BAND_COUNT; band++) {
    const start = Math.floor(band * perBand)
    const end = Math.max(start + 1, Math.floor((band + 1) * perBand))
    let total = 0
    for (let i = start; i < end; i++) total += bins[i]
    audioBands.current[band] = total / (end - start) / 255
  }
}

function clearBands(): void {
  audioBands.current.fill(0)
}

function tick() {
  if (analyser && freqData) {
    analyser.getByteFrequencyData(freqData)
    let sum = 0
    for (let i = 0; i < freqData.length; i++) sum += freqData[i]
    audioAmplitude.current = sum / freqData.length / 255
    writeBands(freqData)
  }
  rafId = requestAnimationFrame(tick)
}

export function startAudioAnalysis(audio: HTMLAudioElement) {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === "suspended") void audioCtx.resume()

    if (sourceEl !== audio) {
      // createMediaElementSource silences the element's own direct
      // output - it must be manually reconnected through to destination
      // or narration goes mute. chat-message.tsx creates a brand-new
      // Audio() per playSpeech() call, so this is always a fresh
      // element, never a double-source error on the same one.
      const source = audioCtx.createMediaElementSource(audio)
      analyser = audioCtx.createAnalyser()
      // 128 (up from 64) gives 64 bins, enough to fill BAND_COUNT bars
      // with a real average per band rather than a stretched handful.
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.72
      // Cast needed: newer lib.dom typings want Uint8Array<ArrayBuffer>
      // specifically, but the plain-number constructor overload infers
      // the wider Uint8Array<ArrayBufferLike> - a real buffer either way.
      freqData = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>
      source.connect(analyser)
      analyser.connect(audioCtx.destination)
      sourceEl = audio
    }
    if (rafId === null) tick()
  } catch {
    // An exotic browser/privacy configuration that rejects Web Audio
    // entirely just loses the reactive visuals - narration itself is
    // untouched, and the reactor falls back to its fixed sine pulse.
  }
}

export function stopAudioAnalysis() {
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = null
  audioAmplitude.current = 0
  clearBands()
}

// --- Mic side ---------------------------------------------------------
// While recording, the HUD should react to *your* voice exactly as it
// reacts to narration. mic-button.tsx's VAD loop already runs an
// analyser and computes a per-frame RMS, so rather than standing up a
// second one this just feeds those numbers in. The two sources are
// mutually exclusive in time: a barge-in stops narration before the mic
// opens, so nothing races over these values.

// Uncalibrated, same caveat as mic-button.tsx's VAD constants - speech
// RMS lands well below 1.0, so it needs a lift to read as motion at
// all. Clamped so a shout cannot blow the visuals out.
const MIC_GAIN = 2.5

export function setMicAmplitude(rms: number) {
  audioAmplitude.current = Math.min(1, rms * MIC_GAIN)
}

/** Frequency bins straight off the mic's existing analyser. */
export function setMicBands(bins: Uint8Array): void {
  writeBands(bins)
}

export function clearMicAmplitude() {
  audioAmplitude.current = 0
  clearBands()
}
