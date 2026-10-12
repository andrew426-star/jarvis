from app.tools.directive import directive


def test_set_validates_and_starts_the_first_step():
    r = directive({"op": "set", "objective": "Arm that sorts screws", "phases": [{"name": "Design", "steps": ["Torque budget", "Gripper"]}, {"name": "Empty", "steps": []}]})
    assert r["ok"]
    phases = r["actions"][0]["phases"]
    assert [p["name"] for p in phases] == ["Design"]
    assert phases[0]["steps"][0] == {"text": "Torque budget", "status": "active"}
    assert directive({"op": "set", "objective": "", "phases": []})["ok"] is False


def test_steps_are_checked_against_the_plan_as_it_stands():
    current = {"objective": "x", "phases": [{"name": "A", "steps": [{"text": "a", "status": "active"}]}]}
    assert directive({"op": "step", "phase": 1, "step": 1, "status": "done", "note": "ok"}, current)["actions"] == [
        {"op": "step", "phase": 1, "step": 1, "status": "done", "note": "ok"}
    ]
    assert directive({"op": "step", "phase": 2, "step": 1, "status": "done"}, current)["ok"] is False
    assert directive({"op": "step", "phase": 1, "step": 1, "status": "sleeping"}, current)["ok"] is False
    assert directive({"op": "add", "phase": 1, "text": "b"}, current)["actions"] == [{"op": "add", "phase": 1, "text": "b"}]
    assert directive({"op": "step", "phase": 1, "step": 1, "status": "done"}, None)["ok"] is False
