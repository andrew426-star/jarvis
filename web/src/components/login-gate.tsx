"use client"

import { useState } from "react"
import { Loader2Icon } from "lucide-react"

import { googleLoginUrl } from "@/lib/jarvis-client"

// Mirrors the login_error values app/api/routes/google_login.py can
// redirect back with. Anything unrecognised falls through to a generic
// message rather than printing a raw code at the user.
const ERROR_MESSAGE: Record<string, string> = {
  denied: "Sign-in was cancelled.",
  not_allowed: "That Google account is not authorised for this instance.",
  bad_request: "That sign-in link expired. Try again.",
  exchange_failed: "Google sign-in failed. Try again.",
  not_configured: "Sign-in is not configured on the server yet.",
}

interface LoginGateProps {
  loginError?: string | null
}

export function LoginGate({ loginError }: LoginGateProps) {
  const [redirecting, setRedirecting] = useState(false)

  function handleSignIn() {
    setRedirecting(true)
    window.location.href = googleLoginUrl()
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* The gate gets the environment but none of the instruments - the
          HUD proper is what you are being let into. */}
      <div className="perspective-grid opacity-60" aria-hidden />
      <div className="crt-vignette" aria-hidden />
      <div className="crt-overlay" aria-hidden />

      <div className="hud-panel glow-hud boot-up relative z-10 w-full max-w-sm p-7">
        <div className="flex flex-col items-center gap-1 text-center">
          {/* A dormant reactor: rings present, core unlit. */}
          <svg viewBox="0 0 100 100" className="mb-3 size-16" aria-hidden>
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="var(--hud)"
              strokeWidth="1"
              strokeDasharray="2 5"
              opacity="0.5"
              className="reactor-ring"
              style={{ animation: "reactor-spin 24s linear infinite" }}
            />
            <circle
              cx="50"
              cy="50"
              r="32"
              fill="none"
              stroke="var(--hud)"
              strokeWidth="2.5"
              strokeDasharray="30 14"
              opacity="0.8"
              className="reactor-ring"
              style={{ animation: "reactor-spin-rev 16s linear infinite" }}
            />
            <circle cx="50" cy="50" r="16" fill="none" stroke="var(--hud)" strokeWidth="1" opacity="0.6" />
            <circle
              cx="50"
              cy="50"
              r="8"
              fill="var(--hud)"
              opacity="0.35"
              className="reactor-ring"
              style={{ animation: "reactor-breathe 4s ease-in-out infinite" }}
            />
          </svg>

          <h1 className="font-display text-gradient-hud text-xl">J.A.R.V.I.S.</h1>
          <p className="label-hud">Authentication Required</p>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          {loginError && (
            <p className="readout text-[0.72rem]" style={{ color: "var(--destructive)" }}>
              {ERROR_MESSAGE[loginError] ?? "Sign-in failed. Try again."}
            </p>
          )}
          <button
            type="button"
            onClick={handleSignIn}
            disabled={redirecting}
            className="bracket-frame font-display flex w-full items-center justify-center gap-2 py-3 text-[0.7rem] transition-colors duration-200 disabled:opacity-50"
            style={{
              color: "var(--hud)",
              background: "hsl(var(--hue) var(--sat) 55% / 0.09)",
              border: "1px solid hsl(var(--hue) 70% 55% / 0.4)",
            }}
          >
            {redirecting && <Loader2Icon className="size-3.5 animate-spin" />}
            {redirecting ? "Redirecting" : "Authenticate with Google"}
          </button>
        </div>
      </div>
    </div>
  )
}
