from datetime import datetime, timezone

from app.core.supabase_client import get_supabase_client

# Protocols, after Stark's: one name that sets several systems moving at
# once ("House Party Protocol", "Clean Slate"). A protocol is a short list
# of steps written for Jarvis to carry out with his own tools in the same
# turn, so a protocol can do nothing a tool cannot. A few are built in;
# Andrew can save his own (kept in jarvis_state), and one of his with a
# built-in's name replaces it.

STATE_KEY = "protocols"
MAX_STEPS = 12
MAX_STEP_CHARS = 300
MAX_CUSTOM = 30

BUILT_IN: dict[str, dict] = {
    "wake up": {
        "summary": "The morning greeting: time, weather, then the full daily brief.",
        "steps": [
            "In one round: weather, launch_tracker status, google_titan calendar_list_events for today, kiv_tasks list (due_within_days 2), habits status, reminders list, inbox list.",
            "Open the way JARVIS wakes Stark: the time, then the weather in one line (temperature, conditions, rain chance, anything worth dressing for).",
            "Then the daily brief exactly as DAILY BRIEF describes, plus any reminders set for today and anything waiting in the inbox.",
        ],
    },
    "house party": {
        "summary": "Every system reports in at once: a status board of everything Jarvis watches.",
        "steps": [
            "In one round: launch_tracker status, kiv_tasks list (due_within_days 2), inbox list, market_analysis for SPY and QQQ, portfolio, company_financials, kivaro_pipeline status, google_titan gmail_list_messages (is:unread newer_than:1d), zoho_mail list_recent, reminders list, hold status.",
            "Report as a status board, one line per system, each marked nominal, watch or attention, with the one figure that matters. Anything marked attention first.",
            "Close with the single thing most worth doing now.",
        ],
    },
    "focus": {
        "summary": "Heads-down block: notifications held, a countdown running, the console cleared.",
        "steps": [
            "hold on for the block (default 50 minutes, or what he said), reason 'Focus block'.",
            "console: timer_start with the same length, label 'Focus', and close_showcase.",
            "If he asked for music, spotify search for a focus or instrumental playlist and play the first result.",
            "Say how long, when it ends, and that only security and his reminders will reach him.",
        ],
    },
    "clean slate": {
        "summary": "Clear the console: holograms, showcase, panels and timers away.",
        "steps": [
            "console, in one call: clear_holograms, close_showcase, close_panel for each open panel in CONSOLE_STATE, timer_stop (empty target), close_timers.",
            "One dry line that the slate is clean.",
        ],
    },
    "lights out": {
        "summary": "End the night: tomorrow's first commitment, notifications held till morning, console to standby.",
        "steps": [
            "In one round: google_titan calendar_list_events (days 1) and reminders list.",
            "hold on until 8:00 tomorrow Central (work out the minutes from now), reason 'Overnight'.",
            "Say tomorrow's first commitment and when to be up for it, and any reminder due before noon.",
            "console: close_console.",
        ],
    },
    "debrief": {
        "summary": "End-of-day review: what got done, what slipped, what carries to tomorrow.",
        "steps": [
            "In one round: history day (today), kiv_tasks list (due_within_days 1), habits status, checklist list, launch_tracker status.",
            "Give what got done today, what slipped or is overdue, which practices are still open, and the phase pace.",
            "Offer to set reminders for the two things that most need doing tomorrow; set them only if he says yes.",
        ],
    },
    "dossier": {
        "summary": "Everything known about a person or company, from every source, kept as a note.",
        "steps": [
            "The subject is whoever or whatever he named; if he named nobody, ask who.",
            "In one round: web_research on the subject, database_agent list_contacts with the name, kivaro_pipeline find, google_titan gmail_list_messages with the name, zoho_mail search with the name, launch_tracker status.",
            "Write a dossier: who they are, what they do, every touchpoint with Andrew or Kivaro (contacts, emails, pipeline stage, logged conversations), recent news, and the opening worth using.",
            "Save it with notes save (title 'Dossier: <subject>'), and give him the headline in the reply.",
        ],
    },
}

