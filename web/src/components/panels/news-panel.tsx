"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ExternalLinkIcon, RadioIcon } from "lucide-react"

import {
  JarvisAuthError,
  getIntel,
  NEWS_CATEGORIES,
  type NewsArticle,
  type NewsResult,
} from "@/lib/jarvis-client"
import {
  EASE_OUT,
  PanelSection,
  RefreshButton,
  ScanRows,
  itemVariants,
  listVariants,
  relativeTime,
  syncStamp,
} from "./hud-kit"

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

// Shorter chip labels; the full category name shows as the feed heading.
const SHORT_LABELS: Record<string, string> = {
  "market-moves": "Markets",
  "ai-tools-llms": "AI Tools",
  "hedge-funds": "Hedge Funds",
  "private-equity": "PE",
  "venture-capital": "VC",
  "ai-innovation": "AI Research",
}

const FRESH_MS = 6 * 60 * 60 * 1000

// Structured like kiv-console's Intel Hub — one feed per theme, fetched in
// parallel. A live chat-triggered news_feed result (liveNews) sits on top
// as its own intercept block rather than replacing a feed, since the fixed
// themes and an ad-hoc chat query are different things worth keeping both.
export function NewsPanel({ token, onAuthError, liveNews }: NewsPanelProps) {
  const [categories, setCategories] = useState<CategoryFeed[] | null>(null)
  const [activeId, setActiveId] = useState<string>(NEWS_CATEGORIES[0].id)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)

  // One request for every theme: the articles the hourly Intel refresh
  // stored (app/services/intel.py), the same ones K.I.V.'s Intel Hub shows.
  // Stale or empty, the server starts a refresh, and this checks back.
  function fetchCategories(): Promise<void> {
    return getIntel(token)
      .then((result) => {
        if (!result.ok) {
          setError(result.error ?? "Could not load news.")
          return
        }
        setCategories(
          NEWS_CATEGORIES.map((c) => ({
            id: c.id,
            label: c.label,
            articles: result.categories?.[c.id] ?? [],
          })),
        )
        setSyncedAt(result.fetched_at ? new Date(result.fetched_at) : new Date())
        if (result.refreshing) setTimeout(() => void fetchCategories(), 30_000)
      })
      .catch((err) => {
        if (err instanceof JarvisAuthError) {
          onAuthError()
          return
        }
        setError("Could not load news.")
      })
      .finally(() => setLoading(false))
  }

  function loadCategories() {
    setLoading(true)
    setError(null)
    void fetchCategories()
  }

  useEffect(() => {
    void fetchCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const anyResults = categories?.some((c) => c.articles.length > 0) ?? false
  const active = categories?.find((c) => c.id === activeId)
  const total = categories?.reduce((n, c) => n + c.articles.length, 0) ?? 0

  return (
    <div className="flex flex-col" style={{ gap: "var(--sp-3)" }}>
      <AnimatePresence>
        {liveNews?.ok && liveNews.articles && liveNews.articles.length > 0 && (
          <motion.section
            key={liveNews.query}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
            className="card glow-std flex flex-col"
            style={{
              padding: "var(--sp-3)",
              gap: "var(--sp-2)",
              borderColor: "rgba(var(--accent-rgb), 0.6)",
              borderLeft: "2px solid var(--accent)",
            }}
          >
            <span className="t-panel-header flex items-center" style={{ gap: 6, color: "var(--accent)" }}>
              <RadioIcon className="size-3.5" /> Intercept · {liveNews.query}
            </span>
            {liveNews.articles.slice(0, 3).map((article) => (
              <a
                key={article.url}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="t-body clamp-2 hover:underline"
              >
                {article.title}
              </a>
            ))}
          </motion.section>
        )}
      </AnimatePresence>

      <PanelSection
        title="Intel"
        meta={[syncStamp(syncedAt), total ? `${total} ITEMS` : null].filter(Boolean).join(" · ")}
        action={<RefreshButton loading={loading} onClick={loadCategories} label="Refresh intel" />}
      >
        {categories && (
          <div className="flex overflow-x-auto" style={{ gap: "var(--sp-1)", paddingBottom: 2 }}>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className="btn shrink-0"
                data-active={c.id === activeId}
                onClick={() => setActiveId(c.id)}
                style={{ height: 26, padding: "0 var(--sp-2)", gap: 6 }}
                title={c.label}
              >
                {(SHORT_LABELS[c.id] ?? c.label).toUpperCase()}
                <span className="t-label" style={{ color: "var(--text-secondary)" }}>
                  {c.articles.length}
                </span>
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="t-body" style={{ color: "var(--error)" }}>
            {error}
          </p>
        )}
        {!categories && loading ? <ScanRows rows={4} height={44} /> : null}
        {!error && !loading && categories && !anyResults && (
          <p className="t-body" style={{ color: "var(--text-secondary)" }}>
            No articles right now. NewsAPI&apos;s free tier rate-limits at 100 requests a day, so
            this can go quiet for a while and resumes on its own.
          </p>
        )}

        {active && anyResults && (
          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              variants={listVariants}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              className="grid grid-cols-1 @4xl:grid-cols-2"
              style={{ gap: "var(--sp-1) var(--sp-3)" }}
            >
              <span className="t-label @4xl:col-span-2" style={{ color: "var(--text-secondary)" }}>
                {active.label.toUpperCase()}
              </span>
              {active.articles.length === 0 ? (
                <p className="t-body" style={{ color: "var(--text-secondary)" }}>
                  No recent results.
                </p>
              ) : (
                active.articles.map((article) => <ArticleRow key={article.url} article={article} />)
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </PanelSection>
    </div>
  )
}

function ArticleRow({ article }: { article: NewsArticle }) {
  // Captured once per row render; the panel re-renders on every refresh.
  const [now] = useState(() => Date.now())
  const fresh = now - new Date(article.published_at).getTime() < FRESH_MS

  return (
    <motion.a
      variants={itemVariants}
      whileHover={{ x: 3 }}
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex min-w-0 flex-col"
      style={{
        gap: 2,
        padding: "var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3)",
        borderLeft: `2px solid ${fresh ? "var(--accent)" : "rgba(var(--accent-rgb), 0.15)"}`,
        background: "rgba(10, 14, 26, 0.35)",
      }}
    >
      <span className="t-label flex min-w-0 items-center" style={{ gap: "var(--sp-2)" }}>
        <span className="truncate-1" style={{ color: "var(--accent)" }}>
          {article.source.toUpperCase()}
        </span>
        <span style={{ color: "var(--text-secondary)" }}>{relativeTime(article.published_at, now)}</span>
        {fresh ? (
          <span
            style={{
              color: "var(--bg-base)",
              background: "var(--accent)",
              padding: "0 4px",
              borderRadius: 2,
              fontSize: 10,
            }}
          >
            NEW
          </span>
        ) : null}
      </span>
      <span className="t-body flex items-start" style={{ gap: 6 }}>
        <span className="clamp-2 min-w-0">{article.title}</span>
        <ExternalLinkIcon
          className="mt-1 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: "var(--text-secondary)" }}
        />
      </span>
    </motion.a>
  )
}
