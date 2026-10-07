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


def test_wear_and_try_on():
    p, _ = wp.normalize({"wear": {"anchor": "wrist", "group": "Band", "offset": [0, 0, 22], "scale": 9}})
    assert p["wear"] == {"anchor": "wrist", "group": "Band", "offset": [0.0, 0.0, 22.0], "rot": [0.0, 0.0, 0.0], "scale": 5.0}
    assert wp.normalize({"wear": {"anchor": "tail"}})[0]["wear"] is None
    assert not wp.project_tool({"operation": "try_on"}, None)["ok"]
    assert wp.project_tool({"operation": "try_on", "anchor": "face"}, "abc")["actions"] == [{"action": "try_on", "anchor": "face"}]
    line = wp.state_line({"project": {"name": "Specs", "parts": 1, "try_on": {"active": True, "anchor": "face", "tracking": "tracking"}}})
    assert "TRY-ON showing in his camera on his face: tracking" in line


def test_wear_actions_and_finishes():
    p, problems = wp.normalize({
        "wear": {
            "anchor": "chest",
            "actions": [
                {"name": "Unibeam", "kind": "beam", "at": [0, -10, 0], "charge": 99, "color": "#9fdcff"},
                {"name": "Visor", "kind": "deploy", "cue": "jaw", "at": [0, 0, 40], "turn": [-70, 0, 0], "targets": ["Faceplate"]},
                {"name": "Nope", "kind": "deploy", "at": [0, 0, 0]},
                {"name": "Bad", "kind": "laser", "at": [0, 0, 0]},
            ],
        },
        "printed": [{"name": "Shell", "code": "cube(1);", "material": "silk", "color": "#a8201a"}, {"name": "X", "code": "cube(1);", "material": "gold"}],
    })
    beam, visor = p["wear"]["actions"]
    assert beam == {"name": "Unibeam", "kind": "beam", "cue": "auto", "at": [0.0, -10.0, 0.0], "dir": [0.0, -1.0, 0.0], "color": "#9fdcff", "charge": 5.0}
    assert visor["targets"] == ["Faceplate"] and visor["turn"] == [-70.0, 0.0, 0.0] and visor["cue"] == "jaw"
    assert any("Nope" in x for x in problems) and any("Bad" in x for x in problems)
    assert p["printed"][0]["material"] == "silk" and p["printed"][0]["color"] == "#a8201a"
    assert "material" not in p["printed"][1]
    fired = wp.project_tool({"operation": "try_on", "fire": "Unibeam"}, "abc")["actions"]
    assert fired == [{"action": "try_on", "fire": "Unibeam"}]
    line = wp.state_line({"project": {"name": "Reactor", "parts": 1, "try_on": {"active": True, "anchor": "chest", "tracking": "tracking", "actions": [{"name": "Unibeam"}], "last_fired": "Unibeam"}}})
    assert "actions Unibeam" in line and "last fired Unibeam" in line


def test_specialty_filaments():
    p, _ = wp.normalize({"printed": [
        {"name": "Visor", "code": "cube(1);", "material": "dual_silk", "color": "#c9a24a", "color2": "#b33a3a", "texture": "smooth"},
        {"name": "Badge", "code": "cube(1);", "material": "glow", "texture": "sandpaper"},
    ]})
    visor, badge = p["printed"]
    assert visor["material"] == "dual_silk" and visor["color2"] == "#b33a3a" and visor["texture"] == "smooth"
    assert badge["material"] == "glow" and "texture" not in badge


def test_segments_are_kept_bounded_and_loop_free():
    raw = {
        "parts": [{"id": "U1", "type": "uno"}, {"id": "LED1", "type": "led", "group": "Hand"}],
        "printed": [{"name": "Bracer", "code": "cube(1);"}],
        "segments": [
            {"name": "Hand", "members": ["hand", "Ghost"], "pivot": [0, 0, 0], "anchor": "hand",
             "limits": [[70, -70], [-70, 70], [-30, 30]], "pose": [0, 400, 0], "parent": "Finger"},
            {"name": "Finger", "members": ["LED1"], "parent": "Hand"},
            {"name": "Controller", "members": ["u1"], "move": [-400, 0, 45], "anchor": "upper_arm"},
            {"name": "hand", "members": ["Bracer"]},
            {"name": "Elbow", "members": [], "anchor": "tail"},
        ],
        "wear": {"anchor": "wrist", "actions": [{"name": "Blast", "kind": "repulsor", "at": [70, 0, -20], "segment": "Hand"}]},
    }
    p, problems = wp.normalize(raw)
    segs = {s["name"]: s for s in p["segments"]}
    assert list(segs) == ["Hand", "Finger", "Controller", "Elbow"]
    # Group names match whatever their case; unknown members are reported.
    assert segs["Hand"]["members"] == ["Hand"]
    assert any("Ghost" in m for m in problems)
    assert segs["Hand"]["limits"][0] == [-70.0, 70.0]
    assert segs["Hand"]["pose"] == [0.0, 180.0, 0.0]
    # Hand -> Finger -> Hand loops: the first parent goes, the other stays.
    assert "parent" not in segs["Hand"] and segs["Finger"]["parent"] == "Hand"
    assert segs["Controller"] == {"name": "Controller", "members": ["U1"], "move": [-400.0, 0.0, 45.0], "anchor": "upper_arm"}
    assert "anchor" not in segs["Elbow"]
    assert any("own" in m for m in problems)
    assert p["wear"]["actions"][0]["segment"] == "Hand"
    assert wp.normalize({})[0]["segments"] == []
    assert "segments" in wp.SECTIONS


