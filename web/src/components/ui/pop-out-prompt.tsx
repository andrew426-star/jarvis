"use client"

import { AnimatePresence, motion } from "framer-motion"
import { AppWindowIcon } from "lucide-react"

import { popOutWindow, useWindowRequest, WINDOW_TITLES } from "@/lib/window-control"

// Jarvis asked for a window and the browser held it back for want of a
// click. One click here opens it; the hint says how to stop being asked.
export function PopOutPrompt() {
  const waiting = useWindowRequest((state) => state.waiting)
  const setWaiting = useWindowRequest((state) => state.setWaiting)

  return (
    <AnimatePresence>
      {waiting && (
        <motion.div
          key="pop-out-prompt"
          role="alertdialog"
          aria-label="Open in a new window"
          className="card glow-std fixed flex flex-col"
          style={{
            top: 48 + 16,
            left: "50%",
            x: "-50%",
            width: "min(420px, calc(100vw - 32px))",
            zIndex: 60,
            padding: "var(--sp-4)",
            gap: "var(--sp-3)",
            background: "rgba(5, 7, 14, 0.96)",
            borderColor: "rgba(var(--accent-rgb), 0.5)",
          }}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          <div className="flex items-center" style={{ gap: "var(--sp-2)", color: "var(--accent)" }}>
            <AppWindowIcon size={16} className="shrink-0" />
            <span className="t-header truncate-1" style={{ fontSize: 12 }}>
              Open {WINDOW_TITLES[waiting]} in a new window
            </span>
          </div>
          <p className="t-body wrap-words" style={{ color: "var(--text-secondary)", lineHeight: 1.55, margin: 0 }}>
            The browser needs one click before Jarvis can open a window. To let him do it straight away next
            time, allow pop-ups for this site from the icon at the end of the address bar.
          </p>
          <div className="flex justify-end" style={{ gap: "var(--sp-2)" }}>
            <button type="button" className="btn" style={{ height: 32, padding: "0 14px" }} onClick={() => setWaiting(null)}>
              NOT NOW
            </button>
            <button
              type="button"
              className="btn"
              data-active
              style={{ height: 32, padding: "0 14px" }}
              onClick={() => popOutWindow(waiting)}
            >
              OPEN WINDOW
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
