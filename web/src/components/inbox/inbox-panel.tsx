"use client"

import { useEffect, useState } from "react"
import { BellIcon, BellOffIcon, Loader2Icon, PlayIcon, RefreshCwIcon } from "lucide-react"

import { InboxItemCard } from "@/components/inbox/inbox-item"
import { useInbox } from "@/lib/inbox-store"
import {
  JarvisAuthError,
  getAutonomy,
  runRoundsNow,
  setAutonomy,
  testPush,
  type AutonomySettings,
  type InboxItem,
} from "@/lib/jarvis-client"
import { disablePush, enablePush, pushStatus, type PushStatus } from "@/lib/push"

// The inbox: what Jarvis's rounds left (app/services/autonomy.py), with
// the controls for them: rounds on or off, a round now, and notifications
// on this device. One component for the desktop's data window and the
// phone's sheet; sizes are in em, so each sets the type size.

const PUSH_NOTE: Record<PushStatus, string> = {
  on: "This device gets notifications.",
  off: "Notifications are off on this device.",
  denied: "Notifications are blocked for this site. Allow them in the browser's site settings.",
  "needs-install": "On iPhone, add Jarvis to the Home Screen (Share → Add to Home Screen) and open it from there to get notifications.",
  unconfigured: "Push is not set up on the server yet (VAPID keys).",
  unsupported: "This browser cannot receive notifications.",
}

