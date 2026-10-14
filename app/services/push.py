import json
import logging
from datetime import datetime, timedelta, timezone

from pywebpush import WebPushException, webpush

from app.core.config import get_settings
from app.core.supabase_client import get_supabase_client

# Web Push to Andrew's devices: the phone's home-screen app (iOS 16.4+
# delivers push only to an installed web app) and any desktop browser where
# he switched notifications on. Each device subscribes from the console
# (web/src/lib/push.ts); web/public/sw.js shows what arrives. Sends are
# best effort: a failed push never fails what triggered it.

logger = logging.getLogger(__name__)

TABLE = "jarvis_push_subscriptions"

# "Hold all my calls": while a hold is on, ordinary pushes are not sent.
# What would have been pushed is still filed in the inbox, so nothing is
# lost, only kept quiet. Urgent pushes (security, reminders he set) still
# go through. The hold lives in jarvis_state.
HOLD_KEY = "push_hold"
MAX_HOLD = timedelta(hours=24)


def _state_table():
    return get_supabase_client().table("jarvis_state")


def hold_status() -> dict:
    """{'held': bool, 'until': iso, 'since': iso, 'reason': str}."""
    rows = _state_table().select("value").eq("key", HOLD_KEY).limit(1).execute().data
    value = rows[0]["value"] if rows else {}
    until = value.get("until")
    if not until or datetime.fromisoformat(until) <= datetime.now(timezone.utc):
        return {"held": False}
    return {"held": True, "until": until, "since": value.get("since"), "reason": value.get("reason")}


def set_hold(minutes: float, reason: str | None = None) -> dict:
    now = datetime.now(timezone.utc)
    until = now + min(timedelta(minutes=max(1.0, minutes)), MAX_HOLD)
    current = hold_status()
    value = {
        "until": until.isoformat(),
        "since": current.get("since") if current.get("held") else now.isoformat(),
        "reason": (reason or "").strip()[:120] or None,
    }
    _state_table().upsert({"key": HOLD_KEY, "value": value, "updated_at": now.isoformat()}).execute()
    return {"held": True, **value}


def clear_hold() -> dict:
    """Lifts the hold; returns what it was, so the caller can say what came in."""
    was = hold_status()
    now = datetime.now(timezone.utc).isoformat()
    _state_table().upsert({"key": HOLD_KEY, "value": {}, "updated_at": now}).execute()
    return was


def push_configured() -> bool:
    settings = get_settings()
    return bool(settings.vapid_public_key and settings.vapid_private_key)


def public_key() -> str | None:
    return get_settings().vapid_public_key if push_configured() else None


def subscribe(endpoint: str, p256dh: str, auth: str, device: str | None) -> None:
    get_supabase_client().table(TABLE).upsert(
        {"endpoint": endpoint, "p256dh": p256dh, "auth": auth, "device": device}
    ).execute()


def unsubscribe(endpoint: str) -> None:
    get_supabase_client().table(TABLE).delete().eq("endpoint", endpoint).execute()


def send_push(title: str, body: str, url: str = "/?inbox=1", tag: str | None = None, urgent: bool = False) -> int:
    """Pushes to every subscribed device; returns how many took it.
    Subscriptions the push service says are gone are dropped. While a hold
    is on, only urgent pushes are sent."""
    if not push_configured():
        return 0
    if not urgent:
        try:
            if hold_status().get("held"):
                return 0
        except Exception:  # noqa: BLE001 — an unreadable hold must not silence everything
            logger.warning("push hold check failed", exc_info=True)
    settings = get_settings()
    payload = json.dumps({"title": title[:120], "body": body[:300], "url": url, "tag": tag})
    claims = {"sub": settings.vapid_subject or "mailto:jarvis@localhost"}
    rows = get_supabase_client().table(TABLE).select("endpoint,p256dh,auth").execute().data or []
    delivered = 0
    for row in rows:
        try:
            webpush(
                subscription_info={"endpoint": row["endpoint"], "keys": {"p256dh": row["p256dh"], "auth": row["auth"]}},
                data=payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims=dict(claims),
                ttl=6 * 3600,
                timeout=10,
            )
            delivered += 1
            get_supabase_client().table(TABLE).update(
                {"last_sent_at": datetime.now(timezone.utc).isoformat()}
            ).eq("endpoint", row["endpoint"]).execute()
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):
                unsubscribe(row["endpoint"])
            else:
                logger.warning("push failed (%s): %s", status, exc)
        except Exception:  # noqa: BLE001 — one bad device must not stop the rest
            logger.warning("push failed", exc_info=True)
    return delivered
