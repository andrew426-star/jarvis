"use client"

import { useCallback, useEffect, useRef } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { AppWindowIcon, MinimizeIcon, XIcon } from "lucide-react"

import { BenchPanel } from "@/components/ultron/bench-panel"
import { DirectivePanel } from "@/components/ultron/directive-panel"
import { LegionPanel } from "@/components/ultron/legion-panel"
import { PopOutPortal, usePopOut } from "@/components/ui/pop-out"
import { sfx } from "@/lib/sfx"
import { ownerOf, ULTRON_TABS, useJarvis, type UltronTab } from "@/lib/store"
import { registerWindow } from "@/lib/window-control"

// Ultron's bay: where his apps open, in place of Jarvis's data window while
// the console is his. Not a glass card unfolding but a hatch: two blast
// doors meet over it, unlatch and part (with the latch, the servos and the
// seat), and the app is there behind them. Moving between his apps swaps
// the rack - the old one collapses to a line, the new one is scanned in
// from the top. Like the data window it can leave for a window of its own.

const INSET = { top: 48 + 12, bottom: 56 + 12, side: 12 }
/** The doors: shut a beat, then part. */
const DOOR_S = 0.78

export interface UltronAppProps {
  token: string
  onAuthError: () => void
  /** Put a request to Ultron, as if Andrew had typed it. */
  onAsk: (prompt: string) => void
}

function App({ tab, ...props }: UltronAppProps & { tab: UltronTab }) {
  if (tab === "directive") return <DirectivePanel {...props} />
  if (tab === "legion") return <LegionPanel {...props} />
  return <BenchPanel {...props} />
}

function Door({ side, label }: { side: "top" | "bottom"; label: string }) {
  const top = side === "top"
  return (
    <motion.div
      className="pointer-events-none absolute right-0 left-0 flex items-center justify-center"
      style={{
        [side]: 0,
        height: "50.5%",
        zIndex: 5,
        background:
          "repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 4px), linear-gradient(180deg, #2a1718, #120809)",
        boxShadow: "inset 0 0 0 1px rgba(var(--accent-rgb), 0.35)",
      }}
      initial={{ y: "0%" }}
      animate={{ y: ["0%", top ? "2%" : "-2%", top ? "-102%" : "102%"] }}
      transition={{ duration: DOOR_S, times: [0, 0.32, 1], ease: [0.7, 0, 0.25, 1] }}
    >
      {/* The meeting edge: hazard stripes, and the bay's designation. */}
      <div className="u-hazard absolute right-0 left-0" style={{ [top ? "bottom" : "top"]: 0, height: 10 }} />
      {top && (
        <span className="u-stencil absolute" style={{ bottom: 22, fontSize: 13, letterSpacing: "0.4em", color: "rgba(255, 220, 210, 0.75)" }}>
          {label}
        </span>
      )}
    </motion.div>
  )
}

