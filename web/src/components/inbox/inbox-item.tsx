"use client"

import { useState } from "react"
import { BellIcon, CheckIcon, Loader2Icon, WandSparklesIcon, XIcon } from "lucide-react"

import { ChecklistCard } from "@/components/checklist-card"
import { ToolBadge } from "@/components/tool-badge"
import { useInbox } from "@/lib/inbox-store"
import { JarvisAuthError, decideInboxItem, type Checklist, type InboxItem } from "@/lib/jarvis-client"

// One thing Jarvis's rounds left for Andrew: a notice to read, or a
// proposal to approve or decline. The same card in the desktop inbox, the
// phone's inbox and in a chat reply (the inbox tool), so deciding works
// the same everywhere. Approving runs the exact call shown under "Will
// run"; nothing runs before that tap. Sizes are in em, to take the type
// size of wherever it sits.

const STATUS_LABEL: Record<InboxItem["status"], string> = {
  pending: "Pending",
  approved: "Running",
  done: "Done",
  failed: "Failed",
  declined: "Declined",
  dismissed: "Dismissed",
}

function age(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

export function InboxItemCard({
  item: initial,
  token,
  onAuthError,
}: {
  item: InboxItem
  token: string
  onAuthError: () => void
}) {
  // A card in an old chat reply follows the live inbox once it has loaded.
  const live = useInbox((state) => state.pending.find((p) => p.id === initial.id) ?? state.recent.find((r) => r.id === initial.id))
  const [decided, setDecided] = useState<InboxItem | null>(null)
  const [busy, setBusy] = useState<"approve" | "decline" | "dismiss" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<unknown>(null)
  const item = decided ?? live ?? initial
  const proposal = item.kind === "proposal"
  const pending = item.status === "pending"

  async function decide(decision: "approve" | "decline" | "dismiss") {
    setBusy(decision)
    setError(null)
    try {
      const outcome = await decideInboxItem(item.id, decision, token)
      if (outcome.item) {
        setDecided(outcome.item)
        useInbox.getState().settle(outcome.item)
      }
      if (outcome.result !== undefined) setResult(outcome.result)
      if (!outcome.ok) setError(outcome.error ?? errorOf(outcome.result) ?? "That did not work.")
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setError("Could not reach Jarvis. Try again.")
    } finally {
      setBusy(null)
    }
  }

  const shownResult = result ?? item.result
  const checklist = (shownResult as { checklist?: Checklist } | null)?.checklist
  const accent = item.priority === "high" ? "var(--warning)" : "var(--accent)"
  const operation = typeof item.args?.operation === "string" ? item.args.operation : null

  return (
    <article
      className="w-full"
      style={{
        padding: "0.65em 0.8em",
        border: `1px solid ${pending ? `color-mix(in srgb, ${accent} 45%, transparent)` : "rgba(var(--accent-rgb), 0.15)"}`,
        borderRadius: "var(--radius)",
        background: "rgba(5, 5, 8, 0.5)",
        opacity: pending ? 1 : 0.8,
        whiteSpace: "normal",
      }}
    >
      <header className="flex items-start" style={{ gap: "0.5em" }}>
        <span style={{ color: accent, marginTop: "0.15em" }} aria-hidden>
          {proposal ? <WandSparklesIcon size="1em" /> : <BellIcon size="1em" />}
        </span>
        <div className="min-w-0 flex-1">
          <div style={{ color: "var(--text-primary)", fontWeight: 500, lineHeight: 1.35 }}>{item.title}</div>
          <div className="t-label" style={{ color: "var(--text-secondary)", marginTop: "0.15em" }}>
            {proposal ? "Proposal" : "Notice"} · {age(item.created_at)}
            {item.priority === "high" && <span style={{ color: "var(--warning)" }}> · Urgent</span>}
            {!pending && <span> · {STATUS_LABEL[item.status]}</span>}
          </div>
        </div>
      </header>

      {item.body && (
        <p style={{ color: "var(--text-secondary)", lineHeight: 1.45, marginTop: "0.45em" }}>{item.body}</p>
      )}

      {proposal && item.tool && (
        <details style={{ marginTop: "0.45em" }}>
          <summary className="t-label flex cursor-pointer items-center" style={{ gap: "0.4em", color: "var(--text-secondary)" }}>
            Will run <ToolBadge tool={item.tool} />
            {operation && <span>{operation}</span>}
          </summary>
          <pre
            className="font-mono"
            style={{
              marginTop: "0.35em",
              padding: "0.5em",
              fontSize: "0.8em",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "var(--text-secondary)",
              background: "rgba(var(--accent-rgb), 0.05)",
              borderRadius: "var(--radius)",
            }}
          >
            {JSON.stringify(item.args ?? {}, null, 2)}
          </pre>
        </details>
      )}

      {pending && (
        <div className="flex flex-wrap" style={{ gap: "0.5em", marginTop: "0.6em" }}>
          {proposal ? (
            <>
              <button
                type="button"
                className="btn"
                data-active
                style={{ minHeight: "2.6em", padding: "0 1em", fontSize: "0.85em" }}
                disabled={busy !== null}
                onClick={() => void decide("approve")}
              >
                {busy === "approve" ? <Loader2Icon size="1em" className="animate-spin" /> : <CheckIcon size="1em" />}
                APPROVE
              </button>
              <button
                type="button"
                className="btn"
                style={{ minHeight: "2.6em", padding: "0 1em", fontSize: "0.85em" }}
                disabled={busy !== null}
                onClick={() => void decide("decline")}
              >
                {busy === "decline" ? <Loader2Icon size="1em" className="animate-spin" /> : <XIcon size="1em" />}
                DECLINE
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn"
              style={{ minHeight: "2.6em", padding: "0 1em", fontSize: "0.85em" }}
              disabled={busy !== null}
              onClick={() => void decide("dismiss")}
            >
              {busy === "dismiss" ? <Loader2Icon size="1em" className="animate-spin" /> : <CheckIcon size="1em" />}
              GOT IT
            </button>
          )}
        </div>
      )}

      {item.status === "done" && checklist && <ChecklistCard checklist={checklist} token={token} onAuthError={onAuthError} />}
      {(error || item.status === "failed") && (
        <p className="t-label" style={{ color: "var(--error)", marginTop: "0.45em" }}>
          {error ?? errorOf(shownResult) ?? "It ran, and failed."}
        </p>
      )}
    </article>
  )
}

function errorOf(result: unknown): string | null {
  const error = (result as { error?: unknown } | null)?.error
  return typeof error === "string" ? error : null
}
