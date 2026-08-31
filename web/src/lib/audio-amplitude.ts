// Module-level singleton, not React state/context — this updates at
// animation-frame rate while narration plays, and routing it through
// React would re-render the whole console tree 60x/sec for no reason.
// Mirrors jarvis-core.tsx's own imperative-ref style (rotationRef,
// flickerIndicesRef), just crossing a file boundary via a module export
// instead of a shared component-tree ref, since chat-message.tsx (owns
// the <audio> element) and jarvis-core.tsx (needs the amplitude) have no
// convenient common ancestor to thread a ref through.
export const audioAmplitude = { current: 0 }

let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let sourceEl: HTMLAudioElement | null = null
let freqData: Uint8Array<ArrayBuffer> | null = null
let rafId: number | null = null

function tick() {
  if (analyser && freqData) {
    analyser.getByteFrequencyData(freqData)
    let sum = 0
    for (let i = 0; i < freqData.length; i++) sum += freqData[i]
    audioAmplitude.current = sum / freqData.length / 255
  }
  rafId = requestAnimationFrame(tick)
}

export function startAudioAnalysis(audio: HTMLAudioElement) {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === "suspended") void audioCtx.resume()

    if (sourceEl !== audio) {
      // createMediaElementSource silences the element's own direct
      // output — it must be manually reconnected through to destination
      // or narration goes mute. chat-message.tsx creates a brand-new
      // Audio() instance per playSpeech() call, so this is always a
      // fresh element, never a double-source error on the same one.
      const source = audioCtx.createMediaElementSource(audio)
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.75
      // Cast needed: newer lib.dom typings want Uint8Array<ArrayBuffer>
      // specifically, but the plain-number constructor overload infers
      // the wider Uint8Array<ArrayBufferLike> — a real buffer either way.
      freqData = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>
      source.connect(analyser)
      analyser.connect(audioCtx.destination)
      sourceEl = audio
    }
    if (rafId === null) tick()
  } catch {
    // An exotic browser/privacy configuration that rejects Web Audio
    // entirely just loses the reactive visual — narration itself is
    // untouched, jarvis-core.tsx falls back to its fixed-sine pulse.
  }
}

export function stopAudioAnalysis() {
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = null
  audioAmplitude.current = 0
}

// --- Mic side ---------------------------------------------------------
// While recording, the core should react to *your* voice the same way it
// reacts to narration. mic-button.tsx's VAD loop already computes a
// per-frame RMS, so rather than standing up a second analyser this just
// feeds that existing number into the same singleton. The two are
// mutually exclusive in time: a barge-in stops narration before the mic
// opens, so nothing races over this value.

// Gain is uncalibrated, same caveat as mic-button.tsx's VAD constants —
// speech RMS lands well below 1.0, so it needs a lift to read as motion
// on the core at all. Clamped so a shout can't blow the pulse out.
const MIC_GAIN = 2.5

export function setMicAmplitude(rms: number) {
  audioAmplitude.current = Math.min(1, rms * MIC_GAIN)
}

export function clearMicAmplitude() {
  audioAmplitude.current = 0
}
