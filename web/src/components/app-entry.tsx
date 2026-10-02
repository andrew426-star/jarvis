"use client"

import dynamic from "next/dynamic"
import { useSyncExternalStore } from "react"

import { resolveView, subscribeView } from "@/lib/view"

// Each view is its own chunk, so a phone never downloads the desktop HUD
// (three.js, the workshop, hand tracking) and the desktop is unchanged.
const blank = () => <div style={{ height: "100dvh" }} />

const JarvisConsole = dynamic(() => import("@/components/jarvis-console").then((m) => m.JarvisConsole), {
  ssr: false,
  loading: blank,
})

const MobileConsole = dynamic(() => import("@/components/mobile/mobile-console").then((m) => m.MobileConsole), {
  ssr: false,
  loading: blank,
})

export function AppEntry() {
  // null on the server render: the static export cannot know the device.
  const view = useSyncExternalStore(subscribeView, resolveView, () => null)
  if (view === null) return blank()
  return view === "mobile" ? <MobileConsole /> : <JarvisConsole />
}
