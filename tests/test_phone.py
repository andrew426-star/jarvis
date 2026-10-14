import pytest
from fastapi.testclient import TestClient
from twilio.request_validator import RequestValidator

from app.api.routes import phone as route
from app.core.config import get_settings
from app.services import phone

# Jarvis answering the phone. Requests are signed the way Twilio signs
# them; Gemini, Twilio's REST API, Fish and Whisper are replaced.

BASE = "https://jarvis.example.com"
TOKEN = "twilio-auth-token"
ANDREW = "+13185550100"


@pytest.fixture
def line(db, monkeypatch):
    for key, value in {
        "TWILIO_ACCOUNT_SID": "AC123", "TWILIO_AUTH_TOKEN": TOKEN, "TWILIO_NUMBER": "+13185550199",
        "ANDREW_PHONE": ANDREW, "PUBLIC_BASE_URL": BASE, "FISH_AUDIO_API_KEY": "", "FISH_AUDIO_VOICE_ID": "",
    }.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    monkeypatch.setattr(phone, "summarize", lambda speech, number, contact: {
        "caller": "Dana Wu, Citadel", "reason": "the pilot next week", "spam": "warranty" in speech})
    from app.main import app

    yield TestClient(app), db
    get_settings.cache_clear()


def post(client, path: str, params: dict, signed: bool = True):
    signature = RequestValidator(TOKEN).compute_signature(f"{BASE}{path}", params) if signed else "nope"
    return client.post(path, data=params, headers={"X-Twilio-Signature": signature})


def test_unsigned_requests_are_refused(line):
    client, _ = line
    assert post(client, "/phone/voice", {"CallSid": "CA1", "From": "+15550001111"}, signed=False).status_code == 403


def test_a_call_is_screened_then_rung_through_and_accepted(line):
    client, db = line
    call = {"CallSid": "CA1", "From": "+15550001111"}
    greeting = post(client, "/phone/voice", call).text
    assert "<Gather" in greeting and "Jarvis" in greeting and "Polly.Brian" in greeting

    rung = post(client, "/phone/screen", {**call, "SpeechResult": "Dana from Citadel about the pilot"}).text
    assert f">{ANDREW}</Number>" in rung and 'timeout="15"' in rung

    whisper = post(client, "/phone/whisper?call=CA1", {"CallSid": "CA2"}).text
    assert "Dana Wu, Citadel" in whisper and "Press 1" in whisper

    assert post(client, "/phone/accept?call=CA1", {"CallSid": "CA2", "Digits": "1"}).text.endswith("<Response></Response>")
    done = post(client, "/phone/after-dial", {**call, "DialCallStatus": "completed"}).text
    assert "<Hangup/>" in done and "<Record" not in done
    assert db.tables["jarvis_calls"][0]["status"] == "done"


def test_not_taken_goes_to_a_transcribed_message(line, monkeypatch):
    client, db = line
    call = {"CallSid": "CA1", "From": "+15550001111"}
    post(client, "/phone/voice", call)
    post(client, "/phone/screen", {**call, "SpeechResult": "Dana about the pilot"})
    left = post(client, "/phone/after-dial", {**call, "DialCallStatus": "no-answer"}).text
    assert "<Record" in left and "/phone/recording" in left

    monkeypatch.setattr(phone, "fetch_recording", lambda url: b"mp3")
    monkeypatch.setattr(route, "transcribe_audio", lambda *a: "Can we move the pilot to Thursday?")
    post(client, "/phone/recording", {**call, "RecordingUrl": "https://api.twilio.com/rec/RE1"})
    notice = db.tables["jarvis_inbox"][-1]
    assert notice["title"] == "Voicemail from Dana Wu, Citadel" and "Thursday" in notice["body"] and notice["topic"] == "calls"


def test_spam_is_turned_away_and_a_hold_skips_the_ring(line):
    client, db = line
    post(client, "/phone/voice", {"CallSid": "CA1", "From": "+15550002222"})
    spam = post(client, "/phone/screen", {"CallSid": "CA1", "From": "+15550002222", "SpeechResult": "your car warranty"}).text
    assert "<Hangup/>" in spam and "<Dial" not in spam

    from app.tools.hold import hold

    hold({"operation": "on", "minutes": 30})
    post(client, "/phone/voice", {"CallSid": "CA3", "From": "+15550003333"})
    held = post(client, "/phone/screen", {"CallSid": "CA3", "From": "+15550003333", "SpeechResult": "Dana"}).text
    assert "<Record" in held and "<Dial" not in held


def test_a_hang_up_while_screening_is_a_missed_call(line):
    client, db = line
    post(client, "/phone/voice", {"CallSid": "CA9", "From": "+15550004444"})
    post(client, "/phone/status", {"CallSid": "CA9", "CallStatus": "completed"})
    assert db.tables["jarvis_inbox"][-1]["title"].startswith("Missed call")


def test_texts_from_andrew_reach_jarvis_and_others_become_notices(line, monkeypatch):
    client, db = line
    started = []
    monkeypatch.setattr(route.threading, "Thread", lambda target, args, daemon: type("T", (), {"start": lambda self: started.append(args)})())
    post(client, "/phone/sms", {"MessageSid": "SM1", "From": ANDREW, "Body": "remind me at 3 to call Dana"})
    assert started == [("remind me at 3 to call Dana",)]
    post(client, "/phone/sms", {"MessageSid": "SM2", "From": "+15550005555", "Body": "Running late"})
    assert db.tables["jarvis_inbox"][-1]["title"] == "Text from +15550005555"


def test_over_text_jarvis_reads_but_only_makes_small_changes(line):
    schemas, handlers = route.sms_tools()
    names = {s["function"]["name"] for s in schemas}
    assert {"reminders", "checklist", "google_titan", "phone"} <= names
    refused = handlers["google_titan"]({"operation": "gmail_send_message", "to": "x@y.com"})
    assert refused["ok"] is False and "console" in refused["error"]
    # The call log can be read by text; texting someone else cannot be done by text.
    assert handlers["phone"]({"operation": "text", "to": "+15550001111", "body": "hi"})["ok"] is False


def test_audio_links_are_signed_and_expire(line, monkeypatch):
    token = phone.audio_token("Good day.")
    assert phone.read_audio_token(token) == "Good day."
    assert phone.read_audio_token(token[:-1] + ("0" if token[-1] != "0" else "1")) is None
    monkeypatch.setattr(phone.time, "time", lambda: 10**12)
    assert phone.read_audio_token(token) is None
