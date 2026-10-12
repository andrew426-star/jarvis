"use client"

// What is being said right now, and how far into it the voice is - so a
// face can shape its mouth to the transcript rather than only to loudness.
// The speech queue (speech-queue.ts) reports each sentence as its clip
// starts and stops; mouthShape() reads the letter being spoken now.

interface Line {
  text: string
  /** performance.now() when the clip started. */
  start: number
  /** The clip's length, ms. */
  duration: number
}

let line: Line | null = null

export function speechStarted(text: string, durationS: number) {
  const duration = Number.isFinite(durationS) && durationS > 0 ? durationS * 1000 : Math.max(800, text.length * 65)
  line = { text, start: performance.now(), duration }
  window.dispatchEvent(new CustomEvent("speech-line", { detail: text }))
}

export function speechStopped() {
  line = null
}

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

const REST: Mouth = { open: 0, wide: 0.5, round: 0, press: 0, tuck: 0 }

function viseme(c: string): Mouth {
  if ("a".includes(c)) return { open: 1, wide: 0.7, round: 0, press: 0, tuck: 0 }
  if ("h".includes(c)) return { open: 0.7, wide: 0.6, round: 0, press: 0, tuck: 0 }
  if ("ei".includes(c)) return { open: 0.55, wide: 1, round: 0, press: 0, tuck: 0 }
  if ("y".includes(c)) return { open: 0.35, wide: 0.9, round: 0, press: 0, tuck: 0 }
  if ("o".includes(c)) return { open: 0.75, wide: 0.25, round: 0.9, press: 0, tuck: 0 }
  if ("uwq".includes(c)) return { open: 0.35, wide: 0.1, round: 1, press: 0, tuck: 0 }
  if ("mbp".includes(c)) return { open: 0, wide: 0.5, round: 0, press: 1, tuck: 0 }
  if ("fv".includes(c)) return { open: 0.15, wide: 0.6, round: 0, press: 0, tuck: 1 }
  if ("lntdszcjxkgr".includes(c)) return { open: 0.35, wide: 0.65, round: 0, press: 0, tuck: 0 }
  return REST
}

/** The mouth shape for the letter being spoken now (null when silent),
 *  looking a letter ahead as real mouths do. */
export function mouthShape(now = performance.now()): Mouth | null {
  if (!line) return null
  const t = (now - line.start) / line.duration
  if (t < 0 || t > 1) return null
  const text = line.text.toLowerCase()
  const at = Math.min(text.length - 1, Math.floor(t * text.length))
  const a = viseme(text[at] ?? " ")
  const b = viseme(text[at + 1] ?? " ")
  const k = t * text.length - Math.floor(t * text.length)
  const mix = (x: number, y: number) => x + (y - x) * k * 0.5
  return { open: mix(a.open, b.open), wide: mix(a.wide, b.wide), round: mix(a.round, b.round), press: mix(a.press, b.press), tuck: mix(a.tuck, b.tuck) }
}
