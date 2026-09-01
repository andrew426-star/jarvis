"use client"

// Scrolling telemetry columns at the screen edges, behind everything.
//
// Content is a fixed table rather than Math.random(): this renders
// during the static export as well as in the browser, and random values
// would differ between the two - a guaranteed hydration mismatch for
// something nobody would notice was non-random.
//
// Each column's text is repeated twice and the animation translates by
// -50%, which is what makes an infinite scroll seamless without JS.

const LINES = [
  "0x4F2A", "SYS:OK", "MEM:64%", "NET:1.2G", "0xA71C", "CPU:24%",
  "DSK:58%", "0x93BE", "TMP:46C", "PWR:92%", "SYS:OK", "0x2D07",
  "IO:NOM", "0xE4F1", "SEC:CLR", "NET:OK", "0x77A9", "PRC:164",
  "0xBC38", "SYS:OK", "LAT:24ms", "0x50D2", "GPU:31%", "CACHE:OK",
]

interface Column {
  side: "left" | "right"
  offset: string
  duration: number
  slice: [number, number]
}

const COLUMNS: Column[] = [
  { side: "left", offset: "8px", duration: 8, slice: [0, 12] },
  { side: "left", offset: "64px", duration: 16, slice: [6, 20] },
  { side: "right", offset: "8px", duration: 12, slice: [12, 24] },
  { side: "right", offset: "64px", duration: 20, slice: [3, 17] },
]

export function DataStream({ visible, serious }: { visible: boolean; serious: boolean }) {
  return (
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{
        zIndex: 0,
        opacity: visible ? 1 : 0,
        transition: "opacity 300ms ease",
      }}
      aria-hidden
    >
      {COLUMNS.map((column) => {
        const lines = LINES.slice(column.slice[0], column.slice[1])
        const text = [...lines, ...lines].join("\n")
        return (
          <div
            key={`${column.side}-${column.offset}`}
            className="data-stream-col"
            style={{
              [column.side]: column.offset,
              animationDuration: `${column.duration}s`,
              // Serious mode runs hotter and brighter, per the spec.
              opacity: serious ? 0.15 : 0.09,
            }}
          >
            {text}
          </div>
        )
      })}
    </div>
  )
}
