"use client"

import { ExternalLinkIcon } from "lucide-react"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import type { NewsArticle } from "@/lib/jarvis-client"

type CategoryFeed = {
  id: string
  label: string
  articles: NewsArticle[]
}

// Mirrors kiv-console's Intel Hub NewsTabs (src/components/intel/news-tabs.tsx)
// structurally — same tab-per-category layout — adapted for Jarvis's
// NewsArticle shape (snake_case published_at) and HUD card styling.
export function NewsTabs({ categories }: { categories: CategoryFeed[] }) {
  return (
    <Tabs defaultValue={categories[0]?.id}>
      {/* !h-auto (important) — confirmed live via getBoundingClientRect
          that plain h-auto loses to the base Tabs primitive's own
          group-data-horizontal/tabs:h-8, so TabsList reports a stuck
          32px height even once these 6 pills wrap to 3 rows at this
          reading pane's ~480px width. TabsContent then starts rendering
          at that stale (too-small) offset, overlapping the wrapped
          rows. Kiv-console's own Intel Hub never hit this because its
          card is wide enough for the pills to fit in fewer rows there. */}
      <TabsList className="!h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
        {categories.map((category) => (
          <TabsTrigger
            key={category.id}
            value={category.id}
            className="flex-none grow-0 rounded-full border border-border px-3 py-1 data-active:border-primary/40 data-active:bg-primary/10 data-active:text-primary"
          >
            {category.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {categories.map((category) => (
        <TabsContent key={category.id} value={category.id} className="flex flex-col gap-1 pt-3">
          {category.articles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent results.</p>
          ) : (
            category.articles.map((article) => (
              <a
                key={article.url}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="glow-border-hover flex flex-col gap-0.5 rounded-lg p-2.5"
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {article.title}
                  <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
                </span>
                <span className="text-xs text-muted-foreground">
                  {article.source} · {new Date(article.published_at).toLocaleDateString()}
                </span>
              </a>
            ))
          )}
        </TabsContent>
      ))}
    </Tabs>
  )
}
