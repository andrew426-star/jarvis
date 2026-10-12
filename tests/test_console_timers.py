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


def test_window_actions():
    actions = [
        {"action": "pop_out", "target": "Workshop"},
        {"action": "pop_out", "target": "markets"},
        {"action": "pop_in", "target": "timers"},
        {"action": "pop_out", "target": "fridge"},
    ]
    # Jarvis: his own panels; the workshop is Ultron's.
    r = c.console({"actions": actions})
    assert r["actions"] == [
        {"action": "pop_out", "target": "markets"},
        {"action": "pop_in", "target": "timers"},
    ]
    assert any("pop_out needs" in p for p in r["skipped"])
    assert any("Ultron's" in p for p in r["skipped"])
    # Ultron: the workshop; markets are Jarvis's.
    r = c.console({"actions": actions}, ultron=True)
    assert r["actions"] == [
        {"action": "pop_out", "target": "workshop"},
        {"action": "pop_in", "target": "timers"},
    ]


def test_each_ai_opens_his_own_apps():
    r = c.console({"actions": [{"action": "open_panel", "target": "legion"}, {"action": "open_panel", "target": "notes"}, {"action": "open_workshop"}]})
    assert r["actions"] == [{"action": "open_panel", "target": "notes"}]
    assert any("set_mode serious" in p for p in r["skipped"])
    r = c.console({"actions": [{"action": "open_panel", "target": "legion"}, {"action": "open_panel", "target": "notes"}, {"action": "open_workshop"}]}, ultron=True)
    assert r["actions"] == [{"action": "open_panel", "target": "legion"}, {"action": "open_workshop"}]
    assert any("set_mode normal" in p for p in r["skipped"])
    assert "In windows of their own: workshop." in c.state_note({"windows_out": ["workshop"]})


def test_timer_state_note():
    note = c.state_note({"timers": [{"label": "Print cooling", "kind": "countdown", "state": "running", "remaining": "9:41"}]})
    assert "TIMERS: Print cooling (countdown, running, 9:41 left)." in note
