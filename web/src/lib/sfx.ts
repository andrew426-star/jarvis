"use client"

// A recorded bed under synthesised cues.
//
// The bed is Andrew's own ambience file, shared with Ultron and filtered
// differently here: a low-pass at 760 Hz takes the edge off so it sits
// behind the interface rather than in front of it. One asset, two
// treatments - a separately mixed "calm" file would be a second 4 MB
// download and a second thing to keep in step with the first.
//
// Everything that reacts is still synthesised, and has to be: the clicks,
// the thinking tick and the confirmations are driven by `status` at the
// moment it changes, which is not something a recording can do. The
// oscillator bed remains as startSynthBed, the fallback when the file
// cannot be fetched or played.

type Status = "idle" | "listening" | "speaking" | "thinking"

const STORAGE_KEY = "jarvis.sfx.muted"

// Deliberately quiet. This sits under a voice channel and a UI, and
// ambience that announces itself is ambience you turn off.
const MASTER_GAIN = 0.5

let ctx: AudioContext | null = null
let master: GainNode | null = null
let bedGain: GainNode | null = null
let noise: AudioBuffer | null = null
let thinkTimer: ReturnType<typeof setInterval> | null = null
let bedEl: HTMLAudioElement | null = null
let muted = false
let started = false

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    // Private windows and blocked site data both throw here; audio on is
    // the sane default and the toggle still works for the session.
    return false
  }
}

function noiseBuffer(context: AudioContext): AudioBuffer {
  if (noise) return noise
  const frames = context.sampleRate * 2
  const buffer = context.createBuffer(1, frames, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1
  noise = buffer
  return buffer
}

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    muted = readMuted()

    // A limiter rather than trusting the arithmetic: a click landing on
    // top of the bed and a ping should never clip.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -8
    limiter.ratio.value = 12

    master = ctx.createGain()
    master.gain.value = muted ? 0 : MASTER_GAIN
    master.connect(limiter)
    limiter.connect(ctx.destination)
  }
  return ctx
}

// Browsers start an AudioContext suspended until a real gesture. Called
// from the console on first pointer/key contact.
export function unlockAudio(): void {
  const context = ensure()
  if (!context) return
  void context.resume()
  if (!started) {
    started = true
    startBed()
  }
}

// Served from web/public, so it ships with the static export and is
// same-origin - a MediaElementSource cannot be routed through the graph
// otherwise.
const AMBIENCE_URL = "/ambience.mp3"

function startBed(): void {
  const context = ensure()
  if (!context || !master) return

  bedGain = context.createGain()
  bedGain.gain.value = 0.0
  bedGain.connect(master)

  const el = new Audio(AMBIENCE_URL)
  el.loop = true
  el.preload = "auto"
  bedEl = el

  // Calmer than Ultron's, from the same recording. A low-pass at 760 Hz
  // takes the edge and detail off it so it sits behind the interface
  // rather than in front of it, and a high-pass clears the rumble a
  // lowpassed bed otherwise leaves sitting on the speaker. Same file,
  // different treatment - a second mix would be a second 4 MB asset and
  // a second thing to keep in step.
  const tone = context.createBiquadFilter()
  tone.type = "lowpass"
  tone.frequency.value = 760
  tone.Q.value = 0.4

  const rumble = context.createBiquadFilter()
  rumble.type = "highpass"
  rumble.frequency.value = 70

  const source = context.createMediaElementSource(el)
  source.connect(rumble)
  rumble.connect(tone)
  tone.connect(bedGain)

  // A missing or unplayable file falls back to the synthesised bed
  // rather than leaving the console silent. Worth having: the asset is
  // 4 MB, and a slow or failed fetch is a real state, not a theoretical
  // one.
  el.addEventListener("error", () => startSynthBed(), { once: true })
  void el.play().catch(() => startSynthBed())

  bedGain.gain.linearRampToValueAtTime(0.6, context.currentTime + 3)
}

