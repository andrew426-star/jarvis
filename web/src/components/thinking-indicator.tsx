// A filling block meter rather than three bouncing dots - it reads as a
// machine working through something, which is what is actually
// happening, and matches the segmented language of the status ring.
export function ThinkingIndicator() {
  return (
    <div className="boot-up flex items-center gap-2">
      <span className="label-hud" style={{ color: "var(--hud)" }}>
        Processing
      </span>
      <span className="flex gap-[3px]">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="h-2 w-1 animate-pulse-dot"
            style={{
              background: "var(--hud)",
              animationDelay: `${i * 110}ms`,
            }}
          />
        ))}
      </span>
    </div>
  )
}
