from fastapi import APIRouter, Depends

from app.core.auth import require_access_token
from app.tools.market_analysis import market_analysis
from app.tools.market_history import market_history
from app.tools.news_feed import news_feed
from app.tools.portfolio import portfolio

# Direct REST access to the same tool functions Jarvis's agent loop calls —
# no Groq round-trip, no token cost. Lets a tab (Markets/News/Portfolio)
# show real data the instant it's opened, without asking Jarvis anything
# first. These tool functions already never raise ({"ok": False, ...} on
# failure), so no extra error handling is needed here.
router = APIRouter(prefix="/panels", dependencies=[Depends(require_access_token)])


@router.get("/market")
def panel_market() -> dict:
    return market_analysis({})


@router.get("/market/history")
def panel_market_history(symbol: str, range: str = "1M") -> dict:  # noqa: A002 — the query parameter's name
    return market_history({"symbol": symbol, "range": range})


@router.get("/news")
def panel_news(query: str | None = None) -> dict:
    return news_feed({"query": query} if query else {})


@router.get("/portfolio")
def panel_portfolio() -> dict:
    return portfolio({})
