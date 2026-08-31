"use client"

import { BootStage } from "@/lib/use-boot"

// Everything behind the interface: the perspective grid, the falling
// data streams, the CRT raster and the corner furniture.
//
// The stream positions are a fixed table rather than Math.random(). This
// component renders during the static export as well as in the browser,
// and random values would differ between the two - a guaranteed
// hydration mismatch for something nobody would ever notice was
// non-random.
const STREAMS = [
  { left: "6%", duration: 7.5, delay: 0 },
  { left: "13%", duration: 11, delay: 2.4 },
  { left: "22%", duration: 9, delay: 5.1 },
  { left: "31%", duration: 13, delay: 1.2 },
  { left: "44%", duration: 8.5, delay: 3.7 },
  { left: "57%", duration: 12, delay: 0.6 },
  { left: "68%", duration: 9.8, delay: 4.3 },
  { left: "77%", duration: 7, delay: 2 },
  { left: "86%", duration: 14, delay: 6.2 },
  { left: "94%", duration: 10.5, delay: 1.8 },
]

interface HudFrameProps {
  bootStage: BootStage
}

export function HudFrame({ bootStage }: HudFrameProps) {
  const gridUp = bootStage >= BootStage.Grid
  const chromeUp = bootStage >= BootStage.Panels

  return (
    <>
      {/* Grid and streams share the grid stage - the environment comes
          up as one thing, before any instrument does. */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          opacity: gridUp ? 1 : 0,
          transition: "opacity 900ms ease-in-out",
        }}
      >
        <div className="perspective-grid" />
        {STREAMS.map((stream) => (
          <div
            key={stream.left}
            className="data-stream"
            style={{
              left: stream.left,
              animationDuration: `${stream.duration}s`,
              animationDelay: `${stream.delay}s`,
            }}
          />
        ))}
        {/* Horizon glow, where the two grid planes meet. */}
        <div
          className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
          style={{
            background:
              "linear-gradient(90deg, transparent, hsl(var(--hue) var(--sat) 60% / 0.5), transparent)",
            boxShadow: "0 0 40px 6px hsl(var(--hue) var(--sat) 55% / 0.12)",
          }}
        />
      </div>

      {/* Corner ticks, framing the whole viewport. */}
      <div
        className="pointer-events-none fixed inset-3 z-50 sm:inset-5"
        style={{
          opacity: chromeUp ? 1 : 0,
          transition: "opacity 600ms ease-in-out",
        }}
        aria-hidden
      >
        {(
          [
            ["top-0 left-0", "border-t-2 border-l-2"],
            ["top-0 right-0", "border-t-2 border-r-2"],
            ["bottom-0 left-0", "border-b-2 border-l-2"],
            ["bottom-0 right-0", "border-b-2 border-r-2"],
          ] as const
        ).map(([position, borders]) => (
          <div
            key={position}
            className={`absolute size-5 sm:size-7 ${position} ${borders}`}
            style={{ borderColor: "hsl(var(--hue) var(--sat) 55% / 0.4)" }}
          />
        ))}
      </div>

      <div className="crt-vignette" aria-hidden />
      <div className="crt-overlay" aria-hidden />
    </>
  )
}
