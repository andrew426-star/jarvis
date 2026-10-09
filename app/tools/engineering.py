import math
from collections.abc import Callable

from app.tools.workshop_project import Nets, bom, check, get_project, library

# Ultron's engineering bench (serious mode only; app/services/ultron.py).
# Jarvis builds; Ultron takes the build apart first. Everything here is
# arithmetic on real numbers - the parts library's ratings, textbook
# statics and beam theory - so the critique stands on figures, not mood:
#
#   torque  what each joint of an arm holds at worst-case reach, against
#           the servo on it, and the smallest servo that would do
#   power   every rail of the open project: who draws from what, typical
#           and stalled, against what the source gives; battery runtime
#   beam    whether a printed arm, bracket or tab holds its load, by
#           material and print orientation, and how far it sags
#   review  all of the above plus the workshop's own checks on the open
#           project, ranked by what fails first

G = 9.81

# Servos a joint might use: the library's (with real ratings) and common
# ones ordered online. torque kg-cm at 4.8-6V, mass g, stall mA.
SERVOS = [
    {"name": "SG90 (plastic gears)", "torque_kgcm": 1.8, "mass_g": 9, "stall_ma": 650, "where": "online"},
    {"name": "MG90S (metal gears)", "type": "servo_micro", "torque_kgcm": 2.0, "mass_g": 13.4, "stall_ma": 700, "where": "parts library"},
    {"name": "MG996R", "type": "servo_std", "torque_kgcm": 9.0, "mass_g": 55, "stall_ma": 2500, "where": "parts library"},
    {"name": "DS3218 (20 kg)", "torque_kgcm": 20.0, "mass_g": 60, "stall_ma": 2800, "where": "online"},
    {"name": "DS3235 (35 kg)", "torque_kgcm": 35.0, "mass_g": 68, "stall_ma": 3500, "where": "online"},
]

# Printed materials: tensile strength along the layers (MPa) for a solid,
# well-tuned print, and stiffness (GPa). Across the layers (a load that
# pulls layers apart) a print is far weaker.
MATERIALS = {
    "pla": (50, 3.5),
    "petg": (45, 2.1),
    "abs": (38, 2.2),
    "asa": (40, 2.0),
    "nylon": (55, 1.6),
    "pla_cf": (55, 5.0),
    "resin": (45, 2.5),
}
ACROSS_LAYERS = 0.5
# A printed part is not a moulded one: perimeters, infill and voids.
PRINT_KNOCKDOWN = 0.7

# What a board's own supply pins give, beyond the board's own use.
BOARD_RAIL_MA = {("uno", "out5v"): 500, ("uno", "out3v3"): 50, ("esp32", "out5v"): 500, ("esp32", "out3v3"): 300, ("feather_s3", "out3v3"): 300}
BOARD_SELF_MA = {"uno": 50, "esp32": 80, "feather_s3": 60}
BOARD_PEAK_MA = {"uno": 50, "esp32": 240, "feather_s3": 240}
# Capacity of a supply without a rating of its own.
BATTERY_MAH = {"battery_6aa": 2000}
BOOST_EFFICIENCY = 0.85


def _f(value, default: float = 0.0) -> float:
    try:
        v = float(value)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


# --- torque ------------------------------------------------------------------


def _servo_for(actuator) -> dict | None:
    if isinstance(actuator, (int, float)):
        return {"name": f"{actuator} kg-cm servo", "torque_kgcm": float(actuator), "mass_g": 0, "stall_ma": 0}
    text = str(actuator or "").strip().lower()
    if not text:
        return None
    try:
        return _servo_for(float(text))
    except ValueError:
        pass
    for s in SERVOS:
        if text in (s.get("type") or "") or text in s["name"].lower() or s["name"].lower().split(" ")[0] in text:
            return s
    lib = library().get(text)
    if lib and lib.get("torque_kgcm"):
        return {"name": lib["catalog"], "torque_kgcm": lib["torque_kgcm"], "mass_g": 0, "stall_ma": lib.get("stall_ma", 0)}
    return None


