from app.core.config import get_settings
from app.core.zoho_oauth import get_zoho_connection
from app.integrations import zoho_mail_api


def _ok(operation: str, data) -> dict:
    return {"ok": True, "operation": operation, "data": data}


def _err(operation: str, message: str) -> dict:
    return {"ok": False, "operation": operation, "error": message}


def _build_search_key(args: dict) -> str | None:
    clauses = []
    if args.get("sender"):
        clauses.append(f"sender:{args['sender']}")
    if args.get("subject"):
        clauses.append(f"subject:{args['subject']}")
    if args.get("keyword"):
        clauses.append(f"entire:{args['keyword']}")
    return "::".join(clauses) if clauses else None


def zoho_mail(args: dict) -> dict:
    operation = args.get("operation")

    if not get_settings().zoho_client_id:
        return _err(str(operation), "Zoho Mail not configured yet")

    try:
        connection = get_zoho_connection()
        if not connection:
            return _err(str(operation), "Zoho Mail not connected — visit /auth/zoho/connect first")

        account_id = connection.get("account_id")
        if not account_id:
            return _err(
                operation, "Zoho Mail connection is missing account setup — reconnect at /auth/zoho/connect"
            )

        access_token = connection["access_token"]
        api_domain = get_settings().zoho_api_domain

        if operation == "list_recent":
            folder_id = connection.get("inbox_folder_id")
            if not folder_id:
                return _err(operation, "Inbox folder couldn't be resolved — reconnect at /auth/zoho/connect")
            data = zoho_mail_api.list_recent_messages(
                access_token, api_domain, account_id, folder_id, int(args.get("max_results") or 10)
            )
            return _ok(operation, data)

        if operation == "search":
            search_key = _build_search_key(args)
            if not search_key:
                return _err(operation, "Provide at least one of sender, subject, or keyword")
            data = zoho_mail_api.search_messages(
                access_token, api_domain, account_id, search_key, int(args.get("max_results") or 10)
            )
            return _ok(operation, data)

        if operation == "get_content":
            folder_id = args.get("folder_id")
            message_id = args.get("message_id")
            if not folder_id or not message_id:
                return _err(operation, "folder_id and message_id are required")
            data = zoho_mail_api.get_message_content(access_token, api_domain, account_id, folder_id, message_id)
            return _ok(operation, data)

        return _err(str(operation), f"Unknown operation: {operation}")
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return _err(str(operation), str(exc))
