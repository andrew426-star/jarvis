from datetime import datetime, timezone

import httpx

from app.core.config import get_settings

STRIPE_BASE = "https://api.stripe.com/v1"


def company_financials(args: dict) -> dict:
    headers = {"Authorization": f"Bearer {get_settings().stripe_secret_key}"}

    try:
        balance_res = httpx.get(f"{STRIPE_BASE}/balance", headers=headers, timeout=15.0)
        activity_res = httpx.get(
            f"{STRIPE_BASE}/balance_transactions", headers=headers, params={"limit": 10}, timeout=15.0
        )
        if not balance_res.is_success:
            raise RuntimeError(f"Stripe balance fetch failed: {balance_res.text}")
        if not activity_res.is_success:
            raise RuntimeError(f"Stripe activity fetch failed: {activity_res.text}")

        balance = balance_res.json()
        available = (balance.get("available") or [{}])[0]
        pending = (balance.get("pending") or [{}])[0]
        activity = activity_res.json().get("data", [])

        return {
            "ok": True,
            "available_balance": available.get("amount", 0) / 100,
            "pending_balance": pending.get("amount", 0) / 100,
            "currency": (available.get("currency") or "usd").upper(),
            "recent_activity": [
                {
                    "id": tx["id"],
                    "type": tx["type"],
                    "description": tx.get("description"),
                    "amount": tx["amount"] / 100,
                    "currency": tx["currency"].upper(),
                    "created_at": datetime.fromtimestamp(tx["created"], tz=timezone.utc).isoformat(),
                }
                for tx in activity
            ],
        }
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "error": str(exc)}
