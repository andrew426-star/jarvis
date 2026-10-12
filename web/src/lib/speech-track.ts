"use client"

// What is being said right now, and how far into it the voice is - so a
// face can shape its mouth to the transcript rather than only to loudness.
// The speech queue (speech-queue.ts) reports each sentence as its clip
// starts and stops; mouthShape() reads the sound being made now.
//
// A sentence becomes a timeline of sounds, not letters: letter pairs that
// make one sound (th, sh, ch, oo, ee, ou, ph, ng...) are one, silent final
// e's barely count, and each sound lasts as long as it does in speech -
// vowels longer than consonants, a gap between words, a real pause (the
// mouth at rest) at a comma or a full stop. The timeline is stretched to
// the clip's actual length (less its lead-in and tail), so the mouth
// stays on the words through a long sentence. At any moment the shape is
// this sound's, eased into the next over the end of it, and rounding (o,
// u, w) starts early, as lips do.

/** A mouth shape: how open the jaw is, how wide the lips, how rounded
 *  (pushed forward), and whether they press shut (m, b, p) or the lower
 *  lip tucks under the teeth (f, v). Each 0..1. */
export interface Mouth {
  open: number
  wide: number
  round: number
  press: number
  tuck: number
}

interface Sound {
  shape: Mouth
  /** Relative length. */
  weight: number
}

interface Line {
  text: string
  /** performance.now() when the clip started. */
  start: number
  /** The clip's length, ms. */
  duration: number
  sounds: Sound[]
  /** Each sound's end, 0..1 of the spoken part. */
  ends: number[]
}

const REST: Mouth = { open: 0, wide: 0.5, round: 0, press: 0, tuck: 0 }
const M = (open: number, wide: number, round = 0, press = 0, tuck = 0): Mouth => ({ open, wide, round, press, tuck })

// The mouth for each sound, and how long it lasts (a vowel about twice a
// consonant).
const SOUNDS: [string, Mouth, number][] = [
  // Pairs first: they are one sound.
  ["th", M(0.3, 0.62), 1],
  ["sh", M(0.28, 0.3, 0.55), 1.1],
  ["ch", M(0.3, 0.32, 0.5), 1.1],
  ["ph", M(0.12, 0.6, 0, 0, 1), 1],
  ["wh", M(0.2, 0.08, 1), 0.9],
  ["ng", M(0.38, 0.55), 0.9],
  ["qu", M(0.25, 0.1, 0.9), 1.1],
  ["oo", M(0.35, 0.1, 1), 1.9],
  ["ee", M(0.42, 1), 1.8],
  ["ea", M(0.45, 0.95), 1.8],
  ["ou", M(0.62, 0.25, 0.8), 2],
  ["ow", M(0.65, 0.25, 0.8), 2],
  ["oi", M(0.65, 0.4, 0.6), 2],
  ["ai", M(0.7, 0.85), 2],
  ["ay", M(0.7, 0.85), 2],
  // Vowels.
  ["a", M(1, 0.68), 1.9],
  ["e", M(0.55, 0.95), 1.6],
  ["i", M(0.45, 1), 1.5],
  ["o", M(0.75, 0.22, 0.85), 1.9],
  ["u", M(0.38, 0.12, 0.95), 1.6],
  ["y", M(0.35, 0.9), 1.2],
  // Consonants.
  ["m", M(0, 0.5, 0, 1), 1.1],
  ["b", M(0, 0.5, 0, 1), 0.9],
  ["p", M(0, 0.5, 0, 1), 0.9],
  ["f", M(0.12, 0.6, 0, 0, 1), 1],
  ["v", M(0.12, 0.6, 0, 0, 1), 1],
  ["w", M(0.2, 0.06, 1), 0.9],
  ["r", M(0.3, 0.35, 0.35), 0.9],
  ["l", M(0.32, 0.6), 0.9],
  ["s", M(0.16, 0.85), 1.1],
  ["z", M(0.16, 0.85), 1],
  ["c", M(0.36, 0.6), 0.8],
  ["k", M(0.38, 0.55), 0.8],
  ["g", M(0.38, 0.55), 0.8],
  ["q", M(0.38, 0.55), 0.8],
  ["x", M(0.3, 0.7), 1.2],
  ["j", M(0.3, 0.32, 0.5), 1],
  ["t", M(0.28, 0.62), 0.8],
  ["d", M(0.3, 0.6), 0.8],
  ["n", M(0.3, 0.58), 0.9],
  ["h", M(0.55, 0.55), 0.7],
]

