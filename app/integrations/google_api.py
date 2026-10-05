import base64
import json
from email.message import EmailMessage
from typing import Any
from urllib.parse import quote

import httpx

GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
DRIVE_BASE = "https://www.googleapis.com/drive/v3"
DOCS_BASE = "https://docs.googleapis.com/v1/documents"
SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"


def _headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


def _header_value(headers: list[dict], name: str) -> str:
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


# --- Gmail --------------------------------------------------------------
# messages.list only returns {id, threadId} per item — a follow-up
# messages.get per message is required for usable subject/sender info.


def gmail_list_messages(access_token: str, query: str | None, max_results: int) -> list[dict]:
    params: dict[str, Any] = {"maxResults": max_results}
    if query:
        params["q"] = query
    else:
        params["labelIds"] = "INBOX"

    res = httpx.get(f"{GMAIL_BASE}/messages", headers=_headers(access_token), params=params)
    if not res.is_success:
        raise RuntimeError(f"Gmail list failed: {res.text}")
    ids = [m["id"] for m in res.json().get("messages", [])]

    summaries = []
    for message_id in ids:
        meta_res = httpx.get(
            f"{GMAIL_BASE}/messages/{message_id}",
            headers=_headers(access_token),
            params={"format": "metadata", "metadataHeaders": ["Subject", "From", "Date"]},
        )
        if not meta_res.is_success:
            continue
        data = meta_res.json()
        headers = data.get("payload", {}).get("headers", [])
        summaries.append(
            {
                "id": data["id"],
                "thread_id": data.get("threadId"),
                "subject": _header_value(headers, "Subject"),
                "from": _header_value(headers, "From"),
                "date": _header_value(headers, "Date"),
                "snippet": data.get("snippet", ""),
            }
        )
    return summaries


def _decode_body_data(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def _extract_plain_text(payload: dict) -> str:
    body = payload.get("body", {})
    if body.get("data"):
        return _decode_body_data(body["data"])
    for part in payload.get("parts", []):
        if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
            return _decode_body_data(part["body"]["data"])
    # Fall back to the first part with any body data (e.g. text/html only).
    for part in payload.get("parts", []):
        if part.get("body", {}).get("data"):
            return _decode_body_data(part["body"]["data"])
    return ""


def gmail_get_message(access_token: str, message_id: str) -> dict:
    res = httpx.get(
        f"{GMAIL_BASE}/messages/{message_id}",
        headers=_headers(access_token),
        params={"format": "full"},
    )
    if not res.is_success:
        raise RuntimeError(f"Gmail get message failed: {res.text}")
    data = res.json()
    payload = data.get("payload", {})
    headers = payload.get("headers", [])
    return {
        "id": data["id"],
        "thread_id": data.get("threadId"),
        "subject": _header_value(headers, "Subject"),
        "from": _header_value(headers, "From"),
        "to": _header_value(headers, "To"),
        "date": _header_value(headers, "Date"),
        "message_id_header": _header_value(headers, "Message-ID"),
        "snippet": data.get("snippet", ""),
        "body_text": _extract_plain_text(payload),
    }


def gmail_send_message(
    access_token: str,
    to: str,
    subject: str,
    body: str,
    thread_id: str | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
) -> dict:
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = references or in_reply_to
    msg.set_content(body)

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
    payload: dict[str, Any] = {"raw": raw}
    if thread_id:
        payload["threadId"] = thread_id

    res = httpx.post(f"{GMAIL_BASE}/messages/send", headers=_headers(access_token), json=payload)
    if not res.is_success:
        raise RuntimeError(f"Gmail send failed: {res.text}")
    data = res.json()
    return {"id": data.get("id"), "thread_id": data.get("threadId")}


# --- Calendar -------------------------------------------------------------


def calendar_list_events(access_token: str, days_ahead: int, max_results: int) -> list[dict]:
    from datetime import datetime, timedelta, timezone

    time_min = datetime.now(timezone.utc).isoformat()
    time_max = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).isoformat()

    res = httpx.get(
        f"{CALENDAR_BASE}/calendars/primary/events",
        headers=_headers(access_token),
        params={
            "timeMin": time_min,
            "timeMax": time_max,
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": max_results,
        },
    )
    if not res.is_success:
        raise RuntimeError(f"Calendar list failed: {res.text}")

    events = []
    for item in res.json().get("items", []):
        start = item.get("start", {})
        end = item.get("end", {})
        events.append(
            {
                "id": item["id"],
                "summary": item.get("summary", "(No title)"),
                "start": start.get("dateTime") or start.get("date"),
                "end": end.get("dateTime") or end.get("date"),
                "all_day": "dateTime" not in start,
                "html_link": item.get("htmlLink"),
            }
        )
    return events


