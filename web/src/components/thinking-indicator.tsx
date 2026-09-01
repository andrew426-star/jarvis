// A filling block meter rather than three bouncing dots - it reads as a
// machine working through something, and matches the segmented language
// of the status ring.
export function ThinkingIndicator() {
  return (
    <div className="flex items-center" style={{ gap: "var(--sp-2)" }}>
      <span className="t-label" style={{ color: "var(--accent)" }}>
        PROCESSING
      </span>
      <span className="flex" style={{ gap: "3px" }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="anim-dot"
            style={{
              width: "3px",
              height: "10px",
              background: "var(--accent)",
              animationDelay: `${i * 110}ms`,
            }}
          />
        ))}
      </span>
    </div>
  )
}
