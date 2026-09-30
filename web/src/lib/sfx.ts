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
type Ambience = "normal" | "serious"

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
let mutedLoaded = false
// The recorded (or synth) bed passes through normalGain and bedTone so
// serious mode can pull it back and darken it under the Mechanicus layer.
let normalGain: GainNode | null = null
let bedTone: BiquadFilterNode | null = null
let reverb: ConvolverNode | null = null
let ambienceMode: Ambience = "normal"
// The top bar's Audio/Muted label reads mute state as an external store
// (useSyncExternalStore) rather than copying it into React state.
const muteListeners = new Set<() => void>()
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

// Loaded lazily, on first read in the browser: the static export's server
// render has no localStorage, and nothing should need an AudioContext just
// to know whether audio is muted.
function currentMuted(): boolean {
  if (!mutedLoaded && typeof window !== "undefined") {
    muted = readMuted()
    mutedLoaded = true
  }
  return muted
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
    currentMuted()

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
    if (ambienceMode === "serious") startMechanicus()
  }
}

// Served from web/public, so it ships with the static export and is
// same-origin - a MediaElementSource cannot be routed through the graph
// otherwise.
const AMBIENCE_URL = "/ambience.mp3"

// Where the normal bed plugs in. Shared by the recorded bed and its synth
// fallback, so the fallback reuses the chain instead of orphaning it.
function bedInput(context: AudioContext): GainNode {
  if (!bedGain) {
    bedGain = context.createGain()
    bedGain.gain.value = 0.0
    bedGain.connect(master!)
  }
  if (!normalGain) {
    normalGain = context.createGain()
    normalGain.gain.value = ambienceMode === "serious" ? SERIOUS_BED_LEVEL : 1
    normalGain.connect(bedGain)
  }
  return normalGain
}

function startBed(): void {
  const context = ensure()
  if (!context || !master) return
  const input = bedInput(context)

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
  tone.frequency.value = ambienceMode === "serious" ? SERIOUS_BED_CUTOFF : 760
  tone.Q.value = 0.4
  bedTone = tone

  const rumble = context.createBiquadFilter()
  rumble.type = "highpass"
  rumble.frequency.value = 70

  const source = context.createMediaElementSource(el)
  source.connect(rumble)
  rumble.connect(tone)
  tone.connect(input)

  // A missing or unplayable file falls back to the synthesised bed
  // rather than leaving the console silent. Worth having: the asset is
  // 4 MB, and a slow or failed fetch is a real state, not a theoretical
  // one.
  el.addEventListener("error", () => startSynthBed(), { once: true })
  void el.play().catch(() => startSynthBed())

  bedGain!.gain.linearRampToValueAtTime(0.6, context.currentTime + 3)
}

function startSynthBed(): void {
  const context = ensure()
  if (!context || !master) return
  const input = bedInput(context)

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
  airGain.connect(input)
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
  warm.connect(input)

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

  bedGain!.gain.linearRampToValueAtTime(0.6, context.currentTime + 3)
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

// ---------------------------------------------------------------------------
// Serious mode: the Mechanicus layer.
//
// A forge-cathedral under the normal bed rather than instead of it: the
// recorded bed drops to SERIOUS_BED_LEVEL and darkens, and over it runs an
// organ drone on A, a formant "choir" pad walking a slow modal progression,
// soft piston beats, low servo groans and a distant bell - all in a long
// synthetic cathedral reverb. Nothing in the running layer sits in the
// bright register; the binary cant is kept for the mode switch alone.
// Everything is synthesised, so it costs no download and reacts to mode
// the instant it changes.
// ---------------------------------------------------------------------------

const SERIOUS_BED_LEVEL = 0.4
const SERIOUS_BED_CUTOFF = 420
// Overall level of the layer inside the bed, before status ducking.
const MECH_LEVEL = 0.9

let mechGain: GainNode | null = null
let mechNodes: AudioScheduledSourceNode[] = []
let mechTimers: ReturnType<typeof setTimeout>[] = []
let choirVoices: OscillatorNode[][] = []
let mechanicusOn = false

// A long, dark hall: stereo noise with an exponential tail, darker as it
// decays because every sample is averaged with the last.
function cathedral(context: AudioContext): ConvolverNode {
  if (reverb) return reverb
  const seconds = 5.5
  const length = Math.floor(context.sampleRate * seconds)
  const impulse = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel)
    let last = 0
    for (let i = 0; i < length; i += 1) {
      const t = i / length
      const smooth = 0.4 + t * 0.55
      last = last * smooth + (Math.random() * 2 - 1) * (1 - smooth)
      data[i] = last * Math.pow(1 - t, 2.6) * 3
    }
  }
  reverb = context.createConvolver()
  reverb.buffer = impulse
  reverb.connect(master!)
  return reverb
}

