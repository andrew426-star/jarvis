from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.routes import devices as route
from app.services import devices as svc

TOKEN = "d" * 64
EVENT = {"device": "Desk Sentry", "title": "Motion at the desk", "body": "Something at 142 cm"}


@pytest.fixture
def client(db, monkeypatch):
    settings = SimpleNamespace(jarvis_device_token=TOKEN)
    monkeypatch.setattr(route, "get_settings", lambda: settings)
    monkeypatch.setattr(svc, "announce", lambda items: None)
    svc._last_event.clear()
    from app.main import app

    return TestClient(app)


def auth(token=TOKEN):
    return {"Authorization": f"Bearer {token}"}


def test_device_routes_fail_closed(client, monkeypatch):
    assert client.post("/devices/event", json=EVENT).status_code == 401
    assert client.post("/devices/event", json=EVENT, headers=auth("wrong")).status_code == 401
    monkeypatch.setattr(route, "get_settings", lambda: SimpleNamespace(jarvis_device_token=None))
    assert client.post("/devices/event", json=EVENT, headers=auth()).status_code == 401


def test_an_alert_lands_in_the_inbox_once_a_minute(client, db):
    assert client.post("/devices/event", json=EVENT, headers=auth()).json() == {"ok": True, "filed": True}
    assert client.post("/devices/event", json=EVENT, headers=auth()).json()["filed"] is False
    rows = db.tables["jarvis_inbox"]
    assert len(rows) == 1 and rows[0]["topic"] == "security" and rows[0]["title"] == "Desk Sentry: Motion at the desk"

