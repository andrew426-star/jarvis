import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

from app.core.config import get_settings

# Price history for the Markets panel's chart and for Jarvis: stocks and
# ETFs and crypto from Alpaca (the paper-trading keys `portfolio` already
# uses; Finnhub's free tier has no candles), fiat currency pairs from the
# ECB's daily reference rates (Frankfurter, no key). Ranges run from the
# last hour to the year so far, each at a bar size fine enough to read a
# move precisely.
#
# Two extras for "why does it look like that?":
#   explain_at   the move at a moment, and the company's headlines around
#                it (Finnhub company news), for Jarvis to reason from.
#   annotations  his explanations, pinned on the chart at their moments.
# The chart gets every bar; the model gets a summary (see `summary`), since
# hundreds of bars would only be truncated on the way to it.

ALPACA_DATA = "https://data.alpaca.markets"
FINNHUB = "https://finnhub.io/api/v1"
FRANKFURTER = "https://api.frankfurter.app"
MARKET_TZ = ZoneInfo("America/New_York")

# range -> (bar size, how far back to look). Intraday ranges look further
# back than they show, so a weekend or holiday still finds the last session.
RANGES: dict[str, tuple[str, timedelta]] = {
    "1H": ("1Min", timedelta(days=5)),
    "1D": ("5Min", timedelta(days=5)),
    "1W": ("30Min", timedelta(days=7)),
    "1M": ("1Hour", timedelta(days=31)),
    "1Y": ("1Day", timedelta(days=366)),
    "YTD": ("1Day", timedelta(0)),  # from 1 January, worked out per call
}
INTRADAY = {"1H", "1D", "1W", "1M"}

CRYPTO = {
    "BTC", "ETH", "SOL", "DOGE", "LTC", "XRP", "ADA", "AVAX", "LINK", "DOT", "BCH", "UNI",
    "SHIB", "AAVE", "MATIC", "XTZ", "SUSHI", "GRT", "BAT", "CRV", "MKR", "YFI", "PEPE", "TRUMP",
}
FIAT = {
    "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "HKD", "SGD", "SEK", "NOK",
    "DKK", "PLN", "CZK", "HUF", "MXN", "BRL", "INR", "KRW", "ZAR", "TRY", "ILS", "THB", "IDR",
    "MYR", "PHP", "RON", "ISK", "BGN",
}

MAX_HEADLINES = 8
MAX_ANNOTATIONS = 6

MARKET_HISTORY_SCHEMA = {
    "type": "function",
    "function": {
        "name": "market_history",
        "description": (
            "Price history for one stock, ETF, crypto coin or currency pair, drawn as a chart in the "
            "Markets panel (it opens there). range: 1H (1-minute bars), 1D (the last session, "
            "5-minute bars, against the previous close), 1W (30-minute), 1M (hourly), 1Y and YTD "
            "(daily). Currency pairs (EUR/USD, GBPJPY) have daily rates only: 1W, 1M, 1Y, YTD. "
            "You get a summary (open, close, change, high and low with their times, the biggest "
            "moves), not every bar. "
            "When Andrew asks WHY it looks the way it does at some point (a drop, a spike, a gap): "
            "1) call with explain_at set to that moment: you get the move there and the company's "
            "headlines from around it; use web_research too if those do not explain it. "
            "2) call again with the same symbol and range and `annotations`: one per moment worth "
            "explaining, each a short title and a one- or two-sentence reason, grounded in what you "
            "found. They are pinned on the chart at those moments for him to read. Do not invent a "
            "cause: if nothing explains a move, say so in the note."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "One symbol: 'AAPL', 'SPY', 'BTC' or 'BINANCE:BTCUSDT', 'EUR/USD'.",
                },
                "range": {"type": "string", "enum": list(RANGES)},
                "explain_at": {
                    "type": "string",
                    "description": "A moment to explain: a date ('2026-09-12') or date and time "
                    "('2026-09-12 10:30', US Eastern for stocks).",
                },
                "annotations": {
                    "type": "array",
                    "description": "Explanations to pin on the chart.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "at": {"type": "string", "description": "The moment, as for explain_at."},
                            "title": {"type": "string", "description": "A few words: 'Earnings beat'."},
                            "note": {"type": "string", "description": "Why, in one or two sentences."},
                            "source": {"type": "string", "description": "A URL backing it, if any."},
                        },
                        "required": ["at", "title", "note"],
                    },
                },
            },
            "required": ["symbol"],
        },
    },
}