PROTOCOLS_SCHEMA = {
    "type": "function",
    "function": {
        "name": "protocols",
        "description": (
            "Andrew's protocols: one name that sets several systems moving at once, like Stark's. "
            "Built in: "
            + "; ".join(f"{name} ({p['summary']})" for name, p in BUILT_IN.items())
            + ". He can also save his own. get: the steps of one protocol by `name`; then CARRY "
            "THEM OUT in this same turn with your tools, as few rounds as you can, and report what "
            "was done. Call get whenever he says 'protocol', 'initiate', 'engage' or names one "
            "('house party', 'clean slate', 'lights out', 'wake me up'), in any wording. list: "
            "every protocol. save: a new one (or replace one) from what he describes, as `name` and "
            "`steps`, each a short instruction naming the tool and arguments, like the built-ins. "
            "delete: remove one of his own."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["get", "list", "save", "delete"]},
                "name": {"type": "string", "description": "The protocol's name, without the word 'protocol'."},
                "summary": {"type": "string", "description": "save: one line on what it does."},
                "steps": {"type": "array", "items": {"type": "string"}, "description": "save: the steps, in order."},
            },
            "required": ["operation"],
        },
    },
}


def _key(name: str) -> str:
    words = " ".join(str(name or "").lower().replace("protocol", " ").replace("-", " ").replace("_", " ").split())
    return words.strip()


def _custom() -> dict:
    rows = get_supabase_client().table("jarvis_state").select("value").eq("key", STATE_KEY).limit(1).execute().data
    return (rows[0]["value"] or {}).get("custom", {}) if rows else {}


def _save_custom(custom: dict) -> None:
    get_supabase_client().table("jarvis_state").upsert(
        {"key": STATE_KEY, "value": {"custom": custom}, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).execute()


def _all() -> dict[str, dict]:
    merged = {name: {**p, "source": "built in"} for name, p in BUILT_IN.items()}
    merged.update({name: {**p, "source": "his own"} for name, p in _custom().items()})
    return merged


def _find(name: str, protocols: dict[str, dict]) -> str | None:
    key = _key(name)
    if key in protocols:
        return key
    # "wake me up", "the house party one": every word of exactly one name.
    words = set(key.split())
    hits = [n for n in protocols if set(n.split()) <= words] or [n for n in protocols if key and key in n]
    return hits[0] if len(hits) == 1 else None


def protocols(args: dict) -> dict:
    operation = args.get("operation")
    try:
        if operation == "list":
            return {
                "ok": True,
                "protocols": [{"name": n, "summary": p.get("summary"), "source": p["source"]} for n, p in _all().items()],
            }
        if operation == "get":
            everything = _all()
            name = _find(args.get("name") or "", everything)
            if name is None:
                return {"ok": False, "error": f"No protocol called '{args.get('name')}'.", "known": sorted(everything)}
            protocol = everything[name]
            return {
                "ok": True,
                "name": name,
                "summary": protocol.get("summary"),
                "steps": protocol["steps"],
                "instruction": "Carry out these steps now, in this turn, then report what was done. Steps that need a tool you lack, or one that fails, are reported as such, never claimed.",
            }
        if operation == "save":
            name = _key(args.get("name") or "")
            steps = [" ".join(str(s).split())[:MAX_STEP_CHARS] for s in (args.get("steps") or []) if str(s).strip()]
            if not name or not steps:
                return {"ok": False, "error": "name and at least one step are required."}
            custom = _custom()
            if name not in custom and len(custom) >= MAX_CUSTOM:
                return {"ok": False, "error": f"{MAX_CUSTOM} protocols of his own is the limit; delete one first."}
            replaced = name in custom or name in BUILT_IN
            custom[name] = {"summary": " ".join(str(args.get("summary") or "").split())[:200] or None, "steps": steps[:MAX_STEPS]}
            _save_custom(custom)
            return {"ok": True, "saved": name, "steps": custom[name]["steps"], "replaced": replaced}
        if operation == "delete":
            custom = _custom()
            name = _find(args.get("name") or "", custom)
            if name is None:
                if _key(args.get("name") or "") in BUILT_IN:
                    return {"ok": False, "error": "That one is built in and cannot be deleted; saving one by the same name replaces it."}
                return {"ok": False, "error": f"None of his protocols is called '{args.get('name')}'.", "his": sorted(custom)}
            custom.pop(name)
            _save_custom(custom)
            restored = name in BUILT_IN
            return {"ok": True, "deleted": name, "built_in_restored": restored}
        return {"ok": False, "error": "operation must be get, list, save or delete"}
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return {"ok": False, "error": str(exc)}
