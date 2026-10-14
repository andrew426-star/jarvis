import logging
from datetime import datetime, timedelta, timezone

from app.core.local_time import LOCAL_TZ
from app.core.supabase_client import get_supabase_client
from app.services.inbox import add_item
from app.services.push import send_push

# Reminders at a time: "remind me at three to call Dr. Lee", "every weekday
# at 7:30, the Italian review", "in forty minutes, check the print". The
# console's timers only live while the console is open; these are kept in
# jarvis_reminders and fired by the scheduler every minute (pg_cron,
# migration 0015, POST /reminders/run), as a push that gets through a hold
# and an inbox notice under the reminders topic.

logger = logging.getLogger(__name__)

TABLE = "jarvis_reminders"
REPEATS = ("none", "daily", "weekdays", "weekly")
MAX_TEXT = 200
MAX_LISTED = 25

REMINDERS_SCHEMA = {
    "type": "function",
    "function": {
        "name": "reminders",
        "description": (
            "Reminders at a set time, delivered to Andrew's phone and desktop as a notification even "
            "when the console is closed. set: `text` (what to remind him of, written as the "
            "reminder itself, e.g. 'Call Dr. Lee about lab 4') and either `at` (local Central "
            "time, YYYY-MM-DDTHH:MM, worked out from 'at three', 'tomorrow morning' = 08:00, "
            "'tonight' = 20:00) or `in_minutes`; `repeat` daily | weekdays | weekly for a standing "
            "one. list: what is set. cancel: by `item` (its number in list, or words from it); "
            "cancelling a repeating one stops it for good. Use it whenever he says remind me, "
            "ping me, nudge me or don't let me forget with a time attached, or 'notify me in "
            "...'. Things to remember with no time go on a checklist instead; a countdown he "
            "watches on screen is a console timer."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["set", "list", "cancel"]},
                "text": {"type": "string", "description": "set: the reminder."},
                "at": {"type": "string", "description": "set: local time, YYYY-MM-DDTHH:MM (Central)."},
                "in_minutes": {"type": "number", "description": "set: minutes from now, instead of at."},
                "repeat": {"type": "string", "enum": list(REPEATS), "description": "set: default none."},
                "item": {"type": "string", "description": "cancel: its number from list, or words from it."},
            },
            "required": ["operation"],
        },
    },
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _local(stamp: str | datetime) -> str:
    moment = datetime.fromisoformat(stamp) if isinstance(stamp, str) else stamp
    local = moment.astimezone(LOCAL_TZ)
    hour = local.strftime("%I").lstrip("0") or "12"
    return f"{local.strftime('%a %b')} {local.day}, {hour}:{local.strftime('%M %p')}"


def _parse_at(value: str) -> datetime:
    """Local wall time -> aware datetime. An offset given is respected."""
    moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00").replace(" ", "T"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=LOCAL_TZ)
    return moment


def next_occurrence(due: datetime, repeat: str, after: datetime) -> datetime | None:
    """The next time a repeating reminder is due, after `after`, keeping its
    local wall-clock time across daylight-saving changes."""
    if repeat not in ("daily", "weekdays", "weekly"):
        return None
    local = due.astimezone(LOCAL_TZ).replace(tzinfo=None)
    step = timedelta(weeks=1) if repeat == "weekly" else timedelta(days=1)
    while True:
        local += step
        if repeat == "weekdays" and local.weekday() >= 5:
            continue
        candidate = local.replace(tzinfo=LOCAL_TZ)
        if candidate > after:
            return candidate


def _table():
    return get_supabase_client().table(TABLE)


def _pending() -> list[dict]:
    return _table().select("*").eq("status", "pending").order("due_at").limit(MAX_LISTED).execute().data or []


def _shape(row: dict, number: int | None = None) -> dict:
    shaped = {"id": row["id"], "text": row["text"], "when": _local(row["due_at"]), "repeat": row.get("repeat") or "none"}
    if number is not None:
        shaped = {"number": number, **shaped}
    return shaped


