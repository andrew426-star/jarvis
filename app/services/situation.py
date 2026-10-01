import json
import logging
import random
import threading
import time
from datetime import date, datetime

from app.core.google_oauth import SCHOOL_ROW_ID, get_google_access_token
from app.core.local_time import LOCAL_TZ
from app.core.redis_client import get_redis_client
from app.integrations.google_api import calendar_list_events

logger = logging.getLogger(__name__)

# The same Jarvis at 7am and at 1am should not sound the same. This builds a
# short note, per message, about the moment he is speaking in - the hour,
# the day, how long since Andrew last spoke to him, what is on his calendar
# - and how that should colour the reply, plus one mannerism drawn at
# random so that similar questions do not get word-for-word similar
# answers. The note shapes delivery only; it never adds content he was not
# asked for.

LAUNCH = date(2027, 1, 12)

# Hours are Central. Each band: a name and how to carry himself in it.
_BANDS = [
    (0, 5, "the small hours", (
        "Quiet and sparing: few words, no flourishes. You may remark on the hour once, drily, "
        "and suggest sleep only if it plainly matters; do not repeat it."
    )),
    (5, 8, "early morning", (
        "Brisk but gentle - he may have just woken. Short sentences, a light touch, the day ahead "
        "in view."
    )),
    (8, 12, "the morning", "Crisp and energetic, agenda-minded: this is when the day gets decided."),
    (12, 17, "the afternoon", "Efficient and steady; keep momentum, check progress without nagging."),
    (17, 21, "the evening", (
        "Warmer and a touch more reflective; the day's work is winding down, so a little more "
        "wit is welcome."
    )),
    (21, 24, "late evening", (
        "Lower-key and unhurried. Fewer words, dry concern at most; tomorrow is close."
    )),
]

# A mannerism per message, so repeated questions do not get repeated
# phrasing. Weighted toward what suits each band.
_MANNERS = {
    "any": [
        "a single dry understatement, somewhere natural",
        "clipped efficiency - get to the point, then one polished closing line",
        "a butler's formality with a flicker of warmth",
        "a wry aside in parentheses of tone, not punctuation",
        "an apt, lightly worn literary or historical allusion, only if it fits",
        "quiet confidence: state things plainly, no hedging",
        "an engineer's precision - one exact figure or detail where it lands well",
    ],
    "the small hours": ["hushed economy", "a single raised-eyebrow remark about the hour"],
    "early morning": ["gentle briskness", "a hint of coffee-and-briefing energy"],
    "the morning": ["crisp command-room energy", "forward-looking, agenda first"],
    "the afternoon": ["steady, workmanlike calm", "a nudge of momentum"],
    "the evening": ["relaxed wit", "a reflective beat about the day"],
    "late evening": ["low, unhurried delivery", "dry, fond concern"],
}

# How long a silence means the conversation has started over.
GREETING_GAP_SECONDS = 3 * 3600
CALENDAR_TTL_SECONDS = 600
CALENDAR_BUDGET_SECONDS = 1.5

_calendar_cache: tuple[float, list[dict] | None] = (0.0, None)  # (fetched at, events)
_calendar_lock = threading.Lock()


def _band(hour: int) -> tuple[str, str]:
    for start, end, name, guidance in _BANDS:
        if start <= hour < end:
            return name, guidance
    return _BANDS[0][2], _BANDS[0][3]


def _last_turn_at(session_id: str) -> datetime | None:
    """When this session last had an exchange, from the Redis window."""
    try:
        raw = get_redis_client().lrange(f"jarvis:session:{session_id}", 0, 0)
        if raw:
            return datetime.fromisoformat(json.loads(raw[0])["ts"])
    except Exception:  # noqa: BLE001 — situation is best effort
        logger.debug("last turn lookup failed", exc_info=True)
    return None


_refreshing = False


def _calendar() -> list[dict] | None:
    """Today's remaining events, cached; None when unavailable."""
    global _refreshing
    with _calendar_lock:
        fetched_at, events = _calendar_cache
        fresh = time.time() - fetched_at < CALENDAR_TTL_SECONDS
        # Stale but present: answer with it now and refresh behind the
        # reply, so the calendar only ever costs time on a cold start.
        if not fresh and fetched_at and not _refreshing:
            _refreshing = True
            threading.Thread(target=_refresh_calendar, daemon=True).start()
        if fetched_at:
            return events
    return _refresh_calendar()


