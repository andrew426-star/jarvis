import pytest

from app.tools import workshop_project as wp
from app.services.orchestrator import _model_view

BLINK = """
const int LED_PIN = 13;
void setup() { pinMode(LED_PIN, OUTPUT); Serial.begin(9600); }
void loop() { digitalWrite(LED_PIN, HIGH); delay(500); digitalWrite(LED_PIN, LOW); delay(500); }
"""


def project(parts, wires, code="", **extra):
    p, problems = wp.normalize({"name": "Test", "parts": parts, "wires": wires, "code": code, **extra})
    assert not problems, problems
    return p


def texts(checks, level=None):
    return [c["text"] for c in checks if level is None or c["level"] == level]


UNO = {"id": "U1", "type": "uno"}


def test_led_without_resistor_is_an_error_and_with_one_is_priced():
    bare = project([UNO, {"id": "LED1", "type": "led"}], [{"a": "U1.D13", "b": "LED1.A"}, {"a": "LED1.K", "b": "U1.GND"}], BLINK)
    assert any("no current-limiting resistor" in t for t in texts(wp.check(bare), "error"))

    two_hundred = project(
        [UNO, {"id": "LED1", "type": "led"}, {"id": "R1", "type": "resistor", "props": {"ohms": 100}}],
        [{"a": "U1.D13", "b": "R1.1"}, {"a": "R1.2", "b": "LED1.A"}, {"a": "LED1.K", "b": "U1.GND"}],
        BLINK,
    )
    checks = wp.check(two_hundred)
    # 100 ohm: (5 - 2) / 100 = 30 mA, over the 20 mA rating.
    assert any("about 30 mA" in t for t in texts(checks, "warning"))
    assert not texts(checks, "error")


def test_shorts_motors_and_supply_voltages():
    p = project(
        [UNO, {"id": "M1", "type": "dc_motor"}, {"id": "SRV1", "type": "servo"}, {"id": "PSU", "type": "supply_12v"}],
        [
            {"a": "U1.D5", "b": "M1.+"}, {"a": "M1.-", "b": "U1.GND"},
            {"a": "SRV1.V+", "b": "PSU.+"}, {"a": "SRV1.GND", "b": "U1.GND"}, {"a": "SRV1.SIG", "b": "U1.D9"},
            {"a": "U1.5V", "b": "U1.GND"},
        ],
    )
    checks = wp.check(p)
    errors = texts(checks, "error")
    assert any("needs a driver" in t for t in errors)
    assert any("SRV1.V+ gets 12V" in t for t in errors)
    assert any("Short circuit" in t for t in errors)
    assert "PSU.- is not wired." in texts(checks, "warning")

    p["wires"].append({"a": "PSU.-", "b": "M1.-"})
    p["wires"].remove({"a": "M1.-", "b": "U1.GND"})
    assert any("Grounds are not common" in t for t in texts(wp.check(p), "error"))


def test_code_is_checked_against_the_wiring():
    p = project(
        [UNO, {"id": "B1", "type": "button"}],
        [{"a": "U1.D2", "b": "B1.1"}, {"a": "B1.2", "b": "U1.GND"}],
        "void setup(){ pinMode(2, INPUT_PULLUP); pinMode(7, OUTPUT); analogWrite(4, 100); analogRead(3);}\nvoid loop(){}",
    )
    checks = wp.check(p)
    assert any("uses D7 but nothing is wired" in t for t in texts(checks))
    assert any("analogWrite on D4" in t for t in texts(checks))
    assert any("analogRead on D3" in t for t in texts(checks, "error"))
    assert not any("D2" in t for t in texts(checks))


def test_a4988_reset_and_hall_pullup():
    p = project(
        [UNO, {"id": "DRV", "type": "a4988"}, {"id": "HS", "type": "hall"}],
        [{"a": "DRV.STEP", "b": "U1.D3"}, {"a": "HS.OUT", "b": "U1.D4"}, {"a": "HS.VCC", "b": "U1.5V"}, {"a": "HS.GND", "b": "U1.GND"}],
        "void setup(){ pinMode(4, INPUT); }\nvoid loop(){}",
    )
    checks = wp.check(p)
    assert any("stays in reset" in t for t in texts(checks, "error"))
    assert any("open collector" in t for t in texts(checks, "warning"))


def test_normalize_rejects_bad_parts_and_pins():
    p, problems = wp.normalize({
        "parts": [UNO, {"id": "X1", "type": "warp_core"}, {"id": "led1", "type": "led"}],
        "wires": [{"a": "U1.D99", "b": "LED1.A"}, {"a": "u1.d13", "b": "LED1.a"}],
    })
    assert [x["id"] for x in p["parts"]] == ["U1", "LED1"]
    assert p["wires"] == [{"a": "U1.D13", "b": "LED1.A"}]
    assert any("warp_core" in x for x in problems) and any("no pin 'D99'" in x for x in problems)