ESP = {"id": "U1", "type": "esp32"}


def test_bom_prices_campus_with_tax_and_online_at_list():
    p = project(
        [UNO, {"id": "FAN", "type": "fan_5v"}],
        [{"a": "FAN.+", "b": "U1.5V"}, {"a": "FAN.-", "b": "U1.GND"}],
    )
    b = wp.bom(p)
    fan = next(l for l in b["lines"] if l["source"] == "online")
    assert fan["url"].startswith("https://www.adafruit.com/") and fan["where"] == "Online: Adafruit"
    # Campus lines first in the list; online at its listed price, campus x1.13.
    assert b["lines"][-1]["source"] == "online"
    assert b["estimated_total"] == round(b["campus_subtotal"] * 1.13 + b["online_subtotal"], 2)


def test_esp32_pins_are_3v3_and_its_sketch_pins_are_gpio_numbers():
    code = "const int LED = 25;" + chr(10) + "void setup() { pinMode(LED, OUTPUT); pinMode(34, OUTPUT); }" + chr(10) + "void loop() { analogRead(25); }"
    p = project(
        [ESP, {"id": "US1", "type": "ping"}],
        [{"a": "US1.SIG", "b": "U1.IO18"}, {"a": "US1.5V", "b": "U1.5V"}, {"a": "US1.GND", "b": "U1.GND"},
         {"a": "U1.IO18", "b": "U1.5V"}],
        code,
    )
    errors = texts(wp.check(p), "error")
    assert any("U1.IO18 is on a 5V net" in t for t in errors)
    assert any("analogRead on IO25" in t for t in errors)
    assert any("IO34 is input-only" in t for t in errors)
    assert any("nothing is wired to U1.IO25" in t for t in texts(wp.check(p), "warning"))


def test_a_rail_behind_a_power_toggle_counts_as_powered():
    p = project(
        [UNO, {"id": "BAT", "type": "lipo_2500"}, {"id": "SW", "type": "switch"}, {"id": "BST", "type": "boost_5v"}],
        [{"a": "BAT.+", "b": "SW.1"}, {"a": "SW.2", "b": "BST.VIN"}, {"a": "BAT.-", "b": "U1.GND"},
         {"a": "BST.GND", "b": "U1.GND"}, {"a": "BST.5V", "b": "U1.5V"}],
    )
    assert not any("no power source" in t for t in texts(wp.check(p)))


def test_speakers_need_an_amplifier_and_big_servos_their_own_supply():
    p = project(
        [ESP, {"id": "SPK", "type": "speaker"}, {"id": "S1", "type": "servo_std"}],
        [{"a": "SPK.+", "b": "U1.IO25"}, {"a": "SPK.-", "b": "U1.GND"},
         {"a": "S1.V+", "b": "U1.5V"}, {"a": "S1.GND", "b": "U1.GND"}, {"a": "S1.SIG", "b": "U1.IO13"}],
    )
    errors = texts(wp.check(p), "error")
    assert any("drive it from an amplifier" in t for t in errors)
    assert any("S1 (MG996R) is powered from U1.5V" in t for t in errors)


def test_esp32_projects_are_checked_not_compiled(db, monkeypatch):
    monkeypatch.setattr(wp, "compile_sketch", lambda code: pytest.fail("ESP32 sketches must not go to the AVR compiler"))
    result = wp.save_project({"name": "Sentry", "parts": [ESP], "wires": [], "code": "void setup() {}" + chr(10) + "void loop() {}"})
    assert result["report"]["compile"]["skipped"] and result["project"]["hex"] is None


def test_a_pair_of_boards_each_with_its_own_ground():
    feather = lambda side: [{"id": f"U_{side}", "type": "feather_s3"}, {"id": f"B_{side}", "type": "lipo_1200"}]
    wires = lambda side: [{"a": f"B_{side}.+", "b": f"U_{side}.BAT"}, {"a": f"B_{side}.-", "b": f"U_{side}.GND"}]
    pair = project(feather("R") + feather("L"), wires("R") + wires("L"))
    checks = wp.check(pair)
    assert not texts(checks, "error")
    assert any("2 boards run the same sketch" in t for t in texts(checks, "note"))
    mixed = project([UNO, {"id": "U2", "type": "esp32"}], [])
    assert any("One UNO per project" in t for t in texts(wp.check(mixed), "error"))
