from dataclasses import dataclass
from datetime import date
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import require_access_token
from app.core.config import get_settings
from app.core.google_oauth import get_google_access_token
from app.core.local_time import local_today
from app.core.supabase_client import get_supabase_client
from app.integrations import google_api
from app.services.orchestrator import run_invoke
from app.tools.habits import habits
from app.tools.italian import italian

router = APIRouter()

EMAIL_NOTE = (
    " This is going out by email, so it will be read rather than heard: keep the same voice, "
    "plain prose, short paragraphs."
)


def _evening_has_something_open() -> str | None:
    """Skip the evening email when there's nothing to nudge about."""
    status = habits({"operation": "status"})
    progress = italian({"operation": "progress"})
    open_habits = status.get("still_to_do_today") or []
    due_cards = progress.get("due_today") or 0
    if not open_habits and not due_cards:
        return "Every habit is done and no Italian cards are due."
    return None


@dataclass(frozen=True)
class Routine:
    name: str
    subject: Callable[[date], str]
    request: str
    # Returns a reason to skip today's run, or None to send.
    skip_if: Callable[[], str | None] | None = None
    # Session ids are "<prefix>-<date>"; the once-a-day guard keys on them.
    session_prefix: str | None = None


# Jarvis's scheduled routines, each triggered by a GitHub Actions cron
# (.github/workflows/jarvis-routines.yml, plus morning-brief.yml), run
# through the ordinary agent loop in a session of its own per day, and
# emailed from the connected Gmail account to Andrew.
ROUTINES: dict[str, Routine] = {
    "morning-brief": Routine(
        name="morning-brief",
        subject=lambda d: f"Morning brief · {d.strftime('%A, %b')} {d.day}",
        request="Give me my morning brief." + EMAIL_NOTE,
        # What /brief/run used before routines existed; kept so the guard
        # still recognises briefs already sent under it.
        session_prefix="brief",
    ),
    "evening-checkin": Routine(
        name="evening-checkin",
        subject=lambda d: f"Evening check-in · {d.strftime('%A, %b')} {d.day}",
        request=(
            "Evening check-in. Use habits (status), italian (progress), kiv_tasks (list, "
            "due_within_days 1) and google_titan for tomorrow's calendar. Tell me which daily "
            "practices are still open tonight and what streak each one protects, how many Italian "
            "cards are due, anything due tomorrow, and tomorrow's first commitment and what to "
            "wear for it if it's a meeting or pitch. Three short paragraphs at most."
        )
        + EMAIL_NOTE,
        skip_if=_evening_has_something_open,
    ),
    "weekly-review": Routine(
        name="weekly-review",
        subject=lambda d: f"Weekly review · week of {d.strftime('%b')} {d.day}",
        request=(
            "Sunday weekly review. Use launch_tracker (status), habits (status), italian "
            "(progress), kiv_tasks (list, due_within_days 7) and google_titan for the coming "
            "week's calendar. Cover: the launch phase's pace against its target and what that "
            "means for this week, this week's habit totals and streaks, Italian progress, what's "
            "due or overdue, the pressure points in the coming week (exams, deadlines, meetings), "
            "and the three priorities for the week, fitted around classes. End with one line of "
            "honest encouragement or a pointed nudge, whichever the numbers earn."
        )
        + EMAIL_NOTE,
    ),
}


def _recipient() -> str | None:
    configured = get_settings().jarvis_brief_email
    if configured:
        return configured
    rows = (
        get_supabase_client()
        .table("jarvis_google_connection")
        .select("google_email")
        .eq("id", "default")
        .execute()
        .data
    )
    return rows[0]["google_email"] if rows else None


def _run(routine: Routine, force: bool) -> dict:
    today = local_today()
    try:
        access_token = get_google_access_token()
    except RuntimeError as exc:
        # Typically invalid_grant: the refresh token was revoked or expired
        # (Google expires them after 7 days while the OAuth app is in
        # Testing mode). Say what fixes it rather than a bare 500.
        raise HTTPException(
            status_code=409,
            detail=f"Google connection expired; reconnect at /auth/google/connect. ({exc})",
        ) from exc
    if not access_token:
        raise HTTPException(status_code=409, detail="Google not connected; visit /auth/google/connect.")
    recipient = _recipient()
    if not recipient:
        raise HTTPException(status_code=409, detail="No recipient: set JARVIS_BRIEF_EMAIL or reconnect Google.")

    # The crons retry when the Render instance is slow to wake, and a
    # timed-out first attempt may still have finished on the server. Each
    # routine sends at most once a day: if today's session already has a
    # turn, don't resend.
    session_id = f"{routine.session_prefix or routine.name}-{today.isoformat()}"
    already = (
        get_supabase_client()
        .table("jarvis_interaction_log")
        .select("id")
        .eq("session_id", session_id)
        .limit(1)
        .execute()
        .data
    )
    if already and not force:
        return {"ok": True, "routine": routine.name, "skipped": "Already sent today."}
    if routine.skip_if and not force:
        reason = routine.skip_if()
        if reason:
            return {"ok": True, "routine": routine.name, "skipped": reason}

    result = run_invoke(routine.request, session_id)
    subject = routine.subject(today)
    google_api.gmail_send_message(access_token, to=recipient, subject=subject, body=result["response"])
    return {
        "ok": True,
        "routine": routine.name,
        "sent_to": recipient,
        "subject": subject,
        "tools_used": result["tools_used"],
        "body": result["response"],
    }


# Sync on purpose, like /invoke.
@router.post("/routines/{name}/run", dependencies=[Depends(require_access_token)])
def run_routine(name: str, force: bool = False) -> dict:
    routine = ROUTINES.get(name)
    if routine is None:
        raise HTTPException(status_code=404, detail=f"Unknown routine: {name}. Known: {', '.join(ROUTINES)}")
    return _run(routine, force)


# The original morning-brief path, kept so morning-brief.yml and anything
# else already calling it keeps working.
@router.post("/brief/run", dependencies=[Depends(require_access_token)])
def run_brief(force: bool = False) -> dict:
    return _run(ROUTINES["morning-brief"], force)