def test_bom_prices_packs_and_flags_what_tech_does_not_stock():
    p = project(
        [UNO, *({"id": f"R{i}", "type": "resistor", "props": {"ohms": 1000}} for i in range(5)),
         {"id": "R9", "type": "resistor", "props": {"ohms": 220}}, {"id": "LED1", "type": "led", "props": {"color": "blue"}}],
        [{"a": "U1.D13", "b": "R1.1"}],
        extras=[{"item": "Extruded Aluminum: M5 10mm machine screws, Torx, black oxide", "qty": 8}],
    )
    b = wp.bom(p)
    lines = {l["item"]: l for l in b["lines"]}
    assert lines["1 kOhm resistor"]["buy"] == 2 and lines["1 kOhm resistor"]["where"] == "Vending: Buttons, C3"
    assert lines["Arduino UNO Rev3"]["where"] == "Engineering store"
    assert lines["Extruded Aluminum: M5 10mm machine screws, Torx, black oxide"]["buy"] == 2
    assert "Jumper wires: pack of 140" in lines
    assert any("R9" in x for x in b["not_stocked"]) and any("LED1" in x for x in b["not_stocked"])
    assert b["estimated_total"] == round(b["subtotal"] * 1.13, 2)


def test_tool_saves_compiles_and_keeps_the_payload_from_the_model(db, monkeypatch):
    compiles = []

    def fake_compile(code):
        compiles.append(code)
        return {"ok": True, "hex": ":00000001FF\n", "flash_bytes": 900, "ram_bytes": 10, "warnings": []}

    monkeypatch.setattr(wp, "compile_sketch", fake_compile)
    opened = wp.project_tool({"operation": "open", "name": "Blinky", "goal": "learn"}, None)
    assert opened["ok"] and opened["project"] == "Blinky"
    pid = opened["actions"][0]["project"]["id"]

    result = wp.project_tool({
        "operation": "update",
        "parts": [UNO, {"id": "LED1", "type": "led"}, {"id": "R1", "type": "resistor"}],
        "wires": [{"a": "U1.D13", "b": "R1.1"}, {"a": "R1.2", "b": "LED1.A"}, {"a": "LED1.K", "b": "U1.GND"}],
        "code": BLINK,
    }, pid)
    assert result["compile"]["ok"] and len(compiles) == 1
    assert not [c for c in result["checks"] if c["level"] == "error"]
    loaded = result["actions"][0]["project"]
    assert loaded["id"] == pid and loaded["hex"] and loaded["goal"] == "learn"

    # Same code again: no recompile. The model never sees the sketch or HEX.
    again = wp.project_tool({"operation": "update", "name": "Blinky v2"}, pid)
    assert len(compiles) == 1 and again["project"] == "Blinky v2"
    seen = _model_view(again)
    assert seen["actions"][0]["project"] == "(sent to the console)"
    assert len(db.tables[wp.TABLE]) == 1

    assert wp.project_tool({"operation": "simulate", "run": True, "inputs": {"b1": True}}, pid)["actions"][0] == {
        "action": "sim", "run": True, "inputs": {"B1": True}}
    assert [p["name"] for p in wp.project_tool({"operation": "list"}, pid)["projects"]] == ["Blinky v2"]


def test_state_line_reports_the_simulation():
    line = wp.state_line({"project": {"name": "Blinky", "parts": 3, "sim": {
        "running": True, "time_s": 4.2, "readings": ["LED1 on 13 mA"], "warnings": ["D13 sourcing 45 mA"], "serial": "hello\n"}}})
    assert "RUNNING" in line and "LED1 on 13 mA" in line and "D13 sourcing 45 mA" in line and "hello" in line


@pytest.mark.parametrize("code,ok", [('#include "../../etc/passwd"', False), ("#include <Servo.h>\nvoid setup(){}\nvoid loop(){}", None)])
def test_compile_refuses_path_includes(code, ok, monkeypatch):
    from app.services import arduino

    monkeypatch.setattr(arduino, "_cli", lambda: None)
    result = arduino.compile_sketch(code)
    if ok is False:
        assert "library headers" in result["error"]
    else:
        assert result.get("unavailable")


def test_status_notes_groups_and_the_gallery(db, monkeypatch):
    monkeypatch.setattr(wp, "compile_sketch", lambda code: {"ok": True, "hex": ":00000001FF", "warnings": []})
    pid = wp.project_tool({"operation": "open", "name": "Rover"}, None)["actions"][0]["project"]["id"]
    wp.project_tool({
        "operation": "update", "status": "simulate", "notes": "Wheels 60 mm.",
        "parts": [UNO, {"id": "M1", "type": "dc_motor", "group": "Drive"}],
        "printed": [{"name": "Motor clip", "code": "cube(5);", "group": "Drive"}],
        "wires": [{"a": "U1.D5", "b": "M1.+"}],
    }, pid)
    project = wp.get_project(pid)
    assert project["status"] == "simulate" and project["notes"] == "Wheels 60 mm."
    assert project["parts"][1]["group"] == "Drive" and project["printed"][0]["group"] == "Drive"
    assert wp.normalize({"status": "teleported"})[0]["status"] == "design"
    [card] = wp.gallery()
    assert card["name"] == "Rover" and card["groups"] == ["Drive"] and card["errors"] >= 1
    assert "code" not in card and card["printed"][0]["code"] == "cube(5);"
