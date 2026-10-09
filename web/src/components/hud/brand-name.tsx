"use client"

import { useJarvis } from "@/lib/store"

// Who is on the console: J.A.R.V.I.S., or in serious mode Ultron
// (lib/persona.ts), whose name never quite holds still. The glitch is CSS
// (.brand-ultron in globals.css): two offset copies of the word that tear
// sideways for a few frames every few seconds.
export function BrandName() {
  const serious = useJarvis((state) => state.mode === "serious")
  if (!serious) return <>J.A.R.V.I.S.</>
  return (
    <span className="brand-ultron" data-text="ULTRON">
      ULTRON
    </span>
  )
}
