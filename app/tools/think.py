def think(args: dict) -> dict:
    """A reasoning scratchpad — no external I/O, no logging of its own.
    Every tool call (including this one) already lands durably in
    jarvis_interaction_log.tool_call_trace via the orchestrator's dispatch
    loop, so a separate reasoning-log table would just duplicate that.
    Deliberately doesn't echo the thought text back — Groq's own message
    history already carries the full argument.
    """
    thought = str(args.get("thought") or "").strip()
    thought_type = args.get("thought_type") or "general"
    if not thought:
        return {"ok": False, "error": "thought is required"}
    return {"ok": True, "thought_type": thought_type, "acknowledged": True}
