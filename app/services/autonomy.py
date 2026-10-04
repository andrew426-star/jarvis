import json
import logging
from datetime import datetime, timedelta, timezone

from app.core.local_time import LOCAL_TZ
from app.core.supabase_client import get_supabase_client
from app.services.inbox import announce, pending_summary
from app.services.orchestrator import run_invoke
from app.tools.rounds import round_tools

# Jarvis's rounds: every two hours (pg_cron, supabase/migrations/
# 0009_jarvis_autonomy.sql) he looks over Andrew's tasks, launch, habits,
# calendar, mail and lists on his own, and files what he finds in the inbox
# (app/services/inbox.py): notices to know, proposals to approve. He reads
# freely and changes nothing; app/tools/rounds.py holds every write for
# Andrew's approval. One push per round says what was filed, if anything.

logger = logging.getLogger(__name__)

SETTINGS_TABLE = "jarvis_autonomy"
# The cron fires every two hours plus a retry ten minutes later; this
# keeps the retry (or a manual run) from doubling a round.
MIN_GAP = timedelta(minutes=90)

ROUND_REQUEST = (
    "Make your rounds. It is {now}. Look over what is relevant at this hour: kiv_tasks (overdue, "
    "due in the next two days, blocked), launch_tracker (status, against its pace), habits "
    "(status, if it is afternoon or later), google_titan for today's and tomorrow's calendar and "
    "for unread mail that needs him, zoho_mail for anything recent from a customer or investor, "
    "and checklist (list) for open lists. File a notice for what he should know now, and a "
    "proposal for any action you would take for him, as the exact tool call. "
    "Already in his inbox, so do not file again: {pending}"
)


def get_settings_row() -> dict:
    rows = get_supabase_client().table(SETTINGS_TABLE).select("*").eq("id", "default").limit(1).execute().data
    if rows:
        return rows[0]
    return {"id": "default", "enabled": True, "quiet_start": 22, "quiet_end": 8, "last_round_at": None}


def update_settings(**changes) -> dict:
    changes = {k: v for k, v in changes.items() if v is not None}
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    rows = get_supabase_client().table(SETTINGS_TABLE).upsert({"id": "default", **changes}).execute().data
    return rows[0] if rows else get_settings_row()


def _quiet(hour: int, start: int, end: int) -> bool:
    """Inside quiet hours, which may wrap past midnight (22 -> 8)."""
    if start == end:
        return False
    return start <= hour < end if start < end else hour >= start or hour < end


def run_rounds(force: bool = False) -> dict:
    """One round, unless rounds are off, it is quiet hours, or one ran
    within MIN_GAP. `force` (Run now in the console) skips those checks."""
    settings = get_settings_row()
    now = datetime.now(LOCAL_TZ)
    if not force:
        if not settings.get("enabled", True):
            return {"ok": True, "skipped": "Rounds are switched off."}
        if _quiet(now.hour, settings.get("quiet_start", 22), settings.get("quiet_end", 8)):
            return {"ok": True, "skipped": "Quiet hours."}
        last = settings.get("last_round_at")
        if last and datetime.now(timezone.utc) - datetime.fromisoformat(last) < MIN_GAP:
            return {"ok": True, "skipped": "A round ran recently."}
    # Claimed up front, so the retry ten minutes later sees it even if this
    # round is still running.
    update_settings(last_round_at=datetime.now(timezone.utc).isoformat())

    session_id = f"rounds-{now.date().isoformat()}"
    schemas, handlers, filed = round_tools(session_id)
    pending = pending_summary()
    request = ROUND_REQUEST.format(
        now=now.strftime("%A %d %B, %I:%M %p Central"),
        pending=json.dumps(pending, default=str) if pending else "nothing.",
    )
    result = run_invoke(request, session_id, channel="autonomy", tool_override=(schemas, handlers))
    announce(filed)
    return {
        "ok": True,
        "filed": filed,
        "log": result.get("response", ""),
        "tools_used": result.get("tools_used", []),
    }