def torque(args: dict) -> dict:
    """Static torque at each joint of a serial arm held straight out
    (the worst case), base joint first."""
    links = [l for l in (args.get("links") or []) if isinstance(l, dict)][:8]
    if not links:
        return {"ok": False, "error": "torque needs links: [{length_mm, mass_g}], base outward."}
    payload = _f(args.get("payload_g"))
    sf = max(1.0, _f(args.get("safety_factor"), 2.0))
    actuators = list(args.get("actuators") or [])
    lengths = [max(0.0, _f(l.get("length_mm"))) / 10 for l in links]  # cm
    masses = [max(0.0, _f(l.get("mass_g"))) / 1000 for l in links]  # kg
    servos = [_servo_for(actuators[i]) if i < len(actuators) else None for i in range(len(links))]
    # A joint's servo rides on the link before it, so it loads every joint
    # behind it: servo i+1 sits at the end of link i.
    joints = []
    for i in range(len(links)):
        need = 0.0
        reach = 0.0
        for j in range(i, len(links)):
            need += masses[j] * (reach + lengths[j] / 2)
            reach += lengths[j]
            if j + 1 < len(links) and servos[j + 1]:
                need += servos[j + 1]["mass_g"] / 1000 * reach
        need += payload / 1000 * reach
        joint = {
            "joint": i + 1,
            "reach_cm": round(reach, 1),
            "static_kgcm": round(need, 2),
            "needed_with_margin_kgcm": round(need * sf, 2),
        }
        s = servos[i]
        if s:
            ratio = s["torque_kgcm"] / need if need else math.inf
            joint["servo"] = s["name"]
            joint["servo_kgcm"] = s["torque_kgcm"]
            joint["load_pct_of_stall"] = round(100 * need / s["torque_kgcm"]) if s["torque_kgcm"] else None
            joint["verdict"] = (
                "FAILS: cannot hold its own arm" if ratio < 1
                else f"marginal: under the {sf:g}x margin, it will stall when it moves" if ratio < sf
                else "holds"
            )
        fits = [s for s in SERVOS if s["torque_kgcm"] >= need * sf]
        joint["smallest_that_holds"] = fits[0]["name"] + f" ({fits[0]['torque_kgcm']} kg-cm, {fits[0]['where']})" if fits else "none listed: shorten the arm, counterweight it, or gear it down"
        joints.append(joint)
    stall = sum((s or {}).get("stall_ma", 0) for s in servos)
    return {
        "ok": True,
        "assumption": "arm held straight out horizontally (the worst case), static; the margin covers acceleration and a servo's real torque falling short of its rating",
        "safety_factor": sf,
        "joints": joints,
        "all_servos_stalled_ma": stall or None,
        "note": "Torque falls with reach squared in practice: halving the outer link's length or mass helps the base joint most. Campus servos are continuous rotation and cannot hold a joint.",
    }


# --- power -------------------------------------------------------------------


def _part_draw(spec: dict) -> tuple[float, float]:
    typical = spec.get("busy_ma") or spec.get("draw_ma") or 0
    peak = spec.get("stall_ma") or spec.get("max_ma") or spec.get("busy_ma") or typical
    return float(typical), float(peak)


