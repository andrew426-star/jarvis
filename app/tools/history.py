import re
from datetime import date, datetime, time, timedelta

from app.core.local_time import LOCAL_TZ, local_today
from app.core.supabase_client import get_supabase_client

# Jarvis's own record of what he did: every turn is in jarvis_interaction_log
# (app/memory/interaction_log.py) with what was asked, what he answered and
# which tools he used - chat, routines like the morning brief, and watch
# remarks. This reads it back by day, by range or by text, so "what did you
# do yesterday?" is answered from the record rather than from memory.

TABLE = "jarvis_interaction_log"
MAX_TURNS = 80
ASKED_CHARS = 220
REPLY_CHARS = 320
MAX_RANGE_DAYS = 31

HISTORY_SCHEMA = {
    "type": "function",
    "function": {
        "name": "history",
        "description": (
            "Your own log of everything you have done with Andrew: each exchange with when it "
            "happened (US Central), what he asked, what you answered and which tools you used - "
            "including routines (morning brief, check-ins) and remarks you made while watching "
            "his board. Use it whenever he asks what you did, what you talked about or what "
            "happened on a day or in a period (\"what did you do yesterday?\", \"what did we "
            "cover on Monday?\", \"when did I last ask about X?\"), instead of answering from "
            "memory. day: one date. range: from and to dates (at most a month). search: find "
            "text in what was asked or answered, newest first. Dates are YYYY-MM-DD in Central "
            "time; work 'yesterday' or 'last Tuesday' out from today's date. Summarise for him - "
            "do not read the log out line by line."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["day", "range", "search"]},
                "date": {"type": "string", "description": "day: YYYY-MM-DD."},
                "from": {"type": "string", "description": "range: first day, YYYY-MM-DD."},
                "to": {"type": "string", "description": "range: last day, YYYY-MM-DD (inclusive)."},
                "query": {"type": "string", "description": "search: text to find."},
            },
            "required": ["operation"],
        },
    },
}


def _date(value) -> date | None:
    text = str(value or "").strip().lower()
    if text == "today":
        return local_today()
    if text == "yesterday":
        return local_today() - timedelta(days=1)
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _bounds(first: date, last: date) -> tuple[str, str]:
    """UTC ISO bounds of whole Central days, first to last inclusive."""
    start = datetime.combine(first, time.min, LOCAL_TZ)
    end = datetime.combine(last + timedelta(days=1), time.min, LOCAL_TZ)
    return start.isoformat(), end.isoformat()


def _clip(text, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _shape(rows: list[dict]) -> list[dict]:
    turns = []
    for row in rows:
        at = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00")).astimezone(LOCAL_TZ)
        tools = sorted(set(row.get("tools_used") or []))
        turns.append(
            {
                "when": f"{at:%a %b} {at.day}, {at.hour % 12 or 12}:{at:%M %p}",
                "asked": _clip(row.get("user_message"), ASKED_CHARS),
                "answered": _clip(row.get("assistant_response"), REPLY_CHARS),
                **({"tools": tools} if tools else {}),
            }
        )
    return turns


def _summary(rows: list[dict]) -> dict:
    tools: dict[str, int] = {}
    for row in rows:
        for tool in set(row.get("tools_used") or []):
            tools[tool] = tools.get(tool, 0) + 1
    return {"exchanges": len(rows), "tools_used": dict(sorted(tools.items(), key=lambda kv: -kv[1]))}


def _select():
    return get_supabase_client().table(TABLE).select("created_at,user_message,assistant_response,tools_used")


def _between(first: date, last: date) -> dict:
    start, end = _bounds(first, last)
    rows = (
        _select().gte("created_at", start).lt("created_at", end).order("created_at").limit(1000).execute().data or []
    )
    result = {"ok": True, "from": first.isoformat(), "to": last.isoformat(), **_summary(rows)}
    if not rows:
        result["note"] = "Nothing logged in that period."
    # A long day keeps its first and last exchanges, which frame it best.
    if len(rows) > MAX_TURNS:
        half = MAX_TURNS // 2
        result["omitted_middle"] = len(rows) - MAX_TURNS
        rows = rows[:half] + rows[-half:]
    result["turns"] = _shape(rows)
    return result


def history(args: dict) -> dict:
    operation = args.get("operation")
    try:
        if operation == "day":
            day = _date(args.get("date"))
            if not day:
                return {"ok": False, "error": "date is required, as YYYY-MM-DD"}
            return _between(day, day)
        if operation == "range":
            first, last = _date(args.get("from")), _date(args.get("to"))
            if not first or not last:
                return {"ok": False, "error": "from and to are required, as YYYY-MM-DD"}
            if last < first:
                first, last = last, first
            if (last - first).days >= MAX_RANGE_DAYS:
                return {"ok": False, "error": f"a range is at most {MAX_RANGE_DAYS} days"}
            return _between(first, last)
        if operation == "search":
            query = str(args.get("query") or "").strip()
            if not query:
                return {"ok": False, "error": "query is required"}
            # Commas and brackets are syntax inside PostgREST's or= filter.
            pattern = "%" + re.sub(r"[%,()]", " ", query).strip() + "%"
            rows = (
                _select()
                .or_(f"user_message.ilike.{pattern},assistant_response.ilike.{pattern}")
                .order("created_at", desc=True)
                .limit(30)
                .execute()
                .data
                or []
            )
            return {"ok": True, "query": query, "matches": len(rows), "turns": _shape(rows)}
        return {"ok": False, "error": "operation must be day, range or search"}
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return {"ok": False, "error": f"Could not read the log: {exc}"}
