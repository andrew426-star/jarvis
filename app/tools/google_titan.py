from app.core.google_oauth import ROW_ID, SCHOOL_ROW_ID, get_google_access_token
from app.integrations import google_api

# Tool-facing account names -> connection row ids.
ACCOUNTS = {"kivaro": ROW_ID, "school": SCHOOL_ROW_ID}
# The school account is read-only (see SCHOOL_SCOPES); these merge across
# both accounts by default, tagging every item with its account.
MERGED_READS = ("gmail_list_messages", "calendar_list_events")
SCHOOL_READS = MERGED_READS + ("gmail_get_message",)


def _ok(operation: str, data) -> dict:
    return {"ok": True, "operation": operation, "data": data}


def _err(operation: str, message: str) -> dict:
    return {"ok": False, "operation": operation, "error": message}


def _tagged(items: list[dict], account: str) -> list[dict]:
    return [{**item, "account": account} for item in items]


def _list(operation: str, access_token: str, args: dict) -> list[dict]:
    if operation == "gmail_list_messages":
        return google_api.gmail_list_messages(
            access_token, args.get("query"), int(args.get("max_results") or 10)
        )
    return google_api.calendar_list_events(
        access_token,
        int(args.get("days_ahead") or 14),
        int(args.get("max_results") or 50),
    )


def _merged_read(operation: str, args: dict, account: str) -> dict:
    """gmail_list_messages / calendar_list_events across the requested
    accounts. With 'all', a school account that isn't connected or is
    failing is reported in `school_account` rather than failing the call —
    the Kivaro results are still real."""
    names = ["kivaro", "school"] if account == "all" else [account]
    items: list[dict] = []
    school_note = None
    for name in names:
        try:
            token = get_google_access_token(ACCOUNTS[name])
        except Exception as exc:  # noqa: BLE001
            if account == "all" and name == "school":
                school_note = f"school account failed: {exc}"
                continue
            raise
        if not token:
            if account == "all" and name == "school":
                school_note = "school account not connected (/auth/google/connect?account=school)"
                continue
            return _err(
                operation,
                f"Google {name} account not connected — visit /auth/google/connect"
                + ("?account=school" if name == "school" else "")
                + " first",
            )
        try:
            items.extend(_tagged(_list(operation, token, args), name))
        except Exception as exc:  # noqa: BLE001
            if account == "all" and name == "school":
                school_note = f"school account failed: {exc}"
                continue
            raise

    if operation == "calendar_list_events":
        items.sort(key=lambda e: e.get("start") or "")
    data: dict | list = items
    if school_note:
        data = {"items": items, "school_account": school_note}
    return _ok(operation, data)


def google_titan(args: dict) -> dict:
    operation = args.get("operation")
    # Reads default to both accounts; gmail_get_message and every write
    # default to Kivaro.
    account = args.get("account") or ("all" if operation in MERGED_READS else "kivaro")

    try:
        if account not in ("kivaro", "school", "all"):
            return _err(str(operation), f"Unknown account: {account}")
        if account == "all" and operation not in MERGED_READS:
            return _err(str(operation), "account 'all' only works for list operations")
        if account == "school" and operation not in SCHOOL_READS:
            return _err(
                str(operation),
                "The school account is read-only — sending, creating events, Drive and Docs "
                "only work on the Kivaro account.",
            )

        if operation in MERGED_READS:
            return _merged_read(operation, args, account)

        access_token = get_google_access_token(ACCOUNTS[account])
        if not access_token:
            return _err(
                str(operation),
                "Google not connected — visit /auth/google/connect"
                + ("?account=school" if account == "school" else "")
                + " first",
            )

        if operation == "gmail_get_message":
            message_id = args.get("message_id")
            if not message_id:
                return _err(operation, "message_id is required")
            return _ok(operation, google_api.gmail_get_message(access_token, message_id))

        if operation == "gmail_send_message":
            to = args.get("to")
            subject = args.get("subject")
            body = args.get("body")
            if not to or not subject or body is None:
                return _err(operation, "to, subject, and body are required")
            data = google_api.gmail_send_message(
                access_token,
                to=to,
                subject=subject,
                body=body,
                thread_id=args.get("thread_id"),
                in_reply_to=args.get("in_reply_to"),
            )
            return _ok(operation, data)

        if operation == "calendar_create_event":
            event = args.get("event") or {}
            if not event.get("summary") or not event.get("start") or not event.get("end"):
                return _err(operation, "event.summary, event.start, and event.end are required")
            data = google_api.calendar_create_event(
                access_token,
                summary=event["summary"],
                start=event["start"],
                end=event["end"],
                description=event.get("description"),
                attendees=event.get("attendees"),
                tz=event.get("timezone"),
            )
            return _ok(operation, data)

        if operation == "drive_search_files":
            query = args.get("query")
            if not query:
                return _err(operation, "query is required")
            data = google_api.drive_search_files(access_token, query, int(args.get("max_results") or 20))
            return _ok(operation, data)

        if operation == "docs_create_document":
            title = args.get("title")
            if not title:
                return _err(operation, "title is required")
            data = google_api.docs_create_document(access_token, title, args.get("content"))
            return _ok(operation, data)

        if operation == "docs_get_document":
            document_id = args.get("document_id")
            if not document_id:
                return _err(operation, "document_id is required")
            return _ok(operation, google_api.docs_get_document(access_token, document_id))

        return _err(str(operation), f"Unknown operation: {operation}")
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return _err(str(operation), str(exc))