def power(project: dict) -> dict:
    lib = library()
    nets = Nets(project)
    rails: dict[str, dict] = {}

    def rail_for(ref: str) -> dict | None:
        root = nets.find(ref)
        if root in rails:
            return rails[root]
        for r in nets.net(ref):
            pid, pin = r.split(".", 1)
            spec = lib[nets.type_of(r)]
            role = nets.role(r)
            cap = None
            if spec["kind"] == "power" and pin == "+":
                cap = spec.get("max_ma") or (spec.get("amps") or 0) * 1000 or None
                label = f"{pid} ({spec['catalog']})"
            elif spec["kind"] == "mcu" and role in ("out5v", "out3v3"):
                cap = BOARD_RAIL_MA.get((nets.type_of(r), role))
                label = f"{r} (the board's {'5V' if role == 'out5v' else '3.3V'} pin)"
            elif spec.get("out_ma") and role == "out5v":
                cap = spec["out_ma"]
                label = f"{r} (5V boost)"
            else:
                continue
            rails[root] = {"source": label, "source_part": pid, "capacity_ma": cap, "loads": [], "cell": bool(spec.get("mah") or BATTERY_MAH.get(nets.type_of(r)))}
            return rails[root]
        return None

    unpowered = []
    for p in project["parts"]:
        spec = lib[p["type"]]
        if spec["kind"] in ("mcu", "power"):
            continue
        supply_pins = [pin for pin, role in (spec.get("pins") or {}).items() if role in ("supply", "load")]
        typical, peak = _part_draw(spec)
        if not supply_pins or not (typical or peak):
            continue
        ref = f"{p['id']}.{supply_pins[0]}"
        rail = rail_for(ref)
        if rail is None:
            # An unwired pin is the workshop checks' to report; this is
            # wired, but to nothing that supplies it.
            if nets.wired(ref):
                unpowered.append(p["id"])
            continue
        rail["loads"].append({"part": p["id"], "what": spec.get("catalog", p["type"]), "typical_ma": typical, "peak_ma": peak})

    out = []
    for rail in rails.values():
        if rail.get("cell"):
            continue  # a battery is judged by what flows out of it, below
        loads = rail["loads"]
        typical = sum(l["typical_ma"] for l in loads)
        # All at once stalled is rare; one stalled while the rest run is not.
        worst_one = max((l["peak_ma"] - l["typical_ma"] for l in loads), default=0)
        realistic = typical + worst_one
        all_peak = sum(l["peak_ma"] for l in loads)
        cap = rail["capacity_ma"]
        if cap:
            verdict = (
                "OVER at typical load: it will brown out" if typical > cap
                else "browns out when one load stalls" if realistic > cap
                else "tight: everything stalled at once exceeds it" if all_peak > cap
                else "fine"
            )
            headroom = round(100 * (cap - realistic) / cap)
        else:
            verdict, headroom = "source has no current rating to check against", None
        out.append({
            "source": rail["source"],
            "source_part": rail["source_part"],
            "capacity_ma": cap,
            "typical_ma": round(typical),
            "one_stalled_ma": round(realistic),
            "all_stalled_ma": round(all_peak),
            "headroom_pct": headroom,
            "verdict": verdict,
            "loads": [f"{l['part']} {l['typical_ma']:.0f}/{l['peak_ma']:.0f} mA" for l in loads],
        })

    boards = [p for p in project["parts"] if lib[p["type"]]["kind"] == "mcu"]
    board_ma = sum(BOARD_SELF_MA.get(b["type"], 50) for b in boards)
    runtime = []
    for p in project["parts"]:
        spec = lib[p["type"]]
        mah = spec.get("mah") or BATTERY_MAH.get(p["type"])
        if not mah or f"{p['id']}.+" not in nets.parent:
            continue
        volts = float(spec.get("volts") or 3.7)
        cell_net = nets.find(f"{p['id']}.+")
        # What this cell feeds: loads on its own net, and 5V boosts whose
        # input is on it (their rails cost 5V / cell volts / efficiency).
        own = sum(l["typical_ma"] for l in (rails.get(cell_net) or {}).get("loads", []))
        fed_5v, fed_5v_peak, boosted = 0.0, 0.0, set()
        for q in project["parts"]:
            if lib[q["type"]].get("out_ma") and f"{q['id']}.VIN" in nets.parent and nets.find(f"{q['id']}.VIN") == cell_net:
                boosted.add(nets.find(f"{q['id']}.5V"))
        for r in out:
            root = next((k for k, v in rails.items() if v["source"] == r["source"]), None)
            if root in boosted:
                fed_5v += r["typical_ma"]
                fed_5v_peak += r["one_stalled_ma"]
        # A board runs from the cell when its VIN or 5V pin sits on a fed net.
        fed_boards = [
            b for b in boards
            if any(f"{b['id']}.{pin}" in nets.parent and nets.find(f"{b['id']}.{pin}") in boosted | {cell_net} for pin in ("VIN", "5V", "BAT", "USB"))
        ]
        # ...and so does whatever hangs off that board's own supply pins.
        fed_ids = {b["id"] for b in fed_boards}
        for r in out:
            if r["source_part"] in fed_ids:
                fed_5v += r["typical_ma"]
                fed_5v_peak += r["one_stalled_ma"]
        fed_5v += sum(BOARD_SELF_MA.get(b["type"], 50) for b in fed_boards)
        fed_5v_peak += sum(BOARD_PEAK_MA.get(b["type"], 50) for b in fed_boards)
        cell_ma = own + fed_5v * 5 / volts / BOOST_EFFICIENCY
        cell_peak = own + fed_5v_peak * 5 / volts / BOOST_EFFICIENCY
        if not cell_ma:
            continue
        entry = {
            "battery": f"{p['id']} ({mah} mAh)",
            "feeds": f"{len(boosted)} boosted 5V rail(s), {len(fed_boards)} board(s)",
            "cell_draw_ma": round(cell_ma),
            "cell_peak_ma": round(cell_peak),
            "hours_typical": round(0.8 * mah / cell_ma, 1),
            "note": "80% of rated capacity, loads at their typical draw, boost at 85%",
        }
        # A small protected LiPo trips its protection somewhere past 1C-2C.
        if spec.get("mah") and cell_peak > 2 * mah:
            entry["warning"] = f"Peaks near {cell_peak:.0f} mA, over 2C for a {mah} mAh cell: its protection will cut out. A bigger cell, or a separate one for the motors."
        runtime.append(entry)
    return {
        "rails": out,
        "boards_own_draw_ma": board_ma,
        "board_wifi_peaks_ma": sum(BOARD_PEAK_MA.get(b["type"], 50) for b in boards),
        "unpowered_loads": unpowered,
        "battery_runtime": runtime,
    }


