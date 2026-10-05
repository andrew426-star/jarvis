import secrets
import time

from fastapi import APIRouter, Body, Depends, HTTPException

from app.core.auth import require_access_token

# The phone camera link: Andrew's iPhone streaming its camera to the
# desktop console over WebRTC (web/src/lib/phone-camera.ts), so the
# workshop's tracking, try-on and looks run on the better camera. The
# video never comes through here - it goes device to device; this only
# passes the two session descriptions between them, under a short code
# the desktop shows and the phone types in. Rooms live in memory for ten
# minutes: a link is set up in seconds and nothing about it is kept.

router = APIRouter(prefix="/camera-link", dependencies=[Depends(require_access_token)])

ROOM_TTL_S = 600
MAX_SDP_CHARS = 20_000
_rooms: dict[str, dict] = {}


def _sweep() -> None:
    now = time.time()
    for code in [c for c, r in _rooms.items() if now - r["created"] > ROOM_TTL_S]:
        _rooms.pop(code, None)


def _room(code: str) -> dict:
    _sweep()
    room = _rooms.get(code)
    if not room:
        raise HTTPException(status_code=404, detail="No camera link with that code (it may have expired). Open a new one on the desktop.")
    return room


def _sdp(body: dict) -> str:
    sdp = str((body or {}).get("sdp") or "")
    if not sdp.startswith("v=0") or len(sdp) > MAX_SDP_CHARS:
        raise HTTPException(status_code=400, detail="Not a session description.")
    return sdp


@router.post("/open")
def open_link() -> dict:
    """The desktop asks for a code to show."""
    _sweep()
    code = f"{secrets.randbelow(10_000):04d}"
    while code in _rooms:
        code = f"{secrets.randbelow(10_000):04d}"
    _rooms[code] = {"created": time.time(), "offer": None, "answer": None}
    return {"ok": True, "code": code, "expires_in": ROOM_TTL_S}


@router.post("/{code}/offer")
def post_offer(code: str, body: dict = Body(...)) -> dict:
    """The phone's offer: its camera, ready to send."""
    room = _room(code)
    room["offer"] = _sdp(body)
    room["answer"] = None
    return {"ok": True}


@router.get("/{code}/offer")
def get_offer(code: str) -> dict:
    return {"ok": True, "sdp": _room(code)["offer"]}


@router.post("/{code}/answer")
def post_answer(code: str, body: dict = Body(...)) -> dict:
    """The desktop's answer: it will take the stream."""
    _room(code)["answer"] = _sdp(body)
    return {"ok": True}


@router.get("/{code}/answer")
def get_answer(code: str) -> dict:
    return {"ok": True, "sdp": _room(code)["answer"]}


@router.delete("/{code}")
def close_link(code: str) -> dict:
    _rooms.pop(code, None)
    return {"ok": True}
