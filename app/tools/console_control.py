import math
from collections.abc import Callable

from app.core.gemini import AllModelsExhausted, GeminiNotConfigured
from app.integrations.gemini_scad import scad_from_frame

# Jarvis driving his own console. These tools run on the server but act in
# Andrew's browser: each one validates what the model asked for and returns
# it as `actions`, which the console carries out, in order, the moment the
# reply arrives (web/src/lib/console-commands.ts). The console sends its
# current state with every message (CONSOLE_STATE in the prompt), so the
# model knows what is open and what is in the workshop before it acts.
#
# Only offered on the console channel: the terminal has no console to drive.

CONSOLE_ACTIONS = [
    "open_panel",
    "close_panel",
    "open_workshop",
    "close_workshop",
    "camera_on",
    "camera_off",
    "hands_on",
    "hands_off",
    "watch_on",
    "watch_off",
    "watch_snooze",
    "close_showcase",
    "set_mode",
    "mute",
    "unmute",
    "open_settings",
    "close_settings",
    "clear_holograms",
    "close_console",
]
PANELS = {"markets", "intel", "assets", "notes", "inbox"}
WATCH_LEVELS = {"quiet", "normal", "coach"}
MODES = {"normal", "serious"}

SHAPES = ["box", "rounded_box", "sphere", "cylinder", "cone", "torus", "capsule"]
MATERIALS = ["red", "gold", "steel", "dark", "copper", "glow", "glass"]
MAX_PARTS = 80

# OpenSCAD: printable parts are OpenSCAD programs Jarvis writes, compiled
# in the browser with the Manifold backend (web/src/lib/workshop/
# openscad.ts). SCAD_GUIDE mirrors jarvis.scad (web/src/lib/workshop/
# jarvis-scad.ts) - keep the two in step.
MAX_SCAD_CHARS = 40_000

SCAD_GUIDE = (
    "scad: a PRINTABLE part, as an OpenSCAD program you write - millimetres, Z up, floor on z=0. "
    "It compiles in his browser to a watertight STL (and he can download the .scad). Use it, not "
    "build, for anything he means to 3D print. Give `name`, `code`, and 2-4 `notes` (key "
    "dimensions). Start the code with `include <jarvis.scad>` to use its library: "
    "board(name) presets arduino_uno, arduino_mega, esp32_devkit, raspberry_pi_4, pca9685, l298n, "
    "lm2596 -> [[pcb_x, pcb_y], [[hole_x, hole_y]...], hole_d, tallest_part]; servo(name) sg90, "
    "mg90s, mg996r, ds3218 -> [[body_x, body_y, body_z], hole_spacing, hole_pair, hole_d, "
    "tab_length]; NEMA17 = [face, hole_spacing, hole_d, boss_d]. "
    "enclosure(inner=[x,y,z], wall=2.4, floor_t=2.4, boards=[[name or custom spec, [x,y] offset "
    "of the board centre from the floor centre, standoff]], cutouts=[[side front|back|left|right, "
    "shape rect|circle, size [w,h] or diameter, [along the wall from its centre, height of the "
    "centre above the floor]]], vents=true) makes body plus friction-fit lid side by side; "
    "enclosure_body(...) and enclosure_lid(inner, wall, vents) separately. "
    "servo_mount(name, t=4); arm_link(length, width=20, t=5, hole_d=3.2, end_a=\"horn\"|\"hole\", "
    "end_b, lightening=true); base_plate(d=140, t=6, center_hole=8, nema17=false, bolts=4, "
    "bolt_circle, bolt_d=3.4); l_bracket(width=30, leg_a=40, leg_b=40, t=4, hole_d=3.4, holes=2). "
    "Plain OpenSCAD works too (difference, hull, minkowski, linear_extrude...). Size housings to "
    "the hardware plus ~5 mm clearance and put cut-outs where cables and ports exit. If "
    "CONSOLE_STATE shows last_scad_error, your previous part failed to compile: fix the code and "
    "send it again. "
    "export_stl: download an item's STL (and .scad) - target: its name, 'last' or 'all'. "
    "render: a photoreal image of the current workshop view, made by Gemini's image model and "
    "shown in the workshop; `prompt` is the art direction - materials, finish, colour, lighting, "
    "setting (e.g. 'matte black PLA on a walnut desk beside a monitor, warm evening lamp light'). "
    "The part's geometry is held fixed, so describe looks, not shape. Use it whenever he asks to "
    "see a part for real, rendered or 'what it would look like'. "
    "capture: model what is in front of his camera as a printable part - the object he is "
    "holding up, a sketch on the whiteboard, a broken piece to replace. `prompt` says what to "
    "model and anything to change or add (e.g. 'the bracket in my hand, but 4 mm thick with a "
    "second mounting hole', 'a case that fits this board'), with any real dimensions he gave. A "
    "model that sees the camera frame writes the part, so do not describe the object yourself "
    "and do not call camera_look first. Needs the camera on (it is while watching); if it is "
    "off, turn it on with the console tool and ask him to hold the object up. Size is judged "
    "from the frame unless he gives it, so say which dimensions are estimates and offer to "
    "adjust. "
    "snapshot: save the view as a PNG to download - for Veras (EvolveLAB's renderer, which has "
    "no API; he uploads it himself, and you can give him a Veras prompt) or anything else. "
)

