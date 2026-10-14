from app.services.home import devices, queue

# Jarvis's hand on the house (app/services/home.py): what the devices
# sense, and commands for them. The devices are Ultron's builds.

HOME_SCHEMA = {
    "type": "function",
    "function": {
        "name": "home",
        "description": (
            "Andrew's room and home devices - the ESP32 hubs Ultron built - which check in every few "
            "seconds with what they sense (temperature, light, door, motion...) and what they can do. "
            "status: every device, online or not, its readings and its capabilities. command: send "
            "`device` an `action` from its capabilities, with `value` where it takes one (a level "
            "0-100, a colour, on/off) - 'lights on', 'dim to 30', 'it's cold in here', 'lock up' all "
            "come here. It runs at the device's next check-in, within a few seconds; say so if the "
            "device is offline. Never claim a reading you did not get from status."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["status", "command"]},
                "device": {"type": "string"},
                "action": {"type": "string"},
                "value": {"description": "The action's argument, if it takes one."},
            },
            "required": ["operation"],
        },
    },
}


def home(args: dict) -> dict:
    operation = args.get("operation")
    try:
        if operation == "status":
            found = devices()
            return {"ok": True, "devices": found, "note": None if found else "No device has checked in yet."}
        if operation == "command":
            device, action = str(args.get("device") or "").strip(), str(args.get("action") or "").strip()
            if not device or not action:
                return {"ok": False, "error": "device and action are required (see status)."}
            return queue(device, action, args.get("value"))
        return {"ok": False, "error": "operation must be status or command"}
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return {"ok": False, "error": str(exc)}
