from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import require_signed_in
from app.core.session import issue_unlock_token
from app.services import lock

# The console's lock. A Google session reaches only these routes; they
# exchange the PIN (phone) or a face scan (desktop) for the short-lived
# unlock token every other route requires (app/core/auth.py).
router = APIRouter(prefix="/auth")


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


def _refuse(exc: Exception) -> HTTPException:
    if isinstance(exc, lock.LockedOut):
        return HTTPException(status_code=429, detail=str(exc))
    return HTTPException(status_code=403, detail=str(exc))


def _unlocked(email: str, method: str) -> dict:
    token, expires = issue_unlock_token(email, method)
    return {"ok": True, "unlock_token": token, "expires_at": expires, "method": method}


@router.get("/lock")
def lock_status(email: str = Depends(require_signed_in)) -> dict:
    return {"ok": True, **lock.status()}


@router.post("/unlock/pin")
def unlock_pin(body: PinBody, email: str = Depends(require_signed_in)) -> dict:
    try:
        lock.check_pin(body.pin)
    except (lock.LockedOut, lock.Rejected) as exc:
        raise _refuse(exc) from exc
    return _unlocked(email, "pin")


@router.post("/unlock/face")
def unlock_face(body: FaceBody, email: str = Depends(require_signed_in)) -> dict:
    try:
        distance = lock.check_face(body.descriptors, body.liveness.model_dump())
    except (lock.LockedOut, lock.Rejected) as exc:
        raise _refuse(exc) from exc
    return {**_unlocked(email, "face"), "distance": round(distance, 3)}


@router.post("/face/enroll")
def enroll_face(body: EnrollBody, email: str = Depends(require_signed_in)) -> dict:
    """Enrolling (or replacing) the face takes the PIN, so a stolen Google
    session cannot enrol its own face."""
    try:
        lock.check_pin(body.pin)
        samples = lock.enroll_face(body.descriptors)
    except (lock.LockedOut, lock.Rejected) as exc:
        raise _refuse(exc) from exc
    return {"ok": True, "samples": samples}
