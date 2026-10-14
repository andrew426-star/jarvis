import secrets
from datetime import datetime, timezone

from app.core.supabase_client import get_supabase_client

# Home control: Jarvis's side of the house devices Ultron designs (the
# ESP32 hubs in the workshop). A device checks in every few seconds with
# POST /devices/state - what it senses and what it can do - and gets back
# the commands queued for it since. Jarvis reads the state and queues
# commands with the home tool. A device can only report and fetch its own
# commands (app/api/routes/devices.py, the device token); it never acts as
# Andrew.
#
# Kept in jarvis_state: home:<device> for what it last said,
# home_cmd:<device> for what waits for it. Separate keys, so a check-in
# and a new command never overwrite each other.

ONLINE_S = 30
MAX_QUEUE = 20


def _table():
    return get_supabase_client().table("jarvis_state")


def _get(key: str) -> dict:
    rows = _table().select("value").eq("key", key).limit(1).execute().data
    return dict(rows[0]["value"] or {}) if rows else {}


def _put(key: str, value: dict) -> None:
    _table().upsert({"key": key, "value": value, "updated_at": datetime.now(timezone.utc).isoformat()}).execute()


def _name(device: str) -> str:
    return "".join(c for c in device.strip().lower().replace(" ", "-") if c.isalnum() or c in "-_")[:40]


def check_in(device: str, state: dict, capabilities: list[str] | None) -> list[dict]:
    """A device reports; returns (and clears) its waiting commands."""
    name = _name(device)
    _put(f"home:{name}", {"state": state, "capabilities": capabilities or [], "seen_at": datetime.now(timezone.utc).isoformat()})
    waiting = _get(f"home_cmd:{name}").get("commands") or []
    if waiting:
        _put(f"home_cmd:{name}", {"commands": []})
    return waiting


def devices() -> list[dict]:
    rows = _table().select("key,value").execute().data or []
    now = datetime.now(timezone.utc)
    found = []
    for row in rows:
        if not row["key"].startswith("home:"):
            continue
        value = row["value"] or {}
        seen = value.get("seen_at")
        age = (now - datetime.fromisoformat(seen)).total_seconds() if seen else None
        found.append(
            {
                "device": row["key"][5:],
                "online": age is not None and age <= ONLINE_S,
                "last_seen_s": round(age) if age is not None else None,
                "state": value.get("state") or {},
                "capabilities": value.get("capabilities") or [],
            }
        )
    return found


def queue(device: str, action: str, value=None) -> dict:
    name = _name(device)
    known = {d["device"]: d for d in devices()}
    if name not in known:
        return {"ok": False, "error": f"No device called '{device}' has checked in.", "devices": sorted(known)}
    caps = known[name]["capabilities"]
    if caps and action not in caps:
        return {"ok": False, "error": f"{name} does not do '{action}'.", "capabilities": caps}
    waiting = _get(f"home_cmd:{name}").get("commands") or []
    command = {"id": secrets.token_hex(4), "action": action, "value": value, "at": datetime.now(timezone.utc).isoformat()}
    _put(f"home_cmd:{name}", {"commands": (waiting + [command])[-MAX_QUEUE:]})
    return {"ok": True, "queued": command, "device": name, "online": known[name]["online"]}
