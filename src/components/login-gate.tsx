"use client"

import { useState, type FormEvent } from "react"
import { LockIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { JarvisAuthError, JarvisNetworkError, verifyToken } from "@/lib/jarvis-client"

interface LoginGateProps {
  onAuthenticated: (token: string) => void
}

export function LoginGate({ onAuthenticated }: LoginGateProps) {
  const [value, setValue] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const token = value.trim()
    if (!token || submitting) return

    setSubmitting(true)
    setError(null)
    try {
      await verifyToken(token)
      onAuthenticated(token)
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        setError("Invalid access token.")
      } else if (err instanceof JarvisNetworkError) {
        setError(err.message)
      } else {
        setError("Something went wrong. Try again.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="glow-border scan-line animate-fade-up w-full max-w-sm">
        <CardHeader className="items-center gap-2 text-center">
          <div className="glow-green flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LockIcon className="size-5" />
          </div>
          <CardTitle className="text-2xl text-gradient-green">J.A.R.V.I.S.</CardTitle>
          <CardDescription>Enter your access token to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Access token"
              autoFocus
              disabled={submitting}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={submitting || !value.trim()} className="w-full">
              {submitting && <Loader2Icon className="animate-spin" />}
              {submitting ? "Verifying…" : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
