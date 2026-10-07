from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.routes import devices as route
from app.services import devices as svc

TOKEN = "d" * 64


@pytest.fixture
def client(db, monkeypatch):
    settings = SimpleNamespace(jarvis_device_token=TOKEN, fish_audio_api_key="k", fish_audio_voice_id="v", fish_audio_model="m")
    monkeypatch.setattr(route, "get_settings", lambda: settings)
    monkeypatch.setattr(svc, "announce", lambda items: None)
    svc._last_event.clear()
    from app.main import app

    return TestClient(app)


def auth(token=TOKEN):
    return {"Authorization": f"Bearer {token}"}


def test_device_routes_fail_closed(client, monkeypatch):
    assert client.get("/devices/avatar").status_code == 401
    assert client.get("/devices/avatar", headers=auth("wrong")).status_code == 401
    monkeypatch.setattr(route, "get_settings", lambda: SimpleNamespace(jarvis_device_token=None))
    assert client.get("/devices/avatar", headers=auth()).status_code == 401


def test_an_alert_lands_in_the_inbox_once_a_minute(client, db):
    body = {"device": "Desk Sentry", "title": "Motion at the desk", "body": "Something at 142 cm"}
    assert client.post("/devices/event", json=body, headers=auth()).json() == {"ok": True, "filed": True}
    assert client.post("/devices/event", json=body, headers=auth()).json()["filed"] is False
    rows = db.tables["jarvis_inbox"]
    assert len(rows) == 1 and rows[0]["topic"] == "security" and rows[0]["title"] == "Desk Sentry: Motion at the desk"


def test_the_avatar_gets_each_reply_once_with_a_one_time_speech_link(client, monkeypatch):
    svc._pending.update(count=2, at=1e12)
    monkeypatch.setattr(route, "text_to_speech", lambda text, *a, **k: b"PCM:" + text.encode())
    svc.note_reply("Good evening, sir.")
    state = client.get("/devices/avatar?since=0", headers=auth()).json()
    assert state["say"] == "Good evening, sir." and state["pending"] == 2
    again = client.get(f"/devices/avatar?since={state['say_id']}", headers=auth()).json()
    assert again["say"] == "" and again["speech"] == ""
    audio = client.get(state["speech"])
    assert audio.status_code == 200 and audio.content == b"PCM:Good evening, sir."
    assert audio.headers["content-type"].startswith("audio/L16")
    assert client.get(state["speech"]).status_code == 404
