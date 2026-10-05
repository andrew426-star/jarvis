import json
import math
import re
from collections.abc import Callable
from datetime import datetime, timezone
from functools import cache
from pathlib import Path

from app.core.supabase_client import get_supabase_client
from app.services.arduino import compile_sketch
from app.tools.parts_catalog import TAX_FACTOR, catalog, parts_catalog

# Workshop projects: a real build Andrew means to make, held as one bundle -
# the parts (from Louisiana Tech's catalog), how they are wired, the Arduino
# sketch, the printed parts (OpenSCAD) and where everything sits in 3D. The
# server owns what needs judgement or a toolchain: it checks the wiring and
# the code against each other, prices the bill of materials, compiles the
# sketch, and saves. The browser owns what needs to run live: the emulated
# UNO, the circuit solver, the 3D assembly (web/src/lib/workshop/project).
#
# Saved whole in jarvis_workshop_projects (one jsonb per project), from
# Jarvis's `project` tool or the console's own edits (POST /workshop/...).

TABLE = "jarvis_workshop_projects"
PARTS_JSON = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "workshop" / "parts.json"
MAX_PARTS = 80
MAX_WIRES = 300
MAX_PRINTED = 12
MAX_SCAD_CHARS = 40_000
MAX_CODE_CHARS = 60_000
ID_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,15}$")
GROUND_SOURCES = {("uno", "GND")}


