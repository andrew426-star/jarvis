import httpx

from app.core.config import get_settings

TAVILY_BASE = "https://api.tavily.com"


def _ok(query: str, results: list[dict]) -> dict:
    return {"ok": True, "query": query, "results": results}


def _err(query: str, message: str) -> dict:
    return {"ok": False, "query": query, "error": message}


def web_research(args: dict) -> dict:
    query = str(args.get("query") or "").strip()
    # The model occasionally calls this without filling in the query arg
    # despite it being required — Tavily 400s on an empty query, so treat
    # it as "no results" instead (mirrors kiv-console's src/lib/ai/web-search.ts).
    if not query:
        return _ok(query, [])

    try:
        res = httpx.post(
            f"{TAVILY_BASE}/search",
            headers={"Authorization": f"Bearer {get_settings().tavily_api_key}"},
            json={"query": query, "max_results": 5},
            timeout=20.0,
        )
        res.raise_for_status()
        data = res.json()
        results = [
            {"title": r.get("title"), "url": r.get("url"), "content": r.get("content")}
            for r in data.get("results", [])
        ]
        return _ok(query, results)
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return _err(query, str(exc))
