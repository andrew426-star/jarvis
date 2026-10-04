import math
import random
import time

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core import auth, session
from app.services import lock


def gate(token: str) -> int:
    try:
        auth.require_access_token(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))
        return 200
    except HTTPException as exc:
        return exc.status_code


def test_pin_is_stored_only_as_a_hash(db):
    lock.set_pin("1879")
    row = db.tables["jarvis_lock"][0]
    assert "1879" not in str(row)
    assert len(row["pin_hash"]) == 64 and len(row["pin_salt"]) == 32
    lock.check_pin("1879")


def test_wrong_pins_count_down_then_lock_and_say_so_once(db):
    lock.set_pin("1879")
    for left in (4, 3, 2, 1):
        with pytest.raises(lock.Rejected, match=f"{left} tr"):
            lock.check_pin("0000")
    with pytest.raises(lock.LockedOut) as started:
        lock.check_pin("0000")
    assert started.value.started
    # Locked: even the right PIN is refused, and this is not a new lockout.
    with pytest.raises(lock.LockedOut) as again:
        lock.check_pin("1879")
    assert not again.value.started


def test_lockouts_double(db):
    lock.set_pin("1879")
    row = db.tables["jarvis_lock"][0]
    row["pin_failures"] = 9
    with pytest.raises(lock.LockedOut):
        lock.check_pin("0000")
    until = lock._locked_until(db.tables["jarvis_lock"][0]["pin_locked_until"])
    minutes = (until - lock._now()).total_seconds() / 60
    assert 29 < minutes <= 30  # the second lockout is 30 minutes


def test_right_pin_resets_failures(db):
    lock.set_pin("1879")
    with pytest.raises(lock.Rejected):
        lock.check_pin("1111")
    lock.check_pin("1879")
    assert db.tables["jarvis_lock"][0]["pin_failures"] == 0


def _face(seed: int) -> list[float]:
    rnd = random.Random(seed)
    v = [rnd.gauss(0, 1) for _ in range(128)]
    n = math.sqrt(sum(x * x for x in v))
    return [x / n * 0.9 for x in v]


def _jitter(v, seed, scale=0.02):
    rnd = random.Random(seed)
    return [x + rnd.gauss(0, scale) for x in v]


def test_face_matches_its_owner_only(db):
    me, other = _face(1), _face(2)
    assert lock.enroll_face([_jitter(me, i) for i in range(5)]) == 5
    live = {"blinked": True, "turned": True}
    assert lock.check_face([_jitter(me, 10 + i) for i in range(3)], live) < lock.FACE_MATCH_DISTANCE
    with pytest.raises(lock.Rejected, match="not recognised"):
        lock.check_face([_jitter(other, 20 + i) for i in range(3)], live)


def test_face_needs_liveness_and_a_clear_capture(db):
    me = _face(1)
    lock.enroll_face([_jitter(me, i) for i in range(5)])
    with pytest.raises(lock.Rejected, match="liveness"):
        lock.check_face([_jitter(me, 9)] * 3, {"blinked": True, "turned": False})
    with pytest.raises(lock.Rejected, match="clearly"):
        lock.check_face([[0.1] * 5, [float("nan")] * 128], {"blinked": True, "turned": True})


def test_enrolment_refuses_two_faces(db):
    with pytest.raises(lock.Rejected, match="did not agree"):
        lock.enroll_face([_jitter(_face(1), 1), _jitter(_face(1), 2), _jitter(_face(2), 3)])


def test_the_gate():
    signed_in = session.issue_session("andrew@example.com")
    unlock, _ = session.issue_unlock_token("andrew@example.com", "pin")
    stranger, _ = session.issue_unlock_token("someone@example.com", "pin")
    expired = session._issue({"email": "andrew@example.com", "scope": "unlock", "m": "pin", "exp": int(time.time()) - 5})
    assert gate(unlock) == 200
    assert gate("script-token") == 200
    assert gate(signed_in) == 423  # signed in, but locked
    assert gate(expired) == 423  # ran out: lock again, do not sign out
    assert gate(stranger) == 401
    assert gate(unlock[:-2] + ("00" if not unlock.endswith("00") else "11")) == 401
    assert gate("nonsense") == 401


def test_unlock_tokens_are_not_sessions_and_vice_versa():
    unlock, _ = session.issue_unlock_token("andrew@example.com", "face")
    assert session.verify_session(unlock) is None
    assert session.verify_unlock_token(session.issue_session("andrew@example.com")) is None


def test_attempts_are_audited_and_lockouts_alerted(db, monkeypatch):
    from app.api.routes import unlock as routes

    pushed = []
    monkeypatch.setattr(routes, "announce", lambda items: pushed.extend(items))
    lock.set_pin("1879")

    class Req:
        headers = {"x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "TestPhone"}
        client = None

    for _ in range(5):
        with pytest.raises(HTTPException):
            routes.unlock_pin(routes.PinBody(pin="0000"), Req(), "andrew@example.com")
    events = db.tables["jarvis_auth_events"]
    assert [e["outcome"] for e in events] == ["wrong"] * 4 + ["locked"]
    assert events[0]["ip"] == "203.0.113.9" and events[0]["user_agent"] == "TestPhone"
    assert len(pushed) == 1 and pushed[0]["topic"] == "security" and pushed[0]["priority"] == "high"