/** A spoken digit is a short word. */
const DIGIT: Sound = { shape: M(0.6, 0.7), weight: 3 }

function soundsOf(text: string): Sound[] {
  const s = text.toLowerCase()
  const out: Sound[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/[.!?]/.test(ch)) {
      out.push({ shape: REST, weight: 5 })
      i += 1
      continue
    }
    if (/[,;:—-]/.test(ch)) {
      out.push({ shape: REST, weight: 3 })
      i += 1
      continue
    }
    if (/\s/.test(ch)) {
      // Between words the mouth barely settles.
      out.push({ shape: M(0.08, 0.5), weight: 0.45 })
      i += 1
      continue
    }
    if (/[0-9]/.test(ch)) {
      out.push(DIGIT)
      i += 1
      continue
    }
    const pair = SOUNDS.find(([k]) => k.length === 2 && s.startsWith(k, i))
    if (pair) {
      out.push({ shape: pair[1], weight: pair[2] })
      i += 2
      continue
    }
    const one = SOUNDS.find(([k]) => k === ch)
    if (one) {
      // A final e after a consonant is silent ("make", "rule").
      const silent = ch === "e" && !/[a-z]/.test(s[i + 1] ?? "") && /[bcdfgklmnprstvz]/.test(s[i - 1] ?? "")
      out.push({ shape: one[1], weight: silent ? 0.25 : one[2] })
    }
    // Anything else (symbols) takes no time.
    i += 1
  }
  return out
}

let line: Line | null = null

/** The clip's silent lead-in and tail, ms: the voice is not on at once. */
const LEAD_MS = 70
const TAIL_MS = 110

export function speechStarted(text: string, durationS: number) {
  const sounds = soundsOf(text)
  const total = sounds.reduce((sum, x) => sum + x.weight, 0) || 1
  let acc = 0
  const ends = sounds.map((x) => (acc += x.weight) / total)
  const duration = Number.isFinite(durationS) && durationS > 0 ? durationS * 1000 : Math.max(800, total * 55)
  line = { text, start: performance.now(), duration, sounds, ends }
  window.dispatchEvent(new CustomEvent("speech-line", { detail: text }))
}

export function speechStopped() {
  line = null
}

const ease = (x: number) => x * x * (3 - 2 * x)

function mix(a: Mouth, b: Mouth, k: number): Mouth {
  return {
    open: a.open + (b.open - a.open) * k,
    wide: a.wide + (b.wide - a.wide) * k,
    round: a.round + (b.round - a.round) * k,
    press: a.press + (b.press - a.press) * k,
    tuck: a.tuck + (b.tuck - a.tuck) * k,
  }
}

/** The mouth shape for the sound being made now (null when silent). */
export function mouthShape(now = performance.now()): Mouth | null {
  if (!line || !line.sounds.length) return null
  const spoken = line.duration - LEAD_MS - TAIL_MS
  const t = (now - line.start - LEAD_MS) / Math.max(200, spoken)
  if (t < 0 || t > 1) return null
  // The sound under way, and how far through it.
  let i = 0
  while (i < line.ends.length - 1 && line.ends[i] < t) i += 1
  const begin = i ? line.ends[i - 1] : 0
  const k = (t - begin) / Math.max(1e-6, line.ends[i] - begin)
  const here = line.sounds[i].shape
  const next = line.sounds[i + 1]?.shape ?? REST
  // Into the next sound over the last 40% of this one.
  const shape = mix(here, next, ease(Math.max(0, (k - 0.6) / 0.4)))
  // Lips round ahead of a rounded sound.
  shape.round = Math.max(shape.round, next.round * 0.35)
  return shape
}
