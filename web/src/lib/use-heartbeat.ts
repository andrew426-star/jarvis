"use client"

import { useEffect, useRef } from "react"

import { JarvisAuthError, getSessionContext, ping } from "@/lib/jarvis-client"
import { useJarvis } from "@/lib/store"

// Keeps the link readouts live. Without it LINK, LAT and CTX only moved
// when something else happened to make a request (a reply, the portfolio
// refresh every few minutes), so an idle console showed whatever the page
// load had measured until it was reloaded.
//
//   every PULSE_MS    ping /health: LINK, LAT and the latency history
//   every CONTEXT_MS  re-read the session's turn count: CTX
//
// Only while the page is on screen: a hidden tab stops, so a console left
// in the background neither burns requests nor keeps the free Render
// instance awake. Context is the slower of the two because each read is
// a Redis command against Upstash's monthly allowance; /health costs
// nothing but the round trip.
const PULSE_MS = 5_000
const CONTEXT_MS = 60_000

export function useHeartbeat(token: string, sessionId: string, onAuthError: () => void) {
  // Held in a ref: callers pass a fresh function each render, and the
  // heartbeat must not restart (and ping again) every time they do.
  const authErrorRef = useRef(onAuthError)
  useEffect(() => {
    authErrorRef.current = onAuthError
  }, [onAuthError])

  useEffect(() => {
    let pulseTimer: number | undefined
    let contextTimer: number | undefined
    let stopped = false

    const pulse = async () => {
      const before = useJarvis.getState().signals.link
      try {
        await ping(token)
        if (stopped) return
        if (before === "down") useJarvis.getState().pushLog("OK", "Link restored")
      } catch (error) {
        if (stopped) return
        if (error instanceof JarvisAuthError) {
          authErrorRef.current()
          return
        }
        useJarvis.getState().setLinkDown()
        if (before !== "down") useJarvis.getState().pushLog("ERR", "Link lost")
      }
    }

    const context = async () => {
      try {
        const result = await getSessionContext(sessionId, token)
        if (!stopped && result.turns !== null) useJarvis.getState().setContext(result.turns, result.window)
      } catch {
        // The pulse reports a dead link; this just keeps its last value.
      }
    }

    const stop = () => {
      window.clearInterval(pulseTimer)
      window.clearInterval(contextTimer)
      pulseTimer = contextTimer = undefined
    }

    const start = () => {
      stop()
      void pulse()
      void context()
      pulseTimer = window.setInterval(pulse, PULSE_MS)
      contextTimer = window.setInterval(context, CONTEXT_MS)
    }

    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop())
    onVisibility()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stopped = true
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [token, sessionId])
}