class HistoryError(Exception):
    pass


# ---- symbols


def classify(raw: str) -> tuple[str, str, str]:
    """(asset class, the symbol the data source wants, the display symbol)."""
    symbol = raw.strip().upper()
    if ":" in symbol:  # Finnhub style, as the watchlist has: BINANCE:BTCUSDT
        exchange, symbol = symbol.split(":", 1)
        if exchange in ("NASDAQ", "NYSE", "AMEX", "ARCA", "BATS"):
            return "stock", symbol, symbol
    # The shortest base first, so BTCUSDT splits as BTC + USDT, not BTCU + SDT.
    pair = re.fullmatch(r"([A-Z]{2,6}?)[/\-]?(USDT|USDC|USD|[A-Z]{3})?", symbol)
    if pair:
        base, quote = pair.group(1), pair.group(2)
        if base in CRYPTO or (quote in ("USDT", "USDC") and base not in FIAT):
            return "crypto", f"{base}/USD", f"{base}/USD"
        if base in FIAT and (quote in FIAT or (quote is None and base != "USD")):
            quote = quote or "USD"
            if quote != base:
                return "fx", f"{base}/{quote}", f"{base}/{quote}"
        # A six-letter run like EURUSD with no separator.
        if quote is None and len(base) == 6 and base[:3] in FIAT and base[3:] in FIAT:
            return "fx", f"{base[:3]}/{base[3:]}", f"{base[:3]}/{base[3:]}"
    return "stock", symbol, symbol


# ---- time


def _range_start(rng: str, now: datetime) -> datetime:
    if rng == "YTD":
        jan1 = datetime(now.astimezone(MARKET_TZ).year, 1, 1, tzinfo=MARKET_TZ)
        return jan1.astimezone(timezone.utc)
    return now - RANGES[rng][1]


