from datetime import date, datetime
from zoneinfo import ZoneInfo

# Andrew is in Ruston, Louisiana. The server runs in UTC on Render, so
# "today" for a habit check-in or a flashcard due date has to be taken in
# this zone — at 8pm Central it is already tomorrow in UTC.
LOCAL_TZ = ZoneInfo("America/Chicago")


def local_today() -> date:
    return datetime.now(LOCAL_TZ).date()