export function UltronBay(props: UltronAppProps) {
  const activeTab = useJarvis((state) => state.activeTab)
  const setActiveTab = useJarvis((state) => state.setActiveTab)
  const tab = activeTab && ownerOf(activeTab) === "serious" ? (activeTab as UltronTab) : null
  const meta = ULTRON_TABS.find((t) => t.key === tab)
  const sectionRef = useRef<HTMLElement>(null)
  const popOut = usePopOut("data", useCallback(() => setActiveTab(null), [setActiveTab]))
  const popped = !!popOut.root
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!tab && popped) popOut.close()
  }, [tab, popped, popOut])
  useEffect(
    () =>
      registerWindow("panel", {
        out: () => popOut.open(`${useJarvis.getState().activeTab ?? "bay"}`.toUpperCase(), sectionRef.current?.getBoundingClientRect()),
        in: popOut.close,
        isOut: () => popped,
      }),
    [popped, popOut]
  )
  useEffect(() => {
    if (!tab) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveTab(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [tab, setActiveTab])
  // The hatch's sound: opening, and closing again.
  useEffect(() => {
    if (!!tab === wasOpen.current) return
    wasOpen.current = !!tab
    sfx.helm(!!tab, tab ? DOOR_S * 0.7 : 0.4)
  }, [tab])

  const header = (
    <header className="relative flex shrink-0 items-center justify-between" style={{ padding: "8px 14px", gap: 12, borderBottom: "1px solid rgba(var(--accent-rgb), 0.25)" }}>
      <div className="u-hazard-dim absolute right-0 bottom-0 left-0" style={{ height: 3 }} aria-hidden />
      <div className="flex items-center" style={{ gap: 6 }}>
        {ULTRON_TABS.map((t) => (
          <button key={t.key} type="button" className="u-btn flex items-center" style={{ gap: 8 }} data-active={tab === t.key} onClick={() => setActiveTab(t.key)}>
            <span className="u-code" style={{ color: tab === t.key ? "#fff" : undefined }}>{t.code}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex items-center" style={{ gap: 8 }}>
        {!popped && <span className="u-code hidden sm:inline" style={{ opacity: 0.6 }}>ESC · SEAL BAY</span>}
        <button
          type="button"
          className="u-btn"
          style={{ padding: "5px 7px" }}
          onClick={() => (popped ? popOut.close() : popOut.open(`${tab ?? "bay"}`.toUpperCase(), sectionRef.current?.getBoundingClientRect()))}
          aria-label={popped ? "Back into the console" : "Open in its own window"}
          title={popped ? "Back into the console" : "Open in its own window (another monitor)"}
        >
          {popped ? <MinimizeIcon className="size-4" /> : <AppWindowIcon className="size-4" />}
        </button>
        <button type="button" className="u-btn" style={{ padding: "5px 7px" }} onClick={() => setActiveTab(null)} aria-label="Seal the bay" title="Seal (Esc)">
          <XIcon className="size-4" />
        </button>
      </div>
    </header>
  )

  const rack = tab && (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={tab}
        className="@container relative min-h-0 flex-1 overflow-y-auto"
        style={{ padding: 16 }}
        initial={{ clipPath: "inset(0% 0% 100% 0%)", opacity: 0.4 }}
        animate={{ clipPath: "inset(0% 0% 0% 0%)", opacity: 1 }}
        exit={{ clipPath: "inset(49% 0% 49% 0%)", opacity: 0.2 }}
        transition={{ duration: 0.3, ease: [0.7, 0, 0.3, 1] }}
      >
        {/* The scan that brings the new rack in. */}
        <motion.div
          className="pointer-events-none absolute right-0 left-0"
          style={{ top: 0, height: 2, background: "var(--accent)", boxShadow: "0 0 14px var(--accent)", zIndex: 4 }}
          initial={{ y: 0, opacity: 1 }}
          animate={{ y: 600, opacity: 0 }}
          transition={{ duration: 0.45, ease: "easeIn" }}
          aria-hidden
        />
        <App tab={tab} {...props} />
      </motion.div>
    </AnimatePresence>
  )

  if (tab && popOut.root) {
    return (
      <PopOutPortal root={popOut.root}>
        {header}
        {rack}
      </PopOutPortal>
    )
  }

  return (
    <AnimatePresence>
      {tab && (
        <>
          <motion.div
            key="ultron-bay-backdrop"
            className="fixed"
            style={{ top: 48, bottom: 56, left: 0, right: 0, zIndex: 30, background: "rgba(6, 0, 1, 0.62)", backdropFilter: "blur(2px) saturate(0.6)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setActiveTab(null)}
            aria-hidden
          />
          <motion.section
            key="ultron-bay"
            ref={sectionRef}
            role="dialog"
            aria-label={`Ultron: ${meta?.label ?? "bay"}`}
            className="u-plate fixed flex flex-col overflow-hidden"
            style={{ top: INSET.top, bottom: INSET.bottom, left: INSET.side, right: INSET.side, zIndex: 31 }}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scaleY: 0.02, transition: { duration: 0.28, ease: [0.7, 0, 1, 0.4] } }}
            transition={{ duration: 0.15 }}
          >
            <Door side="top" label={`${meta?.code ?? ""} // ${meta?.label ?? ""}`} />
            <Door side="bottom" label="" />
            {header}
            {rack}
          </motion.section>
        </>
      )}
    </AnimatePresence>
  )
}
