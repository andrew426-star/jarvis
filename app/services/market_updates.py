import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx

from app.core.config import get_settings
from app.core.supabase_client import get_supabase_client
from app.services.inbox import add_item, announce
from app.tools.market_analysis import DEFAULT_SYMBOLS
from app.tools.trade_signals import top_trades

# Market and trading-signal updates for the inbox, every 15 minutes
# (pg_cron, supabase/migrations/0012). Three kinds, each said once:
#
#   signals  a new K.I.V. scan landed: its top trades, by name.
#   signals  a top trade reached its target or its stop (urgent), or came
#            within 1% of its stop.
#   markets  a big move today: 3% on a stock or ETF, 5% on a coin, 1.5% on
#            SPY or QQQ (2.5% is urgent).
#
# What has been said is kept in jarvis_state, by trading day, so a quiet
# market files nothing and a loud one files each thing once.

logger = logging.getLogger(__name__)

FINNHUB = "https://finnhub.io/api/v1/quote"
MARKET_TZ = ZoneInfo("America/New_York")
STATE_KEY = "market_updates"

INDEXES = {"SPY", "QQQ"}
INDEX_MOVE, INDEX_URGENT = 1.5, 2.5
STOCK_MOVE = 3.0
CRYPTO_MOVE = 5.0
NEAR_STOP = 0.01

# Common names for the default watchlist (market_analysis.DEFAULT_SYMBOLS);
# the top trades bring their own from K.I.V.'s scan.
WATCHLIST_NAMES = {
    "SPY": "S&P 500 (SPY)",
    "QQQ": "Nasdaq 100 (QQQ)",
    "AAPL": "Apple",
    "NVDA": "Nvidia",
    "BINANCE:BTCUSDT": "Bitcoin",
    "BINANCE:ETHUSDT": "Ethereum",
}


def _state() -> dict:
    rows = get_supabase_client().table("jarvis_state").select("value").eq("key", STATE_KEY).limit(1).execute().data
    return rows[0]["value"] if rows else {}


