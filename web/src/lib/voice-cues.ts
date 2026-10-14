// Jarvis's voice line carries delivery cues for Fish Audio's S2 voice
// model: "[break]", "[emphasis]", "[sarcastic]", "[soft tone]" (the server's
// VOICE section says which). They shape how a line sounds and must never
// be read on screen, so anything showing the spoken text - the "what he
// has said so far" caption, the face's transcript - passes it through
// here first. The text sent to /speak keeps them.

// A whole cue, and a cue still being streamed at the end of the text.
const CUE = /\[[^\]\n]{1,48}\]\s?/g
const OPEN_CUE = /\[[^\]\n]{0,48}$/

export function stripCues(text: string): string {
  return text.replace(CUE, "").replace(OPEN_CUE, "").replace(/ {2,}/g, " ")
}
