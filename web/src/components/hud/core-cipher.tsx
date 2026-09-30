"use client"

import { useEffect, useRef, useState } from "react"

import { ArcReactor } from "@/components/hud/arc-reactor"
import type { CoreCipher as CoreCipherScene } from "@/lib/core-cipher"
import type { AgentStatus } from "@/lib/store"

interface CoreCipherProps {
  status: AgentStatus
  onToggle: () => void
  /** Boot stage, as the SVG reactor took it: -1 nothing, 0 core ... 3 all. */
  ringsRevealed: number
}

// The 3D holographic core, with the original SVG reactor as the fallback
// when WebGL is unavailable (blocked, lost, or a very old GPU). Same props
// as ArcReactor, so the console swaps one for the other freely.
export function CoreCipher({ status, onToggle, ringsRevealed }: CoreCipherProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CoreCipherScene | null>(null)
  const [failed, setFailed] = useState(false)
  // Latest props, for a scene that finishes loading after they arrived.
  const latest = useRef({ status, ringsRevealed })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    // three.js is imported here, not at module level, so the console's
    // first paint does not wait on it.
    import("@/lib/core-cipher")
      .then(({ CoreCipher }) => {
        if (disposed) return
        try {
          const scene = new CoreCipher(host)
          scene.setStatus(latest.current.status)
          scene.setRevealed(latest.current.ringsRevealed)
          sceneRef.current = scene
        } catch {
          setFailed(true)
        }
      })
      .catch(() => setFailed(true))
    return () => {
      disposed = true
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    latest.current = { status, ringsRevealed }
    sceneRef.current?.setStatus(status)
    sceneRef.current?.setRevealed(ringsRevealed)
  }, [status, ringsRevealed])

  if (failed) return <ArcReactor status={status} onToggle={onToggle} ringsRevealed={ringsRevealed} />

  return (
    <div className="relative aspect-square w-full max-w-[520px]">
      <div ref={hostRef} className="absolute inset-0" aria-hidden />
      {/* Same click target as the SVG reactor: talk to Jarvis. */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={status === "listening" ? "Stop listening" : "Talk to J.A.R.V.I.S."}
        aria-pressed={status === "listening"}
        className="absolute inset-[30%] cursor-pointer rounded-full transition-colors duration-200 hover:bg-[rgba(var(--accent-rgb),0.05)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
      />
    </div>
  )
}
