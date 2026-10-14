from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.tools.home import home

# House devices check in and pick up what Jarvis queued for them.


def _client(monkeypatch):
    from app.api.routes import devices as route
    from app.main import app

    monkeypatch.setattr(route, "get_settings", lambda: type("S", (), {"jarvis_device_token": "dev-token"})())
    return TestClient(app)


def test_device_checks_in_and_collects_commands_once(db, monkeypatch):
    client = _client(monkeypatch)
    headers = {"Authorization": "Bearer dev-token"}
    body = {"device": "Room Hub", "state": {"temp_c": 22.5, "door": "closed"}, "capabilities": ["lights", "fan"]}
    assert client.post("/devices/state", json=body, headers=headers).json() == {"ok": True, "commands": []}

    status = home({"operation": "status"})["devices"]
    assert status[0]["device"] == "room-hub" and status[0]["online"] and status[0]["state"]["temp_c"] == 22.5

    queued = home({"operation": "command", "device": "room hub", "action": "lights", "value": 40})
    assert queued["ok"] and queued["online"]
    assert not home({"operation": "command", "device": "room-hub", "action": "unlock"})["ok"]  # not a capability
    assert not home({"operation": "command", "device": "garage", "action": "lights"})["ok"]

    commands = client.post("/devices/state", json=body, headers=headers).json()["commands"]
    assert [(c["action"], c["value"]) for c in commands] == [("lights", 40)]
    assert client.post("/devices/state", json=body, headers=headers).json()["commands"] == []


def test_device_routes_need_the_device_token(db, monkeypatch):
    client = _client(monkeypatch)
    response = client.post("/devices/state", json={"device": "x"}, headers={"Authorization": "Bearer wrong"})
    assert response.status_code == 401


def test_a_quiet_device_reads_offline(db):
    from app.services.home import _put

    stale = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    _put("home:desk", {"state": {}, "capabilities": [], "seen_at": stale})
    assert home({"operation": "status"})["devices"][0]["online"] is False
