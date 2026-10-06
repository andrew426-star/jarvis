import pytest
from fastapi import HTTPException

from app.api.routes import camera_link as cl


def test_camera_link_round_trip():
    code = cl.open_link()["code"]
    assert len(code) == 4 and cl.get_offer(code)["sdp"] is None
    cl.post_offer(code, {"sdp": "v=0 offer"})
    assert cl.get_offer(code)["sdp"] == "v=0 offer" and cl.get_answer(code)["sdp"] is None
    cl.post_answer(code, {"sdp": "v=0 answer"})
    assert cl.get_answer(code)["sdp"] == "v=0 answer"
    with pytest.raises(HTTPException):
        cl.post_offer(code, {"sdp": "not sdp"})
    cl.close_link(code)
    with pytest.raises(HTTPException):
        cl.get_offer(code)


def test_camera_link_expires(monkeypatch):
    code = cl.open_link()["code"]
    real = cl.time.time
    monkeypatch.setattr(cl.time, "time", lambda: real() + cl.ROOM_TTL_S + 1)
    with pytest.raises(HTTPException):
        cl.get_offer(code)


def test_camera_relay_passes_frames(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    monkeypatch.setattr(cl, "has_full_access", lambda token: token == "good")
    app = FastAPI()
    app.include_router(cl.relay_router)
    client = TestClient(app)
    code = cl.open_link()["code"]
    with client.websocket_connect(f"/camera-link/{code}/relay") as desk:
        desk.send_json({"role": "desk", "token": "good"})
        assert desk.receive_json() == {"type": "ready", "peer": False}
        with client.websocket_connect(f"/camera-link/{code}/relay") as phone:
            phone.send_json({"role": "phone", "token": "good"})
            assert phone.receive_json() == {"type": "ready", "peer": True}
            assert desk.receive_json() == {"type": "peer"}
            phone.send_bytes(b"\xff\xd8jpeg")
            assert desk.receive_bytes() == b"\xff\xd8jpeg"
        assert desk.receive_json() == {"type": "peer-left"}
    with client.websocket_connect(f"/camera-link/{code}/relay") as stranger:
        stranger.send_json({"role": "phone", "token": "bad"})
        with pytest.raises(Exception):
            stranger.receive_json()