def parse_moment(text: str, asset: str) -> datetime | None:
    """'2026-09-12', '2026-09-12 10:30', ISO with or without a zone. A bare
    time is market time (US Eastern) for stocks, UTC otherwise."""
    text = (text or "").strip().replace("T", " ").replace("Z", "+00:00")
    if not text:
        return None
    zone = MARKET_TZ if asset == "stock" else timezone.utc
    for fmt in ("%Y-%m-%d %H:%M:%S%z", "%Y-%m-%d %H:%M%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            moment = datetime.strptime(text, fmt)
        except ValueError:
            continue
        if moment.tzinfo is None:
            if fmt == "%Y-%m-%d" and asset == "stock":
                moment = moment.replace(hour=16)  # a day means its close
            moment = moment.replace(tzinfo=zone)
        return moment.astimezone(timezone.utc)
    return None


# ---- data sources


def _alpaca_headers() -> dict:
    settings = get_settings()
    return {"APCA-API-KEY-ID": settings.alpaca_api_key_id, "APCA-API-SECRET-KEY": settings.alpaca_secret_key}


def _bar(b: dict) -> dict:
    return {"t": b["t"], "open": b["o"], "high": b["h"], "low": b["l"], "close": b["c"], "volume": b.get("v", 0)}


def _stock_bars(symbol: str, timeframe: str, start: datetime, end: datetime, feed: str | None = None) -> list[dict]:
    bars: list[dict] = []
    params: dict = {
        "timeframe": timeframe,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "limit": 10000,
        "adjustment": "split",
    }
    if feed:
        params["feed"] = feed
    while True:
        res = httpx.get(f"{ALPACA_DATA}/v2/stocks/{symbol}/bars", params=params, headers=_alpaca_headers(), timeout=20)
        if not res.is_success:
            raise HistoryError(res.json().get("message", res.text) if res.headers.get("content-type", "").startswith("application/json") else res.text)
        data = res.json()
        bars.extend(_bar(b) for b in data.get("bars") or [])
        token = data.get("next_page_token")
        if not token or len(bars) > 20000:
            return bars
        params["page_token"] = token


def stock_bars(symbol: str, timeframe: str, start: datetime, now: datetime) -> list[dict]:
    """Consolidated (SIP) bars, which the free plan serves up to 15 minutes
    ago, with the last 15 minutes filled from IEX, which it serves live.
    Daily bars are SIP throughout: today's is filled in tomorrow."""
    if timeframe == "1Day":
        return _stock_bars(symbol, timeframe, start, now - timedelta(minutes=16))
    cutoff = now - timedelta(minutes=16)
    bars = _stock_bars(symbol, timeframe, start, cutoff) if cutoff > start else []
    try:
        tail = _stock_bars(symbol, timeframe, cutoff, now, feed="iex")
    except HistoryError:
        tail = []
    last = bars[-1]["t"] if bars else ""
    return bars + [b for b in tail if b["t"] > last]


def crypto_bars(symbol: str, timeframe: str, start: datetime, now: datetime) -> list[dict]:
    bars: list[dict] = []
    params: dict = {"symbols": symbol, "timeframe": timeframe, "start": start.isoformat(), "end": now.isoformat(), "limit": 10000}
    while True:
        res = httpx.get(f"{ALPACA_DATA}/v1beta3/crypto/us/bars", params=params, timeout=20)
        if not res.is_success:
            raise HistoryError(res.text)
        data = res.json()
        bars.extend(_bar(b) for b in (data.get("bars") or {}).get(symbol, []))
        token = data.get("next_page_token")
        if not token or len(bars) > 20000:
            return bars
        params["page_token"] = token


def fx_bars(pair: str, start: datetime, now: datetime) -> list[dict]:
    base, quote = pair.split("/")
    res = httpx.get(
        f"{FRANKFURTER}/{start.date().isoformat()}..{now.date().isoformat()}",
        params={"from": base, "to": quote},
        timeout=20,
        follow_redirects=True,
    )
    if not res.is_success:
        raise HistoryError(res.text)
    rates = res.json().get("rates") or {}
    bars = []
    for day in sorted(rates):
        rate = rates[day].get(quote)
        if rate is None:
            continue
        # One reference rate a day: open, high, low and close are all it.
        bars.append({"t": f"{day}T16:00:00Z", "open": rate, "high": rate, "low": rate, "close": rate, "volume": 0})
    return bars


BAR_LENGTH = {"1Min": 1, "5Min": 5, "30Min": 30, "1Hour": 60}


def regular_hours(bars: list[dict], timeframe: str) -> list[dict]:
    """Only bars that overlap the regular session, 9:30 to 16:00 Eastern.
    Pre-market and after-hours trade is thin and would set the day's
    reference to an after-hours price instead of the close."""
    length = timedelta(minutes=BAR_LENGTH.get(timeframe, 0))
    kept = []
    for b in bars:
        start = datetime.fromisoformat(b["t"].replace("Z", "+00:00")).astimezone(MARKET_TZ)
        opens = start.replace(hour=9, minute=30, second=0, microsecond=0)
        closes = start.replace(hour=16, minute=0, second=0, microsecond=0)
        if start + length > opens and start < closes:
            kept.append(b)
    return kept


def _last_session(bars: list[dict]) -> tuple[list[dict], float | None]:
    """The bars of the latest trading day (market time), and the close of
    the session before it."""
    if not bars:
        return [], None
    day = lambda b: datetime.fromisoformat(b["t"].replace("Z", "+00:00")).astimezone(MARKET_TZ).date()  # noqa: E731
    last_day = day(bars[-1])
    today = [b for b in bars if day(b) == last_day]
    before = [b for b in bars if day(b) < last_day]
    return today, (before[-1]["close"] if before else None)


def load_bars(raw_symbol: str, rng: str) -> dict:
    asset, symbol, display = classify(raw_symbol)
    rng = rng if rng in RANGES else "1M"
    now = datetime.now(timezone.utc)
    timeframe = RANGES[rng][0]
    start = _range_start(rng, now)
    reference = None

    if asset == "fx":
        if rng in ("1H", "1D"):
            raise HistoryError(f"{display} has daily rates only: use 1W, 1M, 1Y or YTD.")
        bars = fx_bars(symbol, start, now)
        timeframe = "1Day"
    elif asset == "crypto":
        # Crypto trades around the clock: no sessions to look back past.
        if rng == "1H":
            start = now - timedelta(hours=2)
        elif rng == "1D":
            start = now - timedelta(hours=25)
        bars = crypto_bars(symbol, timeframe, start, now)
        if rng == "1H":
            bars = bars[-60:]
        elif rng == "1D":
            cutoff = (now - timedelta(days=1)).isoformat()
            earlier = [b for b in bars if b["t"] < cutoff]
            reference = earlier[-1]["close"] if earlier else None
            bars = [b for b in bars if b["t"] >= cutoff]
    else:
        bars = stock_bars(symbol, timeframe, start, now)
        if timeframe != "1Day":
            bars = regular_hours(bars, timeframe)
        if rng == "1D":
            bars, reference = _last_session(bars)
        elif rng == "1H":
            bars = _last_session(bars)[0][-60:]

    if not bars:
        raise HistoryError(f"No price history for {display}. Check the symbol.")
    return {
        "asset_class": asset,
        "symbol": display,
        "range": rng,
        "timeframe": timeframe,
        "candles": bars,
        # What the change is measured against: the previous close for a
        # day, otherwise where the range opened.
        "reference": reference if reference is not None else bars[0]["open"],
        "delayed_note": "Daily bars end at yesterday's close." if timeframe == "1Day" and asset == "stock" else None,
    }


# ---- what the model sees


def _nearest(bars: list[dict], moment: datetime) -> int:
    stamp = moment.isoformat()
    best, gap = 0, None
    for i, b in enumerate(bars):
        d = abs((datetime.fromisoformat(b["t"].replace("Z", "+00:00")) - moment).total_seconds())
        if gap is None or d < gap:
            best, gap = i, d
        if b["t"] > stamp and gap is not None and d > gap:
            break
    return best


def _pct(a: float, b: float) -> float | None:
    return round((b - a) / a * 100, 2) if a else None


def summarize(data: dict) -> dict:
    bars = data["candles"]
    ref = data["reference"]
    last = bars[-1]
    high = max(bars, key=lambda b: b["high"])
    low = min(bars, key=lambda b: b["low"])
    steps = [
        {"t": bars[i]["t"], "from": bars[i - 1]["close"], "to": bars[i]["close"], "pct": _pct(bars[i - 1]["close"], bars[i]["close"])}
        for i in range(1, len(bars))
    ]
    biggest = sorted((s for s in steps if s["pct"] is not None), key=lambda s: abs(s["pct"]), reverse=True)[:5]
    return {
        "bars": len(bars),
        "first": bars[0]["t"],
        "last": last["t"],
        "reference": ref,
        "close": last["close"],
        "change_pct": _pct(ref, last["close"]),
        "high": {"price": high["high"], "t": high["t"]},
        "low": {"price": low["low"], "t": low["t"]},
        "biggest_moves": biggest,
    }


def _company_name(symbol: str) -> str | None:
    try:
        res = httpx.get(f"{FINNHUB}/stock/profile2", params={"symbol": symbol, "token": get_settings().finnhub_api_key}, timeout=10)
        return (res.json() or {}).get("name") if res.is_success else None
    except Exception:  # noqa: BLE001 — the name only sharpens the headline filter
        return None


def headlines_around(symbol: str, moment: datetime) -> list[dict]:
    """The company's own news from two days before the moment to one after,
    nearest first; only items that name the company or ticker (Finnhub's
    company feed mixes in anything that mentions it in passing)."""
    day = moment.astimezone(MARKET_TZ).date()
    res = httpx.get(
        f"{FINNHUB}/company-news",
        params={
            "symbol": symbol,
            "from": (day - timedelta(days=2)).isoformat(),
            "to": (day + timedelta(days=1)).isoformat(),
            "token": get_settings().finnhub_api_key,
        },
        timeout=15,
    )
    items = res.json() if res.is_success else []
    if not isinstance(items, list):
        return []
    name = _company_name(symbol) or ""
    stem = re.sub(r"\b(inc|corp|corporation|co|ltd|plc|holdings|group|class [a-z])\b\.?", "", name, flags=re.I).strip(" ,.")
    keys = [k.lower() for k in (symbol, stem, stem.split(" ")[0] if stem else "") if k and len(k) > 1]
    target = moment.timestamp()
    picked = []
    for item in items:
        text = f"{item.get('headline', '')} {item.get('summary', '')}".lower()
        if keys and not any(re.search(rf"\b{re.escape(k)}\b", text) for k in keys):
            continue
        picked.append(item)
    picked.sort(key=lambda i: abs((i.get("datetime") or 0) - target))
    return [
        {
            "headline": i.get("headline"),
            "source": i.get("source"),
            "at": datetime.fromtimestamp(i.get("datetime") or 0, timezone.utc).isoformat(),
            "summary": (i.get("summary") or "")[:280],
            "url": i.get("url"),
        }
        for i in picked[:MAX_HEADLINES]
    ]


def explain(data: dict, moment: datetime) -> dict:
    bars = data["candles"]
    i = _nearest(bars, moment)
    bar = bars[i]
    window = bars[max(0, i - 6) : i + 7]
    context: dict = {
        "at": bar["t"],
        "bar": bar,
        "change_from_previous_bar_pct": _pct(bars[i - 1]["close"], bar["close"]) if i else None,
        "change_from_range_start_pct": _pct(data["reference"], bar["close"]),
        "around": [{"t": b["t"], "close": b["close"]} for b in window],
    }
    if data["asset_class"] == "stock":
        try:
            context["headlines"] = headlines_around(data["symbol"], moment)
        except Exception as exc:  # noqa: BLE001 — the move is still worth having
            context["headlines_error"] = str(exc)
    else:
        context["headlines"] = []
        context["note"] = "No company news for currencies or crypto: use web_research for this moment."
    return context


def _annotations(raw: list, data: dict) -> list[dict]:
    """Each explanation tied to the bar nearest its moment, so the chart can
    pin it there. Ones outside the range shown are dropped."""
    bars = data["candles"]
    first = datetime.fromisoformat(bars[0]["t"].replace("Z", "+00:00"))
    last = datetime.fromisoformat(bars[-1]["t"].replace("Z", "+00:00"))
    slack = timedelta(days=1)
    pinned = []
    for item in raw[:MAX_ANNOTATIONS]:
        if not isinstance(item, dict):
            continue
        moment = parse_moment(str(item.get("at") or ""), data["asset_class"])
        if not moment or moment < first - slack or moment > last + slack:
            continue
        bar = bars[_nearest(bars, moment)]
        pinned.append(
            {
                "t": bar["t"],
                "price": bar["close"],
                "title": str(item.get("title") or "")[:60],
                "note": str(item.get("note") or "")[:400],
                "source": str(item.get("source") or "")[:500] or None,
            }
        )
    return pinned


def market_history(args: dict) -> dict:
    raw = str(args.get("symbol") or "").strip()
    if not raw:
        return {"ok": False, "error": "symbol is required"}
    rng = str(args.get("range") or "").upper()
    if rng not in RANGES:
        # Older callers (and the panel before ranges) asked in days.
        days = int(args.get("days") or 30)
        rng = "1W" if days <= 7 else "1M" if days <= 31 else "1Y"
    try:
        data = load_bars(raw, rng)
    except HistoryError as exc:
        return {"ok": False, "symbol": raw.upper(), "range": rng, "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "symbol": raw.upper(), "range": rng, "error": str(exc)}

    result = {"ok": True, **data, "summary": summarize(data)}
    if args.get("explain_at"):
        moment = parse_moment(str(args["explain_at"]), data["asset_class"])
        if moment is None:
            result["explain_error"] = "explain_at should look like 2026-09-12 or 2026-09-12 10:30."
        else:
            result["explain"] = explain(data, moment)
    if args.get("annotations"):
        result["annotations"] = _annotations(list(args["annotations"]), data)
    return result

