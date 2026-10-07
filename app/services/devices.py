import logging
import secrets
import threading
import time

from app.services.inbox import add_item, announce, list_inbox

# The workshop's own devices: ESP32 builds that talk to Jarvis
# (app/api/routes/devices.py). The Desk Sentry files an alert when it sees
# someone; the Ultron Sentry, Jarvis's avatar on the desk, asks what he
# last said and plays it through its speaker.
#
# Held in memory, not Supabase: the service is one uvicorn process, a
# restart only means the avatar skips the reply in flight, and the poll
# (every couple of seconds) must not cost a database read each time.

logger = logging.getLogger(__name__)

SPEECH_TTL_S = 120
PENDING_TTL_S = 20
EVENT_GAP_S = 30  # one alert per device per half minute, however busy the room

_lock = threading.Lock()
_reply: dict = {"id": 0, "text": "", "at": 0.0}
_speech: dict[str, tuple[str, float]] = {}
_pending: dict = {"count": 0, "at": 0.0}
_last_event: dict[str, float] = {}


def note_reply(spoken: str | None) -> None:
    """Jarvis has answered (app/api/routes/invoke.py): what the avatar says next."""
    text = " ".join((spoken or "").split())[:600]
    if not text:
        return
    with _lock:
        _reply.update(id=_reply["id"] + 1, text=text, at=time.time())


def _pending_count() -> int:
    now = time.time()
    if now - _pending["at"] > PENDING_TTL_S:
        try:
            _pending.update(count=len(list_inbox(include_recent=False)["pending"]), at=now)
        except Exception:  # noqa: BLE001 - the avatar just shows the last count
            logger.warning("device inbox count failed", exc_info=True)
            _pending["at"] = now
    return _pending["count"]


def avatar_state(since: int) -> dict:
    """What the avatar shows and says: the inbox's pending count, and the
    latest reply if it is newer than `since`, with a one-time link to its
    audio (good for SPEECH_TTL_S, one fetch)."""
    now = time.time()
    with _lock:
        for nonce in [n for n, (_, exp) in _speech.items() if exp < now]:
            del _speech[nonce]
        reply = dict(_reply)
        nonce = None
        if reply["id"] > since and reply["text"]:
            nonce = secrets.token_urlsafe(18)
            _speech[nonce] = (reply["text"], now + SPEECH_TTL_S)
    return {
        "ok": True,
        "pending": _pending_count(),
        "say_id": reply["id"],
        "say": reply["text"] if nonce else "",
        "speech": f"/devices/speech/{nonce}" if nonce else "",
    }


def take_speech(nonce: str) -> str | None:
    with _lock:
        entry = _speech.pop(nonce, None)
    if not entry or entry[1] < time.time():
        return None
    return entry[0]


def file_event(device: str, title: str, body: str, priority: str) -> dict:
    """A device's alert, filed in the inbox (security) and pushed to his phone."""
    device = " ".join(device.split())[:40] or "Device"
    now = time.time()
    with _lock:
        if now - _last_event.get(device, 0) < EVENT_GAP_S:
            return {"ok": True, "filed": False, "reason": "rate limited"}
        _last_event[device] = now
    item = add_item("notice", f"{device}: {title}", body, priority=priority, topic="security")
    if item:
        announce([item])
    return {"ok": True, "filed": bool(item)}
