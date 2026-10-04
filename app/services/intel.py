import logging
import re
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

from app.core.supabase_client import get_supabase_client

# Intel: recent articles per category, from vetted outlets only, for
# Jarvis's Intel panel and K.I.V.'s Intel Hub (both read intel_articles).
#
# The source is Google News search, restricted with site: to the enabled
# outlets in intel_sources. NewsAPI (the previous source) indexes too few of
# them: Reuters, the FT, Barron's and The Economist returned nothing there,
# and some categories got three articles a month. Each category is searched
# once per outlet group, because the wires outrank everything else in one
# combined search; results are kept only from vetted domains and only when
# the headline itself is about the category, then mixed so no outlet has
# more than two of the few shown.

logger = logging.getLogger(__name__)

GOOGLE_NEWS = "https://news.google.com/rss/search"
PER_CATEGORY = 6
MAX_PER_SOURCE = 2
WINDOW = "7d"

# id -> (label, search terms, outlet groups to search, headline pattern).
# Labels and ids match kiv-console's NEWS_CATEGORIES (src/lib/news/newsapi.ts)
# and Jarvis's own (web/src/lib/jarvis-client.ts).
CATEGORIES: dict[str, tuple[str, str, tuple[str, ...], str]] = {
    "market-moves": (
        "Market-Moving Signals",
        '"Federal Reserve" OR "interest rates" OR "stock market" OR "market selloff" OR "market rally" OR recession OR "Treasury yields" OR inflation',
        ("wire", "markets"),
        r"\bfed\b|federal reserve|interest rate|\brates?\b|treasur|yield|inflation|recession|\bstocks?\b|market|sell-?off|rally|s&p|\bdow\b|nasdaq|jobs report|tariff|powell",
    ),
    "ai-tools-llms": (
        "AI Tools & LLM Updates",
        '"large language model" OR LLM OR "generative AI" OR "AI model" OR "AI tool" OR "AI agent" OR OpenAI OR Anthropic',
        ("wire", "markets", "tech"),
        r"\bai\b|a\.i\.|\bllms?\b|language model|generative|openai|anthropic|chatgpt|gemini|claude|copilot|\bagents?\b|chatbot",
    ),
    "hedge-funds": (
        "Hedge Fund Shifts",
        '"hedge fund" OR "hedge funds" OR "multistrategy" OR "multi-strategy"',
        ("wire", "markets", "funds"),
        r"hedge[- ]funds?|multi-?strategy|citadel|millennium|bridgewater|point72|elliott|balyasny|two sigma|renaissance|d\.e\. shaw|pod shop",
    ),
    "private-equity": (
        "Private Equity Shifts",
        '"private equity" OR buyout OR "private credit" OR "private markets"',
        ("wire", "markets", "funds"),
        r"private[- ]equity|buyouts?|private credit|private markets?|\blbo\b|blackstone|\bkkr\b|apollo|carlyle|\btpg\b|ares|secondaries|take-private|carve-out",
    ),
    "venture-capital": (
        "Venture Capital & AI Funding",
        '"venture capital" OR "funding round" OR "startup funding" OR "AI startup" OR "Series A" OR "Series B" OR "seed round"',
        ("wire", "markets", "tech", "funds"),
        r"venture capital|\bvcs?\b|startups?|funding round|raises \$|raised \$|\bseed (round|funding)"
        r"|series [a-f] (round|funding)|valuation|valued at|unicorn",
    ),
    "ai-innovation": (
        "AI Field Innovation",
        '"AI breakthrough" OR "AI research" OR "AI lab" OR "frontier model" OR "AI chip" OR "AI model"',
        ("wire", "markets", "tech"),
        r"\bai\b|artificial intelligence|chips?\b|\bgpus?\b|nvidia|\bmodels?\b|research|\blabs?\b|deepseek|robot|breakthrough|superintelligence|agi\b",
    ),
}

# Titles that are pages, not articles ("52-Week Highs & Lows | Market Data
# Center", a site's own homepage).
NOT_AN_ARTICLE = re.compile(
    r"market data|52-week|stock market news|financial news|opinion, news|news, analysis|homepage"
    r"|stock price|stock quote|^[^ ]+$",
    re.I,
)
# Opinion columns are left out: Intel is for reporting.
OPINION = re.compile(r"^\s*opinion\b|\bopinion \||\| opinion\b|^commentary:", re.I)


def enabled_sources() -> list[dict]:
    return (
        get_supabase_client().table("intel_sources").select("domain,name,grp").eq("enabled", True).execute().data or []
    )


def _domain_of(url: str) -> str:
    host = urllib.parse.urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def _vetted_domain(url: str, domains: set[str]) -> str | None:
    """The vetted domain a source URL belongs to (subdomains count), if any."""
    host = _domain_of(url)
    for domain in domains:
        if host == domain or host.endswith("." + domain):
            return domain
    return None


