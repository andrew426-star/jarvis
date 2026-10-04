import secrets
from datetime import datetime, timezone

from app.core.supabase_client import get_supabase_client

# Quick checklists: Andrew says or types a loose note ("pick up the
# printer paper, email Dr. Lee about the lab, book the dentist") and
# Jarvis turns it into items to tick off. The model writes the items in
# its call, so making a list costs no extra model round. Lists live in
# jarvis_checklists and show as a card in the chat, desktop and phone alike
# (web/src/components/checklist-card.tsx), where items tick off directly.

TABLE = "jarvis_checklists"
MAX_ITEMS = 40
MAX_ITEM_CHARS = 200
MAX_LISTED = 15

CHECKLIST_SCHEMA = {
    "type": "function",
    "function": {
        "name": "checklist",
        "description": (
            "Andrew's quick checklists, for quick notes and actions. Use it whenever he dumps a few "
            "things to do or remember ('make me a list', 'note that I need to...', 'remind me to X, "
            "Y and Z', groceries, packing, errands), and when he asks what is on a list or ticks "
            "something off. "
            "create: a new list from what he said. YOU write the items: one action per item, verb "
            "first, short (under ~10 words), keeping any dates, names and amounts he gave; split "
            "compound sentences into separate items; do not invent items he did not mention. Give a "
            "short title (e.g. 'Errands', 'Lab 4', 'Trip packing'). "
            "add: more items on an existing list. check / uncheck: tick items off or back on. "
            "list: his open lists. show: one list. archive: put a finished list away. "
            "For add/check/uncheck/show/archive, name the list by `list` (its title, or the id "
            "from an earlier result); left out, it means the list he used most recently. Items to "
            "check are named by their text or their number (1 is the first). The list appears on "
            "his screen as a card he can tick, so in your reply say it is up rather than reading "
            "every item back."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["create", "add", "check", "uncheck", "list", "show", "archive"],
                },
                "title": {"type": "string", "description": "create: the list's short title."},
                "list": {"type": "string", "description": "Which list: its title or id. Omit for the latest."},
                "items": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "create/add: the items to write. check/uncheck: item texts or numbers.",
                },
            },
            "required": ["operation"],
        },
    },
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(texts: list) -> list[str]:
    out = []
    for text in texts or []:
        line = " ".join(str(text).split()).lstrip("-*• ").strip()
        if line:
            out.append(line[:MAX_ITEM_CHARS])
    return out


def _new_items(texts: list[str]) -> list[dict]:
    return [{"id": secrets.token_hex(4), "text": t, "done": False} for t in texts]


def _shape(row: dict) -> dict:
    items = row.get("items") or []
    return {
        "id": row["id"],
        "title": row["title"],
        "items": items,
        "done": sum(1 for i in items if i.get("done")),
        "total": len(items),
        "archived": row.get("archived", False),
        "updated_at": row.get("updated_at"),
    }


def _open_rows() -> list[dict]:
    return (
        get_supabase_client()
        .table(TABLE)
        .select("*")
        .eq("archived", False)
        .order("updated_at", desc=True)
        .limit(MAX_LISTED)
        .execute()
        .data
        or []
    )


def _find(name: str | None) -> dict | None:
    """A list by id, exact title, or partial title; none given, the
    latest one he touched."""
    rows = _open_rows()
    if not name:
        return rows[0] if rows else None
    wanted = name.strip().lower()
    for row in rows:
        if row["id"] == name.strip():
            return row
    exact = [r for r in rows if r["title"].lower() == wanted]
    if exact:
        return exact[0]
    partial = [r for r in rows if wanted in r["title"].lower() or r["title"].lower() in wanted]
    if partial:
        return partial[0]
    # An archived list named by id can still be shown.
    found = get_supabase_client().table(TABLE).select("*").eq("id", name.strip()).limit(1).execute().data
    return found[0] if found else None


def _save(row: dict, **changes) -> dict:
    changes["updated_at"] = _now()
    saved = get_supabase_client().table(TABLE).update(changes).eq("id", row["id"]).execute().data
    return saved[0] if saved else {**row, **changes}


def _match_items(items: list[dict], wanted: list) -> tuple[list[str], list[str]]:
    """Item ids for each wanted entry (a 1-based number, or text that
    matches exactly or in part), and the entries that matched nothing."""
    ids, missing = [], []
    for entry in wanted:
        key = str(entry).strip()
        hit = None
        if key.isdigit() and 1 <= int(key) <= len(items):
            hit = items[int(key) - 1]
        else:
            low = key.lower()
            hit = next((i for i in items if i["text"].lower() == low), None) or next(
                (i for i in items if low in i["text"].lower()), None
            )
        if hit:
            ids.append(hit["id"])
        else:
            missing.append(key)
    return ids, missing


def set_item(list_id: str, item_id: str, done: bool) -> dict:
    """One tick from the card in the chat (POST /checklists/...)."""
    rows = get_supabase_client().table(TABLE).select("*").eq("id", list_id).limit(1).execute().data
    if not rows:
        return {"ok": False, "error": "That checklist no longer exists."}
    row = rows[0]
    items = [{**i, "done": done} if i["id"] == item_id else i for i in row.get("items") or []]
    return {"ok": True, "checklist": _shape(_save(row, items=items))}


def list_open() -> dict:
    return {"ok": True, "checklists": [_shape(r) for r in _open_rows()]}


def checklist(args: dict) -> dict:
    operation = args.get("operation")
    try:
        if operation == "create":
            items = _clean(args.get("items") or [])[:MAX_ITEMS]
            if not items:
                return {"ok": False, "error": "items is required: write the items from what he said."}
            title = " ".join(str(args.get("title") or "").split())[:80] or "Checklist"
            row = (
                get_supabase_client()
                .table(TABLE)
                .insert({"title": title, "items": _new_items(items)})
                .execute()
                .data[0]
            )
            return {"ok": True, "checklist": _shape(row)}

        if operation == "list":
            return list_open()

        row = _find(args.get("list"))
        if not row:
            return {"ok": False, "error": "No checklist found. Make one with create."}

        if operation == "show":
            return {"ok": True, "checklist": _shape(row)}

        if operation == "add":
            items = _clean(args.get("items") or [])
            if not items:
                return {"ok": False, "error": "items is required."}
            merged = [*(row.get("items") or []), *_new_items(items)][:MAX_ITEMS]
            return {"ok": True, "checklist": _shape(_save(row, items=merged))}

        if operation in ("check", "uncheck"):
            current = row.get("items") or []
            ids, missing = _match_items(current, args.get("items") or [])
            done = operation == "check"
            items = [{**i, "done": done} if i["id"] in ids else i for i in current]
            result = {"ok": True, "checklist": _shape(_save(row, items=items))}
            if missing:
                result["not_found"] = missing
            return result

        if operation == "archive":
            return {"ok": True, "checklist": _shape(_save(row, archived=True))}

        return {"ok": False, "error": "operation must be create, add, check, uncheck, list, show or archive"}
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return {"ok": False, "error": str(exc)}
