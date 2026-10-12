"use client"

import { useId } from "react"
import { AnimatePresence, motion } from "framer-motion"

import { useSpatial } from "@/lib/spatial-store"
import { ULTRON_TABS, useJarvis } from "@/lib/store"
import { useBench } from "@/lib/ultron/bench-store"
import { directiveProgress, useDirective } from "@/lib/ultron/directive-store"

// The hardware Ultron's console is built into, round its centre column
// (the core and the chat; never over the side panels) while it is his: bolted corner brackets with hazard plates, conduits from
// each corner toward the core carrying his red, rails of status lights down
// the sides, and a plate under the top bar reading what he is doing - his
// directive's progress, the bench, the workshop. Every figure on it is
// real (as every gauge on the HUD is). When he opens or moves between his
// apps the conduits surge, as if the power were being routed to them.

export function Bracket({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  // Its own pattern id: brackets show in the console and the workshop at once.
  const hazard = `u-haz-${useId().replace(/:/g, "")}`
  const flipX = corner === "tr" || corner === "br"
  const flipY = corner === "bl" || corner === "br"
  return (
    <svg
      width="120"
      height="80"
      viewBox="0 0 120 80"
      className="absolute"
      style={{ [flipY ? "bottom" : "top"]: 4, [flipX ? "right" : "left"]: 4, transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` }}
      aria-hidden
    >
      <defs>
        <pattern id={hazard} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="8" fill="rgba(255,20,48,0.7)" />
        </pattern>
      </defs>
      <path d="M2 78 V14 L14 2 H118" fill="none" stroke="rgba(255,20,48,0.55)" strokeWidth="2" />
      <path d="M8 78 V18 L18 8 H118" fill="none" stroke="rgba(255,220,210,0.12)" strokeWidth="1" />
      <rect x="26" y="12" width="44" height="7" fill={`url(#${hazard})`} />
      {[[14, 30], [30, 14]].map(([x, y]) => (
        <g key={`${x}${y}`}>
          <circle cx={x} cy={y} r="3.4" fill="#2a1c1c" />
          <circle cx={x} cy={y} r="1.8" fill="#8a7d7b" />
        </g>
      ))}
    </svg>
  )
}

function Rail({ side, count }: { side: "left" | "right"; count: number }) {
  return (
    <div className="u-led-row absolute flex flex-col" style={{ [side]: 3, top: "34%", gap: 7 }} aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className="u-led" data-state={i < count ? "active" : undefined} style={{ width: 4, height: 10, animationDelay: `${i * 0.13}s` }} />
      ))}
    </div>
  )
}

export function UltronFrame() {
  const mode = useJarvis((s) => s.mode)
  const activeTab = useJarvis((s) => s.activeTab)
  const workshopOpen = useSpatial((s) => s.workshopOpen)
  const status = useJarvis((s) => s.status)
  const directive = useDirective((s) => s.directive)
  const runs = useBench((s) => s.runs.length)
  const ultron = mode === "serious"
  // Power routed to whatever he just opened: the conduits are remade on
  // every change, which replays their one-shot surge (u-surge, globals.css).
  const routed = `${activeTab ?? ""}-${workshopOpen}`

  const { done, total } = directiveProgress(directive)
  const app = ULTRON_TABS.find((t) => t.key === activeTab)
  const busy = status === "thinking" || status === "speaking"

  return (
    <AnimatePresence>
      {ultron && (
        <motion.div
          key="ultron-frame"
          className="u-frame pointer-events-none absolute"
          style={{ inset: 0, zIndex: 1 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.7, 0, 0.3, 1] }}
        >
          {/* Conduits: corner to core. */}
          <svg key={routed} className="u-routed absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <path className="u-conduit" d="M1 6 L12 6 L22 22 L34 30" vectorEffect="non-scaling-stroke" />
            <path className="u-conduit" d="M99 6 L88 6 L78 22 L66 30" vectorEffect="non-scaling-stroke" />
            {/* Below, short runs along the floor: the chat lives there. */}
            <path className="u-conduit" d="M1 97 L14 97 L19 92" vectorEffect="non-scaling-stroke" />
            <path className="u-conduit" d="M99 97 L86 97 L81 92" vectorEffect="non-scaling-stroke" />
          </svg>
          <Bracket corner="tl" />
          <Bracket corner="tr" />
          <Bracket corner="bl" />
          <Bracket corner="br" />
          <Rail key={`l${routed}`} side="left" count={busy ? 6 : total ? Math.max(1, Math.round((done / total) * 6)) : 1} />
          <Rail key={`r${routed}`} side="right" count={busy ? 6 : Math.min(6, Math.ceil(runs / 3)) || 1} />

          {/* What he is doing, under the top bar. */}
          <div className="absolute flex items-center" style={{ top: 0, left: "50%", transform: "translateX(-50%)", gap: 0 }}>
            <div
              className="flex items-center"
              style={{
                gap: 14,
                padding: "4px 16px 5px",
                background: "linear-gradient(180deg, rgba(30,14,15,0.95), rgba(14,6,7,0.92))",
                clipPath: "polygon(0 0, 100% 0, calc(100% - 10px) 100%, 10px 100%)",
                boxShadow: "inset 0 0 0 1px rgba(var(--accent-rgb), 0.3)",
              }}
            >
              <span className="u-code">{app ? `${app.code} ${app.label.toUpperCase()}` : workshopOpen ? "U-00 WORKSHOP" : "STANDBY"}</span>
              <span className="u-code" style={{ opacity: 0.35 }}>|</span>
              <span className="u-code">DIRECTIVE {total ? `${done}/${total}` : "NONE"}</span>
              <span className="u-code" style={{ opacity: 0.35 }}>|</span>
              <span className="u-code">BENCH {runs}</span>
              <span className="u-led" data-state={busy ? "active" : undefined} style={{ width: 6, height: 6 }} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
