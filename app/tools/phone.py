from app.services import phone as line

# Jarvis's side of the phone line (app/services/phone.py): the log of
# calls, voicemails and texts, sending a text, ringing Andrew himself, and
# how calls are handled.

PHONE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "phone",
        "description": (
            "Andrew's phone line, which you answer when he does not: you screen callers, put through "
            "the ones he accepts, take messages (transcribed into his inbox) and turn away spam. log: "
            "recent calls, voicemails and texts, with who, why and what they said - use it for 'who "
            "called?', 'any messages?'. text: send an SMS from his Jarvis number, `to` (E.164, e.g. "
            "+13185551234, or from his contacts) and `body`; only when he asks you to, and read the "
            "text back first if he has not dictated it word for word. call_me: ring his own phone "
            "and say `message` - for something urgent he must hear now. mode: how calls are handled, "
            "`mode` screen (ask who and why, then ring him) or voicemail (straight to a message); "
            "'hold my calls' (the hold tool) also sends calls to messages. status: is the line set up, "
            "and its mode."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["log", "text", "call_me", "mode", "status"]},
                "to": {"type": "string"},
                "body": {"type": "string"},
                "message": {"type": "string"},
                "mode": {"type": "string", "enum": ["screen", "voicemail"]},
            },
            "required": ["operation"],
        },
    },
}


def phone(args: dict) -> dict:
    operation = args.get("operation")
    try:
        if operation == "status":
            return {"ok": True, "configured": line.configured(), **(line.phone_settings() if line.configured() else {})}
        if not line.configured():
            return {"ok": False, "error": "The phone line is not set up yet (TWILIO_* settings, ANDREW_PHONE and PUBLIC_BASE_URL)."}
        if operation == "log":
            return {"ok": True, "calls": line.recent()}
        if operation == "text":
            to, body = str(args.get("to") or "").strip(), str(args.get("body") or "").strip()
            if not to.startswith("+") or not body:
                return {"ok": False, "error": "to (E.164, starting with +) and body are required."}
            return {"ok": True, "sent": line.send_text(to, body)}
        if operation == "call_me":
            message = str(args.get("message") or "").strip()
            if not message:
                return {"ok": False, "error": "message is required."}
            return {"ok": True, "calling": line.call_andrew(message[:500])}
        if operation == "mode":
            if args.get("mode") not in ("screen", "voicemail"):
                return {"ok": False, "error": "mode must be screen or voicemail."}
            return {"ok": True, **line.set_mode(args["mode"])}
        return {"ok": False, "error": "unknown operation"}
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return {"ok": False, "error": str(exc)}

