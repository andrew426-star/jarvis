"use client"

import { useEffect, useState } from "react"
import { RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NewsTabs } from "./news-tabs"
import { JarvisAuthError, getNews, NEWS_CATEGORIES, type NewsArticle, type NewsResult } from "@/lib/jarvis-client"

interface NewsPanelProps {
  token: string
  onAuthError: () => void
  liveNews?: NewsResult
}

interface CategoryFeed {
  id: string
  label: string
  articles: NewsArticle[]
}

// Structured like kiv-console's Intel Hub (CategorizedNews + NewsTabs) —
// one tab per theme, fetched in parallel — rather than a single flat list.
// A live chat-triggered news_feed result (liveNews) is layered on top as
// its own "from your conversation" section instead of replacing the
// tabs, since the fixed categories and an ad-hoc chat query are genuinely
// different things worth keeping both visible.
export function NewsPanel({ token, onAuthError, liveNews }: NewsPanelProps) {
  const [categories, setCategories] = useState<CategoryFeed[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadCategories() {
    setLoading(true)
    setError(null)
    try {
      const results = await Promise.all(NEWS_CATEGORIES.map((c) => getNews(token, c.query)))
      setCategories(
        NEWS_CATEGORIES.map((c, i) => ({
          id: c.id,
          label: c.label,
          articles: results[i].ok ? (results[i].articles ?? []) : [],
        })),
      )
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setError("Could not load news.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const anyResults = categories?.some((c) => c.articles.length > 0) ?? false

  return (
    <Card className="glow-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>News</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={loadCategories}
          aria-label="Refresh news"
        >
          <RefreshCwIcon className={loading ? "animate-spin" : ""} />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {liveNews?.ok && liveNews.articles && liveNews.articles.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
            <span className="text-xs font-medium tracking-wide text-primary uppercase">
              From your conversation — {liveNews.query}
            </span>
            {liveNews.articles.slice(0, 3).map((article) => (
              <a
                key={article.url}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm hover:underline"
              >
                {article.title}
              </a>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !loading && categories && !anyResults && (
          <p className="text-sm text-muted-foreground">
            No articles right now — NewsAPI&apos;s free tier rate-limits at 100 requests/day, so
            this can go quiet temporarily. It&apos;ll resume on its own.
          </p>
        )}
        {categories && anyResults && <NewsTabs categories={categories} />}
      </CardContent>
    </Card>
  )
}
