from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import require_access_token
from app.core.config import get_settings
from app.core.google_oauth import get_google_access_token
from app.core.local_time import LOCAL_TZ, local_today
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
    # Central wall-clock time it runs at. days: 0 = Sunday ... 6 = Saturday,
    # None = every day.
    hour: int
    minute: int
    subject: Callable[[date], str]
    request: str
    # Returns a reason to skip today's run, or None to send.
    skip_if: Callable[[], str | None] | None = None
    # Session ids are "<prefix>-<date>"; the once-a-day guard keys on them.
    session_prefix: str | None = None
    days: tuple[int, ...] | None = None


# Jarvis's scheduled routines, each triggered by a GitHub Actions cron
# (.github/workflows/jarvis-routines.yml, plus morning-brief.yml), run
# through the ordinary agent loop in a session of its own per day, and
# emailed from the connected Gmail account to Andrew.
ROUTINES: dict[str, Routine] = {
    "morning-brief": Routine(
        name="morning-brief",
        hour=7,
        minute=0,
        subject=lambda d: f"Morning brief · {d.strftime('%A, %b')} {d.day}",
        request="Give me my morning brief." + EMAIL_NOTE,
        # What /brief/run used before routines existed; kept so the guard
        # still recognises briefs already sent under it.
        session_prefix="brief",
    ),
    "evening-checkin": Routine(
        name="evening-checkin",
        hour=20,
        minute=30,
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
        hour=17,
        minute=0,
        days=(0,),
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


def central_utc_offset_hours(now: datetime | None = None) -> int:
    """5 in daylight time (CDT), 6 in standard time (CST)."""
    now = now or datetime.now(LOCAL_TZ)
    offset = now.astimezone(LOCAL_TZ).utcoffset()
    return int(-offset.total_seconds() // 3600)


def utc_cron(routine: Routine, offset: int) -> str:
    """The GitHub (UTC) cron that fires this routine at its Central time,
    for one of the two offsets. GitHub cron has no time zones, so
    .github/workflows/jarvis-routines.yml lists both and the route keeps
    whichever matches the offset in effect."""
    total = routine.hour + offset
    hour = total % 24
    if routine.days is None:
        days = "*"
    else:
        days = ",".join(str(d) for d in sorted((d + total // 24) % 7 for d in routine.days))
    return f"{routine.minute} {hour} * * {days}"


# GitHub runs scheduled workflows best-effort and can start them hours
# late (an 8:30pm check-in once went out at 2:13am). A scheduled run that
# arrives later than this after its slot is dropped, not sent.
MAX_LATE = timedelta(minutes=90)


def last_occurrence(routine: Routine, now: datetime | None = None) -> datetime:
    """The most recent Central time this routine was due, at or before now."""
    now = (now or datetime.now(LOCAL_TZ)).astimezone(LOCAL_TZ)
    for back in range(8):
        day = now.date() - timedelta(days=back)
        slot = datetime(day.year, day.month, day.day, routine.hour, routine.minute, tzinfo=LOCAL_TZ)
        # isoweekday: Monday 1 ... Sunday 7; the routine's days count Sunday as 0.
        if slot <= now and (routine.days is None or day.isoweekday() % 7 in routine.days):
            return slot
    raise ValueError(f"{routine.name} has no occurrence in the past week")


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


def _run(routine: Routine, force: bool, due: datetime | None = None) -> dict:
    """`due` is the slot a scheduled run is for: it dates the email and
    bounds the once-per-slot guard. Manual runs have none and go by today."""
    today = due.date() if due else local_today()
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
    # routine sends at most once per slot: if this session already has a
    # turn since the slot came due, don't resend. Counting only from the
    # slot means a stray late send (say at 2am) cannot block that
    # evening's real one.
    session_id = f"{routine.session_prefix or routine.name}-{today.isoformat()}"
    query = (
        get_supabase_client()
        .table("jarvis_interaction_log")
        .select("id")
        .eq("session_id", session_id)
    )
    if due:
        query = query.gte("created_at", due.astimezone(timezone.utc).isoformat())
    already = query.limit(1).execute().data
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
def run_routine(name: str, force: bool = False, schedule: str | None = None) -> dict:
    routine = ROUTINES.get(name)
    if routine is None:
        raise HTTPException(status_code=404, detail=f"Unknown routine: {name}. Known: {', '.join(ROUTINES)}")
    # A scheduled run passes the cron that fired; only the one for Central's
    # current offset proceeds. Manual runs pass none.
    if schedule:
        expected = utc_cron(routine, central_utc_offset_hours())
        if schedule != expected:
            return {"ok": True, "routine": name, "skipped": f"Not this season's schedule ({expected} is)."}
        due = last_occurrence(routine)
        late = datetime.now(LOCAL_TZ) - due
        if late > MAX_LATE and not force:
            hours = late.total_seconds() / 3600
            return {
                "ok": True,
                "routine": name,
                "skipped": f"GitHub started this run {hours:.1f}h after its {due:%I:%M %p} slot; "
                "dropped rather than sent late.",
            }
        return _run(routine, force, due)
    return _run(routine, force)


# The original morning-brief path, kept so morning-brief.yml and anything
# else already calling it keeps working.
@router.post("/brief/run", dependencies=[Depends(require_access_token)])
def run_brief(force: bool = False) -> dict:
    return _run(ROUTINES["morning-brief"], force)
