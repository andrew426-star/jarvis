"use client"

import type { Dispatch, SetStateAction } from "react"

import type { ChatMessageData } from "@/components/hud/chat-message"
import {
  invokeStream,
  type Checklist,
  type InboxItem,
  type InvokeOptions,
  type InvokeResult,
  type ToolResult,
} from "@/lib/jarvis-client"
import { SpeechQueue } from "@/lib/speech-queue"
import { clockTime } from "@/lib/store"

// One turn with Jarvis, as both consoles run it: the desktop HUD
// (jarvis-console.tsx) and the phone view (mobile/mobile-console.tsx).
// Streaming the reply into the chat, speaking it a sentence at a time,
// showing what has been said so far, and the cards a reply carries all
// live here, so a change to any of them reaches both views at once. What
// stays in each console is only what that view has and the other does not
// (the desktop's camera, panels and log; the phone's retry bubble).

export interface TurnSetup<M extends ChatMessageData> {
  text: string
  sessionId: string
  token: string
  options: InvokeOptions
  setMessages: Dispatch<SetStateAction<M[]>>
  /** Speak the reply. Off, the chat shows the screen text only. */
  speak: boolean
  /** The tap-unlocked element replies play through on iOS (speech-queue.ts). */
  audio?: HTMLAudioElement
  onAuthError: () => void
  onSpeakingChange: (speaking: boolean) => void
  /** Speech over: `completed` is false when it was cut off (barge-in). */
  onVoiceEnd?: (completed: boolean) => void
  /** What the turn is doing now ("Thinking", "Composing"). */
  onStatus?: (label: string) => void
  /** Each tool as it finishes, while he is still talking. */
  onTool?: (result: ToolResult) => void
}

export interface TurnOutcome {
  result: InvokeResult
  replyId: string
}

/** The checklists a turn's tool results carry, latest version of each. */
export function checklistsFrom(results: ToolResult[]): Checklist[] {
  const byId = new Map<string, Checklist>()
  for (const entry of results) {
    if (entry.name !== "checklist") continue
    const shown = entry.result as { ok?: boolean; checklist?: Checklist } | null
    if (shown?.ok && shown.checklist && !shown.checklist.archived) byId.set(shown.checklist.id, shown.checklist)
  }
  return [...byId.values()]
}

/** Inbox items a turn listed (the inbox tool), to decide from the chat. */
export function inboxFrom(results: ToolResult[]): InboxItem[] {
  const listed = results.filter((entry) => entry.name === "inbox").at(-1)?.result as
    | { ok?: boolean; inbox?: InboxItem[] }
    | undefined
  return listed?.ok && listed.inbox ? listed.inbox : []
}

/** Runs one turn into the chat. On failure the reply so far is settled and
 *  the speech stopped before the error is rethrown, so each console only
 *  decides how to show it. */
export async function runTurn<M extends ChatMessageData>(setup: TurnSetup<M>): Promise<TurnOutcome> {
  const { setMessages } = setup

  // The reply appears, and is spoken, while it is still being written. Its
  // message goes in empty and fills as text arrives; the voice line (which
  // the server sends first) is spoken a sentence at a time.
  const replyId = crypto.randomUUID()
  let replyShown = false
  const updateReply = (change: (message: M) => M) => {
    if (!replyShown) {
      replyShown = true
      const blank = { id: replyId, role: "assistant", content: "", time: clockTime(), streaming: true } as M
      setMessages((prev) => [...prev, change(blank)])
      return
    }
    setMessages((prev) => prev.map((m) => (m.id === replyId ? change(m) : m)))
  }

  // The bubble shows what he has said so far, a sentence at a time as each
  // is heard. Cut off (barge-in) or finished, it shows all of it.
  let interrupted = false
  const sayAll = (m: M): M => (m.said !== undefined && m.spoken ? { ...m, said: m.spoken } : m)
  const voice = setup.speak
    ? new SpeechQueue(
        setup.token,
        {
          onSay: (sentence) => updateReply((m) => ({ ...m, said: m.said ? `${m.said} ${sentence}` : sentence })),
          onStart: () => setup.onSpeakingChange(true),
          onEnd: (completed) => {
            if (!completed) interrupted = true
            if (replyShown) updateReply(sayAll)
            setup.onSpeakingChange(false)
            setup.onVoiceEnd?.(completed)
          },
          onAuthError: setup.onAuthError,
        },
        setup.audio
      )
    : null

  const cards: ToolResult[] = []
  try {
    const result = await invokeStream(setup.text, setup.sessionId, setup.token, setup.options, (event) => {
      if (event.type === "status") setup.onStatus?.(event.label)
      else if (event.type === "text") updateReply((m) => ({ ...m, content: m.content + event.delta }))
      else if (event.type === "reset") updateReply((m) => ({ ...m, content: "" }))
      else if (event.type === "spoken") {
        if (!voice) return
        voice.push(event.delta)
        updateReply((m) => ({ ...m, spoken: (m.spoken ?? "") + event.delta, said: m.said ?? "" }))
      } else if (event.type === "tool") {
        const entry = { name: event.name, result: event.result }
        cards.push(entry)
        setup.onTool?.(entry)
      }
    })
    voice?.finish(result.spoken)

    // The finished reply replaces what streamed in: the server's final text
    // is the authoritative one (tags stripped, whitespace settled).
    const ran = result.tool_results.length ? result.tool_results : cards
    const checklists = checklistsFrom(ran)
    const inbox = inboxFrom(ran)
    updateReply((m) => ({
      ...m,
      content: result.response,
      spoken: result.spoken,
      toolsUsed: [...new Set(result.tools_used)],
      streaming: false,
      checklists: checklists.length ? checklists : undefined,
      inbox: inbox.length ? inbox : undefined,
      // Not spoken: the screen text is the reply. Cut off already: nothing
      // more will be heard, so show the rest.
      said: voice && result.spoken?.trim() ? (interrupted ? result.spoken : (m.said ?? "")) : undefined,
    }))
    return { result, replyId }
  } catch (err) {
    voice?.stop()
    if (replyShown) updateReply((m) => sayAll({ ...m, streaming: false }))
    throw err
  }
}
