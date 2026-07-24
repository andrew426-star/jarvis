from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import get_settings

ALPACA_DATA_BASE = "https://data.alpaca.markets"


# Finnhub's free tier (the key this project already has) has no candle/
# history access at all — confirmed live, both /stock/candle and
# /crypto/candle return "You don't have access to this resource." Alpaca's
# existing paper-trading credentials (already in use for `portfolio`) do
# have free historical bar access, so this uses that instead. Scoped to
# equities/ETFs — Alpaca's crypto-bars endpoint uses a different symbol
# format and isn't worth the added complexity here.
def market_history(args: dict) -> dict:
    symbol = str(args.get("symbol") or "").upper().strip()
    days = int(args.get("days") or 30)
    if not symbol:
        return {"ok": False, "error": "symbol is required"}

    settings = get_settings()
    headers = {
        "APCA-API-KEY-ID": settings.alpaca_api_key_id,
        "APCA-API-SECRET-KEY": settings.alpaca_secret_key,
    }
    start = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    try:
        res = httpx.get(
            f"{ALPACA_DATA_BASE}/v2/stocks/{symbol}/bars",
            params={"timeframe": "1Day", "start": start, "limit": days + 5},
            headers=headers,
            timeout=15.0,
        )
        if not res.is_success:
            return {"ok": False, "symbol": symbol, "error": res.text}

        bars = res.json().get("bars") or []
        if not bars:
            return {"ok": False, "symbol": symbol, "error": f"No historical data for {symbol}"}

        candles = [
            {
                "date": b["t"][:10],
                "open": b["o"],
                "high": b["h"],
                "low": b["l"],
                "close": b["c"],
                "volume": b["v"],
            }
            for b in bars
        ]
        return {"ok": True, "symbol": symbol, "candles": candles}
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "symbol": symbol, "error": str(exc)}
