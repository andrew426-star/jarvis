"use client"

import { useEffect, useRef } from "react"

// Noticing a deploy while the console is already open. The page itself is
// served no-cache (app/main.py, _ConsoleFiles), so any fresh load gets the
// new build; the gap is a page that never reloads, above all the phone app
// on the home screen, which iOS resumes from memory for days. Each export
// carries its build id in index.html (`"b":"<id>"` in Next's inline data),
// so the page compares its own with the live one's, cheaply: a revalidated
// index.html is a 304 when nothing changed.

const BUILD_ID = /\\?"b\\?":\\?"([\w-]{8,})\\?"/
const EVERY_MS = 15 * 60_000

let mine: string | null | undefined

function buildIdIn(text: string): string | null {
  return text.match(BUILD_ID)?.[1] ?? null
}

function currentBuild(): string | null {
  if (mine === undefined) {
    mine = buildIdIn(Array.from(document.scripts, (script) => script.textContent ?? "").join("\n"))
  }
  return mine
}

/** True when the server is serving a different build from this page's. */
export async function newBuildLive(): Promise<boolean> {
  const own = currentBuild()
  if (!own) return false
  try {
    const res = await fetch("/", { cache: "no-cache" })
    if (!res.ok) return false
    const live = buildIdIn(await res.text())
    return live !== null && live !== own
  } catch {
    return false
  }
}

/** Calls `onNewBuild` when a deploy has landed: checked when the page
 *  comes back into view and every 15 minutes while it is open. It keeps
 *  calling on later checks until the page reloads, so a console that was
 *  busy the first time can act on a later one. */
export function useUpdateCheck(onNewBuild: () => void) {
  const callback = useRef(onNewBuild)
  useEffect(() => {
    callback.current = onNewBuild
  })

  useEffect(() => {
    let checking = false
    const check = async () => {
      if (checking || document.visibilityState !== "visible") return
      checking = true
      try {
        if (await newBuildLive()) callback.current()
      } finally {
        checking = false
      }
    }
    const onVisible = () => void check()
    document.addEventListener("visibilitychange", onVisible)
    const timer = setInterval(() => void check(), EVERY_MS)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      clearInterval(timer)
    }
  }, [])
}
