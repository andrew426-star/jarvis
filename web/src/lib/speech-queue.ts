"use client"

import { startAudioAnalysis, stopAudioAnalysis } from "@/lib/audio-amplitude"
import { JarvisAuthError, speak } from "@/lib/jarvis-client"
import { clearNarration, registerNarration } from "@/lib/narration"
import { currentVoiceId } from "@/lib/persona"

// Speaking a reply while it is still being written. The voice line streams
// in first (see stream_invoke on the server); each finished sentence is
// sent to /speak straight away, and the clips play back in order. Jarvis
// starts talking after one sentence of synthesis instead of after the
// whole reply and the whole clip.
//
// Synthesis runs ahead of playback: every sentence's /speak request starts
// the moment the sentence is complete, so later clips are usually ready
// before the one in front of them finishes.

// A sentence ends at . ! or ? (plus any closing quote or bracket) followed
// by whitespace. The whitespace matters: "3.5" and "e.g." mid-flow do not
// end one.
const SENTENCE = /^[\s\S]*?[.!?]+["')\]]*\s+/

interface Handlers {
  onStart: () => void
  /** `completed` is false when the queue was stopped (barge-in). */
  onEnd: (completed: boolean) => void
  onAuthError: () => void
  /** Each sentence as it starts to be heard (or is skipped), in order, so
   *  the chat can show exactly what has been said so far. */
  onSay?: (sentence: string) => void
}

export class SpeechQueue {
  private buffer = ""
  private clips: { text: string; blob: Promise<Blob | null> }[] = []
  private closed = false
  private stopped = false
  private started = false
  private playing: HTMLAudioElement | null = null
  private wake: (() => void) | null = null
  private readonly stopFn = () => this.stop()

  /** `element`, when given, plays every clip: iOS only lets audio start
   *  without a tap on an element a tap has already unlocked, and these
   *  clips start long after the tap that sent the message. Clips through
   *  it skip the visualiser, which would claim the element for good. */
  constructor(
    private readonly token: string,
    private readonly handlers: Handlers,
    private readonly element?: HTMLAudioElement
  ) {
    void this.run()
  }

  /** More of the voice line. Complete sentences go to synthesis now. */
  push(delta: string) {
    if (this.stopped || this.closed) return
    this.buffer += delta
    let match: RegExpMatchArray | null
    while ((match = this.buffer.match(SENTENCE))) {
      this.enqueue(match[0])
      this.buffer = this.buffer.slice(match[0].length)
    }
  }

  /** The voice line is complete: speak whatever is left, then end. */
  finish(fallback?: string) {
    if (this.stopped || this.closed) return
    if (this.buffer.trim()) this.enqueue(this.buffer)
    // A reply that never produced a voice line still gets read.
    if (!this.clips.length && fallback?.trim()) this.enqueue(fallback)
    this.buffer = ""
    this.closed = true
    this.poke()
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.playing?.pause()
    this.playing = null
    stopAudioAnalysis()
    clearNarration(this.stopFn)
    this.poke()
    if (this.started) this.handlers.onEnd(false)
  }

  private enqueue(text: string) {
    const sentence = text.trim()
    if (!sentence) return
    this.clips.push({
      text: sentence,
      blob: speak(sentence, this.token, currentVoiceId()).catch((err) => {
        if (err instanceof JarvisAuthError) this.handlers.onAuthError()
        // A sentence that fails to synthesise is skipped, not fatal.
        return null
      }),
    })
    this.poke()
  }

  private poke() {
    this.wake?.()
    this.wake = null
  }

  private async run() {
    let index = 0
    while (!this.stopped) {
      if (index >= this.clips.length) {
        if (this.closed) break
        await new Promise<void>((resolve) => (this.wake = resolve))
        continue
      }
      const clip = this.clips[index]
      const blob = await clip.blob
      index += 1
      if (this.stopped) continue
      // Unspoken (synthesis failed) still counts as said, so the chat
      // never stalls on a sentence that will not come.
      if (!blob) {
        this.handlers.onSay?.(clip.text)
        continue
      }
      await this.play(blob, clip.text)
    }
    if (!this.stopped) {
      if (this.started) {
        clearNarration(this.stopFn)
        stopAudioAnalysis()
      }
      // Also when nothing was spoken, so a voice exchange still reopens
      // the mic after a silent reply.
      this.handlers.onEnd(true)
    }
  }

  private play(blob: Blob, text: string): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob)
      const audio = this.element ?? new Audio()
      audio.src = url
      this.playing = audio
      const done = () => {
        URL.revokeObjectURL(url)
        if (this.playing === audio) this.playing = null
        resolve()
      }
      // Said once, whichever way the clip goes: heard, failed, or blocked.
      let said = false
      const say = () => {
        if (said) return
        said = true
        this.handlers.onSay?.(text)
      }
      audio.onended = done
      audio.onerror = () => {
        say()
        done()
      }
      audio
        .play()
        .then(() => {
          say()
          if (!this.started) {
            this.started = true
            // Registering makes the core's barge-in (and any other reply's
            // playback) stop this queue, exactly like a single clip.
            registerNarration(this.stopFn)
            this.handlers.onStart()
          }
          if (!this.element) startAudioAnalysis(audio)
        })
        .catch(() => {
          say()
          done()
        })
      // A stop() mid-clip pauses the element, which does not fire ended.
      const check = setInterval(() => {
        if (this.stopped) {
          clearInterval(check)
          done()
        }
        if (this.playing !== audio) clearInterval(check)
      }, 100)
    })
  }
}