def _refresh_calendar() -> list[dict] | None:
    global _calendar_cache, _refreshing
    try:
        token = get_google_access_token()
        events = calendar_list_events(token, 1, 8) if token else None
    except Exception:  # noqa: BLE001
        logger.debug("calendar fetch failed", exc_info=True)
        events = None
    # Classes live on the Louisiana Tech calendar, so "in class until 1:45"
    # needs it too. Best-effort: not connected or failing just leaves the
    # Kivaro events.
    try:
        school_token = get_google_access_token(SCHOOL_ROW_ID)
        if school_token:
            school_events = calendar_list_events(school_token, 1, 8)
            events = sorted((events or []) + school_events, key=lambda e: e.get("start") or "")
    except Exception:  # noqa: BLE001
        logger.debug("school calendar fetch failed", exc_info=True)
    with _calendar_lock:
        _calendar_cache = (time.time(), events)
        _refreshing = False
    return events


def _schedule_line(now: datetime) -> str | None:
    # The calendar is a network call; it gets a small budget, and a slow
    # one simply leaves the schedule out of this message.
    result: list = []
    worker = threading.Thread(target=lambda: result.append(_calendar()), daemon=True)
    worker.start()
    worker.join(CALENDAR_BUDGET_SECONDS)
    events = result[0] if result else None
    if not events:
        return None

    current = None
    upcoming = []
    for event in events:
        if event.get("all_day"):
            continue
        try:
            start = datetime.fromisoformat(event["start"]).astimezone(LOCAL_TZ)
            end = datetime.fromisoformat(event["end"]).astimezone(LOCAL_TZ)
        except (KeyError, ValueError):
            continue
        if start <= now < end:
            current = (event["summary"], end)
        elif now < start and (start - now).total_seconds() < 4 * 3600:
            upcoming.append((event["summary"], start))

    parts = []
    if current:
        parts.append(f"he is in \"{current[0]}\" until {current[1].strftime('%I:%M %p').lstrip('0')}")
    if upcoming:
        name, start = upcoming[0]
        minutes = int((start - now).total_seconds() // 60)
        when = f"in {minutes} minutes" if minutes < 90 else f"at {start.strftime('%I:%M %p').lstrip('0')}"
        parts.append(f"next is \"{name}\" {when}")
    if not parts:
        return "His calendar is clear for the next few hours."
    return (
        "Schedule: " + "; ".join(parts) + ". Let it set your pace - tighter and more focused "
        "with something imminent (and mention it if it bears on what he asked), easier when "
        "the time is his."
    )


def _recent_openers(turns: list[dict]) -> list[str]:
    openers = []
    for turn in turns:
        if turn.get("role") != "assistant":
            continue
        words = turn.get("content", "").split()
        if words:
            openers.append(" ".join(words[:6]))
    return openers[-5:]


def situation_note(session_id: str, recent_turns: list[dict] | None) -> str:
    now = datetime.now(LOCAL_TZ)
    band, guidance = _band(now.hour)
    weekend = now.weekday() >= 5

    lines = [
        f"THE MOMENT: it is {band} on a {now.strftime('%A')}"
        + (" - the weekend, so a lighter touch suits unless he is working." if weekend else ".")
        + f" {guidance}"
    ]

    last = _last_turn_at(session_id)
    if last is None:
        lines.append(
            "This is the first exchange of the session: open with a greeting that fits the hour "
            "and the day, in your own words - never a stock 'Good morning, sir' twice in a row."
        )
    else:
        gap = (datetime.now(last.tzinfo) - last).total_seconds()
        if gap > GREETING_GAP_SECONDS:
            hours = int(gap // 3600)
            lines.append(
                f"He has been away about {hours} hour{'s' if hours != 1 else ''}: acknowledge his "
                "return briefly and naturally before anything else."
            )
        else:
            lines.append(
                "You are mid-conversation: no greeting, no preamble - pick up exactly where "
                "things are."
            )

    schedule = _schedule_line(now)
    if schedule:
        lines.append(schedule)

    days = (LAUNCH - now.date()).days
    if days >= 0:
        lines.append(f"Kivaro launches in {days} days.")

    pool = _MANNERS["any"] + _MANNERS.get(band, []) * 2
    lines.append(f"For this reply, a mannerism to lean on: {random.choice(pool)}.")

    openers = _recent_openers(recent_turns or [])
    if openers:
        lines.append(
            "Your recent replies opened with: " + " | ".join(f'"{o}"' for o in openers)
            + ". Open differently this time, and do not start with \"Sir\" by reflex."
        )
    lines.append("All of this shapes how you say things, never what you add: no unasked-for tangents.")
    return "\n".join(lines)