def search(terms: str, domains: list[str], window: str = WINDOW, names: dict[str, str] | None = None) -> list[dict]:
    """Google News search for `terms`, limited to `domains`. Never raises."""
    if not domains:
        return []
    sites = " OR ".join(f"site:{d}" for d in domains)
    query = f"({terms}) ({sites}) when:{window}"
    url = f"{GOOGLE_NEWS}?{urllib.parse.urlencode({'q': query, 'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'})}"
    try:
        res = httpx.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0 (Jarvis Intel)"})
        if not res.is_success:
            logger.warning("intel search %s: HTTP %s", terms[:40], res.status_code)
            return []
        root = ET.fromstring(res.content)
    except Exception:  # noqa: BLE001 — one failed search is one empty group
        logger.warning("intel search failed", exc_info=True)
        return []

    vetted = set(domains)
    items = []
    for item in root.iter("item"):
        source = item.find("source")
        source_name = (source.text or "").strip() if source is not None else ""
        domain = _vetted_domain(source.get("url", "") if source is not None else "", vetted)
        if not domain:
            continue  # Google strayed outside the vetted list
        title = (item.findtext("title") or "").strip()
        suffix = f" - {source_name}"
        if source_name and title.endswith(suffix):
            title = title[: -len(suffix)].strip()
        try:
            published = parsedate_to_datetime(item.findtext("pubDate") or "").astimezone(timezone.utc)
        except Exception:  # noqa: BLE001
            published = None
        items.append(
            {
                "title": title,
                "url": (item.findtext("link") or "").strip(),
                # The vetted list's name ("Bloomberg"), not Google's ("bloomberg.com").
                "source": (names or {}).get(domain) or source_name or domain,
                "domain": domain,
                "published_at": published,
            }
        )
    return items


def pick(items: list[dict], pattern: str, groups_of: dict[str, str], limit: int = PER_CATEGORY) -> list[dict]:
    """Newest first, headline about the category, no repeats, at most two per
    outlet, and every searched group represented before any gets a third."""
    about = re.compile(pattern, re.I)
    seen_titles: set[str] = set()
    candidates = []
    for item in sorted(items, key=lambda i: i["published_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
        key = re.sub(r"\W+", " ", item["title"].lower()).strip()
        title = item["title"]
        if not item["url"] or key in seen_titles or NOT_AN_ARTICLE.search(title) or OPINION.search(title):
            continue
        if not about.search(title):
            continue
        seen_titles.add(key)
        candidates.append(item)

    chosen: list[dict] = []
    per_source: dict[str, int] = {}
    # First pass: the newest from each group, so the wires cannot crowd out
    # the market and trade outlets.
    for group in dict.fromkeys(groups_of[c["domain"]] for c in candidates):
        first = next((c for c in candidates if groups_of[c["domain"]] == group), None)
        if first and len(chosen) < limit:
            chosen.append(first)
            per_source[first["domain"]] = 1
    for c in candidates:
        if len(chosen) >= limit:
            break
        if c in chosen or per_source.get(c["domain"], 0) >= MAX_PER_SOURCE:
            continue
        chosen.append(c)
        per_source[c["domain"]] = per_source.get(c["domain"], 0) + 1
    return sorted(chosen, key=lambda i: i["published_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)


def refresh_intel() -> dict:
    """Every category, searched and stored. A category whose search comes back
    empty keeps what it had."""
    sources = enabled_sources()
    groups_of = {s["domain"]: s["grp"] for s in sources}
    names = {s["domain"]: s["name"] for s in sources}
    by_group: dict[str, list[str]] = {}
    for s in sources:
        by_group.setdefault(s["grp"], []).append(s["domain"])

    client = get_supabase_client()
    counts = {}
    for category, (_label, terms, groups, pattern) in CATEGORIES.items():
        found: list[dict] = []
        for group in groups:
            found.extend(search(terms, by_group.get(group, []), names=names))
            time.sleep(0.5)  # polite to Google News between searches
        chosen = pick(found, pattern, groups_of)
        counts[category] = len(chosen)
        if not chosen:
            continue
        fetched = datetime.now(timezone.utc).isoformat()
        client.table("intel_articles").delete().eq("category", category).execute()
        client.table("intel_articles").insert(
            [
                {
                    "category": category,
                    "title": c["title"][:400],
                    "url": c["url"],
                    "source": c["source"][:120],
                    "domain": c["domain"],
                    "published_at": c["published_at"].isoformat() if c["published_at"] else None,
                    "fetched_at": fetched,
                }
                for c in chosen
            ]
        ).execute()
    return {"ok": True, "articles": counts}


def _shape(row: dict) -> dict:
    return {
        "title": row["title"],
        "url": row["url"],
        "source": row["source"],
        "published_at": row.get("published_at"),
    }


def stored_intel() -> dict:
    """What the last refresh stored, by category, newest first."""
    rows = (
        get_supabase_client()
        .table("intel_articles")
        .select("category,title,url,source,published_at,fetched_at")
        .order("published_at", desc=True)
        .execute()
        .data
        or []
    )
    categories = {cid: [] for cid in CATEGORIES}
    fetched = None
    for row in rows:
        if row["category"] in categories:
            categories[row["category"]].append(_shape(row))
            fetched = max(fetched or row["fetched_at"], row["fetched_at"])
    return {"ok": True, "categories": categories, "fetched_at": fetched}


def search_vetted(query: str, limit: int = 8) -> list[dict]:
    """An ad-hoc search ("news on Nvidia"), across every vetted outlet: one
    search per group, newest first, at most two per outlet."""
    sources = enabled_sources()
    by_group: dict[str, list[str]] = {}
    for s in sources:
        by_group.setdefault(s["grp"], []).append(s["domain"])
    names = {s["domain"]: s["name"] for s in sources}
    found: list[dict] = []
    for domains in by_group.values():
        found.extend(search(query, domains, names=names))
    groups_of = {s["domain"]: s["grp"] for s in sources}
    return [_shape({**c, "published_at": c["published_at"].isoformat() if c["published_at"] else None}) for c in pick(found, r".", groups_of, limit)]


_refreshing = threading.Lock()


def refresh_in_background() -> None:
    """A refresh on its own thread, unless one is already running."""

    def run() -> None:
        if not _refreshing.acquire(blocking=False):
            return
        try:
            refresh_intel()
        except Exception:  # noqa: BLE001 — the next refresh tries again
            logger.warning("intel refresh failed", exc_info=True)
        finally:
            _refreshing.release()

    threading.Thread(target=run, name="intel-refresh", daemon=True).start()
