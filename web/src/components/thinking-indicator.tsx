export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground animate-fade-up">
      <span className="flex gap-1">
        <span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:0ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
      </span>
      J.A.R.V.I.S. is thinking
    </div>
  )
}