def _set(args: dict) -> dict:
    text = " ".join(str(args.get("text") or "").split())[:MAX_TEXT]
    if not text:
        return {"ok": False, "error": "text is required: what to remind him of."}
    repeat = args.get("repeat") or "none"
    if repeat not in REPEATS:
        return {"ok": False, "error": f"repeat must be one of {', '.join(REPEATS)}."}
    now = _now()
    if args.get("in_minutes") not in (None, ""):
        try:
            due = now + timedelta(minutes=float(args["in_minutes"]))
        except (TypeError, ValueError):
            return {"ok": False, "error": "in_minutes must be a number."}
    elif args.get("at"):
        try:
            due = _parse_at(str(args["at"]))
        except ValueError:
            return {"ok": False, "error": "at must be YYYY-MM-DDTHH:MM, Central time."}
    else:
        return {"ok": False, "error": "Give at (a local time) or in_minutes."}
    if due <= now:
        if repeat == "none":
            return {"ok": False, "error": f"{_local(due)} has already passed. Ask him when he means."}
        due = next_occurrence(due, repeat, now)
    row = (
        _table()
        .insert({"text": text, "due_at": due.astimezone(timezone.utc).isoformat(), "repeat": repeat, "status": "pending"})
        .execute()
        .data[0]
    )
    return {"ok": True, "set": _shape(row)}


def _cancel(args: dict) -> dict:
    key = str(args.get("item") or "").strip()
    if not key:
        return {"ok": False, "error": "item is required: its number from list, or words from it."}
    pending = _pending()
    hit = None
    if key.isdigit() and 1 <= int(key) <= len(pending):
        hit = pending[int(key) - 1]
    else:
        low = key.lower()
        hit = next((r for r in pending if r["id"] == key or low in r["text"].lower()), None)
    if hit is None:
        return {"ok": False, "error": f"No pending reminder matches '{key}'.", "pending": [_shape(r, i) for i, r in enumerate(pending, 1)]}
    _table().update({"status": "cancelled"}).eq("id", hit["id"]).execute()
    return {"ok": True, "cancelled": _shape(hit)}


def reminders(args: dict) -> dict:
    operation = args.get("operation")
    try:
        if operation == "set":
            return _set(args)
        if operation == "list":
            pending = _pending()
            return {"ok": True, "reminders": [_shape(r, i) for i, r in enumerate(pending, 1)], "count": len(pending)}
        if operation == "cancel":
            return _cancel(args)
        return {"ok": False, "error": "operation must be set, list or cancel"}
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return {"ok": False, "error": str(exc)}


def run_due_reminders() -> dict:
    """The scheduler's minute tick: fires what is due, books the next one of
    anything that repeats."""
    now = _now()
    due = [r for r in _pending() if datetime.fromisoformat(r["due_at"]) <= now]
    fired = []
    for row in due:
        # Claimed first, so two overlapping ticks cannot fire it twice.
        claimed = (
            _table()
            .update({"status": "done", "fired_at": now.isoformat()})
            .eq("id", row["id"])
            .eq("status", "pending")
            .execute()
            .data
        )
        if not claimed:
            continue
        try:
            add_item("notice", f"Reminder: {row['text']}", f"Set for {_local(row['due_at'])}.", "high", topic="reminders")
        except Exception:  # noqa: BLE001 — the push still goes
            logger.warning("reminder notice failed", exc_info=True)
        try:
            send_push("Reminder, sir", row["text"], tag=f"jarvis-reminder-{row['id']}", urgent=True)
        except Exception:  # noqa: BLE001 — one failed push must not stop the rest
            logger.warning("reminder push failed", exc_info=True)
        following = next_occurrence(datetime.fromisoformat(row["due_at"]), row.get("repeat") or "none", now)
        if following:
            _table().insert(
                {"text": row["text"], "due_at": following.astimezone(timezone.utc).isoformat(), "repeat": row["repeat"], "status": "pending"}
            ).execute()
        fired.append(row["text"])
    return {"ok": True, "fired": fired}
