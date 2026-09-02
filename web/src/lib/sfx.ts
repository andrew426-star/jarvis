"use client"

// Synthesised, not sampled.
//
// An mp3 bed would mean binary assets in the repo, a second thing to cache
// and a loop point you eventually start hearing. Everything here is built
// from oscillators and one noise buffer at runtime, which costs a few
// kilobytes of code, never repeats, and can follow the agent's state -
// the thinking texture is literally driven by `status`, not crossfaded
// underneath it.
//
// Jarvis's palette: clean, high, precise. Filtered air, short bright
// clicks, two-note confirmations. Nothing below ~180 Hz, because the low
// end is Ultron's register and the two consoles should not be mistakable.

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

function startBed(): void {
  const context = ensure()
  if (!context || !master) return

  bedGain = context.createGain()
  bedGain.gain.value = 0.0
  bedGain.connect(master)

  // Filtered air: white noise with everything below 2 kHz removed, which
  // reads as a clean room tone rather than hiss.
  const air = context.createBufferSource()
  air.buffer = noiseBuffer(context)
  air.loop = true
  const airFilter = context.createBiquadFilter()
  airFilter.type = "highpass"
  airFilter.frequency.value = 2400
  const airGain = context.createGain()
  airGain.gain.value = 0.05
  air.connect(airFilter)
  airFilter.connect(airGain)
  airGain.connect(bedGain)
  air.start()

  // A quiet fifth, slowly breathing. Two partials only - more turns into
  // a chord, and a chord has an opinion the room shouldn't have.
  for (const [freq, gain] of [[196, 0.035], [294, 0.022]] as const) {
    const osc = context.createOscillator()
    osc.type = "sine"
    osc.frequency.value = freq
    const g = context.createGain()
    g.gain.value = gain
    osc.connect(g)
    g.connect(bedGain)
    osc.start()

    const lfo = context.createOscillator()
    lfo.frequency.value = 0.07 + Math.random() * 0.05
    const lfoGain = context.createGain()
    lfoGain.gain.value = gain * 0.6
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
  },
  toggleMuted(): boolean {
    this.setMuted(!muted)
    return muted
  },
}
