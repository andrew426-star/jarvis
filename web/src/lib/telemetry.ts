// Real numbers for the status ring.
//
// The brief asked for CPU / Memory / Network gauges. A browser cannot
// see the server's CPU, and inventing a number that looks like server
// telemetry would make the HUD a liar - so these measure what this page
// can actually observe: its own render load, its own heap, and the
// latency of its own API calls. The labels say RENDER / HEAP / LATENCY
// for that reason.
//
// Module singleton rather than React state: the frame sampler runs at
// animation-frame rate, and routing that through the tree would
// re-render the console 60 times a second to move a gauge a pixel.

export interface Telemetry {
  /** Render load, 0-1, from rolling frame time. */
  render: number
  /** JS heap in use, 0-1. null where the browser will not report it. */
  heap: number | null
  /** Last API round trip, 0-1, normalised against LATENCY_CEILING_MS. */
  latency: number
  /** Raw milliseconds of the last API call, for the numeric readout. */
  latencyMs: number | null
  /** navigator.onLine, sampled. */
  online: boolean
}

// A frame at 60fps is ~16.7ms. Anything under 8ms of work is idle for
// our purposes; 38ms (roughly 26fps) is a fully loaded gauge.
const FRAME_FLOOR_MS = 8
const FRAME_CEILING_MS = 38
const LATENCY_CEILING_MS = 2500

// Enough samples to smooth out a single janky frame, few enough that a
// real slowdown shows up within a fraction of a second.
const FRAME_WINDOW = 45

const frameTimes: number[] = []
let lastFrameAt = 0
let rafId: number | null = null
let latencyMs: number | null = null

interface MemoryInfo {
  usedJSHeapSize: number
  jsHeapSizeLimit: number
}

function readHeap(): number | null {
  // performance.memory is Chrome-only and not in the standard lib
  // typings, hence the cast. Absent everywhere else, which the status
  // ring renders as an explicit "--" rather than a fake zero.
  const memory = (performance as Performance & { memory?: MemoryInfo }).memory
  if (!memory || !memory.jsHeapSizeLimit) return null
  return Math.min(1, memory.usedJSHeapSize / memory.jsHeapSizeLimit)
}

function sample(now: number) {
  if (lastFrameAt) {
    frameTimes.push(now - lastFrameAt)
    if (frameTimes.length > FRAME_WINDOW) frameTimes.shift()
  }
  lastFrameAt = now
  rafId = requestAnimationFrame(sample)
}

export function startTelemetry(): void {
  if (rafId !== null || typeof window === "undefined") return
  rafId = requestAnimationFrame(sample)
}

export function stopTelemetry(): void {
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = null
  lastFrameAt = 0
  frameTimes.length = 0
}

/** Called by jarvis-client on every completed request. */
export function recordLatency(ms: number): void {
  latencyMs = ms
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function readTelemetry(): Telemetry {
  const avgFrame = frameTimes.length
    ? frameTimes.reduce((total, ms) => total + ms, 0) / frameTimes.length
    : FRAME_FLOOR_MS

  return {
    render: clamp01((avgFrame - FRAME_FLOOR_MS) / (FRAME_CEILING_MS - FRAME_FLOOR_MS)),
    heap: readHeap(),
    latency: latencyMs === null ? 0 : clamp01(latencyMs / LATENCY_CEILING_MS),
    latencyMs,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
  }
}