# --- beam --------------------------------------------------------------------


def beam(args: dict) -> dict:
    """A printed cantilever (an arm, a bracket, a tab) loaded at its tip."""
    length = _f(args.get("length_mm"))
    width = _f(args.get("width_mm"))
    thick = _f(args.get("thickness_mm"))
    if min(length, width, thick) <= 0:
        return {"ok": False, "error": "beam needs length_mm, width_mm and thickness_mm (the depth in the direction it bends), all above 0."}
    material = str(args.get("material") or "pla").lower()
    if material not in MATERIALS:
        return {"ok": False, "error": f"material must be one of {', '.join(MATERIALS)}."}
    load_n = _f(args.get("load_n")) or _f(args.get("load_g")) / 1000 * G
    if load_n <= 0:
        return {"ok": False, "error": "beam needs load_g or load_n at the tip."}
    across = str(args.get("orientation") or "along").lower().startswith("across")
    strength, modulus_gpa = MATERIALS[material]
    allow = strength * PRINT_KNOCKDOWN * (ACROSS_LAYERS if across else 1)
    moment = load_n * length  # N-mm
    inertia = width * thick**3 / 12  # mm^4
    stress = moment * (thick / 2) / inertia  # MPa
    deflection = load_n * length**3 / (3 * modulus_gpa * 1000 * inertia)  # mm
    sf = allow / stress if stress else math.inf
    # The thickness that would give a 3x margin, holding the width.
    need_thick = math.sqrt(6 * moment * 3 / (width * allow))
    verdict = "BREAKS" if sf < 1 else "will crack in use (under 2x margin)" if sf < 2 else "marginal" if sf < 3 else "holds"
    result = {
        "ok": True,
        "material": material,
        "orientation": "across layers (load pulls layers apart)" if across else "along layers",
        "stress_mpa": round(stress, 1),
        "allowable_mpa": round(allow, 1),
        "safety_factor": round(sf, 2),
        "tip_deflection_mm": round(deflection, 2),
        "verdict": verdict,
        "thickness_for_3x_mm": round(need_thick, 1),
        "note": "Root of the beam is where it fails: add a fillet there. Thickness counts squared for strength and cubed for stiffness; width only linearly.",
    }
    if material == "pla" and stress > 0.25 * strength:
        result["creep"] = "PLA under a sustained load above about a quarter of its strength creeps and sags over days, worse in a warm car; PETG or ASA hold better."
    if across:
        result["print_it"] = "Print it on its side so the layers run along the beam: about twice the strength."
    return result


# --- review ------------------------------------------------------------------


