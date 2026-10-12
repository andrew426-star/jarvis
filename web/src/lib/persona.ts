"use client"

import { useJarvis } from "@/lib/store"

// Serious mode is Ultron (app/services/ultron.py on the server): his own
// persona per turn, and his own voice here. Jarvis's voice is the server's
// default (FISH_AUDIO_VOICE_ID), so only Ultron's needs naming.
export const ULTRON_VOICE_ID = "9062ee6786ec40e8a27e273279336a06"

export function isUltron(): boolean {
  return useJarvis.getState().mode === "serious"
}

/** The Fish Audio voice for whoever is speaking now; undefined = Jarvis. */
export function currentVoiceId(): string | undefined {
  return isUltron() ? ULTRON_VOICE_ID : undefined
}

/** Run `then` as Ultron: at once if the console is his, else after it is
 *  handed over to him (the workshop is his alone). */
export function asUltron(then: () => void) {
  const jarvis = useJarvis.getState()
  if (jarvis.mode === "serious") return then()
  jarvis.toggleMode()
  const stop = useJarvis.subscribe((state) => {
    if (state.mode !== "serious") return
    stop()
    then()
  })
  // A hand-over that never lands (cancelled) must not leave this waiting.
  setTimeout(stop, 8000)
}
