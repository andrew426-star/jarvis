from datetime import date, datetime
from zoneinfo import ZoneInfo

# Andrew is in Ruston, Louisiana. The server runs in UTC on Render, so
# "today" for a habit check-in or a flashcard due date has to be taken in
# this zone — at 8pm Central it is already tomorrow in UTC.
LOCAL_TZ = ZoneInfo("America/Chicago")


def local_today() -> date:
    return datetime.now(LOCAL_TZ).date()


def now_for_prompt() -> str:
    """The current Central date and time, spelled out for the system prompt
    so "today", "tomorrow" and every time Jarvis mentions mean Andrew's."""
    now = datetime.now(LOCAL_TZ)
    hour = now.strftime("%I").lstrip("0") or "12"
    stamp = f"{now.strftime('%A, %B')} {now.day}, {now.year}, {hour}:{now.strftime('%M %p')} {now.tzname()}"
    return (
        f"Current date and time: {stamp} (US Central, Andrew's time zone). Interpret "
        '"today", "tomorrow", "this week" and every time you mention in Central.'
    )
