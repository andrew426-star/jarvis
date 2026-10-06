"use client"

import { useCallback, useEffect, useRef } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { AppWindowIcon, MinimizeIcon, XIcon } from "lucide-react"

import { PopOutPortal, usePopOut } from "@/components/ui/pop-out"
import { registerWindow } from "@/lib/window-control"

import { useJarvis, type TabKey } from "@/lib/store"

const TABS: { key: TabKey; label: string }[] = [
  { key: "markets", label: "Markets" },
  { key: "intel", label: "Intel" },
  { key: "assets", label: "Assets" },
  { key: "notes", label: "Notes" },
  { key: "inbox", label: "Inbox" },
]

// Top bar 48px, bottom bar 56px, plus a gutter — the window floats over
// everything between them, side panels included, so the data tabs get the
// whole console instead of the 40%-high comms slot.
const INSET = { top: 48 + 12, bottom: 56 + 12, side: 12 }

// Transform and opacity only (rule 10): the window unfolds on scaleY from
// its centre line, the same gesture as the boot sequence's scan line.
// All three panels stay mounted while the window is open (the caller
// hides the inactive ones), so switching tabs doesn't refetch or lose a
// chart the user was looking at. It can leave the console for a window of
// its own - markets on the second monitor - tabs and all; closing that
// window closes it.
export function DataWindow({ children }: { children: React.ReactNode }) {
  const activeTab = useJarvis((state) => state.activeTab)
  const setActiveTab = useJarvis((state) => state.setActiveTab)
  const sectionRef = useRef<HTMLElement>(null)
  const popOut = usePopOut("data", useCallback(() => setActiveTab(null), [setActiveTab]))
  const popped = !!popOut.root
  useEffect(() => {
    if (!activeTab && popped) popOut.close()
  }, [activeTab, popped, popOut])
  // Jarvis can move it too (console tool: pop_out / pop_in); the panel to
  // show is opened first by the caller.
  useEffect(
    () =>
      registerWindow("panel", {
        out: () => popOut.open(`${useJarvis.getState().activeTab ?? "data"}`.toUpperCase(), sectionRef.current?.getBoundingClientRect()),
        in: popOut.close,
        isOut: () => popped,
      }),
    [popped, popOut]
  )

  useEffect(() => {
    if (!activeTab) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveTab(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activeTab, setActiveTab])

  const header = (
<header
      className="relative flex shrink-0 items-center justify-between overflow-hidden"
      style={{
        padding: "var(--sp-2) var(--sp-3)",
        gap: "var(--sp-3)",
        borderBottom: "1px solid rgba(var(--accent-rgb), 0.2)",
      }}
    >
      <div className="bar-sweep" />
      <div className="flex items-center" style={{ gap: "var(--sp-2)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="btn"
            data-active={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{ padding: "4px 12px" }}
          >
            {tab.label.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="flex items-center" style={{ gap: "var(--sp-3)" }}>
        {!popped && <span className="t-time hidden sm:inline">ESC TO CLOSE</span>}
        <button
          type="button"
          className="btn"
          style={{ width: 28, height: 28, padding: 0 }}
          onClick={() => (popped ? popOut.close() : popOut.open(`${activeTab ?? "data"}`.toUpperCase(), sectionRef.current?.getBoundingClientRect()))}
          aria-label={popped ? "Back into the console" : "Open in its own window"}
          title={popped ? "Back into the console" : "Open in its own window (another monitor)"}
        >
          {popped ? <MinimizeIcon className="size-4" /> : <AppWindowIcon className="size-4" />}
        </button>
        <button
          type="button"
          className="btn"
          style={{ width: 28, height: 28, padding: 0 }}
          onClick={() => setActiveTab(null)}
          aria-label="Close data window"
          title="Close (Esc)"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </header>
  )

  if (activeTab && popOut.root) {
    return (
      <PopOutPortal root={popOut.root}>
        {header}
        <div className="@container min-h-0 flex-1 overflow-y-auto" style={{ padding: "var(--sp-4)" }}>
          {children}
        </div>
      </PopOutPortal>
    )
  }

  return (
    <AnimatePresence>
      {activeTab && (
        <>
          <motion.div
            key="data-window-backdrop"
            className="fixed"
            style={{
              top: 48,
              bottom: 56,
              left: 0,
              right: 0,
              zIndex: 30,
              background: "rgba(0, 0, 0, 0.55)",
              backdropFilter: "blur(3px)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setActiveTab(null)}
            aria-hidden
          />
          <motion.section
            key="data-window"
            ref={sectionRef}
            role="dialog"
            aria-label={`${activeTab} data`}
            className="card glow-std fixed flex flex-col"
            style={{
              top: INSET.top,
              bottom: INSET.bottom,
              left: INSET.side,
              right: INSET.side,
              zIndex: 31,
              background: "rgba(5, 7, 14, 0.94)",
              borderColor: "rgba(var(--accent-rgb), 0.45)",
              transformOrigin: "center",
            }}
            initial={{ scaleY: 0.02, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            exit={{ scaleY: 0.02, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            {header}
            <motion.div
              className="@container min-h-0 flex-1 overflow-y-auto"
              style={{ padding: "var(--sp-4)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25, delay: 0.12 }}
            >
              {children}
            </motion.div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  )
}
