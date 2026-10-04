from datetime import datetime, timedelta, timezone

from app.services import market_updates as mu
from app.tools import trade_signals as ts

NOW = datetime(2026, 10, 3, 1, 0, tzinfo=timezone.utc)


def signal(symbol, confidence, approved, minutes_ago=0, direction="long", entry=100.0, stop=95.0, target=107.5, **extra):
    return {
        "id": f"{symbol}-{confidence}-{minutes_ago}",
        "symbol": symbol,
        "asset_class": "stocks",
        "strategy_id": "momentum",
        "direction": direction,
        "confidence": confidence,
        "entry": entry,
        "stop": stop,
        "target": target,
        "rationale": ["close (100.00) above SMA(50) (95.00)"],
        "created_at": (NOW - timedelta(minutes=minutes_ago)).isoformat(),
        "trading_decisions": [{"approved": approved, "position_size_usd": 10000, "position_size_qty": 100}],
        **extra,
    }


def test_top_trades_are_the_latest_scans_approved_best_first(db):
    db.tables["trading_signals"] = [
        signal("NVDA", 0.51, True),
        signal("PALL", 0.68, True, direction="short", entry=21.27, stop=22.6, target=19.26),
        signal("NVDA", 0.40, True, minutes_ago=5),  # a second strategy on NVDA: one trade
        signal("AAPL", 0.90, False),  # rejected by the risk engine
        signal("MSFT", 0.95, True, minutes_ago=60 * 24),  # yesterday's scan
    ]
    result = ts.top_trades()
    assert [t["symbol"] for t in result["trades"]] == ["PALL", "NVDA"]
    assert result["trades"][0]["reward_to_risk"] == 1.51  # (21.27-19.26)/(22.6-21.27)
    assert result["scan_approved"] == 3 and result["note"]  # fewer than three trades is said


def test_names_and_reasoning_come_through_with_fallbacks(db):
    db.tables["trading_signals"] = [
        signal("PALL", 0.68, True, asset_name="Palladium (PALL ETF proxy)", summary="Palladium, through the PALL ETF...",
               sources=[{"kind": "data", "title": "PALL price chart", "publisher": "Yahoo Finance", "url": "u", "publishedAt": None}]),
        signal("NVDA", 0.5, True),
    ]
    pall, nvda = ts.top_trades()["trades"]
    assert pall["name"] == "Palladium (PALL ETF proxy)" and pall["summary"] and pall["sources"]
    assert nvda["name"] == "NVDA" and nvda["summary"] is None and nvda["sources"] == []


def run_updates(db, monkeypatch, trades, quotes):
    monkeypatch.setattr(mu, "top_trades", lambda: {"trades": trades, "scan_at": "scan-1"})
    monkeypatch.setattr(mu, "quote", lambda symbol: quotes.get(symbol))
    pushed = []
    monkeypatch.setattr(mu, "announce", lambda items: pushed.extend(items))
    out = mu.run_market_updates()
    return out["filed"], pushed


TRADE = {"id": "t1", "symbol": "NVDA", "name": "Nvidia", "direction": "long", "confidence": 0.5,
         "entry": 100.0, "stop": 95.0, "target": 110.0}


def test_a_new_scan_target_and_moves_are_each_filed_once(db, monkeypatch):
    quotes = {"NVDA": {"c": 111.0, "dp": 4.2, "pc": 106.5}, "SPY": {"c": 700, "dp": 0.4, "pc": 697}}
    filed, pushed = run_updates(db, monkeypatch, [TRADE], quotes)
    assert filed == ["New K.I.V. scan: Nvidia long", "Nvidia hit its target", "Nvidia up 4.2% today"]
    assert [p["priority"] for p in pushed] == ["normal", "high", "normal"]
    again, _ = run_updates(db, monkeypatch, [TRADE], quotes)
    assert again == []


def test_short_stops_and_index_thresholds(db, monkeypatch):
    short = {**TRADE, "id": "t2", "symbol": "PALL", "name": "Palladium (PALL ETF proxy)", "direction": "short",
             "entry": 21.0, "stop": 22.6, "target": 19.0}
    quotes = {"PALL": {"c": 22.7, "dp": 1.0, "pc": 22.5}, "SPY": {"c": 700, "dp": -2.6, "pc": 718}, "QQQ": {"c": 500, "dp": -1.2, "pc": 506}}
    filed, pushed = run_updates(db, monkeypatch, [short], quotes)
    assert "Palladium hit its stop" in filed
    assert "S&P 500 (SPY) down 2.6% today" in filed
    assert not any("QQQ" in f for f in filed)  # 1.2% is under the index threshold
    spy = next(p for p in pushed if "SPY" in p["title"])
    assert spy["priority"] == "high" and spy["topic"] == "markets"


def test_crypto_needs_a_bigger_move(db, monkeypatch):
    quotes = {"BINANCE:BTCUSDT": {"c": 90000, "dp": 4.0, "pc": 86500}, "BINANCE:ETHUSDT": {"c": 3000, "dp": -5.5, "pc": 3175}}
    filed, _ = run_updates(db, monkeypatch, [], quotes)
    assert filed == ["Ethereum down 5.5% today"]


def test_finnhub_symbols():
    assert mu.finnhub_symbol("SOL/USD") == "BINANCE:SOLUSDT"
    assert mu.finnhub_symbol("NVDA") == "NVDA"
