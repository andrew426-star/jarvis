from app.tools import console_control as c


def test_timer_actions():
    r = c.console({"actions": [
        {"action": "timer_start", "seconds": 600, "label": "Print cooling"},
        {"action": "timer_start", "target": "stopwatch", "label": "Lap"},
        {"action": "timer_start"},
        {"action": "timer_stop", "target": "Print"},
        {"action": "open_timers"},
    ]})
    assert r["actions"] == [
        {"action": "timer_start", "label": "Print cooling", "seconds": 600},
        {"action": "timer_start", "label": "Lap", "target": "stopwatch"},
        {"action": "timer_stop", "target": "Print"},
        {"action": "open_timers"},
    ]
    assert any("timer_start needs seconds" in p for p in r["skipped"])


def test_timer_state_note():
    note = c.state_note({"timers": [{"label": "Print cooling", "kind": "countdown", "state": "running", "remaining": "9:41"}]})
    assert "TIMERS: Print cooling (countdown, running, 9:41 left)." in note