CONSOLE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "console",
        "description": (
            "Operate Andrew's J.A.R.V.I.S. console in his browser: open or close the data "
            "panels (markets, intel, assets, notes: his saved notes, inbox: what your rounds left for him), open or close the 3D workshop, turn the camera "
            "or hand tracking on or off, close the showcase window (close_showcase), start or stop watching his whiteboard (watch_on brings "
            "the camera up; target sets how readily you speak up: quiet | normal | coach; watch_snooze keeps you quiet "
            "for 15 minutes without stopping), switch between normal and serious mode, mute or "
            "unmute audio, open or close settings, clear the pinned holograms, or close the "
            "console entirely (close_console: stops the camera and audio and puts the console "
            "in standby). Actions run in order the moment your reply arrives. You have full "
            "authority to use this whenever he asks for any of these, in any wording - act, "
            "then say what you did."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "actions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "action": {"type": "string", "enum": CONSOLE_ACTIONS},
                            "target": {
                                "type": "string",
                                "description": (
                                    "open_panel: markets | intel | assets | notes | inbox. set_mode: normal | serious. "
                                    "watch_on: quiet | normal | coach (default normal)."
                                ),
                            },
                        },
                        "required": ["action"],
                    },
                }
            },
            "required": ["actions"],
        },
    },
}

_PART = {
    "type": "object",
    "properties": {
        "shape": {"type": "string", "enum": SHAPES},
        "size": {
            "type": "array",
            "items": {"type": "number"},
            "description": (
                "box/rounded_box: [width, height, depth]. sphere: [radius]. cylinder: "
                "[radius_top, radius_bottom, height]. cone: [radius, height]. torus: [radius, "
                "tube]. capsule: [radius, length]."
            ),
        },
        "position": {"type": "array", "items": {"type": "number"}, "description": "[x, y, z]"},
        "rotation": {"type": "array", "items": {"type": "number"}, "description": "[x, y, z] in degrees"},
        "material": {"type": "string", "enum": MATERIALS},
    },
    "required": ["shape", "size", "material"],
}

WORKSHOP_SCHEMA = {
    "type": "function",
    "function": {
        "name": "workshop",
        "description": (
            "Work in the 3D workshop in Andrew's console (it opens itself if needed). "
            "build: design and project a NEW model from parts - use it whenever he asks you to "
            "make, design, generate or mock up something. Build in a space "
            "about 2 units wide, y up, the model's base near y=0 (it is lifted onto the stage), "
            "with 6 to 60 parts; compose recognisable forms from the primitives, use 'glow' for "
            "lights and energy, and give it a name, a designation line and 2-4 spec notes. "
            "discard: remove items (target: an item name from CONSOLE_STATE, 'last', or 'all'). "
            "set_mode: switch items between 'holo' (wireframe) and 'solid' (target: item name, "
            "'last' or 'all'; mode: holo | solid). clear: empty the workshop. "
            + SCAD_GUIDE
            + "For a whole build with electronics (a circuit, a sketch, and parts to print around "
            "them), use the project tool instead: its printed parts are placed with the real "
            "components in 3D. "
            "When he asks for a physical part, design it from his actual hardware: if he has "
            "not said what goes in it, ask for the list (he can attach a file or photo) before "
            "guessing. Say the key dimensions you chose and why. You have full authority to use "
            "this whenever he asks - act, then say what you did."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "actions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "action": {
                                "type": "string",
                                "enum": ["build", "scad", "capture", "export_stl", "render", "snapshot", "discard", "set_mode", "clear"],
                            },
                            "target": {"type": "string"},
                            "name": {"type": "string", "description": "scad or capture: the part's name."},
                            "code": {"type": "string", "description": "scad: the OpenSCAD program."},
                            "notes": {"type": "array", "items": {"type": "string"}, "description": "scad: 2-4 key dimensions."},
                            "prompt": {"type": "string", "description": "render: art direction. capture: what to model from the camera."},
                            "mode": {"type": "string", "enum": ["holo", "solid"]},
                            "model": {
                                "type": "object",
                                "properties": {
                                    "name": {"type": "string"},
                                    "designation": {"type": "string"},
                                    "notes": {"type": "array", "items": {"type": "string"}},
                                    "parts": {"type": "array", "items": _PART},
                                },
                                "required": ["name", "parts"],
                            },
                        },
                        "required": ["action"],
                    },
                }
            },
            "required": ["actions"],
        },
    },
}


