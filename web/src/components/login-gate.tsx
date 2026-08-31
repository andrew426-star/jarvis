"use client"

import { useState } from "react"
import { LockIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { googleLoginUrl } from "@/lib/jarvis-client"

// Mirrors the login_error values app/api/routes/google_login.py can
// redirect back with. Anything unrecognised falls through to a generic
// message rather than printing a raw code at the user.
const ERROR_MESSAGE: Record<string, string> = {
  denied: "Sign-in was cancelled.",
  not_allowed: "That Google account isn't authorised for this instance.",
  bad_request: "That sign-in link expired. Try again.",
  exchange_failed: "Google sign-in failed. Try again.",
  not_configured: "Sign-in isn't configured on the server yet.",
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="glow-border scan-line animate-fade-up w-full max-w-sm">
        <CardHeader className="items-center gap-2 text-center">
          <div className="glow-green flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LockIcon className="size-5" />
          </div>
          <CardTitle className="text-2xl text-gradient-green">J.A.R.V.I.S.</CardTitle>
          <CardDescription>Sign in with Google to continue.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {loginError && (
            <p className="text-sm text-destructive">
              {ERROR_MESSAGE[loginError] ?? "Sign-in failed. Try again."}
            </p>
          )}
          <Button type="button" onClick={handleSignIn} disabled={redirecting} className="w-full">
            {redirecting && <Loader2Icon className="animate-spin" />}
            {redirecting ? "Redirecting…" : "Sign in with Google"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