def calendar_create_event(
    access_token: str,
    summary: str,
    start: str,
    end: str,
    description: str | None = None,
    attendees: list[str] | None = None,
    tz: str | None = None,
) -> dict:
    is_all_day = "T" not in start

    def _time_block(value: str) -> dict:
        if is_all_day:
            return {"date": value}
        block: dict[str, Any] = {"dateTime": value}
        # Only attach timeZone when the datetime doesn't already carry a
        # UTC offset — Calendar's API requires exactly one of the two.
        if tz and not (value.endswith("Z") or "+" in value[10:] or value.count("-") > 2):
            block["timeZone"] = tz
        return block

    body: dict[str, Any] = {
        "summary": summary,
        "start": _time_block(start),
        "end": _time_block(end),
    }
    if description:
        body["description"] = description
    if attendees:
        body["attendees"] = [{"email": a} for a in attendees]

    res = httpx.post(
        f"{CALENDAR_BASE}/calendars/primary/events", headers=_headers(access_token), json=body
    )
    if not res.is_success:
        raise RuntimeError(f"Calendar create event failed: {res.text}")
    data = res.json()
    return {"id": data["id"], "html_link": data.get("htmlLink")}


# --- Drive ------------------------------------------------------------


def drive_search_files(access_token: str, query_text: str, max_results: int) -> list[dict]:
    escaped = query_text.replace("'", "\\'")
    q = f"(name contains '{escaped}' or fullText contains '{escaped}') and trashed = false"
    res = httpx.get(
        f"{DRIVE_BASE}/files",
        headers=_headers(access_token),
        params={"q": q, "pageSize": max_results, "fields": "files(id,name,mimeType,webViewLink)"},
    )
    if not res.is_success:
        raise RuntimeError(f"Drive search failed: {res.text}")
    return res.json().get("files", [])


FOLDER_MIME = "application/vnd.google-apps.folder"
UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3"


def drive_find_or_create_folder(access_token: str, name: str) -> str:
    """The id of a top-level folder with this name, made if it isn't there."""
    escaped = name.replace("'", "\\'")
    q = f"name = '{escaped}' and mimeType = '{FOLDER_MIME}' and 'root' in parents and trashed = false"
    res = httpx.get(
        f"{DRIVE_BASE}/files",
        headers=_headers(access_token),
        params={"q": q, "pageSize": 1, "fields": "files(id)"},
        timeout=15.0,
    )
    if not res.is_success:
        raise RuntimeError(f"Drive folder lookup failed: {res.text}")
    found = res.json().get("files", [])
    if found:
        return found[0]["id"]
    res = httpx.post(
        f"{DRIVE_BASE}/files",
        headers=_headers(access_token),
        params={"fields": "id"},
        json={"name": name, "mimeType": FOLDER_MIME},
        timeout=15.0,
    )
    if not res.is_success:
        raise RuntimeError(f"Drive folder create failed: {res.text}")
    return res.json()["id"]


def drive_upload_text(access_token: str, folder_id: str, name: str, content: str) -> dict:
    """A plain-text file in the folder. Multipart: metadata and body in one call."""
    boundary = "jarvis-note-boundary"
    metadata = json.dumps({"name": name, "parents": [folder_id], "mimeType": "text/plain"})
    body = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode()
        + metadata.encode()
        + f"\r\n--{boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n".encode()
        + content.encode("utf-8")
        + f"\r\n--{boundary}--".encode()
    )
    res = httpx.post(
        f"{UPLOAD_BASE}/files",
        headers={**_headers(access_token), "Content-Type": f"multipart/related; boundary={boundary}"},
        params={"uploadType": "multipart", "fields": "id,name,webViewLink,modifiedTime"},
        content=body,
        timeout=20.0,
    )
    if not res.is_success:
        raise RuntimeError(f"Drive upload failed: {res.text}")
    return res.json()


def drive_list_folder(access_token: str, folder_id: str, query_text: str | None, max_results: int) -> list[dict]:
    """Files directly in a folder, newest first, optionally matching text."""
    q = f"'{folder_id}' in parents and trashed = false"
    if query_text:
        escaped = query_text.replace("'", "\\'")
        q += f" and (name contains '{escaped}' or fullText contains '{escaped}')"
    res = httpx.get(
        f"{DRIVE_BASE}/files",
        headers=_headers(access_token),
        params={
            "q": q,
            "pageSize": max_results,
            "orderBy": "modifiedTime desc",
            "fields": "files(id,name,size,modifiedTime,webViewLink)",
        },
        timeout=15.0,
    )
    if not res.is_success:
        raise RuntimeError(f"Drive list failed: {res.text}")
    return res.json().get("files", [])


