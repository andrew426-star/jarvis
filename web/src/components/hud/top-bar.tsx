"use client"


import { useClock } from "@/lib/use-clock"
import { useJarvis, type TabKey } from "@/lib/store"
import { useAnimatedNumber } from "@/lib/use-animated-number"

const TABS: { key: TabKey; label: string }[] = [
  { key: "markets", label: "Markets" },
  { key: "intel", label: "Intel" },
  { key: "assets", label: "Assets" },
]

function Metric({ label, value }: { label: string; value: number }) {
  const animated = useAnimatedNumber(value)
  return (
    <div className="flex min-w-0 items-center" style={{ gap: "var(--sp-1)" }}>
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: "var(--accent)", opacity: 0.6 }}
      />
      <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span
        className="truncate-1"
        style={{
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: "12px",
          color: "var(--accent)",
        }}
      >
        {Math.round(animated)}%
      </span>
    </div>
  )
}

function WindowControls() {
  const buttons = [
    { key: "min", hover: "var(--accent)" },
    { key: "max", hover: "var(--accent)" },
    { key: "close", hover: "var(--error)" },
  ]
  return (
    <div className="flex items-center" style={{ gap: "var(--sp-2)" }}>
      {buttons.map((button) => (
        <button
          key={button.key}
          type="button"
          aria-label={button.key}
          className="size-3 shrink-0 cursor-pointer rounded-full transition-all duration-200"
          style={{ border: "1px solid rgba(122, 138, 154, 0.3)", background: "transparent" }}
          onMouseEnter={(event) => {
            event.currentTarget.style.borderColor = button.hover
            event.currentTarget.style.boxShadow = `0 0 8px ${button.hover}`
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.borderColor = "rgba(122, 138, 154, 0.3)"
            event.currentTarget.style.boxShadow = "none"
          }}
        />
      ))}
    </div>
  )
}

export function TopBar() {
  const { activeTab, setActiveTab, mode, toggleMode, metrics } = useJarvis()
  // 0 until the first client tick - see use-clock.ts for why the clock
  // is an external store rather than state driven by an effect.
  const epoch = useClock()
  const now = epoch === 0 ? null : new Date(epoch)

  const serious = mode === "serious"

  return (
    <header
      className="relative flex items-center justify-between overflow-hidden"
      style={{
        height: "48px",
        padding: "0 var(--sp-4)",
        gap: "var(--sp-4)",
        background: "rgba(5, 5, 10, 0.8)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid rgba(var(--accent-rgb), 0.3)",
      }}
    >
      <div className="bar-sweep" aria-hidden />

      {/* Left: identity, health dot, tabs */}
      <div className="relative flex min-w-0 items-center" style={{ gap: "var(--sp-3)" }}>
        <span
          className="truncate-1 shrink-0"
          style={{
            fontFamily: "var(--font-orbitron), sans-serif",
            fontSize: "14px",
            fontWeight: 600,
            letterSpacing: "0.15em",
            color: "var(--accent)",
          }}
        >
          J.A.R.V.I.S.
        </span>
        <span
          className="anim-dot size-2 shrink-0 rounded-full"
          style={{ background: "var(--success)", boxShadow: "0 0 8px var(--success)" }}
          aria-label="Online"
        />
        <nav className="flex shrink-0 items-center" style={{ gap: "var(--sp-2)" }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              data-active={activeTab === tab.key}
              className="btn"
              style={{ padding: "4px 12px" }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Centre: clock. Absolutely positioned so it stays optically
          centred no matter how wide the two side groups grow. */}
      <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center">
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "14px",
            color: "var(--text-primary)",
            lineHeight: 1.1,
          }}
        >
          {now ? now.toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--"}
        </span>
        <span className="t-time">
          {now
            ? now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
            : ""}
        </span>
      </div>

      {/* Right: mode toggle, metrics, window controls */}
      <div className="relative flex min-w-0 shrink-0 items-center" style={{ gap: "var(--sp-4)" }}>
        <button
          type="button"
          onClick={toggleMode}
          aria-pressed={serious}
          className="btn shrink-0"
          style={{ padding: "4px 12px" }}
        >
          {serious ? "Serious" : "Normal"}
        </button>

        <div className="hidden items-center lg:flex" style={{ gap: "var(--sp-3)" }}>
          <Metric label="CPU" value={metrics.cpu} />
          <Metric label="MEM" value={metrics.mem} />
          <Metric label="NET" value={metrics.net} />
        </div>

        <WindowControls />
      </div>
    </header>
  )
}
