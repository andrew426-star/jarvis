from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import require_access_token
from app.core.config import get_settings
from app.core.google_oauth import get_google_access_token
from app.core.local_time import local_today
from app.core.supabase_client import get_supabase_client
from app.integrations import google_api
from app.services.orchestrator import run_invoke

router = APIRouter()

BRIEF_REQUEST = (
    "Give me my morning brief. This one is going out by email, so it will be read rather than "
    "heard: keep the same voice, plain prose, short paragraphs."
)


def _brief_recipient() -> str | None:
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


# Called each morning by .github/workflows/morning-brief.yml with
# JARVIS_ACCESS_TOKEN, so the brief arrives without Andrew asking for it.
# Runs the ordinary agent loop — same tools, same persona — in a session
# of its own per day, then emails the result from the connected Gmail
# account to itself (or JARVIS_BRIEF_EMAIL). Sync on purpose, like /invoke.
@router.post("/brief/run", dependencies=[Depends(require_access_token)])
def run_brief(force: bool = False) -> dict:
    today = local_today()
    access_token = get_google_access_token()
    if not access_token:
        raise HTTPException(status_code=409, detail="Google not connected; visit /auth/google/connect.")
    recipient = _brief_recipient()
    if not recipient:
        raise HTTPException(status_code=409, detail="No recipient: set JARVIS_BRIEF_EMAIL or reconnect Google.")

    session_id = f"brief-{today.isoformat()}"
    # The cron retries when the Render instance is slow to wake, and a
    # timed-out first attempt may still have finished on the server. One
    # brief per day: if today's session already has a turn, don't resend.
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
        return {"ok": True, "skipped": "Today's brief was already sent."}

    result = run_invoke(BRIEF_REQUEST, session_id)
    subject = f"Morning brief · {today.strftime('%A, %b')} {today.day}"
    google_api.gmail_send_message(access_token, to=recipient, subject=subject, body=result["response"])

    return {
        "ok": True,
        "sent_to": recipient,
        "subject": subject,
        "tools_used": result["tools_used"],
        "brief": result["response"],
    }
