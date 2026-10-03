"use client"

import { useEffect, useState } from "react"

import { getBrowserStatus, unpairBrowser, type BrowserStatus } from "@/lib/jarvis-client"

// Settings > Browser: whether the J.A.R.V.I.S. extension (extension/) is
// linked, what it last saw, and how to set it up. Pairing itself happens
// from the extension's toolbar button, on this page.
export function BrowserSettings({ token }: { token: string }) {
  const [status, setStatus] = useState<BrowserStatus | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      getBrowserStatus(token)
        .then((next) => !cancelled && (setStatus(next), setFailed(false)))
        .catch(() => !cancelled && setFailed(true))
    void load()
    const timer = setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [token])

  const state = failed ? "UNKNOWN" : !status ? "CHECKING" : status.connected ? (status.paused ? "PAUSED" : "LINKED") : "NOT LINKED"
  const live = status?.connected && !status.paused

  return (
    <>
      <div className="flex min-w-0 items-center justify-between" style={{ gap: "var(--sp-2)" }}>
        <span className="t-label" style={{ color: "var(--text-secondary)" }}>
          EXTENSION
        </span>
        <span className="t-label" style={{ color: live ? "var(--accent)" : "var(--warning)" }}>
          {state}
        </span>
      </div>
      {live && status?.page && (
        <span className="wrap-words" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          On “{status.page.title}” · {status.tabs} tabs open
        </span>
      )}
      {live && !status?.page && (
        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>On a private site right now.</span>
      )}
      {status?.connected ? (
        <button
          type="button"
          className="btn"
          style={{ padding: "4px 12px" }}
          onClick={async () => {
            await unpairBrowser(token).catch(() => {})
            setStatus((s) => (s ? { ...s, connected: false } : s))
          }}
        >
          UNPAIR EXTENSION
        </button>
      ) : (
        <p className="wrap-words" style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>
          To let Jarvis follow you in the browser: open chrome://extensions (or edge://extensions), turn on
          Developer mode, choose Load unpacked and pick the repo&apos;s <code>extension</code> folder. Then, on
          this page, click the J.A.R.V.I.S. toolbar button and Pair.
        </p>
      )}
    </>
  )
}
