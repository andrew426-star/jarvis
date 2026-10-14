from datetime import datetime

from app.core.local_time import LOCAL_TZ
from app.core.supabase_client import get_supabase_client
from app.services.push import clear_hold, hold_status, set_hold

# "Hold all my calls." Notifications to his devices are held for a while;
# the inbox keeps filling, and when the hold lifts Jarvis can say what came
# in. Security alerts and reminders he set still get through
# (app/services/push.py).

DEFAULT_MINUTES = 60

HOLD_SCHEMA = {
    "type": "function",
    "function": {
        "name": "hold",
        "description": (
            "Do not disturb: hold Andrew's notifications. on: no pushes to his devices for "
            "`minutes` (default 60, at most 24 hours); notices still land in the inbox, and "
            "security alerts and his own reminders still come through. off: lift it, and the "
            "result says how many inbox items arrived while it was on, so tell him. status: is a "
            "hold on, and until when. Use it for 'hold my calls', 'do not disturb', 'I'm going "
            "dark', 'no interruptions for an hour', a focus block, an exam or a meeting, and 'I'm "
            "back' or 'what did I miss' (off)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["on", "off", "status"]},
                "minutes": {"type": "number", "description": "on: how long to hold, in minutes."},
                "reason": {"type": "string", "description": "on: what for, e.g. 'Exam', 'Focus block'."},
            },
            "required": ["operation"],
        },
    },
}


def _local(stamp: str | None) -> str | None:
    if not stamp:
        return None
    return datetime.fromisoformat(stamp).astimezone(LOCAL_TZ).strftime("%a %I:%M %p").replace(" 0", " ")


def _arrived_since(since: str | None) -> list[dict]:
    if not since:
        return []
    rows = (
        get_supabase_client()
        .table("jarvis_inbox")
        .select("title,topic,priority,created_at")
        .eq("status", "pending")
        .gte("created_at", since)
        .order("created_at", desc=True)
        .limit(20)
        .execute()
        .data
    )
    return [{"title": r["title"], "topic": r.get("topic"), "priority": r.get("priority")} for r in rows or []]


def hold(args: dict) -> dict:
    operation = args.get("operation")
    try:
        if operation == "on":
            try:
                minutes = float(args.get("minutes") or DEFAULT_MINUTES)
            except (TypeError, ValueError):
                minutes = DEFAULT_MINUTES
            state = set_hold(minutes, args.get("reason"))
            return {"ok": True, "held": True, "until_local": _local(state["until"]), "reason": state.get("reason")}
        if operation == "off":
            was = clear_hold()
            if not was.get("held"):
                return {"ok": True, "held": False, "note": "No hold was on."}
            arrived = _arrived_since(was.get("since"))
            return {"ok": True, "held": False, "held_since_local": _local(was.get("since")), "arrived": arrived, "count": len(arrived)}
        if operation == "status":
            state = hold_status()
            if not state.get("held"):
                return {"ok": True, "held": False}
            return {"ok": True, "held": True, "until_local": _local(state["until"]), "reason": state.get("reason")}
        return {"ok": False, "error": "operation must be on, off or status"}
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return {"ok": False, "error": str(exc)}