function hour(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`
}

type Filter = "all" | InboxItem["topic"]

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "rounds", label: "ROUNDS" },
  { id: "markets", label: "MARKETS" },
  { id: "signals", label: "SIGNALS" },
]

export function InboxPanel({
  token,
  onAuthError,
  onOpenSymbol,
}: {
  token: string
  onAuthError: () => void
  /** Charts a market or signal notice's symbol (the desktop's Markets panel). */
  onOpenSymbol?: (symbol: string) => void
}) {
  const { pending: allPending, recent: allRecent, loaded, error } = useInbox()
  const [filter, setFilter] = useState<Filter>("all")
  const shown = (item: InboxItem) => filter === "all" || (item.topic ?? "rounds") === filter
  const pending = allPending.filter(shown)
  const recent = allRecent.filter(shown)
  const [settings, setSettings] = useState<AutonomySettings | null>(null)
  const [push, setPush] = useState<PushStatus | null>(null)
  const [busy, setBusy] = useState<"rounds" | "push" | "toggle" | "refresh" | null>(null)
  const [note, setNote] = useState<string | null>(null)

  function failed(err: unknown, fallback: string) {
    if (err instanceof JarvisAuthError) {
      onAuthError()
      return
    }
    setNote(fallback)
  }

  useEffect(() => {
    let cancelled = false
    getAutonomy(token)
      .then(async (loadedSettings) => {
        if (cancelled) return
        setSettings(loadedSettings)
        setPush(await pushStatus(loadedSettings.push_key))
      })
      .catch((err) => failed(err, "Could not load the rounds settings."))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function refresh() {
    setBusy("refresh")
    try {
      await useInbox.getState().refresh(token)
    } catch (err) {
      failed(err, "Could not refresh the inbox.")
    } finally {
      setBusy(null)
    }
  }

  async function roundNow() {
    setBusy("rounds")
    setNote("Jarvis is making his rounds. This takes a minute or so.")
    try {
      const outcome = await runRoundsNow(token)
      const filed = outcome.filed?.length ?? 0
      const unread = outcome.failed_reads ?? []
      setNote(
        outcome.skipped ??
          (outcome.blind
            ? `Round could not see enough: ${unread.join(", ")} failed to load. Try again shortly.`
            : `${filed ? `Round done: ${filed} filed.` : "Round done: nothing needed you."}${
                unread.length ? ` (Could not read ${unread.join(", ")}.)` : ""
              }`)
      )
      await useInbox.getState().refresh(token)
      setSettings(await getAutonomy(token))
    } catch (err) {
      failed(err, "The round did not finish. Try again in a minute.")
    } finally {
      setBusy(null)
    }
  }

  async function toggleRounds() {
    if (!settings) return
    setBusy("toggle")
    try {
      setSettings(await setAutonomy({ enabled: !settings.enabled }, token))
    } catch (err) {
      failed(err, "Could not change that.")
    } finally {
      setBusy(null)
    }
  }

  async function togglePush() {
    if (!settings?.push_key) return
    setBusy("push")
    setNote(null)
    try {
      if (push === "on") {
        setPush(await disablePush(token))
      } else {
        const status = await enablePush(token, settings.push_key)
        setPush(status)
        if (status === "on") {
          const sent = await testPush(token)
          setNote(sent.ok ? "Sent a test notification." : "Switched on, but the test did not arrive.")
        }
      }
    } catch (err) {
      failed(err, "Could not change notifications on this device.")
    } finally {
      setBusy(null)
    }
  }

  const lastRound = settings?.last_round_at ? new Date(settings.last_round_at) : null

  return (
    <div className="flex flex-col" style={{ gap: "0.9em" }}>
      <section
        className="flex flex-col"
        style={{
          gap: "0.6em",
          padding: "0.7em 0.8em",
          border: "1px solid rgba(var(--accent-rgb), 0.2)",
          borderRadius: "var(--radius)",
          background: "rgba(10, 14, 26, 0.55)",
        }}
      >
        <div className="flex flex-wrap items-center" style={{ gap: "0.5em" }}>
          <span className="t-panel-header" style={{ color: "var(--accent)" }}>
            ROUNDS
          </span>
          <span className="t-label" style={{ color: "var(--text-secondary)" }}>
            {settings
              ? settings.enabled
                ? `Every 2h, quiet ${hour(settings.quiet_start)}–${hour(settings.quiet_end)}`
                : "Off"
              : "…"}
            {lastRound && ` · last ${lastRound.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
          </span>
        </div>
        <p style={{ color: "var(--text-secondary)", lineHeight: 1.45, fontSize: "0.9em" }}>
          Jarvis looks over your tasks, launch, calendar and mail on his own. He reads freely, but anything that would
          change something waits here for your approval.
        </p>
        <div className="flex flex-wrap" style={{ gap: "0.5em" }}>
          <button
            type="button"
            className="btn"
            style={{ minHeight: "2.6em", padding: "0 1em", fontSize: "0.85em" }}
            data-active={settings?.enabled ?? false}
            disabled={!settings || busy !== null}
            onClick={() => void toggleRounds()}
          >
            {busy === "toggle" && <Loader2Icon size="1em" className="animate-spin" />}
            {settings?.enabled ? "ROUNDS ON" : "ROUNDS OFF"}
          </button>
          <button
            type="button"
            className="btn"
            style={{ minHeight: "2.6em", padding: "0 1em", fontSize: "0.85em" }}
            disabled={busy !== null}
            onClick={() => void roundNow()}
          >
            {busy === "rounds" ? <Loader2Icon size="1em" className="animate-spin" /> : <PlayIcon size="1em" />}
            RUN NOW
          </button>
          <button
            type="button"
            className="btn"
            style={{ minHeight: "2.6em", padding: "0 1em", fontSize: "0.85em" }}
            data-active={push === "on"}
            disabled={busy !== null || (push !== "on" && push !== "off")}
            onClick={() => void togglePush()}
          >
            {busy === "push" ? (
              <Loader2Icon size="1em" className="animate-spin" />
            ) : push === "on" ? (
              <BellIcon size="1em" />
            ) : (
              <BellOffIcon size="1em" />
            )}
            {push === "on" ? "NOTIFY ON" : "NOTIFY OFF"}
          </button>
        </div>
        {push && push !== "on" && push !== "off" && (
          <p className="t-label" style={{ color: "var(--text-secondary)", lineHeight: 1.4, textTransform: "none", letterSpacing: 0 }}>
            {PUSH_NOTE[push]}
          </p>
        )}
        {note && (
          <p className="t-label" style={{ color: "var(--accent)", lineHeight: 1.4, textTransform: "none", letterSpacing: 0 }}>
            {note}
          </p>
        )}
      </section>

      <div className="flex flex-wrap" style={{ gap: "0.4em" }} role="tablist" aria-label="Inbox topics">
        {FILTERS.map((f) => {
          const count =
            f.id === "all" ? allPending.length : allPending.filter((p) => (p.topic ?? "rounds") === f.id).length
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className="btn"
              data-active={filter === f.id}
              style={{ minHeight: "2.2em", padding: "0 0.9em", fontSize: "0.8em" }}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {count > 0 && <span style={{ color: "var(--warning)", marginLeft: 6 }}>{count}</span>}
            </button>
          )
        })}
      </div>

      <div className="flex items-center" style={{ gap: "0.5em" }}>
        <span className="t-panel-header" style={{ color: "var(--accent)" }}>
          WAITING ON YOU
        </span>
        <span className="t-label" style={{ color: "var(--text-secondary)" }}>
          {pending.length}
        </span>
        <button
          type="button"
          className="btn btn-icon ml-auto"
          style={{ width: "2.2em", height: "2.2em", padding: 0 }}
          aria-label="Refresh inbox"
          disabled={busy !== null}
          onClick={() => void refresh()}
        >
          <RefreshCwIcon size="1em" className={busy === "refresh" ? "animate-spin" : ""} />
        </button>
      </div>

      {error && <p style={{ color: "var(--error)" }}>{error}</p>}
      {!loaded ? (
        <p style={{ color: "var(--text-secondary)" }}>Loading…</p>
      ) : pending.length === 0 ? (
        <p style={{ color: "var(--text-secondary)" }}>
          {filter === "all" ? "Nothing waiting, sir. Everything is in hand." : "Nothing waiting under " + filter + "."}
        </p>
      ) : (
        <div className="flex flex-col" style={{ gap: "0.6em" }}>
          {pending.map((item) => (
            <InboxItemCard key={item.id} item={item} token={token} onAuthError={onAuthError} onOpenSymbol={onOpenSymbol} />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <>
          <span className="t-panel-header" style={{ color: "var(--text-secondary)", marginTop: "0.4em" }}>
            RECENT
          </span>
          <div className="flex flex-col" style={{ gap: "0.6em" }}>
            {recent.map((item) => (
              <InboxItemCard key={item.id} item={item} token={token} onAuthError={onAuthError} onOpenSymbol={onOpenSymbol} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
