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
