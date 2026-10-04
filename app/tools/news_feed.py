import json

from app.core.redis_client import get_redis_client
from app.services.intel import CATEGORIES, search_vetted, stored_intel

# News for Jarvis, from the vetted outlets in intel_sources only (rated for
# credibility and lean; see supabase/migrations/0010). With no query, the
# Intel briefing the hourly refresh stored, the same articles K.I.V.'s Intel
# Hub shows (app/services/intel.py). With a query ("news on Nvidia"), a live
# search across those outlets, cached for an hour.

CACHE_TTL_SECONDS = 3600
CACHE_KEY_VERSION = "v4"  # bump when the search changes shape
PER_CATEGORY_IN_BRIEFING = 2

NEWS_FEED_SCHEMA = {
    "type": "function",
    "function": {
        "name": "news_feed",
        "description": (
            "Recent news from vetted outlets only (Reuters, WSJ, FT, Bloomberg, Barron's, "
            "MarketWatch, The Economist, Fortune, Financial Post and trade outlets like Hedgeweek, "
            "PitchBook and The Information; rated for credibility and lean). With no query: the "
            "Intel briefing, the newest articles in each Intel category (market-moving signals, AI "
            "tools and LLMs, hedge funds, private equity, venture capital and AI funding, AI "
            "research), or one category. With a query: a search of those outlets for it."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to search for. Omit for the Intel briefing."},
                "category": {"type": "string", "enum": list(CATEGORIES), "description": "One Intel category."},
                "page_size": {"type": "integer", "description": "How many articles for a query. Default 8."},
            },
            "required": [],
        },
    },
}


def news_feed(args: dict) -> dict:
    query = str(args.get("query") or "").strip()
    try:
        if not query:
            intel = stored_intel()
            category = args.get("category")
            if category in intel["categories"]:
                return {
                    "ok": True,
                    "query": CATEGORIES[category][0],
                    "articles": intel["categories"][category],
                    "fetched_at": intel["fetched_at"],
                }
            briefing = [a for articles in intel["categories"].values() for a in articles[:PER_CATEGORY_IN_BRIEFING]]
            return {"ok": True, "query": "Intel briefing", "articles": briefing, "fetched_at": intel["fetched_at"]}

        size = max(1, min(int(args.get("page_size") or 8), 12))
        cache_key = f"jarvis:newscache:{CACHE_KEY_VERSION}:{query.lower()}:{size}"
        try:
            cached = get_redis_client().get(cache_key)
            if cached:
                return {"ok": True, "query": query, "articles": json.loads(cached), "cached": True}
        except Exception:  # noqa: BLE001 — a cache outage falls through to a live search
            pass
        articles = search_vetted(query, size)
        try:
            get_redis_client().set(cache_key, json.dumps(articles), ex=CACHE_TTL_SECONDS)
        except Exception:  # noqa: BLE001
            pass
        return {"ok": True, "query": query, "articles": articles}
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "query": query or "Intel briefing", "error": str(exc)}
