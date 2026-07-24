"use client"

import { useEffect, useState } from "react"

import { ChatThread } from "@/components/chat-thread"
import { LoginGate } from "@/components/login-gate"
import {
  clearSession,
  clearStoredToken,
  getOrCreateSessionId,
  getStoredToken,
  setStoredToken,
} from "@/lib/storage"

type Status = "resolving" | "unauthenticated" | "authenticated"

export function JarvisConsole() {
  const [status, setStatus] = useState<Status>("resolving")
  const [token, setToken] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState("")

  // Resolved on mount, not read during render — localStorage doesn't exist
  // during server-side prerendering, the same class of bug as `window is
  // not defined`. Rendering a neutral placeholder until this runs avoids a
  // hydration mismatch.
  useEffect(() => {
    const storedToken = getStoredToken()
    if (storedToken) {
      setToken(storedToken)
      setSessionId(getOrCreateSessionId())
      setStatus("authenticated")
    } else {
      setStatus("unauthenticated")
    }
  }, [])

  function handleAuthenticated(newToken: string) {
    setStoredToken(newToken)
    setToken(newToken)
    setSessionId(getOrCreateSessionId())
    setStatus("authenticated")
  }

  function handleAuthError() {
    clearStoredToken()
    clearSession()
    setToken(null)
    setStatus("unauthenticated")
  }

  if (status === "resolving") {
    return <div className="min-h-screen" />
  }

  if (status === "unauthenticated" || !token) {
    return <LoginGate onAuthenticated={handleAuthenticated} />
  }

  return (
    <div className="flex min-h-screen flex-col items-center gap-4 px-4 py-8">
      <h1 className="font-heading text-2xl text-gradient-green">J.A.R.V.I.S.</h1>
      <ChatThread token={token} sessionId={sessionId} onAuthError={handleAuthError} />
    </div>
  )
}
