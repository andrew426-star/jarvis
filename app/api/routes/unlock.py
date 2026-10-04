import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.auth import require_signed_in
from app.core.session import issue_unlock_token
from app.core.supabase_client import get_supabase_client
from app.services import lock
from app.services.inbox import add_item, announce

# The console's lock. A Google session reaches only these routes; they
# exchange the PIN (phone) or a face scan (desktop) for the short-lived
# unlock token every other route requires (app/core/auth.py).
#
# Every attempt is recorded in jarvis_auth_events (time, method, outcome,
# IP, device), and the events worth knowing about at once (a lockout
# starting, a face being enrolled) also go to Andrew's inbox as urgent
# security notices, pushed to his devices.
router = APIRouter(prefix="/auth")
logger = logging.getLogger(__name__)


class PinBody(BaseModel):
    pin: str = Field(pattern=r"^\d{4,8}$")


class Liveness(BaseModel):
    blinked: bool = False
    turned: bool = False


class FaceBody(BaseModel):
    descriptors: list[list[float]] = Field(min_length=1, max_length=10)
    liveness: Liveness


class EnrollBody(BaseModel):
    pin: str = Field(pattern=r"^\d{4,8}$")
    descriptors: list[list[float]] = Field(min_length=3, max_length=12)


def _client(request: Request) -> tuple[str | None, str | None]:
    # Render sits in front: the caller's address is the first hop.
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() or (request.client.host if request.client else None)
    return ip, (request.headers.get("user-agent") or "")[:300] or None


def _audit(request: Request, method: str, outcome: str, detail: str | None = None) -> None:
    ip, agent = _client(request)
    logger.info("auth %s %s from %s: %s", method, outcome, ip, detail or "")
    try:
        get_supabase_client().table("jarvis_auth_events").insert(
            {"method": method, "outcome": outcome, "detail": (detail or "")[:300] or None, "ip": ip, "user_agent": agent}
        ).execute()
    except Exception:  # noqa: BLE001 — the lock must not fail because the log did
        logger.warning("auth event not recorded", exc_info=True)


def _alert(request: Request, title: str, body: str) -> None:
    ip, agent = _client(request)
    try:
        item = add_item("notice", title, f"{body}\nFrom {ip or 'an unknown address'}, {agent or 'an unknown device'}.", "high", topic="security")
        if item:
            announce([item])
    except Exception:  # noqa: BLE001
        logger.warning("security notice not filed", exc_info=True)


def _outcome(exc: Exception) -> str:
    if isinstance(exc, lock.LockedOut):
        return "locked"
    return "wrong" if "wrong" in str(exc).lower() or "not recognised" in str(exc).lower() else "rejected"


def _refuse(request: Request, method: str, exc: Exception) -> HTTPException:
    _audit(request, method, _outcome(exc), str(exc))
    if isinstance(exc, lock.LockedOut):
        if exc.started:
            what = "PIN" if method in ("pin", "enroll") else "face scan"
            _alert(
                request,
                f"Console {what} locked after repeated failures",
                f"Someone failed the {what} too many times; it is locked until "
                f"{exc.until:%H:%M} UTC. If that was not you, sign out everywhere by rotating JARVIS_SESSION_SECRET.",
            )
        return HTTPException(status_code=429, detail=str(exc))
    return HTTPException(status_code=403, detail=str(exc))


def _unlocked(email: str, method: str) -> dict:
    token, expires = issue_unlock_token(email, method)
    return {"ok": True, "unlock_token": token, "expires_at": expires, "method": method}


@router.get("/lock")
def lock_status(email: str = Depends(require_signed_in)) -> dict:
    return {"ok": True, **lock.status()}


@router.post("/unlock/pin")
def unlock_pin(body: PinBody, request: Request, email: str = Depends(require_signed_in)) -> dict:
    try:
        lock.check_pin(body.pin)
    except (lock.LockedOut, lock.Rejected) as exc:
        raise _refuse(request, "pin", exc) from exc
    _audit(request, "pin", "ok")
    return _unlocked(email, "pin")


@router.post("/unlock/face")
def unlock_face(body: FaceBody, request: Request, email: str = Depends(require_signed_in)) -> dict:
    try:
        distance = lock.check_face(body.descriptors, body.liveness.model_dump())
    except (lock.LockedOut, lock.Rejected) as exc:
        raise _refuse(request, "face", exc) from exc
    _audit(request, "face", "ok", f"distance {distance:.3f}")
    return {**_unlocked(email, "face"), "distance": round(distance, 3)}


@router.post("/face/enroll")
def enroll_face(body: EnrollBody, request: Request, email: str = Depends(require_signed_in)) -> dict:
    """Enrolling (or replacing) the face takes the PIN, so a stolen Google
    session cannot enrol its own face. Andrew is told either way."""
    try:
        lock.check_pin(body.pin)
        samples = lock.enroll_face(body.descriptors)
    except (lock.LockedOut, lock.Rejected) as exc:
        raise _refuse(request, "enroll", exc) from exc
    _audit(request, "enroll", "ok", f"{samples} samples")
    _alert(request, "A face was enrolled for the console", "The desktop's face unlock now matches a newly enrolled face.")
    return {"ok": True, "samples": samples}
