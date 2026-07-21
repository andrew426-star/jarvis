from datetime import datetime, timezone
from typing import Any

from app.core.supabase_client import get_supabase_client

TABLE = "jarvis_contacts"


def _ok(operation: str, data: Any, count: int | None = None) -> dict:
    result = {"ok": True, "operation": operation, "data": data}
    if count is not None:
        result["count"] = count
    return result


def _err(operation: str, message: str) -> dict:
    return {"ok": False, "operation": operation, "error": message}


def database_agent(args: dict) -> dict:
    operation = args.get("operation")
    supabase = get_supabase_client()

    try:
        if operation == "list_contacts":
            query = supabase.table(TABLE).select("*")
            name_filter = args.get("query")
            if name_filter:
                query = query.ilike("name", f"%{name_filter}%")
            res = query.order("created_at", desc=True).limit(50).execute()
            return _ok(operation, res.data, count=len(res.data))

        if operation == "get_contact":
            contact_id = args.get("contact_id")
            name_filter = args.get("query")
            query = supabase.table(TABLE).select("*")
            if contact_id:
                query = query.eq("id", contact_id)
            elif name_filter:
                query = query.ilike("name", f"%{name_filter}%")
            else:
                return _err(operation, "contact_id or query is required")
            res = query.limit(5).execute()
            if not res.data:
                return _ok(operation, None)
            return _ok(operation, res.data[0] if contact_id else res.data)

        if operation == "create_contact":
            contact = args.get("contact") or {}
            if not contact.get("name"):
                return _err(operation, "contact.name is required")
            res = supabase.table(TABLE).insert(contact).execute()
            return _ok(operation, res.data[0] if res.data else None)

        if operation == "update_contact":
            contact_id = args.get("contact_id")
            contact = args.get("contact") or {}
            if not contact_id:
                return _err(operation, "contact_id is required")
            if not contact:
                return _err(operation, "contact fields to update are required")
            contact["updated_at"] = datetime.now(timezone.utc).isoformat()
            res = supabase.table(TABLE).update(contact).eq("id", contact_id).execute()
            return _ok(operation, res.data[0] if res.data else None)

        return _err(str(operation), f"Unknown operation: {operation}")
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return _err(str(operation), str(exc))