def _num(value, fallback: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if math.isnan(number) or math.isinf(number):
        return fallback
    return max(low, min(high, number))


def _vector(value, length: int, fallback: float, low: float, high: float) -> list[float]:
    items = list(value) if isinstance(value, (list, tuple)) else []
    return [_num(items[i] if i < len(items) else None, fallback, low, high) for i in range(length)]


def _clean_model(model: dict) -> tuple[dict | None, str | None]:
    parts_in = model.get("parts") if isinstance(model, dict) else None
    if not isinstance(parts_in, list) or not parts_in:
        return None, "A built model needs at least one part."
    parts = []
    for part in parts_in[:MAX_PARTS]:
        if not isinstance(part, dict) or part.get("shape") not in SHAPES:
            continue
        parts.append(
            {
                "shape": part["shape"],
                # Sizes are generous but bounded: nothing larger than the stage,
                # nothing so thin it vanishes.
                "size": _vector(part.get("size"), 3, 0.2, 0.005, 4.0),
                "position": _vector(part.get("position"), 3, 0.0, -3.0, 4.0),
                "rotation": _vector(part.get("rotation"), 3, 0.0, -360.0, 360.0),
                "material": part.get("material") if part.get("material") in MATERIALS else "steel",
            }
        )
    if not parts:
        return None, "None of the parts had a usable shape."
    notes = model.get("notes") if isinstance(model.get("notes"), list) else []
    return {
        "name": str(model.get("name") or "Prototype")[:40],
        "designation": str(model.get("designation") or "WORKSHOP PROTOTYPE")[:60],
        "notes": [str(n)[:60] for n in notes[:4]],
        "parts": parts,
    }, None


def console(args: dict) -> dict:
    actions = []
    problems = []
    for raw in args.get("actions") or []:
        action = (raw or {}).get("action")
        target = str((raw or {}).get("target") or "").lower().strip()
        if action not in CONSOLE_ACTIONS:
            problems.append(f"unknown action {action!r}")
            continue
        if action == "open_panel" and target not in PANELS:
            problems.append(f"open_panel needs one of {sorted(PANELS)}")
            continue
        if action == "set_mode" and target not in MODES:
            problems.append("set_mode needs normal or serious")
            continue
        if action == "watch_on" and target and target not in WATCH_LEVELS:
            target = "normal"
        actions.append({"action": action, "target": target} if target else {"action": action})
    if not actions:
        return {"ok": False, "error": "; ".join(problems) or "No actions given."}
    result = {"ok": True, "actions": actions, "note": "Carried out in the console as this reply arrives."}
    if problems:
        result["skipped"] = problems
    return result


def make_workshop(frame_b64: str | None, frame_type: str) -> Callable[[dict], dict]:
    """The workshop handler for this turn, holding the camera frame (if any)
    for a capture."""
    return lambda args: workshop(args, frame_b64, frame_type)


def _capture(raw: dict, frame_b64: str | None, frame_type: str) -> tuple[dict | None, str | None]:
    """A capture becomes an ordinary scad action, so the console compiles it
    and reports a failed compile back like any other part."""
    if not frame_b64:
        return None, "capture needs the camera on: there is no frame this turn"
    instructions = str(raw.get("prompt") or "").strip()[:1500] or "Model the main object in view."
    try:
        part = scad_from_frame(frame_b64, frame_type, instructions, SCAD_GUIDE)
    except GeminiNotConfigured as exc:
        return None, str(exc)
    except AllModelsExhausted as exc:
        return None, f"capture failed, no model would take it - {exc.detail()}"
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return None, f"capture failed: {exc}"
    if len(part["code"]) > MAX_SCAD_CHARS:
        return None, "capture produced code too long to compile"
    name = str(raw.get("name") or part["name"])[:60]
    return {"action": "scad", "name": name, "code": part["code"], "notes": [str(n)[:60] for n in part["notes"][:4]]}, None


def workshop(args: dict, frame_b64: str | None = None, frame_type: str = "image/jpeg") -> dict:
    actions = []
    problems = []
    for raw in args.get("actions") or []:
        raw = raw or {}
        action = raw.get("action")
        target = str(raw.get("target") or "").strip()
        if action == "build":
            model, error = _clean_model(raw.get("model") or {})
            if error:
                problems.append(error)
                continue
            actions.append({"action": "build", "model": model})
        elif action == "scad":
            code = str(raw.get("code") or "").strip()
            if not code:
                problems.append("scad needs code")
                continue
            if len(code) > MAX_SCAD_CHARS:
                problems.append("scad code too long")
                continue
            notes = raw.get("notes") if isinstance(raw.get("notes"), list) else []
            actions.append(
                {
                    "action": "scad",
                    "name": str(raw.get("name") or "Part")[:60],
                    "code": code,
                    "notes": [str(n)[:60] for n in notes[:4]],
                }
            )
        elif action == "capture":
            captured, error = _capture(raw, frame_b64, frame_type)
            if error:
                problems.append(error)
                continue
            actions.append(captured)
        elif action == "snapshot":
            actions.append({"action": "snapshot"})
        elif action == "render":
            prompt = str(raw.get("prompt") or "").strip()[:600]
            actions.append({"action": "render", "prompt": prompt} if prompt else {"action": "render"})
        elif action == "export_stl":
            actions.append({"action": "export_stl", "target": target or "last"})
        elif action == "discard":
            actions.append({"action": "discard", "target": target or "last"})
        elif action == "set_mode":
            mode = raw.get("mode") if raw.get("mode") in ("holo", "solid") else None
            if not mode:
                problems.append("set_mode needs mode holo or solid")
                continue
            actions.append({"action": "set_mode", "target": target or "all", "mode": mode})
        elif action == "clear":
            actions.append({"action": "clear"})
        else:
            problems.append(f"unknown action {action!r}")
    if not actions:
        return {"ok": False, "error": "; ".join(problems) or "No actions given."}
    result = {"ok": True, "actions": actions, "note": "Carried out in the workshop as this reply arrives."}
    if problems:
        result["skipped"] = problems
    return result


CONSOLE_CONTROL_NOTE = (
    "CONSOLE CONTROL: you operate this console yourself. With the console tool you open and "
    "close panels and the workshop, turn the camera and hand tracking on or off, switch modes, "
    "mute, and close the console; with the workshop tool you project, build (design new models "
    "from parts), discard and switch items; with the project tool you build real projects (parts, wiring, the UNO sketch, printed parts) and simulate them. You have Andrew's standing permission for all of it: "
    "when he asks, in any wording, do it in this turn rather than asking or describing how, then "
    "say briefly what you did. You cannot touch other applications on his computer - only this "
    "console - so if he asks you to close something outside it, say so plainly."
)


def state_note(state: dict | None) -> str | None:
    """The console's current state, as the model sees it."""
    if not isinstance(state, dict):
        return None
    items = state.get("workshop_items") or []
    names = ", ".join(
        f"{i.get('name')} ({i.get('mode')})" for i in items[:30] if isinstance(i, dict)
    ) or "none"
    return (
        "CONSOLE_STATE (live, from Andrew's browser): "
        f"mode {state.get('mode', '?')}; "
        f"open panel {state.get('active_panel') or 'none'}; "
        f"workshop {'open' if state.get('workshop_open') else 'closed'}; "
        f"workshop items: {names}; "
        f"camera {'on' if state.get('camera_on') else 'off'}; "
        f"hand tracking {'on' if state.get('hands_on') else 'off'}; "
        + (
            f"WATCHING his whiteboard ({state.get('watching')}): you speak up on your own when it helps; "
            if state.get("watching")
            else "not watching the whiteboard; "
        )
        + f"audio {'muted' if state.get('muted') else 'on'}."
        + (
            " His CAMERA WINDOW FILLS THE SCREEN, so the chat is hidden: anything longer than a "
            "sentence - lists, checked answers, steps, code - must go in a showcase window, or he "
            "will not see it."
            if state.get("camera_fills_screen")
            else ""
        )
        + (
            " Workshop and camera are both up: when he asks you to model, capture or copy what he "
            "is showing, use workshop capture."
            if state.get("workshop_open") and state.get("camera_on")
            else ""
        )
        + (
            f" LAST OPENSCAD COMPILE FAILED for \"{(state.get('last_scad_error') or {}).get('name')}\": "
            f"{(state.get('last_scad_error') or {}).get('error', '')[:800]}"
            if isinstance(state.get("last_scad_error"), dict)
            else ""
        )
    )
