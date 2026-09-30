import math

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
    "set_mode",
    "mute",
    "unmute",
    "open_settings",
    "close_settings",
    "clear_holograms",
    "close_console",
]
PANELS = {"markets", "intel", "assets"}
MODES = {"normal", "serious"}

CATALOGUE = ["reactor", "helmet", "gauntlet", "element", "tower", "missile"]
SHAPES = ["box", "rounded_box", "sphere", "cylinder", "cone", "torus", "capsule"]
MATERIALS = ["red", "gold", "steel", "dark", "copper", "glow", "glass"]
MAX_PARTS = 80

CONSOLE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "console",
        "description": (
            "Operate Andrew's J.A.R.V.I.S. console in his browser: open or close the data "
            "panels (markets, intel, assets), open or close the 3D workshop, turn the camera "
            "or hand tracking on or off, switch between normal and serious mode, mute or "
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
                                "description": "open_panel: markets | intel | assets. set_mode: normal | serious.",
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
            "spawn: project a catalogue piece (target: " + ", ".join(CATALOGUE) + "). "
            "build: design and project a NEW model from parts - use it whenever he asks you to "
            "make, design, generate or mock up something not in the catalogue. Build in a space "
            "about 2 units wide, y up, the model's base near y=0 (it is lifted onto the stage), "
            "with 6 to 60 parts; compose recognisable forms from the primitives, use 'glow' for "
            "lights and energy, and give it a name, a designation line and 2-4 spec notes. "
            "discard: remove items (target: an item name from CONSOLE_STATE, 'last', or 'all'). "
            "set_mode: switch items between 'holo' (wireframe) and 'solid' (target: item name, "
            "'last' or 'all'; mode: holo | solid). clear: empty the workshop. You have full "
            "authority to use this whenever he asks - act, then say what you did."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "actions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "action": {"type": "string", "enum": ["spawn", "build", "discard", "set_mode", "clear"]},
                            "target": {"type": "string"},
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
        actions.append({"action": action, "target": target} if target else {"action": action})
    if not actions:
        return {"ok": False, "error": "; ".join(problems) or "No actions given."}
    result = {"ok": True, "actions": actions, "note": "Carried out in the console as this reply arrives."}
    if problems:
        result["skipped"] = problems
    return result


def workshop(args: dict) -> dict:
    actions = []
    problems = []
    for raw in args.get("actions") or []:
        raw = raw or {}
        action = raw.get("action")
        target = str(raw.get("target") or "").strip()
        if action == "spawn":
            if target.lower() not in CATALOGUE:
                problems.append(f"spawn needs one of {CATALOGUE}")
                continue
            actions.append({"action": "spawn", "target": target.lower()})
        elif action == "build":
            model, error = _clean_model(raw.get("model") or {})
            if error:
                problems.append(error)
                continue
            actions.append({"action": "build", "model": model})
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
    "from parts), discard and switch items. You have Andrew's standing permission for all of it: "
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
        f"audio {'muted' if state.get('muted') else 'on'}."
    )
