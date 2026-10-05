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
