"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

// Any of Jarvis's windows can leave the console for a window of its own -
// a real one, on another monitor if he likes. The content is not copied:
// it is the same React tree, portalled into the new window's document, so
// it stays live (a showcase Jarvis updates, a market tile ticking) and its
// buttons still work. The console's stylesheets, fonts and mode (the
// "serious" class on <html>) are carried across and kept in step.
//
// Opening one needs a click (browsers block pop-ups otherwise). Closing
// the window - its own close button or the OS's - calls `onClosed`, so the
// caller can put the window back or let it go.

/** Copy the console's styles into the pop-out, and keep copying new ones
 *  (a lazily loaded chunk's CSS, dev reloads). */
function mirrorHead(win: Window): () => void {
  const copy = (node: Node) => {
    if (node instanceof HTMLLinkElement && node.rel === "stylesheet") {
      const link = win.document.createElement("link")
      link.rel = "stylesheet"
      // Absolute: the pop-out is about:blank, with no base of its own.
      link.href = node.href
      win.document.head.appendChild(link)
    } else if (node instanceof HTMLStyleElement) {
      win.document.head.appendChild(win.document.importNode(node, true))
    }
  }
  document.head.querySelectorAll("link[rel=stylesheet], style").forEach(copy)
  const headWatch = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(copy)))
  headWatch.observe(document.head, { childList: true })
  // <html> carries the font variables and the mode.
  const sync = () => {
    win.document.documentElement.className = document.documentElement.className
    win.document.documentElement.lang = document.documentElement.lang
    const style = document.documentElement.getAttribute("style")
    if (style) win.document.documentElement.setAttribute("style", style)
    else win.document.documentElement.removeAttribute("style")
  }
  sync()
  const htmlWatch = new MutationObserver(sync)
  htmlWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] })
  return () => {
    headWatch.disconnect()
    htmlWatch.disconnect()
  }
}

export interface PopOut {
  /** The pop-out window's root, while it is open. */
  root: HTMLElement | null
  /** Open it, sized and placed like `from` on screen. False when the
   *  browser blocked it: outside a click that takes the site's pop-up
   *  permission (lib/window-control.ts asks for the click instead). */
  open: (title: string, from?: DOMRect | null) => boolean
  /** Close it from the console's side. */
  close: () => void
}

/**
 * A window of the component's own. `name` keeps one window per thing (a
 * second open() focuses it); `onClosed` runs when he closes it himself.
 */
export function usePopOut(name: string, onClosed: () => void): PopOut {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const win = useRef<Window | null>(null)
  const closedRef = useRef(onClosed)
  useEffect(() => {
    closedRef.current = onClosed
  })

  const close = useCallback(() => {
    const w = win.current
    win.current = null
    setRoot(null)
    if (w && !w.closed) w.close()
  }, [])

  const open = useCallback(
    (title: string, from?: DOMRect | null) => {
      if (win.current && !win.current.closed) {
        win.current.focus()
        return true
      }
      const width = Math.round(Math.max(360, from?.width ?? 760))
      const height = Math.round(Math.max(240, (from?.height ?? 520) + 30))
      // Where it sat in the console, in screen coordinates.
      const left = Math.round(window.screenX + (from?.left ?? (window.innerWidth - width) / 2))
      const top = Math.round(window.screenY + (window.outerHeight - window.innerHeight) + (from?.top ?? 80))
      const w = window.open("", `jarvis-${name}`, `popup,width=${width},height=${height},left=${left},top=${top}`)
      if (!w) return false
      win.current = w
      w.document.title = `${title} · J.A.R.V.I.S.`
      w.document.body.innerHTML = ""
      w.document.body.style.cssText = "margin:0;background:#05070e;overflow:hidden;height:100vh"
      const unmirror = mirrorHead(w)
      const mount = w.document.createElement("div")
      mount.style.cssText = "height:100vh;display:flex;flex-direction:column"
      w.document.body.appendChild(mount)
      setRoot(mount)
      // He closed it: hand control back to the console.
      w.addEventListener("pagehide", () => {
        unmirror()
        if (win.current !== w) return
        win.current = null
        setRoot(null)
        closedRef.current()
      })
      return true
    },
    [name]
  )

  // The console going away takes its pop-outs with it.
  useEffect(() => {
    // Closed from this side: not "he closed it", so no onClosed.
    const drop = () => {
      const w = win.current
      win.current = null
      w?.close()
    }
    window.addEventListener("pagehide", drop)
    return () => {
      window.removeEventListener("pagehide", drop)
      drop()
    }
  }, [])

  return { root, open, close }
}

/** Render into the pop-out window. */
export function PopOutPortal({ root, children }: { root: HTMLElement; children: ReactNode }) {
  return createPortal(children, root)
}
