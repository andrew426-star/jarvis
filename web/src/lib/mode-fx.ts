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
