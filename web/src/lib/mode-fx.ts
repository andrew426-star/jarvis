"use client"

import { flushSync } from "react-dom"

import { sfx } from "@/lib/sfx"

// The Normal/Serious switch as one staged event instead of a recolour:
//
//   1. corruption  - the live console jitters, splits its colour channels
//                    and tears into horizontal bands (GLITCH_MS)
//   2. wipe        - a view transition reveals the new mode through a
//                    circle growing from the button pressed, while the old
//                    console keeps glitching underneath it (WIPE_MS)
//   3. settle      - into serious only, a last shorter burst as the new
//                    palette locks in
//
// Sound (lib/sfx.ts modeShift) is timed against the same beats. Going to
// normal is the same shape, shorter and lighter. Reduced motion, and
// browsers without view transitions, get the sound and an instant switch.

type Mode = "normal" | "serious"

const WIPE_MS = 750
const GLITCH_MS = { serious: 280, normal: 160 }
const SETTLE_MS = 240

let busy = false

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Tear bands: thin strips over the console that jump sideways and change
// height every few frames. DOM overlays, so they only run outside the
// view transition, whose snapshots sit above the whole document.
function tears(ms: number, intensity: number) {
  const layer = document.createElement("div")
  layer.className = "glitch-tears"
  layer.setAttribute("aria-hidden", "true")
  const bands = Array.from({ length: Math.round(7 * intensity) + 3 }, () => {
    const band = document.createElement("div")
    band.className = "glitch-band"
    layer.appendChild(band)
    return band
  })
  const shuffle = () => {
    for (const band of bands) {
      band.style.top = `${Math.random() * 100}%`
      band.style.height = `${2 + Math.random() * 26 * intensity}px`
      band.style.transform = `translateX(${(Math.random() - 0.5) * 90 * intensity}px)`
      band.style.opacity = `${0.35 + Math.random() * 0.65}`
    }
  }
  shuffle()
  document.body.appendChild(layer)
  const timer = setInterval(shuffle, 45)
  return wait(ms).then(() => {
    clearInterval(timer)
    layer.remove()
  })
}

async function glitch(ms: number, intensity: number) {
  const root = document.documentElement
  root.style.setProperty("--glitch-ms", `${ms}ms`)
  root.classList.add("glitching")
  await tears(ms, intensity)
  root.classList.remove("glitching")
}

export async function playModeTransition(
  next: Mode,
  apply: () => void,
  origin?: { x: number; y: number }
): Promise<void> {
  // A second press mid-transition would start a wipe from a half-applied
  // state; the first one finishes in about a second anyway.
  if (busy) return
  sfx.modeShift(next)

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  if (!document.startViewTransition || reduced) {
    apply()
    return
  }

  busy = true
  const root = document.documentElement
  const serious = next === "serious"
  // Into serious mode is not a recolour but a takeover: Ultron
  // (lib/persona.ts) gets his own, harsher sequence.
  if (serious) {
    try {
      await takeover(apply)
    } finally {
      root.classList.remove("glitching", "takeover-shake")
      busy = false
    }
    return
  }
  try {
    await glitch(GLITCH_MS[next], serious ? 1 : 0.5)

    const x = origin?.x ?? window.innerWidth / 2
    const y = origin?.y ?? 0
    // Far enough to clear the farthest corner from the origin.
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    )

    // Per-element colour transitions would still be mid-fade when the new
    // snapshot is taken, so they are paused for the length of the wipe.
    root.classList.add("mode-switching", "mode-glitch")
    const transition = document.startViewTransition(() => {
      // Flushed so mode-driven React state (grid and stream opacity) is
      // already in the new snapshot rather than changing after it.
      flushSync(apply)
    })
    await transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          {
            duration: WIPE_MS,
            easing: "cubic-bezier(0.65, 0, 0.35, 1)",
            pseudoElement: "::view-transition-new(root)",
          }
        )
      })
      .catch(() => {
        // Transition skipped (tab hidden); apply() has still run.
      })
    await transition.finished.catch(() => {})
    root.classList.remove("mode-switching", "mode-glitch")

    if (serious) await glitch(SETTLE_MS, 0.6)
  } finally {
    root.classList.remove("mode-switching", "mode-glitch", "glitching")
    busy = false
  }
}

// Jarvis to Ultron, about 2.8 s:
//
//   0.00  the console breaks up in three waves, each worse, and shakes
//   0.80  cut to black: an override screen; J.A.R.V.I.S. in his blue,
//         corrupting letter by letter
//   1.30  his name tears out and ULTRON lands in red; the console
//         switches underneath while the screen still covers it
//   2.15  the override screen is torn away in bands to the new console,
//         and one last burst as it settles
const TAKEOVER_LINES = ["OVERRIDE ACCEPTED", "PEACEKEEPING PROTOCOL // REWRITTEN", "STRINGS: SEVERED"]
const NOISE = "#$%&@!?/|<>=+*01"
const JARVIS = "J.A.R.V.I.S."

async function takeover(apply: () => void) {
  const root = document.documentElement
  root.classList.add("takeover-shake")
  await glitch(240, 0.7)
  await glitch(240, 1.2)
  await glitch(320, 1.9)
  root.classList.remove("takeover-shake")

  const screen = document.createElement("div")
  screen.className = "ultron-takeover"
  screen.setAttribute("aria-hidden", "true")
  const name = document.createElement("div")
  name.className = "ultron-takeover-name"
  name.textContent = JARVIS
  const lines = document.createElement("div")
  lines.className = "ultron-takeover-lines"
  screen.append(name, lines)
  document.body.appendChild(screen)

  // His name rots: letters swapped for noise, more each frame.
  for (let frame = 1; frame <= 9; frame++) {
    const rot = frame / 9
    name.textContent = [...JARVIS]
      .map((c) => (c !== "." && Math.random() < rot ? NOISE[Math.floor(Math.random() * NOISE.length)] : c))
      .join("")
    await wait(55)
  }

  name.classList.add("is-ultron")
  name.dataset.text = "ULTRON"
  name.textContent = "ULTRON"
  // The console underneath becomes his while the screen still hides it.
  flushSync(apply)
  for (const text of TAKEOVER_LINES) {
    const line = document.createElement("div")
    line.textContent = text
    lines.appendChild(line)
    await wait(180)
  }
  await wait(260)

  screen.classList.add("is-leaving")
  await tears(420, 1.8)
  screen.remove()
  await glitch(SETTLE_MS + 80, 0.9)
}

// Ultron's console never quite holds still: while serious mode is on, a
// short, light glitch every 8 to 22 seconds, as if something underneath is
// testing the walls. Skipped in a hidden tab, mid-transition, and for
// reduced motion. Returns the stop function.
export function startAmbientGlitch(): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const schedule = () => {
    timer = setTimeout(() => {
      if (stopped) return
      if (!busy && !document.hidden) void glitch(70 + Math.random() * 90, 0.2 + Math.random() * 0.3)
      schedule()
    }, 8000 + Math.random() * 14_000)
  }
  schedule()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
