// Only one reply narrates at a time, so a single module-level handle is
// enough to let anything outside the message list interrupt it — the same
// shape as this folder's audio-amplitude.ts shared analyser.
//
// This exists for barge-in: the core sits in a different subtree from the
// ChatMessage that owns the <audio>, so without a shared handle there is
// no way for "click the core while Jarvis is talking" to cut the speech.

type StopFn = () => void

let current: StopFn | null = null

// Called by a message as it starts playing. Registering a second one
// stops the first, so overlapping narration is impossible by construction.
export function registerNarration(stop: StopFn): void {
  if (current && current !== stop) {
    const previous = current
    current = null
    previous()
  }
  current = stop
}

// Called by a message whose playback ended on its own (or errored), so a
// finished narration doesn't leave a stale stop function behind.
export function clearNarration(stop: StopFn): void {
  if (current === stop) current = null
}

// Interrupt whatever is narrating. Returns whether anything was actually
// stopped, which is what lets a caller tell "I barged in" apart from
// "nothing was playing".
export function stopNarration(): boolean {
  const stop = current
  if (!stop) return false
  // Cleared before invoking, so the callee's own clearNarration is a
  // no-op and cannot re-enter this function.
  current = null
  stop()
  return true
}
