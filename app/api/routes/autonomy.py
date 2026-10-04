from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import require_access_token, require_routine_access
from app.services.autonomy import get_settings_row, run_rounds, update_settings
from app.services.inbox import approve, decide, list_inbox
from app.services.push import public_key, push_configured, send_push, subscribe, unsubscribe

# Jarvis on his own, and what he leaves for Andrew (app/services/
# autonomy.py, app/services/inbox.py), plus the push subscriptions that
# carry it to his devices (app/services/push.py). The console's inbox,
# desktop and phone alike (web/src/components/inbox/), works through these.
router = APIRouter()


# The scheduler's call (pg_cron, migration 0009). Sync on purpose, like
# /routines: a round is a full agent turn.
@router.post("/autonomy/rounds", dependencies=[Depends(require_routine_access)])
def autonomy_rounds() -> dict:
    return run_rounds()


@router.post("/autonomy/run", dependencies=[Depends(require_access_token)])
def autonomy_run_now() -> dict:
    return run_rounds(force=True)


class AutonomySettings(BaseModel):
    enabled: bool | None = None
    quiet_start: int | None = Field(default=None, ge=0, le=23)
    quiet_end: int | None = Field(default=None, ge=0, le=23)


def _settings_view(row: dict) -> dict:
    return {
        "ok": True,
        "enabled": row.get("enabled", True),
        "quiet_start": row.get("quiet_start", 22),
        "quiet_end": row.get("quiet_end", 8),
        "last_round_at": row.get("last_round_at"),
        "push_key": public_key(),
    }


@router.get("/autonomy", dependencies=[Depends(require_access_token)])
def autonomy_settings() -> dict:
    return _settings_view(get_settings_row())


@router.put("/autonomy", dependencies=[Depends(require_access_token)])
def autonomy_update(settings: AutonomySettings) -> dict:
    return _settings_view(update_settings(**settings.model_dump()))


@router.get("/inbox", dependencies=[Depends(require_access_token)])
def inbox_list() -> dict:
    try:
        return list_inbox()
    except Exception as exc:  # noqa: BLE001 — panels report errors in the body
        return {"ok": False, "error": str(exc)}


@router.post("/inbox/{item_id}/approve", dependencies=[Depends(require_access_token)])
def inbox_approve(item_id: str) -> dict:
    return approve(item_id)


@router.post("/inbox/{item_id}/decline", dependencies=[Depends(require_access_token)])
def inbox_decline(item_id: str) -> dict:
    return decide(item_id, "declined")


@router.post("/inbox/{item_id}/dismiss", dependencies=[Depends(require_access_token)])
def inbox_dismiss(item_id: str) -> dict:
    return decide(item_id, "dismissed")


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


class PushSubscription(BaseModel):
    endpoint: str = Field(min_length=1, max_length=1000)
    keys: PushKeys
    device: str | None = Field(default=None, max_length=80)


class PushEndpoint(BaseModel):
    endpoint: str = Field(min_length=1, max_length=1000)


@router.post("/push/subscribe", dependencies=[Depends(require_access_token)])
def push_subscribe(subscription: PushSubscription) -> dict:
    if not push_configured():
        raise HTTPException(status_code=409, detail="Push is not set up on the server (VAPID keys).")
    subscribe(subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, subscription.device)
    return {"ok": True}


@router.post("/push/unsubscribe", dependencies=[Depends(require_access_token)])
def push_unsubscribe(body: PushEndpoint) -> dict:
    unsubscribe(body.endpoint)
    return {"ok": True}


@router.post("/push/test", dependencies=[Depends(require_access_token)])
def push_test() -> dict:
    sent = send_push("J.A.R.V.I.S.", "Notifications are on, sir.", tag="jarvis-test")
    return {"ok": sent > 0, "delivered": sent}
