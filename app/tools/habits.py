from datetime import date, timedelta

from app.core.local_time import local_today
from app.core.supabase_client import get_supabase_client

# Andrew's daily founder-development practices. They mirror the "Daily:"
# tasks under the Founder Development projects on K.I.V.'s Company
# Dashboard; this is where each day's check-in actually gets recorded.
HABITS = {
    "italian": {"label": "Italian session", "target_minutes": 20},
    "articulation": {"label": "Articulation drills", "target_minutes": 10},
    "speaking": {"label": "Recorded 2-minute talk", "target_minutes": 5},
    "grooming": {"label": "Grooming routine", "target_minutes": None},
}

HISTORY_DAYS = 60


def current_streak(done_days: set[date], today: date) -> int:
    """Consecutive days done, ending today — or yesterday, so a habit not
    yet done this morning still shows the streak it's protecting."""
    day = today if today in done_days else today - timedelta(days=1)
    streak = 0
    while day in done_days:
        streak += 1
        day -= timedelta(days=1)
    return streak


def summarize(rows: list[dict], today: date) -> dict:
    by_habit: dict[str, set[date]] = {h: set() for h in HABITS}
    minutes_week: dict[str, int] = {h: 0 for h in HABITS}
    week_start = today - timedelta(days=6)
    for row in rows:
        habit = row["habit"]
        if habit not in by_habit:
            continue
        day = date.fromisoformat(row["done_on"])
        by_habit[habit].add(day)
        if day >= week_start:
            minutes_week[habit] += row.get("minutes") or 0

    habits = []
    for key, spec in HABITS.items():
        days = by_habit[key]
        habits.append(
            {
                "habit": key,
                "label": spec["label"],
                "done_today": today in days,
                "streak_days": current_streak(days, today),
                "last_7_days": sum(1 for d in days if d >= week_start),
                "minutes_last_7_days": minutes_week[key],
                "target_minutes": spec["target_minutes"],
            }
        )
    return {
        "today": today.isoformat(),
        "done_today": [h["label"] for h in habits if h["done_today"]],
        "still_to_do_today": [h["label"] for h in habits if not h["done_today"]],
        "habits": habits,
    }


def _status() -> dict:
    today = local_today()
    since = (today - timedelta(days=HISTORY_DAYS)).isoformat()
    rows = (
        get_supabase_client()
        .table("jarvis_habit_log")
        .select("habit, done_on, minutes")
        .gte("done_on", since)
        .execute()
        .data
        or []
    )
    return {"ok": True, **summarize(rows, today)}


def _log(args: dict) -> dict:
    habit = args.get("habit")
    if habit not in HABITS:
        return {"ok": False, "error": f"habit must be one of: {', '.join(HABITS)}"}
    done_on = args.get("done_on") or local_today().isoformat()
    try:
        date.fromisoformat(done_on)
    except ValueError:
        return {"ok": False, "error": "done_on must be a YYYY-MM-DD date"}
    minutes = args.get("minutes")
    minutes = int(minutes) if isinstance(minutes, (int, float)) and minutes > 0 else None
    notes = args.get("notes") if isinstance(args.get("notes"), str) and args["notes"].strip() else None

    supabase = get_supabase_client()
    existing = (
        supabase.table("jarvis_habit_log")
        .select("id, minutes, notes")
        .eq("habit", habit)
        .eq("done_on", done_on)
        .execute()
        .data
    )
    if existing:
        # A second session the same day adds to the day's total rather
        # than overwriting it.
        row = existing[0]
        total = (row.get("minutes") or 0) + (minutes or 0) or None
        merged_notes = "\n".join(n for n in (row.get("notes"), notes) if n) or None
        supabase.table("jarvis_habit_log").update({"minutes": total, "notes": merged_notes}).eq(
            "id", row["id"]
        ).execute()
    else:
        supabase.table("jarvis_habit_log").insert(
            {"habit": habit, "done_on": done_on, "minutes": minutes, "notes": notes}
        ).execute()

    status = _status()
    entry = next(h for h in status["habits"] if h["habit"] == habit)
    return {"ok": True, "logged": {"habit": habit, "done_on": done_on, "minutes": minutes}, "habit_now": entry}


def habits(args: dict) -> dict:
    operation = args.get("operation", "status")
    try:
        if operation == "status":
            return _status()
        if operation == "log":
            return _log(args)
        return {"ok": False, "error": f"Unknown operation: {operation}"}
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        # Most likely cause: supabase/migrations/0005_jarvis_growth.sql
        # hasn't been applied yet.
        return {"ok": False, "error": f"habit tracker unavailable: {exc}"}
