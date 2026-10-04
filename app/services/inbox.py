import json
import logging
from datetime import datetime, timedelta, timezone

from app.core.supabase_client import get_supabase_client
from app.services.push import send_push

# Jarvis's inbox: what his rounds (app/services/autonomy.py) found and
# want Andrew to see or decide. A notice is information. A proposal is one
# tool call Jarvis wants to make (send this email, move that task to done)
# and it runs only when Andrew approves it, from the inbox in either
# console, or by telling Jarvis in a conversation (the inbox tool). Nothing
# Jarvis does on his own changes anything without that.

logger = logging.getLogger(__name__)

TABLE = "jarvis_inbox"
MAX_LISTED = 30


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _shape(row: dict) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "title": row["title"],
        "body": row.get("body") or "",
        "priority": row.get("priority") or "normal",
        "tool": row.get("tool"),
        "args": row.get("args"),
        "status": row["status"],
        "result": row.get("result"),
        "created_at": row.get("created_at"),
        "decided_at": row.get("decided_at"),
    }


def list_inbox(include_recent: bool = True) -> dict:
    """Pending items, newest first, and (for the console) the last few
    decided ones, so an approval's outcome can be seen."""
    client = get_supabase_client()
    pending = (
        client.table(TABLE).select("*").eq("status", "pending").order("created_at", desc=True).limit(MAX_LISTED).execute().data
        or []
    )
    recent = []
    if include_recent:
        since = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        recent = (
            client.table(TABLE)
            .select("*")
            .neq("status", "pending")
            .gte("created_at", since)
            .order("created_at", desc=True)
            .limit(10)
            .execute()
            .data
            or []
        )
    return {"ok": True, "pending": [_shape(r) for r in pending], "recent": [_shape(r) for r in recent]}


def pending_summary() -> list[dict]:
    """What is already waiting, for rounds to avoid repeating itself."""
    rows = list_inbox(include_recent=False)["pending"]
    return [{"kind": r["kind"], "title": r["title"], "tool": r["tool"], "args": r["args"]} for r in rows]


def _duplicate(kind: str, title: str, tool: str | None, args: dict | None) -> bool:
    client = get_supabase_client()
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    rows = (
        client.table(TABLE).select("title,tool,args,status").eq("kind", kind).gte("created_at", since).execute().data or []
    )
    for row in rows:
        if kind == "proposal" and row["tool"] == tool and row["args"] == args and row["status"] == "pending":
            return True
        if row["title"].strip().lower() == title.strip().lower():
            return True
    return False


def add_item(
    kind: str,
    title: str,
    body: str = "",
    priority: str = "normal",
    tool: str | None = None,
    args: dict | None = None,
    session_id: str | None = None,
) -> dict | None:
    """Files a notice or proposal; None when the same one is already there."""
    title = " ".join(title.split())[:140] or ("Proposal" if kind == "proposal" else "Notice")
    if priority not in ("low", "normal", "high"):
        priority = "normal"
    if _duplicate(kind, title, tool, args):
        return None
    row = (
        get_supabase_client()
        .table(TABLE)
        .insert(
            {
                "kind": kind,
                "title": title,
                "body": body.strip()[:2000],
                "priority": priority,
                "tool": tool,
                "args": args,
                "session_id": session_id,
            }
        )
        .execute()
        .data[0]
    )
    return _shape(row)


def _get(item_id: str) -> dict | None:
    rows = get_supabase_client().table(TABLE).select("*").eq("id", item_id).limit(1).execute().data
    return rows[0] if rows else None


def _update(item_id: str, **changes) -> dict:
    rows = get_supabase_client().table(TABLE).update(changes).eq("id", item_id).execute().data
    return _shape(rows[0])


def approve(item_id: str) -> dict:
    """Runs an approved proposal's tool call, once, and records the result."""
    # Imported here: the tool registry imports the inbox tool, which
    # imports this module.
    from app.tools.schemas import DISPATCH

    row = _get(item_id)
    if not row:
        return {"ok": False, "error": "No such inbox item."}
    if row["kind"] != "proposal":
        return {"ok": False, "error": "Only proposals can be approved; dismiss a notice."}
    if row["status"] != "pending":
        return {"ok": False, "error": f"Already {row['status']}.", "item": _shape(row)}
    handler = DISPATCH.get(row["tool"])
    if handler is None:
        return {"ok": False, "error": f"Jarvis no longer has the {row['tool']} tool.", "item": _shape(row)}

    # Claimed before running, so a double tap (or two devices) cannot run it twice.
    claimed = (
        get_supabase_client()
        .table(TABLE)
        .update({"status": "approved", "decided_at": _now()})
        .eq("id", item_id)
        .eq("status", "pending")
        .execute()
        .data
    )
    if not claimed:
        return {"ok": False, "error": "Someone already decided this one.", "item": _shape(_get(item_id) or row)}
    try:
        result = handler(dict(row.get("args") or {}))
    except Exception as exc:  # noqa: BLE001 — record the failure on the item
        result = {"ok": False, "error": str(exc)}
    failed = isinstance(result, dict) and result.get("ok") is False
    item = _update(item_id, status="failed" if failed else "done", result=_storable(result))
    return {"ok": not failed, "item": item, "result": result}


def decide(item_id: str, status: str) -> dict:
    """Declines a proposal or dismisses a notice."""
    row = _get(item_id)
    if not row:
        return {"ok": False, "error": "No such inbox item."}
    if row["status"] != "pending":
        return {"ok": False, "error": f"Already {row['status']}.", "item": _shape(row)}
    return {"ok": True, "item": _update(item_id, status=status, decided_at=_now())}


def _storable(result) -> dict:
    """Results are kept for the inbox to show, capped so one large tool
    result does not bloat the table."""
    text = json.dumps(result, default=str)
    if len(text) <= 8000:
        return json.loads(text)
    return {"ok": result.get("ok") if isinstance(result, dict) else None, "truncated": text[:8000]}


def announce(items: list[dict]) -> None:
    """One push for what a round filed, rather than one per item."""
    if not items:
        return
    proposals = [i for i in items if i["kind"] == "proposal"]
    notices = [i for i in items if i["kind"] == "notice" and i["priority"] != "low"]
    if not proposals and not notices:
        return
    lead = (proposals or notices)[0]
    parts = []
    if proposals:
        parts.append(f"{len(proposals)} to approve")
    if notices:
        parts.append(f"{len(notices)} to know")
    title = lead["title"] if len(items) == 1 else f"Jarvis · {', '.join(parts)}"
    body = lead["body"] if len(items) == 1 else "; ".join(i["title"] for i in (proposals + notices)[:4])
    try:
        send_push(title, body or lead["title"], tag="jarvis-inbox")
    except Exception:  # noqa: BLE001 — the items are filed either way
        logger.warning("inbox push failed", exc_info=True)