function startSynthBed(): void {
  const context = ensure()
  if (!context || !master) return

  bedGain = context.createGain()
  bedGain.gain.value = 0.0
  bedGain.connect(master)

  // A trace of filtered air, well under the hum. At 0.05 this was the
  // loudest thing in the bed and read as static; it is here to give the
  // tone somewhere to sit, not to be heard on its own.
  const air = context.createBufferSource()
  air.buffer = noiseBuffer(context)
  air.loop = true
  const airFilter = context.createBiquadFilter()
  airFilter.type = "highpass"
  airFilter.frequency.value = 3200
  const airGain = context.createGain()
  airGain.gain.value = 0.011
  air.connect(airFilter)
  airFilter.connect(airGain)
  airGain.connect(bedGain)
  air.start()

  // The hum. A fundamental with its harmonics falling away above it -
  // that decreasing series is what the ear reads as one warm tone rather
  // than as several oscillators playing a chord.
  //
  // Every partial is doubled a fraction of a hertz off its twin. Those
  // pairs beat against each other slowly, which is the difference between
  // a hum that breathes and a test tone. It stays clear of Ultron's
  // register: nothing here is below 98 Hz, where his drone lives.
  const warm = context.createBiquadFilter()
  warm.type = "lowpass"
  warm.frequency.value = 900
  warm.connect(bedGain)

  const partials: [number, number][] = [
    [98, 0.055],
    [147, 0.030],
    [196, 0.024],
    [294, 0.011],
  ]

  for (const [freq, gain] of partials) {
    const g = context.createGain()
    g.gain.value = gain
    g.connect(warm)

    for (const detune of [0, 0.35]) {
      const osc = context.createOscillator()
      osc.type = "sine"
      osc.frequency.value = freq + detune
      osc.connect(g)
      osc.start()
    }

    // Slow amplitude drift, different per partial so they never swell
    // together and give away the trick.
    const lfo = context.createOscillator()
    lfo.frequency.value = 0.05 + Math.random() * 0.06
    const lfoGain = context.createGain()
    lfoGain.gain.value = gain * 0.45
    lfo.connect(lfoGain)
    lfoGain.connect(g.gain)
    lfo.start()
  }

  bedGain.gain.linearRampToValueAtTime(0.6, context.currentTime + 3)
}

// One short tone with a percussive envelope - the shape every UI sound
// here is made of.
function blip(freq: number, peak: number, decay: number, type: OscillatorType = "triangle"): void {
  const context = ensure()
  if (!context || !master || muted) return
  const now = context.currentTime
  const osc = context.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, now)
  const g = context.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(peak, now + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, now + decay)
  osc.connect(g)
  g.connect(master)
  osc.start(now)
  osc.stop(now + decay + 0.02)
}

export const sfx = {
  // Interface contact: bright, short, unmistakably mechanical.
  click(): void {
    blip(2100, 0.06, 0.05)
  },
  // Sent a command.
  send(): void {
    blip(1320, 0.05, 0.07)
    window.setTimeout(() => blip(1980, 0.04, 0.09), 55)
  },
  // A reply landed, or a tool came back clean.
  confirm(): void {
    blip(880, 0.05, 0.12, "sine")
    window.setTimeout(() => blip(1320, 0.045, 0.2, "sine"), 90)
  },
  // Something failed. Descending, because every listener already reads
  // that as "no" without being told.
  alert(): void {
    blip(660, 0.06, 0.14, "sine")
    window.setTimeout(() => blip(440, 0.055, 0.28, "sine"), 110)
  },

  // Drives the ambience from agent state. Thinking gets an intermittent
  // data tick; speaking ducks the bed so narration stays legible.
  setStatus(status: Status): void {
    const context = ensure()
    if (!context || !bedGain) return
    const now = context.currentTime

    if (thinkTimer) {
      clearInterval(thinkTimer)
      thinkTimer = null
    }

    if (status === "thinking") {
      bedGain.gain.linearRampToValueAtTime(1.0, now + 0.4)
      thinkTimer = setInterval(() => {
        // Slight random detune so a fixed interval doesn't read as a
        // metronome - it should sound like work, not a countdown.
        blip(1400 + Math.random() * 500, 0.022, 0.045)
      }, 340)
      return
    }
    if (status === "speaking") {
      bedGain.gain.linearRampToValueAtTime(0.25, now + 0.3)
      return
    }
    if (status === "listening") {
      bedGain.gain.linearRampToValueAtTime(1.2, now + 0.3)
      return
    }
    bedGain.gain.linearRampToValueAtTime(0.6, now + 0.8)
  },

  isMuted(): boolean {
    return muted
  },
  setMuted(next: boolean): void {
    muted = next
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
    } catch {
      // Preference won't survive a reload; the toggle still works now.
    }
    const context = ensure()
    if (context && master) {
      master.gain.linearRampToValueAtTime(next ? 0 : MASTER_GAIN, context.currentTime + 0.2)
    }
    // Actually stop the stream. Turning the gain down leaves it decoding
    // a looping 4 MB file for nothing.
    if (bedEl) {
      if (next) bedEl.pause()
      else void bedEl.play().catch(() => {})
    }
  },
  toggleMuted(): boolean {
    this.setMuted(!muted)
    return muted
  },
}