// Sends a source into the layer: part dry, part into the hall.
function mechSend(context: AudioContext, node: AudioNode, dry: number, wet: number) {
  if (!mechGain) return
  const d = context.createGain()
  d.gain.value = dry
  node.connect(d)
  d.connect(mechGain)
  const w = context.createGain()
  w.gain.value = wet
  node.connect(w)
  w.connect(cathedral(context))
}

function later(ms: number, fn: () => void) {
  mechTimers.push(setTimeout(fn, ms))
}

function oneShotNoise(context: AudioContext, seconds: number): AudioBufferSourceNode {
  const source = context.createBufferSource()
  source.buffer = noiseBuffer(context)
  source.loop = true
  source.start(context.currentTime, Math.random())
  source.stop(context.currentTime + seconds + 0.05)
  return source
}

// One bit of binharic cant. Square waves through a narrow band, so it
// sounds like a vox-grille, not a synth.
function binharicBit(one: boolean, peak = 0.018, at = 0, into?: AudioNode) {
  const context = ensure()
  if (!context || !master || muted) return
  const now = context.currentTime + at
  const osc = context.createOscillator()
  osc.type = "square"
  osc.frequency.value = one ? 1780 : 1190
  const band = context.createBiquadFilter()
  band.type = "bandpass"
  band.frequency.value = 1500
  band.Q.value = 2.5
  const g = context.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(peak, now + 0.003)
  g.gain.setValueAtTime(peak, now + 0.028)
  g.gain.linearRampToValueAtTime(0, now + 0.034)
  osc.connect(band)
  band.connect(g)
  g.connect(into ?? master)
  osc.start(now)
  osc.stop(now + 0.05)
}

function cant(bits: number, spacing: number, peak: number, into?: AudioNode) {
  for (let i = 0; i < bits; i += 1) binharicBit(Math.random() < 0.5, peak, i * spacing, into)
}

// Inharmonic partials are what make a bell a bell and not a chord.
const BELL_PARTIALS: [number, number, number][] = [
  [0.5, 1, 7],
  [1, 0.8, 5.5],
  [1.19, 0.5, 4],
  [1.56, 0.4, 3.2],
  [2, 0.35, 3],
  [2.51, 0.2, 2.2],
  [2.66, 0.18, 2],
]

function toll(base: number, peak: number) {
  const context = ensure()
  if (!context || !master || muted) return
  const now = context.currentTime
  const out = context.createGain()
  out.connect(cathedral(context))
  const dry = context.createGain()
  dry.gain.value = 0.35
  out.connect(dry)
  dry.connect(mechGain ?? master)
  for (const [ratio, level, decay] of BELL_PARTIALS) {
    const osc = context.createOscillator()
    osc.frequency.value = base * ratio
    const g = context.createGain()
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(peak * level, now + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay)
    osc.connect(g)
    g.connect(out)
    osc.start(now)
    osc.stop(now + decay + 0.1)
  }
}

// A minor, F major, D minor, E major: slow and modal, a chant rather
// than a song.
const CHORDS = [
  [220, 261.63, 329.63],
  [174.61, 220, 261.63],
  [146.83, 174.61, 220],
  [164.81, 207.65, 246.94],
]
let chordIndex = 0

