import asyncio
import logging
import os
import secrets
import time

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from app.core.auth import has_full_access, require_access_token

# The phone camera link: Andrew's iPhone streaming its camera to the
# desktop console over WebRTC (web/src/lib/phone-camera.ts), so the
# workshop's tracking, try-on and looks run on the better camera. The
# video never comes through here - it goes device to device; this only
# passes the two session descriptions between them, under a short code
# the desktop shows and the phone types in. Rooms live in memory for ten
# minutes: a link is set up in seconds and nothing about it is kept.
#
# Where the two devices cannot reach each other directly - campus and guest
# Wi-Fi isolate their clients, and a phone on cellular is behind its
# carrier's NAT - there are two ways round: a TURN server, if one is
# configured (ice below), or the relay at the end of this file, which
# carries the phone's frames through this server.

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/camera-link", dependencies=[Depends(require_access_token)])
# WebSockets authenticate in their first message, so the relay has no
# bearer dependency.
relay_router = APIRouter(prefix="/camera-link")

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


STUN = [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}]


@router.get("/ice")
async def ice_servers() -> dict:
    """The ICE servers both ends use: STUN always, and a TURN relay when
    one is configured - Cloudflare's (CLOUDFLARE_TURN_KEY_ID and
    CLOUDFLARE_TURN_API_TOKEN: short-lived credentials minted here) or any
    other (TURN_URLS, comma-separated, with TURN_USERNAME and
    TURN_CREDENTIAL)."""
    servers = list(STUN)
    key_id = os.environ.get("CLOUDFLARE_TURN_KEY_ID")
    api_token = os.environ.get("CLOUDFLARE_TURN_API_TOKEN")
    if key_id and api_token:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                res = await client.post(
                    f"https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers",
                    headers={"Authorization": f"Bearer {api_token}"},
                    json={"ttl": 3600},
                )
            res.raise_for_status()
            servers += res.json().get("iceServers") or []
        except Exception:  # noqa: BLE001 - STUN alone still serves a LAN
            logger.exception("Cloudflare TURN credentials failed")
    elif os.environ.get("TURN_URLS"):
        servers.append({
            "urls": [u.strip() for u in os.environ["TURN_URLS"].split(",") if u.strip()],
            "username": os.environ.get("TURN_USERNAME", ""),
            "credential": os.environ.get("TURN_CREDENTIAL", ""),
        })
    return {"ok": True, "iceServers": servers, "turn": len(servers) > len(STUN)}


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


# --- the relay -------------------------------------------------------------------------
#
# When WebRTC cannot connect, the phone sends its camera as JPEG frames over
# a WebSocket and the desktop receives them over another; this passes each
# frame across. Only the newest frame waits for a slow desktop - older ones
# are dropped - so it never falls behind. Nothing is stored.

HELLO_TIMEOUT_S = 10
MAX_FRAME_BYTES = 600_000
_relays: dict[str, dict] = {}


@relay_router.websocket("/{code}/relay")
async def relay(socket: WebSocket, code: str) -> None:
    await socket.accept()
    try:
        hello = await asyncio.wait_for(socket.receive_json(), HELLO_TIMEOUT_S)
    except (asyncio.TimeoutError, WebSocketDisconnect, ValueError):
        await socket.close(code=4001)
        return
    token = str(hello.get("token") or "") if isinstance(hello, dict) else ""
    role = hello.get("role") if isinstance(hello, dict) else None
    if role not in ("phone", "desk") or not await run_in_threadpool(has_full_access, token):
        await socket.close(code=4001)
        return
    _sweep()
    if code not in _rooms:
        await socket.send_json({"type": "error", "error": "No camera link with that code."})
        await socket.close(code=4004)
        return
    relay = _relays.setdefault(code, {"phone": None, "desk": None, "frame": None, "event": asyncio.Event()})
    relay[role] = socket
    other = relay["desk" if role == "phone" else "phone"]
    await socket.send_json({"type": "ready", "peer": other is not None})
    if other is not None:
        try:
            await other.send_json({"type": "peer"})
        except Exception:  # noqa: BLE001
            pass

    async def pump() -> None:
        # Desktop side: send the newest frame whenever there is one.
        while True:
            await relay["event"].wait()
            relay["event"].clear()
            frame = relay["frame"]
            relay["frame"] = None
            if frame is not None:
                await socket.send_bytes(frame)

    sender = asyncio.create_task(pump()) if role == "desk" else None
    try:
        while True:
            message = await socket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            data = message.get("bytes")
            if role == "phone" and data and len(data) <= MAX_FRAME_BYTES:
                relay["frame"] = data
                relay["event"].set()
    except WebSocketDisconnect:
        pass
    finally:
        if sender:
            sender.cancel()
        if relay.get(role) is socket:
            relay[role] = None
        peer = relay["desk" if role == "phone" else "phone"]
        if peer is not None:
            try:
                await peer.send_json({"type": "peer-left"})
            except Exception:  # noqa: BLE001
                pass
        if relay["phone"] is None and relay["desk"] is None:
            _relays.pop(code, None)
