from datetime import date, timedelta

from app.core.local_time import local_today
from app.core.supabase_client import get_supabase_client
from app.tools.italian_deck import DECK

# Leitner boxes: days until the next review after landing in each box.
# A correct answer moves a card up a box; a miss sends it back to box 1.
BOX_INTERVAL_DAYS = {1: 1, 2: 2, 3: 4, 4: 7, 5: 14}
LEARNED_BOX = 4

DEFAULT_NEW = 5
DEFAULT_REVIEW = 10


def next_review(box: int, correct: bool, today: date) -> tuple[int, date]:
    new_box = min(5, box + 1) if correct else 1
    return new_box, today + timedelta(days=BOX_INTERVAL_DAYS[new_box])


def _cards(supabase) -> list[dict]:
    return supabase.table("jarvis_italian_cards").select("*").execute().data or []


def _lesson(args: dict) -> dict:
    supabase = get_supabase_client()
    known = {c["italian"] for c in _cards(supabase)}
    count = int(args.get("count") or DEFAULT_NEW)
    fresh = [(it, en, topic) for it, en, topic in DECK if it not in known][:count]
    if not fresh:
        return {"ok": True, "new_cards": [], "note": "The whole starter deck is in rotation. Review due cards."}
    today = local_today().isoformat()
    supabase.table("jarvis_italian_cards").insert(
        [{"italian": it, "english": en, "box": 1, "due_on": today} for it, en, _ in fresh]
    ).execute()
    return {
        "ok": True,
        "new_cards": [{"italian": it, "english": en, "topic": topic} for it, en, topic in fresh],
        "note": "Teach these, then quiz them now; they're due for review today.",
    }


def _review(args: dict) -> dict:
    today = local_today().isoformat()
    count = int(args.get("count") or DEFAULT_REVIEW)
    due = (
        get_supabase_client()
        .table("jarvis_italian_cards")
        .select("italian, english, box")
        .lte("due_on", today)
        .order("box")
        .order("due_on")
        .limit(count)
        .execute()
        .data
        or []
    )
    return {
        "ok": True,
        "due_cards": due,
        "note": "Quiz one card at a time. Do not reveal the answer before Andrew responds; grade each one.",
    }


def _grade(args: dict) -> dict:
    italian = args.get("italian")
    if not isinstance(args.get("correct"), bool) or not italian:
        return {"ok": False, "error": "italian and correct (true/false) are required"}
    supabase = get_supabase_client()
    rows = supabase.table("jarvis_italian_cards").select("*").eq("italian", italian).execute().data
    if not rows:
        return {"ok": False, "error": f"No card '{italian}' in rotation. Use the exact italian text from review."}
    card = rows[0]
    today = local_today()
    box, due_on = next_review(card["box"], args["correct"], today)
    supabase.table("jarvis_italian_cards").update(
        {
            "box": box,
            "due_on": due_on.isoformat(),
            "correct": card["correct"] + (1 if args["correct"] else 0),
            "wrong": card["wrong"] + (0 if args["correct"] else 1),
            "last_reviewed_on": today.isoformat(),
        }
    ).eq("italian", italian).execute()
    return {"ok": True, "italian": italian, "box": box, "next_review": due_on.isoformat()}


def _progress() -> dict:
    cards = _cards(get_supabase_client())
    today = local_today().isoformat()
    by_box = {b: 0 for b in BOX_INTERVAL_DAYS}
    for c in cards:
        by_box[c["box"]] += 1
    return {
        "ok": True,
        "deck_size": len(DECK),
        "in_rotation": len(cards),
        "learned": sum(1 for c in cards if c["box"] >= LEARNED_BOX),
        "due_today": sum(1 for c in cards if c["due_on"] <= today),
        "by_box": by_box,
        "not_started": len(DECK) - len(cards),
    }


def italian(args: dict) -> dict:
    operation = args.get("operation", "progress")
    try:
        if operation == "lesson":
            return _lesson(args)
        if operation == "review":
            return _review(args)
        if operation == "grade":
            return _grade(args)
        if operation == "progress":
            return _progress()
        return {"ok": False, "error": f"Unknown operation: {operation}"}
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "error": f"Italian tutor unavailable: {exc}"}