// Organ drone plus choir: the continuous part of the layer.
function startDroneAndChoir(context: AudioContext) {
  const now = context.currentTime

  // Organ: A1, E2, A2. Detuned pairs of saws through a slowly breathing
  // low-pass read as pipes in a big room rather than as a synth.
  const organFilter = context.createBiquadFilter()
  organFilter.type = "lowpass"
  organFilter.frequency.value = 300
  organFilter.Q.value = 1.6
  const organ = context.createGain()
  organ.gain.value = 0.05
  organFilter.connect(organ)
  mechSend(context, organ, 0.8, 0.5)

  const pipes: [number, number, OscillatorType][] = [
    [55, 1, "sawtooth"],
    [82.41, 0.55, "sawtooth"],
    [110, 0.35, "square"],
  ]
  for (const [freq, level, type] of pipes) {
    for (const cents of [-5, 5]) {
      const osc = context.createOscillator()
      osc.type = type
      osc.frequency.value = freq
      osc.detune.value = cents
      const g = context.createGain()
      g.gain.value = level * 0.5
      osc.connect(g)
      g.connect(organFilter)
      osc.start(now)
      mechNodes.push(osc)
    }
  }
  const breathe = context.createOscillator()
  breathe.frequency.value = 0.035
  const depth = context.createGain()
  depth.gain.value = 130
  breathe.connect(depth)
  depth.connect(organFilter.frequency)
  breathe.start(now)
  mechNodes.push(breathe)

  // Choir: three voices of detuned saws through two vowel formants ("ah"),
  // almost entirely wet, so it hangs in the hall rather than in the room.
  const f1 = context.createBiquadFilter()
  f1.type = "bandpass"
  f1.frequency.value = 780
  f1.Q.value = 5
  const f2 = context.createBiquadFilter()
  f2.type = "bandpass"
  f2.frequency.value = 1150
  f2.Q.value = 7
  const choir = context.createGain()
  choir.gain.setValueAtTime(0, now)
  choir.gain.linearRampToValueAtTime(0.09, now + 6)
  f1.connect(choir)
  f2.connect(choir)
  mechSend(context, choir, 0.15, 1)

  const swell = context.createOscillator()
  swell.frequency.value = 0.06
  const swellDepth = context.createGain()
  swellDepth.gain.value = 0.035
  swell.connect(swellDepth)
  swellDepth.connect(choir.gain)
  swell.start(now)
  mechNodes.push(swell)

  chordIndex = 0
  choirVoices = CHORDS[0].map((freq) =>
    [-9, 0, 8].map((cents) => {
      const osc = context.createOscillator()
      osc.type = "sawtooth"
      osc.frequency.value = freq
      osc.detune.value = cents
      const g = context.createGain()
      g.gain.value = 0.12
      osc.connect(g)
      g.connect(f1)
      g.connect(f2)
      osc.start(now)
      mechNodes.push(osc)
      return osc
    })
  )
}

function walkChoir() {
  const context = ensure()
  if (!context || !mechanicusOn) return
  chordIndex = (chordIndex + 1) % CHORDS.length
  const chord = CHORDS[chordIndex]
  choirVoices.forEach((voices, i) =>
    voices.forEach((osc) => osc.frequency.setTargetAtTime(chord[i], context.currentTime, 1.2))
  )
  later(18000 + Math.random() * 8000, walkChoir)
}

// Piston: a soft, low thump - felt more than heard. (It once had a metal
// clank and a steam vent; both cut through the room and were removed.)
function piston() {
  const context = ensure()
  if (!context || !mechanicusOn || !mechGain) return
  if (!muted) {
    const now = context.currentTime
    const thump = context.createOscillator()
    thump.frequency.setValueAtTime(58, now)
    thump.frequency.exponentialRampToValueAtTime(36, now + 0.5)
    const tg = context.createGain()
    // A 40ms swell rather than a click-fast attack.
    tg.gain.setValueAtTime(0, now)
    tg.gain.linearRampToValueAtTime(0.1, now + 0.04)
    tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
    thump.connect(tg)
    mechSend(context, tg, 0.9, 0.35)
    thump.start(now)
    thump.stop(now + 0.65)
  }
  later(2800 + Math.random() * 600, piston)
}

