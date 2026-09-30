import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.core.supabase_client import get_supabase_client

# Copy of kiv-console's src/lib/launch/plan.ts — the launch date, phases,
# targets and segments. Both read and write the same launch_activity
# table, so change the two together.
LAUNCH_DATE = "2027-01-12"
LAUNCH_TIME_ZONE = ZoneInfo("America/Chicago")

ACTIVITY_KINDS = ("conversation", "pilot", "commitment", "publicity", "content")

SEGMENT_LABELS = {
    "hedge_fund": "Hedge fund partners & PMs",
    "research_analytics": "Research & analytics teams",
    "investor_relations": "Investor relations & reporting",
    "quant": "Quant & hybrid discretionary funds",
    "venture_capital": "Venture capital managers",
    "private_equity": "Private equity firms",
}

PHASES = [
    {
        "id": "discovery",
        "label": "Discovery",
        "goal": "30 real conversations with people in the target segments. Capture their exact words.",
        "start": "2026-09-28",
        "end": "2026-10-31",
        "metric": "conversation",
        "target": 30,
    },
    {
        "id": "pilots",
        "label": "Pilots",
        "goal": "Turn the best conversations into 3 free or cheap pilots, and get a case study out of each.",
        "start": "2026-11-01",
        "end": "2026-11-30",
        "metric": "pilot",
        "target": 3,
    },
    {
        "id": "commitments",
        "label": "Commitments",
        "goal": "3 paid commitments or letters of intent, a waitlist, and launch assets ready.",
        "start": "2026-12-01",
        "end": "2027-01-11",
        "metric": "commitment",
        "target": 3,
    },
    {
        "id": "launch",
        "label": "Launch",
        "goal": "Public launch: Product Hunt, build-in-public thread, pilot case studies, local press.",
        "start": LAUNCH_DATE,
        "end": LAUNCH_DATE,
        "metric": None,
        "target": 0,
    },
]

RECENT_LIMIT = 10


def _today() -> str:
    return datetime.now(LAUNCH_TIME_ZONE).date().isoformat()


def _days_between(from_iso: str, to_iso: str) -> int:
    return (date.fromisoformat(to_iso) - date.fromisoformat(from_iso)).days


def _current_phase(today: str) -> dict:
    for phase in PHASES:
        if today <= phase["end"]:
            return phase
    return PHASES[-1]


def _status() -> dict:
    supabase = get_supabase_client()
    rows = supabase.table("launch_activity").select("kind, segment").execute().data or []
    recent = (
        supabase.table("launch_activity")
        .select("kind, company, contact, segment, notes, occurred_on, logged_by")
        .order("occurred_on", desc=True)
        .order("created_at", desc=True)
        .limit(RECENT_LIMIT)
        .execute()
        .data
        or []
    )

    counts = {k: 0 for k in ACTIVITY_KINDS}
    by_segment: dict[str, int] = {}
    for row in rows:
        if row["kind"] in counts:
            counts[row["kind"]] += 1
        if row["kind"] == "conversation" and row.get("segment"):
            by_segment[row["segment"]] = by_segment.get(row["segment"], 0) + 1

    today = _today()
    phase = _current_phase(today)
    return {
        "ok": True,
        "today": today,
        "launch_date": LAUNCH_DATE,
        "days_to_launch": max(0, _days_between(today, LAUNCH_DATE)),
        "phase": {
            "label": phase["label"],
            "goal": phase["goal"],
            "ends": phase["end"],
            "days_left": max(0, _days_between(today, phase["end"])),
        },
        "scoreboard": [
            {"phase": p["label"], "metric": p["metric"], "count": counts[p["metric"]], "target": p["target"]}
            for p in PHASES
            if p["metric"]
        ],
        "counts": counts,
        "conversations_by_segment": {SEGMENT_LABELS.get(k, k): v for k, v in by_segment.items()},
        "recent": recent,
    }


def _log(args: dict) -> dict:
    kind = args.get("kind")
    if kind not in ACTIVITY_KINDS:
        return {"ok": False, "error": f"kind must be one of: {', '.join(ACTIVITY_KINDS)}"}
    segment = args.get("segment") or None
    if segment is not None and segment not in SEGMENT_LABELS:
        return {"ok": False, "error": f"segment must be one of: {', '.join(SEGMENT_LABELS)}"}
    occurred_on = args.get("occurred_on") or _today()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", occurred_on):
        return {"ok": False, "error": "occurred_on must be a YYYY-MM-DD date"}

    def text(key: str) -> str | None:
        value = args.get(key)
        return value.strip() if isinstance(value, str) and value.strip() else None

    res = (
        get_supabase_client()
        .table("launch_activity")
        .insert(
            {
                "kind": kind,
                "segment": segment,
                "company": text("company"),
                "contact": text("contact"),
                "notes": text("notes"),
                "occurred_on": occurred_on,
                "logged_by": "jarvis",
            }
        )
        .execute()
    )
    row = (res.data or [{}])[0]
    return {"ok": True, "logged": {k: row.get(k) for k in ("kind", "company", "occurred_on")}}


def launch_tracker(args: dict) -> dict:
    operation = args.get("operation", "status")
    try:
        if operation == "status":
            return _status()
        if operation == "log":
            return _log(args)
        return {"ok": False, "error": f"Unknown operation: {operation}"}
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        # Most likely cause: the launch_activity migration (kiv-console repo)
        # hasn't been applied to this Supabase project yet.
        return {"ok": False, "error": f"launch tracker unavailable: {exc}"}
