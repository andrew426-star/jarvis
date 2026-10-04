from datetime import datetime, timedelta

from app.core.supabase_client import get_supabase_client

# The top recommended trades from K.I.V.'s algorithmic trading signals
# (kiv-console src/lib/trading/signals/generate.ts). Its daily scan runs
# every strategy over the universe, and its risk engine approves or rejects
# each signal (trading_signals, trading_decisions; same Supabase project).
# "Recommended" here is what that engine approved in the LATEST scan, best
# confidence first and one per symbol, so the list replaces itself whenever
# a new scan lands rather than piling up. Read-only: placing a trade stays
# in kiv-console.

MAX_TRADES = 5
# A scan writes its signals over a few minutes; anything within this of the
# newest signal belongs to the same scan.
SCAN_WINDOW = timedelta(hours=3)

TRADE_SIGNALS_SCHEMA = {
    "type": "function",
    "function": {
        "name": "trade_signals",
        "description": (
            "The top 3-5 recommended trades from K.I.V.'s algorithmic trading signals: what its "
            "latest daily scan found and its risk engine approved, best confidence first, with "
            "direction, entry, stop, target, position size and the strategy's reasoning. They also "
            "show in the Markets panel. Use for 'what are the top trades', 'what is the algo "
            "saying', or before discussing one of them. Read-only: trades are placed from K.I.V."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _rationale(raw) -> list[str]:
    """The strategy's reasoning as short lines, whatever shape it was stored in."""
    if not raw:
        return []
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, list):
        return [str(r) for r in raw if r][:6]
    if isinstance(raw, dict):
        lines = []
        for key, value in raw.items():
            if isinstance(value, (int, float)):
                value = round(value, 4)
            lines.append(f"{key.replace('_', ' ')}: {value}")
        return lines[:6]
    return [str(raw)]


def top_trades(limit: int = MAX_TRADES) -> dict:
    rows = (
        get_supabase_client()
        .table("trading_signals")
        .select(
            "id, symbol, asset_class, strategy_id, direction, confidence, entry, stop, target, rationale, "
            "created_at, trading_decisions(approved, reasons, position_size_usd, position_size_qty)"
        )
        .order("created_at", desc=True)
        .limit(400)
        .execute()
        .data
        or []
    )
    if not rows:
        return {"ok": True, "trades": [], "scan_at": None, "note": "No trading signals yet."}

    newest = _parse(rows[0]["created_at"])
    scan = [r for r in rows if newest - _parse(r["created_at"]) <= SCAN_WINDOW]
    approved = []
    for row in scan:
        decision = (row.get("trading_decisions") or [{}])[0]
        if decision.get("approved"):
            approved.append((row, decision))
    approved.sort(key=lambda pair: float(pair[0]["confidence"] or 0), reverse=True)

    trades, seen = [], set()
    for row, decision in approved:
        if row["symbol"] in seen:
            continue  # two strategies agreeing on a symbol is one trade
        seen.add(row["symbol"])
        entry, stop, target = (float(row[k]) if row.get(k) is not None else None for k in ("entry", "stop", "target"))
        risk = abs(entry - stop) if entry is not None and stop is not None else None
        reward = abs(target - entry) if entry is not None and target is not None else None
        trades.append(
            {
                "id": row["id"],
                "symbol": row["symbol"],
                "asset_class": row["asset_class"],
                "direction": row["direction"],
                "strategy": row["strategy_id"],
                "confidence": round(float(row["confidence"] or 0), 3),
                "entry": entry,
                "stop": stop,
                "target": target,
                "reward_to_risk": round(reward / risk, 2) if risk and reward is not None else None,
                "position_size_usd": float(decision.get("position_size_usd") or 0),
                "position_size_qty": float(decision.get("position_size_qty") or 0),
                "rationale": _rationale(row.get("rationale")),
                "created_at": row["created_at"],
            }
        )
        if len(trades) >= limit:
            break

    return {
        "ok": True,
        "trades": trades,
        "scan_at": rows[0]["created_at"],
        "scan_signals": len(scan),
        "scan_approved": len(approved),
        "note": None if len(trades) >= 3 else "The latest scan approved fewer than three trades.",
    }


def trade_signals(args: dict) -> dict:
    try:
        return top_trades()
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return {"ok": False, "error": str(exc)}