def _save_state(value: dict) -> None:
    get_supabase_client().table("jarvis_state").upsert(
        {"key": STATE_KEY, "value": value, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).execute()


def finnhub_symbol(symbol: str) -> str:
    """K.I.V.'s SOL/USD is Finnhub's BINANCE:SOLUSDT; stocks pass as they are."""
    if "/" in symbol:
        base, _ = symbol.split("/", 1)
        return f"BINANCE:{base}USDT"
    return symbol


def quote(symbol: str) -> dict | None:
    try:
        res = httpx.get(
            FINNHUB, params={"symbol": finnhub_symbol(symbol), "token": get_settings().finnhub_api_key}, timeout=10
        )
        data = res.json() if res.is_success else {}
    except Exception:  # noqa: BLE001 — one missing quote is one skipped check
        return None
    return data if data.get("c") else None


def _name(symbol: str, names: dict[str, str]) -> str:
    """The common name ("Palladium"), or a readable symbol."""
    name = names.get(symbol)
    if name:
        # "Palladium (PALL ETF proxy)" reads as "Palladium"; index names keep theirs.
        return name if name.endswith("(SPY)") or name.endswith("(QQQ)") else name.split(" (")[0]
    return symbol.replace("BINANCE:", "").replace("USDT", "")


def _pct(n: float) -> str:
    return f"{'+' if n >= 0 else ''}{n:.1f}%"


def _price(n: float) -> str:
    return f"{n:,.2f}" if n >= 1 else f"{n:.4f}"


def run_market_updates() -> dict:
    state = _state()
    today = datetime.now(MARKET_TZ).date().isoformat()
    if state.get("day") != today:
        state = {"scan_at": state.get("scan_at"), "levels": state.get("levels", {}), "day": today, "moves": {}}
    filed: list[dict] = []

    def file(topic: str, title: str, body: str, priority: str = "normal", symbol: str | None = None) -> None:
        item = add_item("notice", title, body, priority, args={"symbol": symbol} if symbol else None, topic=topic)
        if item:
            filed.append(item)

    trades_result = top_trades()
    trades = trades_result.get("trades") or []
    names = {**WATCHLIST_NAMES, **{t["symbol"]: t.get("name") or t["symbol"] for t in trades}}

    # A new scan.
    scan_at = trades_result.get("scan_at")
    if trades and scan_at and scan_at != state.get("scan_at"):
        lines = [
            f"{i}. {_name(t['symbol'], names)} ({t['symbol']}) {t['direction']}, "
            f"{round(t['confidence'] * 100)}% confidence; entry {_price(t['entry'])}, "
            f"stop {_price(t['stop'])}, target {_price(t['target'])}."
            for i, t in enumerate(trades, 1)
        ]
        leaders = ", ".join(f"{_name(t['symbol'], names)} {t['direction']}" for t in trades[:3])
        file("signals", f"New K.I.V. scan: {leaders}", "\n".join(lines))
        state["scan_at"] = scan_at
        state["levels"] = {}

    # Top trades against their levels.
    quotes: dict[str, dict] = {}
    for t in trades:
        q = quote(t["symbol"])
        if not q or t.get("entry") is None:
            continue
        quotes[t["symbol"]] = q
        price, long = float(q["c"]), t["direction"] == "long"
        said = state["levels"].setdefault(t["id"], [])
        name = _name(t["symbol"], names)
        hit_target = price >= t["target"] if long else price <= t["target"]
        hit_stop = price <= t["stop"] if long else price >= t["stop"]
        near_stop = abs(price - t["stop"]) / t["stop"] <= NEAR_STOP
        if hit_target and "target" not in said:
            said.append("target")
            file(
                "signals",
                f"{name} hit its target",
                f"{name} ({t['symbol']}) is at {_price(price)}, past the {t['direction']} target of {_price(t['target'])}. "
                f"Entry was {_price(t['entry'])}.",
                "high",
                t["symbol"],
            )
        elif hit_stop and "stop" not in said:
            said.append("stop")
            file(
                "signals",
                f"{name} hit its stop",
                f"{name} ({t['symbol']}) is at {_price(price)}, through the {t['direction']} stop of {_price(t['stop'])}. "
                f"Entry was {_price(t['entry'])}.",
                "high",
                t["symbol"],
            )
        elif near_stop and not hit_stop and "near" not in said:
            said.append("near")
            file(
                "signals",
                f"{name} is nearing its stop",
                f"{name} ({t['symbol']}) is at {_price(price)}, within 1% of its stop at {_price(t['stop'])}.",
                "normal",
                t["symbol"],
            )

    # Big moves today.
    for symbol in dict.fromkeys([*DEFAULT_SYMBOLS, *(t["symbol"] for t in trades)]):
        q = quotes.get(symbol) or quote(symbol)
        if not q or q.get("dp") is None:
            continue
        move = float(q["dp"])
        crypto = "/" in symbol or symbol.startswith("BINANCE:")
        bare = symbol.replace("BINANCE:", "")
        threshold = INDEX_MOVE if bare in INDEXES else CRYPTO_MOVE if crypto else STOCK_MOVE
        direction = "up" if move > 0 else "down"
        key = f"{symbol}:{direction}"
        if abs(move) < threshold or key in state["moves"]:
            continue
        state["moves"][key] = move
        name = _name(symbol, names)
        urgent = bare in INDEXES and abs(move) >= INDEX_URGENT
        file(
            "markets",
            f"{name} {direction} {abs(move):.1f}% today",
            f"{name} is at {_price(float(q['c']))}, {_pct(move)} on the day (previous close {_price(float(q['pc']))}).",
            "high" if urgent else "normal",
            symbol,
        )

    _save_state(state)
    announce(filed)
    return {"ok": True, "filed": [f["title"] for f in filed]}
