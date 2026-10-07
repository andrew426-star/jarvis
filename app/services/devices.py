import threading
import time

from app.services.inbox import add_item, announce

# The workshop's own devices: ESP32 builds that talk to Jarvis
# (app/api/routes/devices.py). The Desk Sentry files an alert when it sees
# someone.
#
# The rate limit is held in memory, not Supabase: the service is one
# uvicorn process, and a restart only means one extra alert.

EVENT_GAP_S = 30  # one alert per device per half minute, however busy the room

_lock = threading.Lock()
_last_event: dict[str, float] = {}


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