@cache
def library() -> dict:
    return json.loads(PARTS_JSON.read_text(encoding="utf-8"))["types"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- shape -------------------------------------------------------------------


def _vec(value, n: int = 3) -> list[float]:
    items = value if isinstance(value, (list, tuple)) else []
    out = []
    for i in range(n):
        try:
            v = float(items[i])
            out.append(v if math.isfinite(v) else 0.0)
        except (IndexError, TypeError, ValueError):
            out.append(0.0)
    return out


def normalize(raw: dict) -> tuple[dict, list[str]]:
    """A project with every field present and bounded, and what was dropped."""
    lib = library()
    problems: list[str] = []
    raw = raw if isinstance(raw, dict) else {}

    parts, seen = [], set()
    for p in (raw.get("parts") or [])[:MAX_PARTS]:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id") or "").strip().upper()
        ptype = str(p.get("type") or "").strip()
        if ptype not in lib:
            problems.append(f"part {pid or '?'}: unknown type {ptype!r}")
            continue
        if not ID_RE.match(pid):
            problems.append(f"part id {pid!r} must be letters/digits, starting with a letter (e.g. LED1)")
            continue
        if pid in seen:
            problems.append(f"part id {pid} is used twice")
            continue
        seen.add(pid)
        props = {**(lib[ptype].get("props") or {}), **(p.get("props") if isinstance(p.get("props"), dict) else {})}
        part = {"id": pid, "type": ptype, "props": props}
        if p.get("label"):
            part["label"] = str(p["label"])[:60]
        if p.get("catalog"):
            part["catalog"] = str(p["catalog"])[:120]
        parts.append(part)

    by_id = {p["id"]: p for p in parts}
    wires = []
    for w in (raw.get("wires") or [])[:MAX_WIRES]:
        if not isinstance(w, dict):
            continue
        ends = []
        for key in ("a", "b"):
            ref = str(w.get(key) or "").strip()
            pid, _, pin = ref.partition(".")
            pid = pid.upper()
            part = by_id.get(pid)
            if not part:
                problems.append(f"wire {w.get('a')} - {w.get('b')}: no part {pid!r}")
                break
            pins = lib[part["type"]].get("pins") or {}
            match = next((name for name in pins if name.lower() == pin.lower()), None)
            if not match:
                problems.append(f"wire {w.get('a')} - {w.get('b')}: {part['type']} {pid} has no pin {pin!r} (has {', '.join(pins)})")
                break
            ends.append(f"{pid}.{match}")
        if len(ends) == 2 and ends[0] != ends[1]:
            wire = {"a": ends[0], "b": ends[1]}
            if w.get("color"):
                wire["color"] = str(w["color"])[:20]
            wires.append(wire)

    printed = []
    for item in (raw.get("printed") or [])[:MAX_PRINTED]:
        if not isinstance(item, dict) or not str(item.get("code") or "").strip():
            continue
        code = str(item["code"])
        if len(code) > MAX_SCAD_CHARS:
            problems.append(f"printed part {item.get('name')}: code too long")
            continue
        notes = item.get("notes") if isinstance(item.get("notes"), list) else []
        printed.append({"name": str(item.get("name") or "Part")[:60], "code": code, "notes": [str(n)[:60] for n in notes[:4]]})

    layout = {}
    names = set(by_id) | {p["name"] for p in printed}
    for key, place in (raw.get("layout") or {}).items() if isinstance(raw.get("layout"), dict) else []:
        key = str(key)
        key = key.upper() if key.upper() in by_id else key
        if key not in names or not isinstance(place, dict):
            continue
        layout[key] = {"pos": _vec(place.get("pos")), "rot": _vec(place.get("rot"))}

    extras = []
    for e in (raw.get("extras") or [])[:40]:
        if isinstance(e, dict) and str(e.get("item") or "").strip():
            try:
                qty = max(1, min(999, int(e.get("qty") or 1)))
            except (TypeError, ValueError):
                qty = 1
            extras.append({"item": str(e["item"])[:120], "qty": qty})

    code = str(raw.get("code") or "")[:MAX_CODE_CHARS]
    project = {
        "id": raw.get("id"),
        "name": str(raw.get("name") or "Untitled project")[:80],
        "goal": str(raw.get("goal") or "")[:600],
        "parts": parts,
        "wires": wires,
        "code": code,
        "printed": printed,
        "layout": layout,
        "extras": extras,
        "hex": raw.get("hex") if isinstance(raw.get("hex"), str) else None,
        "compiled_code": raw.get("compiled_code") if isinstance(raw.get("compiled_code"), str) else None,
    }
    return project, problems


# --- nets ------------------------------------------------------------------


class Nets:
    """The wiring as nets: every pin end joined to what it is wired to."""

    def __init__(self, project: dict):
        self.lib = library()
        self.parts = {p["id"]: p for p in project["parts"]}
        self.parent: dict[str, str] = {}
        for part in project["parts"]:
            for pin in self.lib[part["type"]].get("pins") or {}:
                self.parent[f"{part['id']}.{pin}"] = f"{part['id']}.{pin}"
        for w in project["wires"]:
            self._union(w["a"], w["b"])
        self.members: dict[str, list[str]] = {}
        for ref in self.parent:
            self.members.setdefault(self.find(ref), []).append(ref)

    def find(self, ref: str) -> str:
        while self.parent[ref] != ref:
            self.parent[ref] = self.parent[self.parent[ref]]
            ref = self.parent[ref]
        return ref

    def _union(self, a: str, b: str):
        self.parent[self.find(a)] = self.find(b)

    def net(self, ref: str) -> list[str]:
        return self.members[self.find(ref)]

    def wired(self, ref: str) -> bool:
        return len(self.net(ref)) > 1

    def type_of(self, ref: str) -> str:
        return self.parts[ref.split(".")[0]]["type"]

    def role(self, ref: str) -> str:
        pid, pin = ref.split(".", 1)
        return self.lib[self.parts[pid]["type"]]["pins"][pin]

    def is_ground(self, ref: str) -> bool:
        t, pin = self.type_of(ref), ref.split(".", 1)[1]
        return (t, pin) in GROUND_SOURCES or (self.lib[t]["kind"] == "power" and pin == "-")

    def source_volts(self, ref: str) -> float | None:
        """The voltage a pin forces on its net, if it is a supply."""
        t, pin = self.type_of(ref), ref.split(".", 1)[1]
        if t == "uno" and pin == "5V":
            return 5.0
        if t == "uno" and pin == "3V3":
            return 3.3
        if self.lib[t]["kind"] == "power" and pin == "+":
            return float(self.lib[t]["volts"])
        return None

    def net_volts(self, ref: str) -> float | None:
        net = self.net(ref)
        if any(self.is_ground(r) for r in net):
            return 0.0
        found = [v for v in (self.source_volts(r) for r in net) if v is not None]
        if found:
            return found[0]
        # The L298N's onboard regulator puts out 5V when it has 7V+ on 12V.
        for r in net:
            if self.type_of(r) == "l298n" and r.endswith(".5V"):
                v12 = self.net_volts_shallow(r.split(".")[0] + ".12V")
                if v12 is not None and v12 >= 7:
                    return 5.0
        return None

    def net_volts_shallow(self, ref: str) -> float | None:
        net = self.net(ref)
        if any(self.is_ground(r) for r in net):
            return 0.0
        found = [v for v in (self.source_volts(r) for r in net) if v is not None]
        return found[0] if found else None

    def mcu_pins(self, ref: str) -> list[str]:
        return [r for r in self.net(ref) if self.type_of(r) == "uno" and self.role(r) == "io"]

    def of_type(self, ref: str, *types: str) -> list[str]:
        return [r for r in self.net(ref) if self.type_of(r) in types]


# --- code ------------------------------------------------------------------

_DEFINE = re.compile(r"#define\s+(\w+)\s+(A?\d+)\b")
_CONST = re.compile(r"(?:const\s+)?(?:int|byte|uint8_t|short|long|unsigned\s+int)\s+(\w+)\s*=\s*(A?\d+)\s*;")
_CALL = re.compile(r"\b(pinMode|digitalWrite|digitalRead|analogWrite|analogRead|tone|noTone|pulseIn|attach)\s*\(\s*(\w+)\s*(?:,\s*(\w+))?")


def _pin_name(token: str, symbols: dict[str, str]) -> str | None:
    token = symbols.get(token, token)
    if re.fullmatch(r"A[0-5]", token):
        return token
    if token.isdigit():
        n = int(token)
        if 0 <= n <= 13:
            return f"D{n}"
        if 14 <= n <= 19:
            return f"A{n - 14}"
    return None


def code_pins(code: str) -> dict[str, set[str]]:
    """Which UNO pins the sketch uses, and how: {"D9": {"attach"}, ...}.
    Reads literal pins and simple #define / const int names; pins chosen
    at run time (arrays, arithmetic) are not seen."""
    stripped = re.sub(r"//[^\n]*|/\*.*?\*/", "", code or "", flags=re.S)
    symbols = {m.group(1): m.group(2) for m in _DEFINE.finditer(stripped)}
    symbols.update({m.group(1): m.group(2) for m in _CONST.finditer(stripped)})
    used: dict[str, set[str]] = {}
    for m in _CALL.finditer(stripped):
        pin = _pin_name(m.group(2), symbols)
        if not pin:
            continue
        how = m.group(1)
        if how == "pinMode" and m.group(3):
            how = f"pinMode:{m.group(3)}"
        used.setdefault(pin, set()).add(how)
    return used


# --- checks ----------------------------------------------------------------


def check(project: dict) -> list[dict]:
    """Electrical and code checks: [{level: error|warning|note, part, text}]."""
    lib = library()
    nets = Nets(project)
    out: list[dict] = []

    def say(level: str, text: str, part: str = ""):
        out.append({"level": level, "part": part, "text": text})

    unos = [p for p in project["parts"] if p["type"] == "uno"]
    if len(unos) > 1:
        say("error", "Only one UNO can be simulated per project.")
    uno = unos[0]["id"] if unos else None

    # Shorts: two supplies, or a supply and ground, on one net.
    for members in nets.members.values():
        if len(members) < 2:
            continue
        sources = sorted({nets.source_volts(r) for r in members if nets.source_volts(r) is not None})
        grounded = any(nets.is_ground(r) for r in members)
        if grounded and sources:
            say("error", f"Short circuit: {', '.join(r for r in members if nets.source_volts(r) is not None)} is wired straight to ground.")
        elif len(sources) > 1:
            say("error", f"Two different supplies are tied together ({', '.join(r for r in members if nets.source_volts(r) is not None)}).")

    # Every part's essential pins.
    for p in project["parts"]:
        spec = lib[p["type"]]
        for pin in spec.get("need") or []:
            if not nets.wired(f"{p['id']}.{pin}"):
                say("warning", f"{p['id']}.{pin} is not wired.", p["id"])

    # Common ground: every ground source on one net.
    ground_nets = {nets.find(r) for r in nets.parent if nets.is_ground(r) and nets.wired(r)}
    if len(ground_nets) > 1:
        say("error", "Grounds are not common: wire every supply's - (and the L298N/A4988 GND) to the UNO's GND, or signals have no reference.")
    for p in project["parts"]:
        for pin, role in (lib[p["type"]].get("pins") or {}).items():
            ref = f"{p['id']}.{pin}"
            if role == "gnd" and nets.wired(ref) and not any(nets.is_ground(r) for r in nets.net(ref)):
                say("error", f"{ref} is wired, but not to ground.", p["id"])

    # Supply voltages each part is given.
    for p in project["parts"]:
        spec = lib[p["type"]]
        for pin, role in (spec.get("pins") or {}).items():
            if role != "supply":
                continue
            ref = f"{p['id']}.{pin}"
            lo, hi = (3.0, 5.5) if (p["type"] == "a4988" and pin == "VDD") else spec.get("supply_v", [0, 99])
            v = nets.net_volts(ref)
            if not nets.wired(ref):
                continue
            if v is None:
                say("warning", f"{ref} has no power source on its net.", p["id"])
            elif v > hi:
                say("error", f"{ref} gets {v:g}V; {spec['label']} takes {lo:g}-{hi:g}V and will be damaged.", p["id"])
            elif v < lo:
                say("error" if v < lo * 0.8 else "warning", f"{ref} gets {v:g}V; {spec['label']} needs {lo:g}-{hi:g}V.", p["id"])

    # The UNO's own power.
    if uno:
        vin = nets.net_volts(f"{uno}.VIN")
        if vin is not None and vin > 0:
            if vin > 12:
                say("warning", f"{uno}.VIN gets {vin:g}V; above 12V the UNO's regulator overheats.", uno)
            elif vin < 7:
                say("warning", f"{uno}.VIN gets {vin:g}V; below 7V the 5V rail sags.", uno)

    used = code_pins(project["code"]) if project["code"] else {}
    outputs = {pin for pin, hows in used.items() if "pinMode:OUTPUT" in hows or "digitalWrite" in hows and "pinMode:INPUT" not in hows}

    # The UNO's pins.
    if uno:
        spec = lib["uno"]
        for pin, role in spec["pins"].items():
            if role != "io":
                continue
            ref = f"{uno}.{pin}"
            net = nets.net(ref)
            others = [r for r in net if r != ref]
            if any(nets.source_volts(r) is not None or nets.is_ground(r) for r in others):
                tied = next(r for r in others if nets.source_volts(r) is not None or nets.is_ground(r))
                if pin in outputs:
                    say("error", f"{ref} is an OUTPUT in the code but wired straight to {tied}: driving it the other way shorts the pin.", uno)
                else:
                    say("warning", f"{ref} is wired straight to {tied}, so it always reads the same.", uno)
            for r in others:
                t = nets.type_of(r)
                if t == "uno" and nets.role(r) == "io":
                    say("warning", f"{ref} and {r} are wired together; if both are outputs they fight.", uno)
                elif lib[t]["pins"][r.split(".", 1)[1]] == "load":
                    say("error", f"{r.split('.')[0]} ({lib[t]['label']}) is wired straight to {ref}. A pin gives 20 mA; a motor needs a driver (L298N, or a MOSFET with a diode).", r.split(".")[0])
                elif t == "relay" and r.split(".", 1)[1] in ("C1", "C2"):
                    say("warning", f"{r.split('.')[0]}'s coil is driven straight from {ref}: about 40 mA, the pin's absolute limit. Drive it through an NPN transistor with a 1k base resistor.", r.split(".")[0])
                elif t == "stepper":
                    say("error", f"{r} (a stepper coil) is wired to {ref}; steppers need the A4988.", r.split(".")[0])

        # Code against wiring.
        pwm = set(spec["pwm"])
        servo_pins = {pin for pin, hows in used.items() if "attach" in hows}
        for pin, hows in sorted(used.items()):
            ref = f"{uno}.{pin}"
            if not nets.wired(ref):
                say("warning", f"The sketch uses {pin} but nothing is wired to {ref}.", uno)
            if "analogWrite" in hows and pin not in pwm:
                say("warning", f"analogWrite on {pin} only switches it fully on or off; PWM pins are {', '.join(sorted(pwm))}.", uno)
            if "analogRead" in hows and not pin.startswith("A"):
                say("error", f"analogRead on {pin}: only A0-A5 read voltages.", uno)
            if "analogWrite" in hows and servo_pins and pin in ("D9", "D10"):
                say("warning", f"The Servo library takes over timer 1, so analogWrite on {pin} will not work.", uno)
        if re.search(r"\bSerial\.begin", project["code"] or "") and (nets.wired(f"{uno}.D0") or nets.wired(f"{uno}.D1")):
            say("warning", "The sketch uses Serial, which owns D0/D1; parts wired there will garble it and block uploads.", uno)

    # LEDs: a resistor in series, and roughly how much current.
    for p in project["parts"]:
        if p["type"] not in ("led", "rgb_led"):
            continue
        spec = lib[p["type"]]
        cathode = next(pin for pin, role in spec["pins"].items() if role == "cathode")
        for pin, role in spec["pins"].items():
            if role != "anode":
                continue
            a, k = f"{p['id']}.{pin}", f"{p['id']}.{cathode}"
            if not (nets.wired(a) and nets.wired(k)):
                continue
            vf = spec["vf_by_pin"][pin] if p["type"] == "rgb_led" else spec["vf_by_color"].get(p["props"].get("color"), 2.0)
            current = _led_current(nets, a, k, vf)
            label = f"{p['id']}" + (f" ({pin})" if p["type"] == "rgb_led" else "")
            if current == "no_resistor":
                say("error", f"{label} has no current-limiting resistor and will burn out (and can damage the pin). Put 1k (dim) or two 100 ohm in series (~15 mA) in line with it.", p["id"])
            elif isinstance(current, float):
                if current > spec["abs_ma"]:
                    say("error", f"{label} would take about {current:.0f} mA (limit {spec['abs_ma']} mA). Use a larger resistor.", p["id"])
                elif current > spec["max_ma"]:
                    say("warning", f"{label} would take about {current:.0f} mA, over its {spec['max_ma']} mA rating.", p["id"])
                elif current < 1:
                    say("note", f"{label} gets about {current:.1f} mA and will be very dim.", p["id"])

    # Relays want a flyback diode across the coil.
    for p in project["parts"]:
        if p["type"] != "relay":
            continue
        c1, c2 = f"{p['id']}.C1", f"{p['id']}.C2"
        if nets.wired(c1) and nets.wired(c2):
            n1, n2 = nets.find(c1), nets.find(c2)
            has_diode = any(
                {nets.find(f"{d['id']}.A"), nets.find(f"{d['id']}.K")} == {n1, n2}
                for d in project["parts"] if d["type"] == "diode"
            )
            if not has_diode:
                say("warning", f"{p['id']} has no flyback diode across its coil; switching it off spikes the driver. Add a diode, cathode to the + side.", p["id"])

    # Drivers.
    for p in project["parts"]:
        pid = p["id"]
        if p["type"] == "a4988":
            rst, slp = f"{pid}.RST", f"{pid}.SLP"
            if nets.find(rst) != nets.find(slp) and nets.net_volts(rst) != 5.0 and not nets.mcu_pins(rst):
                say("error", f"{pid}.RST is floating, so the driver stays in reset: jumper RST to SLP.", pid)
            coils = [r for r in ("1A", "1B", "2A", "2B") if nets.of_type(f"{pid}.{r}", "stepper")]
            if nets.wired(f"{pid}.STEP") and len(coils) < 4:
                say("warning", f"{pid}'s outputs 1A/1B/2A/2B should each go to a stepper coil wire (one coil on 1A/1B, the other on 2A/2B).", pid)
        if p["type"] == "l298n":
            for out_a, out_b, in_a, in_b, en, jumper in (
                ("OUT1", "OUT2", "IN1", "IN2", "ENA", "ena_jumper"),
                ("OUT3", "OUT4", "IN3", "IN4", "ENB", "enb_jumper"),
            ):
                if nets.wired(f"{pid}.{out_a}") or nets.wired(f"{pid}.{out_b}"):
                    for pin in (in_a, in_b):
                        if not nets.wired(f"{pid}.{pin}"):
                            say("warning", f"{pid}.{pin} is not wired, so that motor cannot be driven both ways.", pid)
                    if not p["props"].get(jumper) and not nets.wired(f"{pid}.{en}"):
                        say("warning", f"{pid}.{en} has no jumper and no wire, so that channel stays off.", pid)
        if p["type"] == "stepper":
            if not all(nets.of_type(f"{pid}.{c}", "a4988") for c in ("A+", "A-", "B+", "B-")):
                say("error", f"{pid} needs all four coil wires on an A4988's 1A/1B/2A/2B.", pid)
        if p["type"] == "hall":
            sig = f"{pid}.OUT"
            pins = nets.mcu_pins(sig)
            pulled = any(
                nets.type_of(r) == "resistor"
                and nets.net_volts(f"{r.split('.')[0]}.{'2' if r.endswith('.1') else '1'}") in (5.0, 3.3)
                for r in nets.net(sig)
            )
            pullup_code = any("pinMode:INPUT_PULLUP" in used.get(r.split(".", 1)[1], set()) for r in pins)
            if nets.wired(sig) and not pulled and not pullup_code:
                say("warning", f"{sig} is open collector: use pinMode(pin, INPUT_PULLUP) or a 10k resistor to 5V, or it floats when no magnet is near.", pid)

    # Power budget on the UNO's 5V pin (USB gives 500 mA in all).
    if uno:
        draw, servos = 25.0, 0
        for p in project["parts"]:
            spec = lib[p["type"]]
            for pin, role in (spec.get("pins") or {}).items():
                if role == "supply" and nets.find(f"{p['id']}.{pin}") == nets.find(f"{uno}.5V"):
                    draw += spec.get("draw_ma", 0)
                    servos += p["type"] == "servo"
        for p in project["parts"]:
            if p["type"] == "relay" and nets.find(f"{p['id']}.C1") == nets.find(f"{uno}.5V"):
                draw += 40
        if draw > 450:
            say("warning", f"About {draw:.0f} mA from the UNO's 5V pin; USB gives 500 mA for everything. Power the motors separately.", uno)
        if servos >= 2:
            say("note", f"{servos} servos on the UNO's 5V: each can pull ~650 mA stalled, enough to reset the board. A separate 5-6V supply for them is safer.", uno)

    return out


def _led_current(nets: Nets, anode: str, cathode: str, vf: float):
    """Roughly the LED's current in mA, 'no_resistor', or None (no path)."""

    def drive(ref: str, high: bool) -> float | None:
        # What a net offers: a supply's voltage, ground, or an UNO pin
        # (taken as 5V on the anode side, 0V on the cathode side).
        v = nets.net_volts(ref)
        if v is not None:
            return v
        if nets.mcu_pins(ref):
            return 5.0 if high else 0.0
        return None

    def resistors(ref: str) -> list[tuple[float, str]]:
        found = []
        for r in nets.net(ref):
            if nets.type_of(r) == "resistor":
                pid, pin = r.split(".")
                found.append((float(nets.parts[pid]["props"].get("ohms") or 0), f"{pid}.{'2' if pin == '1' else '1'}"))
        return found

    va, vk = drive(anode, True), drive(cathode, False)
    if va is not None and vk is not None:
        return "no_resistor" if va - vk > vf else None
    for side, other, high in ((anode, cathode, True), (cathode, anode, False)):
        v_other = drive(other, not high)
        if v_other is None:
            continue
        for ohms, far in resistors(side):
            v_far = drive(far, high)
            if v_far is None or ohms <= 0:
                continue
            span = (v_far - v_other) if high else (v_other - v_far)
            return max(0.0, (span - vf) / ohms * 1000)
    return None


# --- bill of materials -------------------------------------------------------


def _pack_size(item: dict) -> int:
    if item["source"] == "vending":
        return max(1, item.get("quantity") or 1)
    m = re.search(r"(?:pack|group) of (\d+)|^(\d+)$", item.get("packaging") or "", re.I)
    if m:
        return int(m.group(1) or m.group(2))
    return 1


def _find_item(name: str) -> dict | None:
    lowered = name.lower().strip()
    exact = [i for i in catalog() if i["item"].lower() == lowered]
    if exact:
        # The store over the machines when both have it: it is the cheaper listing.
        return sorted(exact, key=lambda i: (i["source"] != "store", i["price"]))[0]
    found = parts_catalog({"query": name}).get("items") or []
    return found[0] if found else None


def _catalog_name(part: dict) -> str | None:
    spec = library()[part["type"]]
    if part.get("catalog"):
        return part["catalog"]
    if "catalog_by_ohms" in spec:
        ohms = part["props"].get("ohms")
        key = str(int(ohms)) if isinstance(ohms, (int, float)) and float(ohms).is_integer() else str(ohms)
        return spec["catalog_by_ohms"].get(key)
    if "catalog_by_color" in spec:
        return spec["catalog_by_color"].get(part["props"].get("color"))
    return spec.get("catalog")


def bom(project: dict) -> dict:
    lines: dict[str, dict] = {}
    not_stocked = []
    for part in project["parts"]:
        name = _catalog_name(part)
        item = _find_item(name) if name else None
        if not item:
            spec = library()[part["type"]]
            detail = f"{part['props'].get('ohms')} ohm" if part["type"] == "resistor" else part["props"].get("color", "")
            not_stocked.append(f"{part['id']}: {spec['label']} {detail}".strip())
            continue
        line = lines.setdefault(item["item"] + "|" + item["source"], {"item": item, "count": 0, "parts": []})
        line["count"] += 1
        line["parts"].append(part["id"])
    for extra in project["extras"]:
        item = _find_item(extra["item"])
        if not item:
            not_stocked.append(extra["item"])
            continue
        line = lines.setdefault(item["item"] + "|" + item["source"], {"item": item, "count": 0, "parts": []})
        line["count"] += extra["qty"]
    if project["wires"] and not any("jumper" in key.lower() for key in lines):
        item = _find_item("Jumper wires: pack of 140")
        if item:
            lines[item["item"] + "|store"] = {"item": item, "count": 1, "parts": ["(wiring)"]}

    out, subtotal = [], 0.0
    for line in lines.values():
        item = line["item"]
        packs = math.ceil(line["count"] / _pack_size(item))
        cost = round(packs * item["price"], 2)
        subtotal += cost
        out.append({
            "item": item["item"],
            "for": line["parts"],
            "need": line["count"],
            "buy": packs,
            "unit": item.get("packaging") or (f"{item['quantity']} per slot" if item["source"] == "vending" else "each"),
            "price": item["price"],
            "cost": cost,
            "where": item.get("location") and f"Vending: {item['location']}" or "Engineering store",
            "part_number": item.get("part_number") or "",
        })
    out.sort(key=lambda l: -l["cost"])
    return {
        "lines": out,
        "subtotal": round(subtotal, 2),
        "estimated_total": round(subtotal * TAX_FACTOR, 2),
        "not_stocked": not_stocked,
    }


# --- save ------------------------------------------------------------------


def _row(project: dict) -> dict:
    data = {k: v for k, v in project.items() if k != "id"}
    return {"name": project["name"], "data": data, "updated_at": _now()}


def save_project(raw: dict) -> dict:
    """Normalize, compile if the code changed, check, price and store a
    project. Returns {ok, project, report}."""
    project, problems = normalize(raw)
    compile_result = None
    if project["code"].strip() and (project["code"] != project["compiled_code"] or not project["hex"]):
        compile_result = compile_sketch(project["code"])
        if compile_result.get("ok"):
            project["hex"] = compile_result["hex"]
            project["compiled_code"] = project["code"]
        elif not compile_result.get("unavailable"):
            project["hex"] = None
            project["compiled_code"] = None
    elif not project["code"].strip():
        project["hex"], project["compiled_code"] = None, None

    supabase = get_supabase_client()
    if project["id"]:
        res = supabase.table(TABLE).update(_row(project)).eq("id", project["id"]).execute()
        if not res.data:
            project["id"] = None
    if not project["id"]:
        res = supabase.table(TABLE).insert({**_row(project), "created_at": _now()}).execute()
        project["id"] = res.data[0]["id"]

    report = {
        "checks": check(project),
        "bom": bom(project),
        "dropped": problems,
        "compile": (
            {k: v for k, v in compile_result.items() if k != "hex"}
            if compile_result
            else {"ok": bool(project["hex"]), "cached": True} if project["code"].strip() else {"ok": False, "error": "No sketch yet."}
        ),
    }
    return {"ok": True, "project": project, "report": report}


def _load(row: dict) -> dict:
    return {**(row.get("data") or {}), "id": row["id"], "name": row["name"]}


def get_project(project_id: str) -> dict | None:
    res = get_supabase_client().table(TABLE).select("*").eq("id", project_id).limit(1).execute()
    return _load(res.data[0]) if res.data else None


def find_project(name: str) -> dict | None:
    rows = get_supabase_client().table(TABLE).select("*").order("updated_at", desc=True).limit(200).execute().data or []
    wanted = name.strip().lower()
    for row in rows:
        if row["name"].lower() == wanted:
            return _load(row)
    for row in rows:
        if wanted in row["name"].lower():
            return _load(row)
    return None


def list_projects() -> list[dict]:
    rows = (
        get_supabase_client().table(TABLE).select("id, name, data, updated_at").order("updated_at", desc=True).limit(50).execute().data
        or []
    )
    return [
        {"id": r["id"], "name": r["name"], "parts": len((r.get("data") or {}).get("parts") or []), "updated_at": r["updated_at"]}
        for r in rows
    ]


def delete_project(project_id: str) -> None:
    get_supabase_client().table(TABLE).delete().eq("id", project_id).execute()


# --- Jarvis's tool -------------------------------------------------------------


def _types_line() -> str:
    lib = library()
    groups: dict[str, list[str]] = {}
    for key, spec in lib.items():
        pins = "/".join(spec.get("pins") or {}) or "no pins"
        groups.setdefault(spec["kind"], []).append(f"{key} [{pins}]")
    return "; ".join(f"{kind}: {', '.join(items)}" for kind, items in groups.items())


PROJECT_SCHEMA = {
    "type": "function",
    "function": {
        "name": "project",
        "description": (
            "Andrew's workshop projects: real builds with electronics, simulated before he buys or "
            "solders anything. A project holds parts (from the Louisiana Tech catalog), the wiring, "
            "an Arduino UNO sketch, printed parts (OpenSCAD) and a 3D layout. It shows in the "
            "workshop's project panel and 3D stage, opening the workshop if needed. "
            "open: load a saved project by name, or start a new one with that name (and goal). "
            "update: change the open project; each field you give REPLACES that whole section, so "
            "send the complete list (parts, wires, printed, layout, extras) and the complete sketch. "
            "The result has the checks (shorts, missing resistors, motors on bare pins, wrong "
            "voltages, code using unwired pins...), the sketch's compile result and the priced bill "
            "of materials: fix every error and compile failure with another update before you "
            "reply, then tell him the warnings that matter and the total. "
            "simulate: run or stop the emulated UNO in his browser (run true/false) and set inputs "
            "(inputs: {part id: value} - button/switch/limit_switch/hall true|false, pot 0-1, "
            "photoresistor light 0-1, thermistor temp C, ping distance cm, adxl335 [x,y,z] g). "
            "What it does comes back in CONSOLE_STATE on his next message (serial output, LED, "
            "servo and motor states, live warnings), not in this turn. "
            "list: saved projects. delete: remove one (only when he asks). "
            "Part types (id it like LED1, R1, U1): " + _types_line() + ". "
            "Wires join pins: {a: 'U1.D9', b: 'SRV1.SIG'}. Only the UNO is emulated. Every servo Tech "
            "stocks is continuous rotation. Resistors stocked: 100, 1k, 10k ohm only. "
            "layout: {part id or printed part name: {pos: [x,y,z] mm, rot: [x,y,z] degrees}}, z up, "
            "the same frame as your OpenSCAD, so printed mounts and the parts they hold line up."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["open", "update", "simulate", "list", "delete"]},
                "name": {"type": "string", "description": "open/delete: the project's name. update: renames it."},
                "goal": {"type": "string", "description": "What the build is for, in a sentence or two."},
                "parts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "type": {"type": "string"},
                            "props": {"type": "object", "description": "e.g. {ohms: 1000}, {color: 'green'}, {length: 300}."},
                            "label": {"type": "string"},
                        },
                        "required": ["id", "type"],
                    },
                },
                "wires": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"a": {"type": "string"}, "b": {"type": "string"}, "color": {"type": "string"}},
                        "required": ["a", "b"],
                    },
                },
                "code": {"type": "string", "description": "The complete Arduino sketch for the UNO."},
                "printed": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "code": {"type": "string", "description": "OpenSCAD, as for the workshop's scad action."},
                            "notes": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["name", "code"],
                    },
                },
                "layout": {"type": "object", "description": "{part id or printed name: {pos: [x,y,z] mm, rot: [x,y,z] deg}}"},
                "extras": {
                    "type": "array",
                    "description": "Bill-of-materials lines with no wiring: screws, extrusion brackets, solder, a tool.",
                    "items": {
                        "type": "object",
                        "properties": {"item": {"type": "string", "description": "Catalog item name."}, "qty": {"type": "integer"}},
                        "required": ["item"],
                    },
                },
                "run": {"type": "boolean", "description": "simulate: true to start, false to stop."},
                "inputs": {"type": "object", "description": "simulate: {part id: value}, as above."},
                "speed": {"type": "number", "description": "simulate: 0.1-1, slow motion below 1."},
            },
            "required": ["operation"],
        },
    },
}

