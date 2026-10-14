from datetime import datetime, timedelta, timezone

import pytest

from app.core.local_time import LOCAL_TZ
from app.services import push
from app.tools import protocols as protocols_mod
from app.tools import weather as weather_mod
from app.tools.hold import hold
from app.tools.protocols import protocols
from app.tools.reminders import next_occurrence, reminders, run_due_reminders
from app.tools.rounds import _allowed
from app.tools.schemas import DISPATCH, TOOL_SCHEMAS

# What the films' JARVIS does that ours did not: the weather on waking,
# reminders at a time, "hold all my calls", and protocols.


@pytest.fixture
def pushes(monkeypatch):
    """Records what would be pushed, through the real hold check."""
    sent = []
    monkeypatch.setattr(push, "push_configured", lambda: True)
    monkeypatch.setattr(push, "get_settings", lambda: type("S", (), {"vapid_subject": None, "vapid_private_key": "k"})())
    monkeypatch.setattr(push, "webpush", lambda **kw: sent.append(kw["data"]))
    return sent


def test_new_tools_are_registered():
    names = {s["function"]["name"] for s in TOOL_SCHEMAS}
    for name in ("weather", "reminders", "hold", "protocols"):
        assert name in names and name in DISPATCH


# --- reminders ---------------------------------------------------------------


