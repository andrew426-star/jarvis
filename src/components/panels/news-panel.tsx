"use client"

import { useEffect, useRef, useState } from "react"
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { JarvisAuthError, getNews, type NewsResult } from "@/lib/jarvis-client"

interface NewsPanelProps {
  token: string
  onAuthError: () => void
  liveNews?: NewsResult
}

export function NewsPanel({ token, onAuthError, liveNews }: NewsPanelProps) {
  const [news, setNews] = useState<NewsResult | null>(null)
  const [loading, setLoading] = useState(true)

  // Guards against the initial background fetch resolving after a fresher
  // live tool result already arrived from a chat turn.
  const hasLiveNewsRef = useRef(false)

  async function refreshNews() {
    setLoading(true)
    try {
      // No query -> server-side DEFAULT_QUERY (news_feed.py), Jarvis/K.I.V.'s
      // shared curated market-moves/AI-tools-LLM/hedge-fund-PE-VC feed. This
      // panel used to hardcode its own narrower AI-only query, independent
      // of that curation — that's why changing the backend default didn't
      // visibly change anything here. Single source of truth now.
      setNews(await getNews(token))
    } catch (err) {
      if (err instanceof JarvisAuthError) {
        onAuthError()
        return
      }
      setNews({ ok: false, query: "", error: "Could not load news." })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    getNews(token)
      .then((result) => {
        if (!hasLiveNewsRef.current) setNews(result)
      })
      .catch((err) => {
        if (err instanceof JarvisAuthError) {
          onAuthError()
          return
        }
        if (!hasLiveNewsRef.current) {
          setNews({ ok: false, query: "", error: "Could not load news." })
        }
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (liveNews) {
      hasLiveNewsRef.current = true
      setNews(liveNews)
    }
  }, [liveNews])

  return (
    <Card className="glow-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>News{news?.query ? ` — ${news.query}` : ""}</CardTitle>
        <Button type="button" variant="ghost" size="icon-sm" onClick={refreshNews} aria-label="Refresh news">
          <RefreshCwIcon className={loading ? "animate-spin" : ""} />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {news?.ok === false && <p className="text-sm text-destructive">{news.error}</p>}
        {news?.ok && news.articles?.length === 0 && (
          <p className="text-sm text-muted-foreground">No articles found.</p>
        )}
        {news?.articles?.map((article) => (
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
        ))}
      </CardContent>
    </Card>
  )
}
