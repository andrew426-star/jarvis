from datetime import datetime, timezone

import pytest

from app.tools import market_history as mh


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("AAPL", ("stock", "AAPL", "AAPL")),
        ("spy", ("stock", "SPY", "SPY")),
        ("BINANCE:BTCUSDT", ("crypto", "BTC/USD", "BTC/USD")),
        ("BINANCE:ETHUSDT", ("crypto", "ETH/USD", "ETH/USD")),
        ("BTC", ("crypto", "BTC/USD", "BTC/USD")),
        ("sol/usd", ("crypto", "SOL/USD", "SOL/USD")),
        ("EUR/USD", ("fx", "EUR/USD", "EUR/USD")),
        ("GBPJPY", ("fx", "GBP/JPY", "GBP/JPY")),
        ("EUR", ("fx", "EUR/USD", "EUR/USD")),
        ("NASDAQ:LINK", ("stock", "LINK", "LINK")),
        ("MA", ("stock", "MA", "MA")),
        ("V", ("stock", "V", "V")),
    ],
)
def test_classify(raw, expected):
    assert mh.classify(raw) == expected


def _bar(t: str, close: float, high=None, low=None, volume=100):
    return {"t": t, "open": close, "high": high or close, "low": low or close, "close": close, "volume": volume}


def test_regular_hours_keeps_only_the_session():
    bars = [
        _bar("2026-10-02T12:55:00Z", 1),  # 08:55 ET, pre-market
        _bar("2026-10-02T13:30:00Z", 2),  # 09:30 ET, the open
        _bar("2026-10-02T19:55:00Z", 3),  # 15:55 ET, the last 5-minute bar
        _bar("2026-10-02T20:00:00Z", 4),  # 16:00 ET, after the close
    ]
    assert [b["close"] for b in mh.regular_hours(bars, "5Min")] == [2, 3]
    # An hourly bar from 09:00 overlaps the open, so it counts.
    assert [b["close"] for b in mh.regular_hours([_bar("2026-10-02T13:00:00Z", 9)], "1Hour")] == [9]


def test_last_session_and_previous_close():
    bars = [
        _bar("2026-10-01T19:55:00Z", 100),
        _bar("2026-10-02T13:30:00Z", 101),
        _bar("2026-10-02T19:55:00Z", 103),
    ]
    today, previous = mh._last_session(bars)
    assert [b["close"] for b in today] == [101, 103]
    assert previous == 100


def test_summary_measures_from_the_reference():
    data = {
        "candles": [
            _bar("2026-10-02T13:30:00Z", 100, high=101, low=99),
            _bar("2026-10-02T14:00:00Z", 110, high=112, low=100),
            _bar("2026-10-02T14:30:00Z", 105, high=111, low=104),
        ],
        "reference": 100.0,
    }
    s = mh.summarize(data)
    assert s["change_pct"] == 5.0
    assert s["high"] == {"price": 112, "t": "2026-10-02T14:00:00Z"}
    assert s["low"] == {"price": 99, "t": "2026-10-02T13:30:00Z"}
    assert s["biggest_moves"][0]["pct"] == 10.0


def test_moments_parse_in_market_time_for_stocks():
    assert mh.parse_moment("2026-09-22 10:30", "stock") == datetime(2026, 9, 22, 14, 30, tzinfo=timezone.utc)
    # A bare date means its close.
    assert mh.parse_moment("2026-09-22", "stock") == datetime(2026, 9, 22, 20, 0, tzinfo=timezone.utc)
    assert mh.parse_moment("2026-09-22T10:30:00Z", "crypto") == datetime(2026, 9, 22, 10, 30, tzinfo=timezone.utc)
    assert mh.parse_moment("next tuesday", "stock") is None


def test_annotations_pin_to_the_nearest_bar_and_drop_outside_the_range():
    data = {
        "asset_class": "stock",
        "candles": [_bar("2026-09-22T14:00:00Z", 10), _bar("2026-09-22T15:00:00Z", 11), _bar("2026-09-22T16:00:00Z", 12)],
    }
    pinned = mh._annotations(
        [
            {"at": "2026-09-22 11:20", "title": "Earnings", "note": "Beat."},
            {"at": "2025-01-01", "title": "Old", "note": "Out of range."},
            "not a dict",
        ],
        data,
    )
    assert [(p["t"], p["price"], p["title"]) for p in pinned] == [("2026-09-22T15:00:00Z", 11, "Earnings")]


def test_the_model_never_gets_the_bars():
    from app.services.orchestrator import _model_view

    shown = _model_view({"ok": True, "candles": [1, 2, 3], "summary": {"bars": 3}})
    assert "candles" not in shown and shown["summary"] == {"bars": 3}


def test_currency_pairs_refuse_intraday(monkeypatch):
    result = mh.market_history({"symbol": "EUR/USD", "range": "1D"})
    assert not result["ok"] and "daily rates only" in result["error"]
