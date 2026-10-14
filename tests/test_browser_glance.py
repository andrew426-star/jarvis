from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.tools.reminders import reminders

# The extension's popup: what waits (counts only), the hold, the next reminder.


def _client(monkeypatch):
    from app.api.routes import browser as route
    from app.main import app

    # Any bearer token passes as the extension's for this test.
    monkeypatch.setattr("app.core.auth.has_full_access", lambda token: token == "ext-token")
    return TestClient(app), route


def test_glance_counts_by_topic_without_contents(db, monkeypatch):
    client, _ = _client(monkeypatch)
    now = datetime.now(timezone.utc).isoformat()
    db.tables["jarvis_inbox"] = [
        {"id": "1", "kind": "notice", "title": "Mail from Dana: pilot", "body": "secret", "topic": "mail", "status": "pending", "priority": "high", "created_at": now},
        {"id": "2", "kind": "notice", "title": "Voicemail from Lee", "body": "secret", "topic": "calls", "status": "pending", "priority": "normal", "created_at": now},
        {"id": "3", "kind": "notice", "title": "Mail from Sam", "body": "secret", "topic": "mail", "status": "pending", "priority": "normal", "created_at": now},
    ]
    reminders({"operation": "set", "text": "Call Dana", "at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()})

    body = client.get("/browser/glance", headers={"Authorization": "Bearer ext-token"}).json()
    assert body["inbox"] == {"total": 3, "topics": {"mail": 2, "calls": 1}}
    assert body["next_reminder"]["text"] == "Call Dana"
    assert body["hold"]["held"] is False
    assert "secret" not in str(body) and "Dana: pilot" not in str(body)


def test_hold_on_and_off_from_the_popup(db, monkeypatch):
    client, _ = _client(monkeypatch)
    headers = {"Authorization": "Bearer ext-token"}
    assert client.post("/browser/hold", json={"minutes": 60}, headers=headers).json()["held"] is True
    assert client.get("/browser/glance", headers=headers).json()["hold"]["held"] is True
    assert client.post("/browser/hold", json={"minutes": None}, headers=headers).json()["held"] is False


def test_glance_needs_a_token(db, monkeypatch):
    client, _ = _client(monkeypatch)
    assert client.get("/browser/glance").status_code == 401
