from app.services.inbox import decide, list_inbox

# The inbox in a conversation ("anything waiting for me?", "dismiss the
# launch one"). Jarvis can show it and put items away, but he cannot
# approve a proposal: approving is Andrew's tap on the item, in the inbox
# or on the cards this tool's result puts in the chat (web/src/components/
# inbox/inbox-item.tsx). Otherwise the model could wave its own proposals
# through.

INBOX_SCHEMA = {
    "type": "function",
    "function": {
        "name": "inbox",
        "description": (
            "Your inbox for Andrew: the notices and proposed actions your rounds (when you look "
            "over his work on your own every couple of hours) left for him. list: what is waiting; "
            "the items appear on his screen as cards with Approve and Decline buttons, so tell him "
            "briefly what is there and let him tap. You cannot approve anything yourself; if he "
            "says to approve one, tell him to tap Approve on its card. decline / dismiss: put away "
            "a proposal or notice when he says so, by `item` (its number in the list, 1 = newest, "
            "or words from its title)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["list", "decline", "dismiss"]},
                "item": {"type": "string", "description": "decline/dismiss: its number or title words."},
            },
            "required": ["operation"],
        },
    },
}


def _find(pending: list[dict], key: str) -> dict | None:
    key = key.strip()
    if key.isdigit() and 1 <= int(key) <= len(pending):
        return pending[int(key) - 1]
    low = key.lower()
    return next((p for p in pending if p["id"] == key or low in p["title"].lower()), None)


def inbox(args: dict) -> dict:
    operation = args.get("operation")
    try:
        if operation == "list":
            listed = list_inbox(include_recent=False)
            return {"ok": True, "inbox": listed["pending"], "count": len(listed["pending"])}
        if operation in ("decline", "dismiss"):
            pending = list_inbox(include_recent=False)["pending"]
            item = _find(pending, str(args.get("item") or ""))
            if not item:
                return {"ok": False, "error": "No pending item matches that."}
            status = "declined" if item["kind"] == "proposal" else "dismissed"
            return decide(item["id"], status)
        return {"ok": False, "error": "operation must be list, decline or dismiss"}
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return {"ok": False, "error": str(exc)}
