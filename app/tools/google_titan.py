from app.core.google_oauth import get_google_access_token
from app.integrations import google_api


def _ok(operation: str, data) -> dict:
    return {"ok": True, "operation": operation, "data": data}


def _err(operation: str, message: str) -> dict:
    return {"ok": False, "operation": operation, "error": message}


def google_titan(args: dict) -> dict:
    operation = args.get("operation")

    try:
        access_token = get_google_access_token()
        if not access_token:
            return _err(str(operation), "Google not connected — visit /auth/google/connect first")

        if operation == "gmail_list_messages":
            data = google_api.gmail_list_messages(
                access_token, args.get("query"), int(args.get("max_results") or 10)
            )
            return _ok(operation, data)

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

        if operation == "calendar_list_events":
            data = google_api.calendar_list_events(
                access_token,
                int(args.get("days_ahead") or 14),
                int(args.get("max_results") or 50),
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