// A servo: a slow, muffled groan somewhere in the machinery. Kept under
// a low-pass so it never reaches the bright register.
function servo() {
  const context = ensure()
  if (!context || !mechanicusOn || !mechGain) return
  if (!muted) {
    const now = context.currentTime
    const osc = context.createOscillator()
    osc.type = "sawtooth"
    osc.frequency.setValueAtTime(70, now)
    osc.frequency.linearRampToValueAtTime(104, now + 1.2)
    osc.frequency.linearRampToValueAtTime(82, now + 2.4)
    const low = context.createBiquadFilter()
    low.type = "lowpass"
    low.Q.value = 0.7
    low.frequency.setValueAtTime(220, now)
    low.frequency.linearRampToValueAtTime(380, now + 1.2)
    low.frequency.linearRampToValueAtTime(240, now + 2.4)
    const g = context.createGain()
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(0.022, now + 0.6)
    g.gain.linearRampToValueAtTime(0, now + 2.5)
    osc.connect(low)
    low.connect(g)
    mechSend(context, g, 0.6, 0.5)
    osc.start(now)
    osc.stop(now + 2.6)
  }
  later(10000 + Math.random() * 9000, servo)
}

function bell() {
  if (!mechanicusOn) return
  toll(110, 0.035)
  later(26000 + Math.random() * 14000, bell)
}

function startMechanicus() {
  const context = ensure()
  if (!context || !bedGain || mechanicusOn) return
  mechanicusOn = true
  const now = context.currentTime

  mechGain = context.createGain()
  mechGain.gain.setValueAtTime(0, now)
  mechGain.gain.linearRampToValueAtTime(MECH_LEVEL, now + 3)
  // Inside the bed, so thinking lifts it and narration ducks it exactly
  // as it does the normal ambience.
  mechGain.connect(bedGain)

  startDroneAndChoir(context)
  later(1800, piston)
  later(6000, servo)
  later(12000, walkChoir)
  later(20000, bell)
}

function stopMechanicus() {
  const context = ensure()
  if (!context || !mechanicusOn) return
  mechanicusOn = false
  mechTimers.forEach(clearTimeout)
  mechTimers = []
  const gain = mechGain
  const nodes = mechNodes
  mechGain = null
  mechNodes = []
  choirVoices = []
  const now = context.currentTime
  if (gain) {
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(0, now + 2)
  }
  // Stopped after the fade, not during it, or the drone would cut dead.
  setTimeout(() => {
    nodes.forEach((node) => {
      try {
        node.stop()
      } catch {
        // Already stopped.
      }
    })
    gain?.disconnect()
  }, 2200)
}

// Digital corruption: a handful of 20-30ms slices, each a random burst of
// band-passed noise or a square blip at a random pitch.
function stutter(slices: number, peak: number) {
  const context = ensure()
  if (!context || !master || muted) return
  const start = context.currentTime
  for (let i = 0; i < slices; i += 1) {
    const at = start + i * 0.028
    const g = context.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(peak * (0.5 + Math.random() * 0.5), at + 0.002)
    g.gain.setValueAtTime(peak * 0.6, at + 0.018)
    g.gain.linearRampToValueAtTime(0, at + 0.022)
    g.connect(master)
    if (Math.random() < 0.55) {
      const burst = context.createBufferSource()
      burst.buffer = noiseBuffer(context)
      const band = context.createBiquadFilter()
      band.type = "bandpass"
      band.frequency.value = 300 + Math.random() * 5000
      band.Q.value = 3
      burst.connect(band)
      band.connect(g)
      burst.start(at, Math.random())
      burst.stop(at + 0.03)
    } else {
      const osc = context.createOscillator()
      osc.type = "square"
      osc.frequency.value = 150 + Math.random() * 2800
      osc.connect(g)
      osc.start(at)
      osc.stop(at + 0.03)
    }
  }
}

function sweep(
  from: number,
  to: number,
  seconds: number,
  peak: number,
  type: OscillatorType,
  cutoff: [number, number]
) {
  const context = ensure()
  if (!context || !master || muted) return
  const now = context.currentTime
  const osc = context.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(from, now)
  osc.frequency.exponentialRampToValueAtTime(to, now + seconds)
  const filter = context.createBiquadFilter()
  filter.type = "lowpass"
  filter.frequency.setValueAtTime(cutoff[0], now)
  filter.frequency.exponentialRampToValueAtTime(cutoff[1], now + seconds)
  const g = context.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(peak, now + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, now + seconds + 0.1)
  osc.connect(filter)
  filter.connect(g)
  g.connect(master)
  osc.start(now)
  osc.stop(now + seconds + 0.15)
}