def test_reminder_in_minutes_fires_once(db, pushes):
    db.tables["jarvis_push_subscriptions"] = [{"endpoint": "e", "p256dh": "p", "auth": "a"}]
    made = reminders({"operation": "set", "text": "Check the print", "in_minutes": 30})
    assert made["ok"], made
    assert run_due_reminders()["fired"] == []

    db.tables["jarvis_reminders"][0]["due_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    assert run_due_reminders()["fired"] == ["Check the print"]
    assert run_due_reminders()["fired"] == []  # claimed, never twice
    assert len(pushes) == 1 and "Check the print" in pushes[0]
    notice = db.tables["jarvis_inbox"][0]
    assert notice["topic"] == "reminders" and notice["priority"] == "high"


def test_reminder_at_local_time_and_past_time_refused(db):
    tomorrow = (datetime.now(LOCAL_TZ) + timedelta(days=1)).strftime("%Y-%m-%dT15:00")
    made = reminders({"operation": "set", "text": "Call Dr. Lee", "at": tomorrow})
    assert made["ok"] and "3:00 PM" in made["set"]["when"]
    stored = datetime.fromisoformat(db.tables["jarvis_reminders"][0]["due_at"]).astimezone(LOCAL_TZ)
    assert stored.hour == 15

    past = reminders({"operation": "set", "text": "Too late", "at": "2020-01-01T09:00"})
    assert not past["ok"] and "passed" in past["error"]


def test_repeating_reminder_books_the_next_and_cancel_stops_it(db, pushes):
    reminders({"operation": "set", "text": "Italian review", "in_minutes": 5, "repeat": "daily"})
    db.tables["jarvis_reminders"][0]["due_at"] = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    run_due_reminders()
    pending = reminders({"operation": "list"})["reminders"]
    assert len(pending) == 1 and pending[0]["repeat"] == "daily"
    assert reminders({"operation": "cancel", "item": "italian"})["ok"]
    assert reminders({"operation": "list"})["count"] == 0


def test_weekdays_skip_the_weekend_and_keep_wall_time_across_dst():
    friday = datetime(2026, 10, 30, 7, 30, tzinfo=LOCAL_TZ)
    monday = next_occurrence(friday, "weekdays", friday)
    assert monday.weekday() == 0 and (monday.hour, monday.minute) == (7, 30)
    # Daylight saving ends Nov 1 2026: still 7:30 local the day after.
    saturday = datetime(2026, 10, 31, 7, 30, tzinfo=LOCAL_TZ)
    sunday = next_occurrence(saturday, "daily", saturday)
    assert (sunday.astimezone(LOCAL_TZ).hour, sunday.astimezone(LOCAL_TZ).minute) == (7, 30)


# --- hold my calls -----------------------------------------------------------


def test_hold_silences_ordinary_pushes_but_not_urgent(db, pushes):
    db.tables["jarvis_push_subscriptions"] = [{"endpoint": "e", "p256dh": "p", "auth": "a"}]
    assert hold({"operation": "on", "minutes": 30, "reason": "Exam"})["held"]
    assert push.send_push("Markets", "SPY down 2%") == 0
    assert push.send_push("Lockout", "Five wrong PINs", urgent=True) == 1
    assert hold({"operation": "status"})["held"]


def test_hold_off_reports_what_arrived(db, pushes):
    hold({"operation": "on", "minutes": 30})
    db.tables["jarvis_inbox"] = [
        {"id": "1", "title": "New K.I.V. scan", "topic": "signals", "status": "pending",
         "created_at": datetime.now(timezone.utc).isoformat()}
    ]
    lifted = hold({"operation": "off"})
    assert lifted["count"] == 1 and lifted["arrived"][0]["title"] == "New K.I.V. scan"
    assert not hold({"operation": "status"})["held"]
    assert not push.hold_status()["held"]


def test_security_notice_gets_through_a_hold(db, pushes):
    from app.services.inbox import add_item, announce

    db.tables["jarvis_push_subscriptions"] = [{"endpoint": "e", "p256dh": "p", "auth": "a"}]
    hold({"operation": "on", "minutes": 30})
    announce([add_item("notice", "Market move", "QQQ -2%", "high", topic="markets")])
    assert pushes == []
    announce([add_item("notice", "PIN locked", "Five wrong tries", "high", topic="security")])
    assert len(pushes) == 1


# --- protocols ---------------------------------------------------------------


def test_protocols_built_in_custom_and_loose_names(db):
    got = protocols({"operation": "get", "name": "House Party Protocol"})
    assert got["ok"] and got["name"] == "house party" and got["steps"]
    assert protocols({"operation": "get", "name": "wake me up"})["name"] == "wake up"
    assert not protocols({"operation": "get", "name": "barrel roll"})["ok"]

    saved = protocols({"operation": "save", "name": "Gym Time", "steps": ["hold on for 90 minutes"]})
    assert saved["ok"] and saved["saved"] == "gym time"
    assert protocols({"operation": "get", "name": "gym time protocol"})["steps"] == ["hold on for 90 minutes"]
    names = {p["name"] for p in protocols({"operation": "list"})["protocols"]}
    assert {"gym time", "clean slate", "dossier"} <= names
    assert not protocols({"operation": "delete", "name": "clean slate"})["ok"]
    assert protocols({"operation": "delete", "name": "gym time"})["ok"]


def test_protocol_steps_name_real_tools():
    known = set(DISPATCH) | {"console"}
    for name, protocol in protocols_mod.BUILT_IN.items():
        text = " ".join(protocol["steps"])
        assert any(tool in text for tool in known), name


# --- rounds stay read-only ---------------------------------------------------


def test_rounds_can_read_but_not_set():
    assert _allowed("weather", {})
    assert _allowed("reminders", {"operation": "list"})
    assert not _allowed("reminders", {"operation": "set"})
    assert not _allowed("hold", {"operation": "on"})
    assert not _allowed("notes", {"operation": "save"})
    assert _allowed("notes", {"operation": "read"})
    assert not _allowed("protocols", {"operation": "get"})


# --- weather -----------------------------------------------------------------


def test_weather_shapes_open_meteo(monkeypatch):
    payload = {
        "current": {"time": "2026-10-14T07:00", "temperature_2m": 61.6, "apparent_temperature": 60.2,
                    "relative_humidity_2m": 80, "weather_code": 2, "wind_speed_10m": 5.1,
                    "wind_gusts_10m": 9.0, "precipitation": 0},
        "hourly": {"time": ["2026-10-14T06:00", "2026-10-14T07:00", "2026-10-14T08:00"],
                   "temperature_2m": [60, 61.6, 64], "precipitation_probability": [0, 10, 40],
                   "weather_code": [1, 2, 61]},
        "daily": {"time": ["2026-10-14"], "weather_code": [61], "temperature_2m_max": [78.4],
                  "temperature_2m_min": [55.1], "precipitation_probability_max": [40],
                  "sunrise": ["2026-10-14T07:09"], "sunset": ["2026-10-14T18:40"], "uv_index_max": [5]},
    }

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return payload

    monkeypatch.setattr(weather_mod.httpx, "get", lambda *a, **k: Response())
    result = weather_mod.weather({})
    assert result["ok"] and result["place"] == "Ruston, Louisiana"
    assert result["now"]["temp_f"] == 62 and result["now"]["conditions"] == "partly cloudy"
    assert result["next_hours"][0]["time"] == "7:00 AM"
    assert result["today"]["high_f"] == 78 and result["today"]["sunset"] == "6:40 PM"
