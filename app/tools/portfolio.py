import httpx

from app.core.config import get_settings


def portfolio(args: dict) -> dict:
    settings = get_settings()
    headers = {
        "APCA-API-KEY-ID": settings.alpaca_api_key_id,
        "APCA-API-SECRET-KEY": settings.alpaca_secret_key,
    }
    base_url = settings.alpaca_api_base_url

    try:
        account_res = httpx.get(f"{base_url}/v2/account", headers=headers, timeout=15.0)
        positions_res = httpx.get(f"{base_url}/v2/positions", headers=headers, timeout=15.0)
        if not account_res.is_success:
            raise RuntimeError(f"Alpaca account fetch failed: {account_res.text}")
        if not positions_res.is_success:
            raise RuntimeError(f"Alpaca positions fetch failed: {positions_res.text}")

        a = account_res.json()
        account = {
            "equity": float(a["equity"]),
            "cash": float(a["cash"]),
            "buying_power": float(a["buying_power"]),
            "portfolio_value": float(a["portfolio_value"]),
            "status": a["status"],
        }
        positions = [
            {
                "symbol": p["symbol"],
                "qty": float(p["qty"]),
                "market_value": float(p["market_value"]),
                "cost_basis": float(p["cost_basis"]),
                "unrealized_pl": float(p["unrealized_pl"]),
                "unrealized_pl_percent": float(p["unrealized_plpc"]) * 100,
                "current_price": float(p["current_price"]),
            }
            for p in positions_res.json()
        ]
        return {"ok": True, "account": account, "positions": positions}
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "error": str(exc)}
