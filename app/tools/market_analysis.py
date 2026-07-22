import httpx

from app.core.config import get_settings

FINNHUB_BASE = "https://finnhub.io/api/v1"

# Matches kiv-console's own default watchlist (src/lib/market/finnhub.ts).
DEFAULT_SYMBOLS = ["SPY", "QQQ", "AAPL", "NVDA", "BINANCE:BTCUSDT", "BINANCE:ETHUSDT"]


def market_analysis(args: dict) -> dict:
    symbols = args.get("symbols") or DEFAULT_SYMBOLS
    api_key = get_settings().finnhub_api_key

    quotes = []
    for symbol in symbols:
        try:
            res = httpx.get(
                f"{FINNHUB_BASE}/quote", params={"symbol": symbol, "token": api_key}, timeout=10.0
            )
            if not res.is_success:
                continue
            data = res.json()
            # Finnhub returns HTTP 200 with c:0 for an unknown symbol, not
            # an error status — skip it rather than reporting a fake quote.
            if not data.get("c"):
                continue
            quotes.append(
                {
                    "symbol": symbol,
                    "price": data["c"],
                    "change": data.get("d"),
                    "change_percent": data.get("dp"),
                }
            )
        except Exception:  # noqa: BLE001 — one bad symbol shouldn't fail the whole call
            continue

    return {"ok": True, "quotes": quotes}