SECTIONS = ("name", "goal", "parts", "wires", "code", "printed", "layout", "extras")


def _model_report(project: dict, report: dict) -> dict:
    """What Jarvis needs back, without the sketch, HEX and SCAD he sent."""
    b = report["bom"]
    return {
        "project": project["name"],
        "parts": len(project["parts"]),
        "wires": len(project["wires"]),
        "compile": report["compile"],
        "checks": report["checks"],
        "dropped": report["dropped"],
        "bom": {
            "lines": [f"{l['buy']} x {l['item']} (${l['price']:.2f}, {l['where']})" for l in b["lines"]],
            "subtotal": b["subtotal"],
            "estimated_total_with_tax": b["estimated_total"],
            "not_stocked": b["not_stocked"],
        },
    }


def project_tool(args: dict, open_id: str | None) -> dict:
    op = args.get("operation")
    try:
        if op == "list":
            return {"ok": True, "projects": list_projects()}

        if op == "delete":
            found = find_project(str(args.get("name") or ""))
            if not found:
                return {"ok": False, "error": f"No project named {args.get('name')!r}."}
            delete_project(found["id"])
            action = {"action": "project_close"} if found["id"] == open_id else None
            return {"ok": True, "deleted": found["name"], **({"actions": [action]} if action else {})}

        if op == "simulate":
            if not open_id:
                return {"ok": False, "error": "No project is open in the workshop."}
            sim = {"action": "sim", "run": bool(args.get("run", True))}
            if isinstance(args.get("inputs"), dict):
                sim["inputs"] = {str(k).upper(): v for k, v in args["inputs"].items()}
            if args.get("speed") is not None:
                try:
                    sim["speed"] = max(0.1, min(1.0, float(args["speed"])))
                except (TypeError, ValueError):
                    pass
            return {"ok": True, "actions": [sim], "note": "Runs in his browser; results arrive in CONSOLE_STATE next turn."}

        if op == "open":
            name = str(args.get("name") or "").strip()
            if not name:
                return {"ok": False, "error": "open needs a name."}
            found = find_project(name)
            raw = found or {"name": name, "goal": args.get("goal") or ""}
            saved = save_project(raw)
        elif op == "update":
            current = get_project(open_id) if open_id else None
            raw = dict(current or {"name": args.get("name") or "Untitled project"})
            for key in SECTIONS:
                if key in args and args[key] is not None:
                    raw[key] = args[key]
            saved = save_project(raw)
        else:
            return {"ok": False, "error": f"Unknown operation {op!r}."}
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "error": f"project {op} failed: {exc}"}

    project, report = saved["project"], saved["report"]
    return {
        "ok": True,
        **_model_report(project, report),
        "actions": [{"action": "project_load", "project": project, "report": report}],
    }