function impact() {
  const context = ensure()
  if (!context || !master || muted) return
  const now = context.currentTime
  const sub = context.createOscillator()
  sub.frequency.setValueAtTime(72, now)
  sub.frequency.exponentialRampToValueAtTime(28, now + 0.9)
  const sg = context.createGain()
  sg.gain.setValueAtTime(0, now)
  sg.gain.linearRampToValueAtTime(0.22, now + 0.01)
  sg.gain.exponentialRampToValueAtTime(0.0001, now + 1.1)
  sub.connect(sg)
  sg.connect(master)
  sg.connect(cathedral(context))
  sub.start(now)
  sub.stop(now + 1.2)

  const rumble = oneShotNoise(context, 0.7)
  const low = context.createBiquadFilter()
  low.type = "lowpass"
  low.frequency.value = 260
  const rg = context.createGain()
  rg.gain.setValueAtTime(0, now)
  rg.gain.linearRampToValueAtTime(0.12, now + 0.01)
  rg.gain.exponentialRampToValueAtTime(0.0001, now + 0.7)
  rumble.connect(low)
  low.connect(rg)
  rg.connect(master)
}

function applyAmbience(mode: Ambience) {
  ambienceMode = mode
  const context = ensure()
  if (!context || !started) return // applied when the bed starts
  const now = context.currentTime
  const serious = mode === "serious"
  normalGain?.gain.setTargetAtTime(serious ? SERIOUS_BED_LEVEL : 1, now, 0.8)
  bedTone?.frequency.setTargetAtTime(serious ? SERIOUS_BED_CUTOFF : 760, now, 0.8)
  if (serious) startMechanicus()
  else stopMechanicus()
}

// The sound of the switch itself, timed against the visual transition in
// lib/mode-fx.ts: corruption first, then (into serious) the power drop and
// impact as the wipe starts, the binary cant, and a bell as it lands.
function playModeShift(mode: Ambience) {
  if (muted) return
  if (mode === "serious") {
    stutter(10, 0.05)
    setTimeout(() => {
      sweep(420, 34, 0.95, 0.07, "sawtooth", [1600, 160])
      impact()
      cant(12, 0.03, 0.022)
    }, 290)
    setTimeout(() => toll(110, 0.05), 950)
  } else {
    stutter(5, 0.035)
    setTimeout(() => {
      sweep(260, 1500, 0.5, 0.05, "sine", [3000, 6000])
      blip(880, 0.045, 0.14, "sine")
      setTimeout(() => blip(1320, 0.04, 0.24, "sine"), 110)
    }, 180)
  }
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
        // Serious mode gets a soft low pulse, not a bright tick.
        if (ambienceMode === "serious") blip(420 + Math.random() * 80, 0.014, 0.18, "sine")
        else blip(1400 + Math.random() * 500, 0.022, 0.045)
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

  // Serious mode's Mechanicus layer on or off. Called whenever the mode
  // changes, including once on load, so a reload into serious mode comes
  // back with its ambience.
  setAmbience(mode: Ambience): void {
    applyAmbience(mode)
  },
  // The sound of the switch itself, once per toggle.
  modeShift(mode: Ambience): void {
    playModeShift(mode)
  },

  // Standby: the whole sound engine goes quiet (and stops decoding the
  // bed) without touching the mute preference.
  sleep(): void {
    bedEl?.pause()
    void ctx?.suspend()
  },
  wake(): void {
    void ctx?.resume()
    if (!muted) void bedEl?.play().catch(() => {})
  },

  isMuted(): boolean {
    return currentMuted()
  },
  subscribeMuted(listener: () => void): () => void {
    muteListeners.add(listener)
    return () => muteListeners.delete(listener)
  },
  setMuted(next: boolean): void {
    muted = next
    mutedLoaded = true
    muteListeners.forEach((listener) => listener())
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
