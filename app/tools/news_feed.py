import json

import httpx

from app.core.config import get_settings
from app.core.redis_client import get_redis_client

NEWSAPI_BASE = "https://newsapi.org/v2/everything"
# Matches kiv-console's own newsapi.ts QUERY, verbatim — same curation:
# potential market moves, AI tools/LLM updates, and shifts in hedge
# funds, PE, VC, or the AI field, not a generic fintech/AI grab-bag.
DEFAULT_QUERY = (
    '"hedge fund" OR "private equity" OR "venture capital" OR "large language model" '
    'OR "generative AI" OR "Federal Reserve" OR "market volatility"'
)
CACHE_TTL_SECONDS = 14400  # 4h — matches kiv-console's own NEWS_CACHE_LIFE.revalidate


def news_feed(args: dict) -> dict:
    query = str(args.get("query") or DEFAULT_QUERY).strip()
    page_size = int(args.get("page_size") or 8)
    cache_key = f"jarvis:newscache:{query.lower()}:{page_size}"

    # Same NEWSAPI_KEY kiv-console already uses against its own 100-req/24h
    # quota, which kiv-console's own history shows running tight — a Redis
    # cache here keeps Jarvis's calls from adding pressure to that budget.
    # A cache miss/outage falls through to a live call, never fails the tool.
    try:
        cached = get_redis_client().get(cache_key)
        if cached:
            return {"ok": True, "query": query, "articles": json.loads(cached), "cached": True}
    except Exception:  # noqa: BLE001
        pass

    try:
        res = httpx.get(
            NEWSAPI_BASE,
            params={
                "q": query,
                # Restricts matching to title/description rather than full
                # article body — confirmed live against the real API that
                # full-text matching (NewsAPI's default) pulls in a lot of
                # noise that title/description matching cuts out almost
                # entirely. Matches kiv-console's own fetchArticles().
                "searchIn": "title,description",
                # pypi.org floods any AI/LLM query with raw package-release
                # notifications ("llm-preflight 2.4.1") — confirmed live
                # against the real API. Matches kiv-console's exclusion.
                "excludeDomains": "pypi.org",
                "language": "en",
                "sortBy": "publishedAt",
                "pageSize": page_size,
                "apiKey": get_settings().newsapi_key,
            },
            timeout=15.0,
        )
        if not res.is_success:
            return {"ok": False, "query": query, "error": res.text}
        articles = [
            {"title": a["title"], "url": a["url"], "source": a["source"]["name"], "published_at": a["publishedAt"]}
            for a in res.json().get("articles", [])
        ]
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "query": query, "error": str(exc)}

    try:
        get_redis_client().set(cache_key, json.dumps(articles), ex=CACHE_TTL_SECONDS)
    except Exception:  # noqa: BLE001
        pass

    return {"ok": True, "query": query, "articles": articles}