def make_project(console_state: dict | None) -> Callable[[dict], dict]:
    """The project handler for this turn, knowing which project is open."""
    state = console_state if isinstance(console_state, dict) else {}
    open_id = (state.get("project") or {}).get("id") if isinstance(state.get("project"), dict) else None
    return lambda args: project_tool(args, open_id)


def state_line(state: dict | None) -> str | None:
    """The open project and its simulation, for CONSOLE_STATE."""
    p = (state or {}).get("project") if isinstance(state, dict) else None
    if not isinstance(p, dict) or not p.get("name"):
        return None
    sim = p.get("sim") if isinstance(p.get("sim"), dict) else {}
    parts = [
        f"WORKSHOP PROJECT open: {p.get('name')} ({p.get('parts', 0)} parts, sketch "
        f"{'compiled' if p.get('compiled') else 'NOT compiled'}, {p.get('errors', 0)} check errors)"
    ]
    if sim:
        parts.append(
            f"simulation {'RUNNING' if sim.get('running') else 'stopped'} at {sim.get('time_s', 0):.1f}s simulated"
        )
        if sim.get("readings"):
            parts.append("readings: " + "; ".join(str(r) for r in sim["readings"][:20]))
        if sim.get("warnings"):
            parts.append("LIVE WARNINGS: " + "; ".join(str(w) for w in sim["warnings"][:8]))
        if sim.get("serial"):
            parts.append("serial output (latest): " + json.dumps(str(sim["serial"])[-600:]))
        if sim.get("error"):
            parts.append("simulator error: " + str(sim["error"])[:300])
    return "; ".join(parts) + "."