def drive_get_metadata(access_token: str, file_id: str) -> dict:
    res = httpx.get(
        f"{DRIVE_BASE}/files/{quote(file_id, safe='')}",
        headers=_headers(access_token),
        params={"fields": "id,name,parents,size,modifiedTime,webViewLink"},
        timeout=15.0,
    )
    if not res.is_success:
        raise RuntimeError(f"Drive metadata failed: {res.text}")
    return res.json()


def drive_download_text(access_token: str, file_id: str) -> str:
    res = httpx.get(
        f"{DRIVE_BASE}/files/{quote(file_id, safe='')}",
        headers=_headers(access_token),
        params={"alt": "media"},
        timeout=20.0,
    )
    if not res.is_success:
        raise RuntimeError(f"Drive download failed: {res.text}")
    return res.content.decode("utf-8", errors="replace")


# --- Docs ---------------------------------------------------------------


def docs_create_document(access_token: str, title: str, content: str | None = None) -> dict:
    res = httpx.post(DOCS_BASE, headers=_headers(access_token), json={"title": title})
    if not res.is_success:
        raise RuntimeError(f"Docs create failed: {res.text}")
    document_id = res.json()["documentId"]

    if content:
        # Index 1 is correct for a brand-new blank doc — index 0 is the
        # document's initial empty paragraph.
        batch_res = httpx.post(
            f"{DOCS_BASE}/{document_id}:batchUpdate",
            headers=_headers(access_token),
            json={"requests": [{"insertText": {"location": {"index": 1}, "text": content}}]},
        )
        if not batch_res.is_success:
            raise RuntimeError(f"Docs insert text failed: {batch_res.text}")

    return {"document_id": document_id, "url": f"https://docs.google.com/document/d/{document_id}/edit"}


def docs_get_document(access_token: str, document_id: str) -> dict:
    res = httpx.get(f"{DOCS_BASE}/{document_id}", headers=_headers(access_token))
    if not res.is_success:
        raise RuntimeError(f"Docs get failed: {res.text}")
    data = res.json()

    text_parts = []
    for element in data.get("body", {}).get("content", []):
        paragraph = element.get("paragraph")
        if not paragraph:
            continue
        for el in paragraph.get("elements", []):
            text_run = el.get("textRun")
            if text_run:
                text_parts.append(text_run.get("content", ""))

    return {
        "document_id": document_id,
        "title": data.get("title", ""),
        "text": "".join(text_parts),
    }


# --- Sheets ----------------------------------------------------------------


def sheets_get_values(access_token: str, spreadsheet_id: str, range_or_tab_name: str) -> list[list[str]]:
    encoded_range = quote(range_or_tab_name, safe="")
    res = httpx.get(
        f"{SHEETS_BASE}/{spreadsheet_id}/values/{encoded_range}",
        headers=_headers(access_token),
        timeout=20.0,
    )
    if not res.is_success:
        raise RuntimeError(f"Sheets read failed: {res.text}")
    return res.json().get("values", [])


def sheets_get_tab_ids(access_token: str, spreadsheet_id: str) -> dict[str, int]:
    """Tab title -> numeric sheetId, which row deletes need."""
    res = httpx.get(
        f"{SHEETS_BASE}/{spreadsheet_id}",
        headers=_headers(access_token),
        params={"fields": "sheets.properties(sheetId,title)"},
        timeout=20.0,
    )
    if not res.is_success:
        raise RuntimeError(f"Sheets metadata failed: {res.text}")
    return {s["properties"]["title"]: s["properties"]["sheetId"] for s in res.json().get("sheets", [])}


def sheets_delete_rows(access_token: str, spreadsheet_id: str, sheet_id: int, row_numbers: list[int]) -> None:
    """Delete whole rows (1-based sheet row numbers) in one batchUpdate,
    bottom-up so earlier deletes don't shift the rows still to go."""
    requests = [
        {
            "deleteDimension": {
                "range": {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": n - 1, "endIndex": n}
            }
        }
        for n in sorted(set(row_numbers), reverse=True)
    ]
    if not requests:
        return
    res = httpx.post(
        f"{SHEETS_BASE}/{spreadsheet_id}:batchUpdate",
        headers=_headers(access_token),
        json={"requests": requests},
        timeout=20.0,
    )
    if not res.is_success:
        raise RuntimeError(f"Sheets delete rows failed: {res.text}")