def review(project: dict) -> dict:
    lib = library()
    checks = check(project)
    pw = power(project)
    failures = []
    for c in checks:
        if c["level"] == "error":
            failures.append({"severity": 1, "where": c["part"] or "wiring", "what": c["text"]})
    for r in pw["rails"]:
        if r["verdict"].startswith(("OVER", "browns")):
            failures.append({"severity": 1 if r["verdict"].startswith("OVER") else 2, "where": r["source"], "what": f"{r['verdict']}: {r['one_stalled_ma']} mA with one load stalled against {r['capacity_ma']} mA."})
        elif r["verdict"].startswith("tight"):
            failures.append({"severity": 3, "where": r["source"], "what": f"{r['all_stalled_ma']} mA if everything stalls, against {r['capacity_ma']} mA."})
    for p in pw["unpowered_loads"]:
        failures.append({"severity": 2, "where": p, "what": "draws current but no supply reaches it."})
    for c in checks:
        if c["level"] == "warning":
            failures.append({"severity": 3, "where": c["part"] or "wiring", "what": c["text"]})
    servos = [
        {"part": p["id"], "what": lib[p["type"]]["catalog"], "torque_kgcm": lib[p["type"]].get("torque_kgcm"), "continuous": bool((lib[p["type"]].get("props") or {}).get("continuous"))}
        for p in project["parts"]
        if lib[p["type"]].get("sim_as") == "servo" or p["type"] == "servo"
    ]
    jointed = {m for seg in project.get("segments") or [] for m in seg.get("members") or []}
    for s in servos:
        if s["continuous"] and s["part"] in jointed:
            failures.append({"severity": 2, "where": s["part"], "what": "continuous-rotation servo: it cannot hold an angle, so it cannot be a joint."})
    failures.sort(key=lambda f: f["severity"])
    b = bom(project)
    return {
        "project": project["name"],
        "first_to_fail": failures[:12],
        "power": pw,
        "servos": servos,
        "segments": [s.get("name") for s in project.get("segments") or []],
        "printed_parts": [p.get("name") for p in project.get("printed") or []],
        "cost": {"subtotal": b["subtotal"], "estimated_total": b["estimated_total"], "not_stocked": b["not_stocked"]},
        "next": "For each servo on a moving segment, run torque with the real link lengths and masses; for each printed part that carries load, run beam.",
    }


# --- tool --------------------------------------------------------------------


ENGINEERING_SCHEMA = {
    "type": "function",
    "function": {
        "name": "engineering",
        "description": (
            "Ultron's engineering bench (serious mode only): real calculations to take a design apart "
            "before it is built. review: the open workshop project ranked by what fails first - the "
            "workshop's checks, every power rail against its source, servos, cost. power: every rail of "
            "the open project, typical / one-stalled / all-stalled current against what the source "
            "gives, and battery runtime. torque: an arm's joints held straight out (worst case) against "
            "their servos, and the smallest servo that holds each. beam: whether a printed arm, bracket "
            "or tab holds a tip load, by material and print orientation, its sag, and the thickness for "
            "a 3x margin. Quote the numbers it returns; do not estimate what it can compute."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["review", "power", "torque", "beam"]},
                "links": {
                    "type": "array",
                    "description": "torque: the arm's links, base outward.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "length_mm": {"type": "number"},
                            "mass_g": {"type": "number", "description": "The link's own mass, printed part and hardware."},
                        },
                    },
                },
                "actuators": {
                    "type": "array",
                    "description": "torque: the servo at each joint, base first: a name (SG90, MG90S, MG996R, DS3218, DS3235), a library type (servo_micro, servo_std) or a rated torque in kg-cm.",
                    "items": {"type": "string"},
                },
                "payload_g": {"type": "number", "description": "torque: what the tip carries (gripper and load)."},
                "safety_factor": {"type": "number", "description": "torque: margin over static, default 2 (moving, real servos)."},
                "length_mm": {"type": "number", "description": "beam: root to load."},
                "width_mm": {"type": "number", "description": "beam: across the bend."},
                "thickness_mm": {"type": "number", "description": "beam: depth in the direction it bends."},
                "load_g": {"type": "number", "description": "beam: tip load in grams (or load_n)."},
                "load_n": {"type": "number"},
                "material": {"type": "string", "enum": list(MATERIALS)},
                "orientation": {"type": "string", "enum": ["along", "across"], "description": "beam: layers along the beam, or across it (a load pulling layers apart)."},
            },
            "required": ["operation"],
        },
    },
}


def engineering_tool(args: dict, open_id: str | None) -> dict:
    op = args.get("operation")
    try:
        if op == "torque":
            return torque(args)
        if op == "beam":
            return beam(args)
        if op in ("review", "power"):
            if not open_id:
                return {"ok": False, "error": f"{op} works on the open workshop project, and none is open. Open one with project first."}
            project = get_project(open_id)
            if not project:
                return {"ok": False, "error": "The open project could not be loaded."}
            return {"ok": True, **(review(project) if op == "review" else power(project))}
        return {"ok": False, "error": f"Unknown operation {op!r}."}
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "error": f"engineering {op} failed: {exc}"}


def make_engineering(console_state: dict | None) -> Callable[[dict], dict]:
    state = console_state if isinstance(console_state, dict) else {}
    project = state.get("project")
    open_id = project.get("id") if isinstance(project, dict) else None
    return lambda args: engineering_tool(args, open_id)
