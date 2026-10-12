"""Ultron's directive: what he is working toward on the engineering side,
and his plan for it - an objective, its phases, and the steps in each, with
where every step stands. His alone (serious mode); it shows in his
Directive app on the console (web/src/components/ultron/directive-panel.tsx).

Like the console tool, it runs in Andrew's browser: the handler validates
the change and returns it as `actions`, the console applies it and keeps
the directive (that browser's storage), and sends it back with every
message in CONSOLE_STATE (directive), so Ultron sees the plan as it stands
before he changes it.
"""

STATUSES = ("queued", "active", "done", "blocked")
MAX_PHASES = 6
MAX_STEPS = 10
MAX_TEXT = 140

DIRECTIVE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "directive",
        "description": (
            "Your directive, Ultron: the objective you are driving on the engineering side and "
            "your plan for it, shown in your Directive app. set: a new objective with its phases "
            "and their steps (replaces the old plan) - plan like an engineer: phases in the order "
            "the work must happen (requirements, design, prototype, test, build...), each step a "
            "concrete action with an outcome. step: mark one step queued | active | done | blocked "
            "(by phase and step number, from 1), with an optional note (what was found, what "
            "blocks it). add: add a step to a phase. clear: drop the directive. Use it when "
            "Andrew sets you a goal or a build, when you plan one, and as work lands - keep it true. "
            "CONSOLE_STATE (directive) shows it as it stands."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "op": {"type": "string", "enum": ["set", "step", "add", "clear"]},
                "objective": {"type": "string", "description": "set: the objective, one line."},
                "phases": {
                    "type": "array",
                    "description": "set: the phases in order.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "steps": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["name", "steps"],
                    },
                },
                "phase": {"type": "integer", "description": "step / add: the phase, from 1."},
                "step": {"type": "integer", "description": "step: the step in that phase, from 1."},
                "status": {"type": "string", "enum": list(STATUSES), "description": "step: where it stands now."},
                "text": {"type": "string", "description": "add: the new step."},
                "note": {"type": "string", "description": "step: what was found, or what blocks it."},
            },
            "required": ["op"],
        },
    },
}


def _text(value, limit: int = MAX_TEXT) -> str:
    return " ".join(str(value or "").split())[:limit]


def directive(args: dict, current: dict | None = None) -> dict:
    op = args.get("op")
    current = current if isinstance(current, dict) else None
    phases_now = (current or {}).get("phases") or []
    if op == "clear":
        return {"ok": True, "actions": [{"op": "clear"}], "note": "The directive is cleared in the console."}
    if op == "set":
        objective = _text(args.get("objective"))
        phases = []
        for raw in (args.get("phases") or [])[:MAX_PHASES]:
            if not isinstance(raw, dict):
                continue
            steps = [_text(s) for s in (raw.get("steps") or [])[:MAX_STEPS] if _text(s)]
            name = _text(raw.get("name"), 60)
            if name and steps:
                phases.append({"name": name, "steps": [{"text": s, "status": "queued"} for s in steps]})
        if not objective or not phases:
            return {"ok": False, "error": "set needs an objective and at least one phase with steps."}
        # The first step is under way.
        phases[0]["steps"][0]["status"] = "active"
        return {"ok": True, "actions": [{"op": "set", "objective": objective, "phases": phases}], "note": "The directive is set in the console."}
    if op in ("step", "add"):
        if not current:
            return {"ok": False, "error": "There is no directive yet: set one first."}
        try:
            p = int(args.get("phase") or 0)
        except (TypeError, ValueError):
            p = 0
        if not 1 <= p <= len(phases_now):
            return {"ok": False, "error": f"phase must be 1 to {len(phases_now)}."}
        if op == "add":
            text = _text(args.get("text"))
            if not text:
                return {"ok": False, "error": "add needs text."}
            if len(phases_now[p - 1].get("steps") or []) >= MAX_STEPS:
                return {"ok": False, "error": f"phase {p} already has {MAX_STEPS} steps."}
            return {"ok": True, "actions": [{"op": "add", "phase": p, "text": text}], "note": "Added in the console."}
        try:
            s = int(args.get("step") or 0)
        except (TypeError, ValueError):
            s = 0
        steps = phases_now[p - 1].get("steps") or []
        if not 1 <= s <= len(steps):
            return {"ok": False, "error": f"step must be 1 to {len(steps)} in phase {p}."}
        status = args.get("status")
        if status not in STATUSES:
            return {"ok": False, "error": f"status must be one of {', '.join(STATUSES)}."}
        action = {"op": "step", "phase": p, "step": s, "status": status}
        note = _text(args.get("note"))
        if note:
            action["note"] = note
        return {"ok": True, "actions": [action], "note": "Updated in the console."}
    return {"ok": False, "error": "op must be set, step, add or clear."}


def make_directive(console_state: dict | None):
    current = (console_state or {}).get("directive")
    return lambda args: directive(args, current)
