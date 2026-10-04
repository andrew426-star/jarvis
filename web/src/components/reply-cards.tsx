"use client"

import { ChecklistCard } from "@/components/checklist-card"
import type { ChatMessageData } from "@/components/hud/chat-message"
import { InboxItemCard } from "@/components/inbox/inbox-item"

// What a reply carries beyond its text, as cards under it: checklists to
// tick, inbox items to decide. Rendered by both chats, the desktop's
// chat-message.tsx and the phone's bubble, and filled by lib/turn.ts for
// both, so a new kind of card is added here once and appears on both.
export function ReplyCards({
  message,
  token,
  onAuthError,
}: {
  message: ChatMessageData
  token: string
  onAuthError: () => void
}) {
  if (!message.checklists?.length && !message.inbox?.length) return null
  return (
    <>
      {message.checklists?.map((list) => (
        <ChecklistCard key={list.id} checklist={list} token={token} onAuthError={onAuthError} />
      ))}
      {message.inbox?.length ? (
        <div className="flex w-full flex-col" style={{ gap: "0.5em", marginTop: "0.6em" }}>
          {message.inbox.map((item) => (
            <InboxItemCard key={item.id} item={item} token={token} onAuthError={onAuthError} />
          ))}
        </div>
      ) : null}
    </>
  )
}
