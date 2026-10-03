import re
import threading
from datetime import datetime

from app.core.config import get_settings
from app.core.google_oauth import ROW_ID, get_google_access_token
from app.core.local_time import LOCAL_TZ
from app.integrations import google_api

# Notes Jarvis puts on screen (showcase kind "text") are also kept as .txt
# files in one Drive folder on the Kivaro account, so they outlive the
# session: the console lists them under NOTES (web/src/components/panels/
# notes-panel.tsx, GET /notes) and Jarvis reads them back with this tool.
# Reads are held to that folder; the rest of Drive goes through google_titan.

FOLDER_NAME = "Jarvis Notes"
MAX_LIST = 50
MAX_READ_CHARS = 20_000

_folder_lock = threading.Lock()
_folder_id: str | None = None

NOTES_SCHEMA = {
    "type": "function",
    "function": {
        "name": "notes",
        "description": (
            "The notes you have put on Andrew's screen before, saved as .txt files in his Drive "
            "folder 'Jarvis Notes'. list: the newest notes, or those matching `query` (name or "
            "text). read: one note's text, by `note_id` from list. Use when he asks for notes "
            "from an earlier session (\"pull up my notes on X\"); to show one again, read it and "
            "put it up with showcase."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["list", "read"]},
                "query": {"type": "string", "description": "list: text to match in the name or contents."},
                "note_id": {"type": "string", "description": "read: the note's id, from list."},
            },
            "required": ["operation"],
        },
    },
}


class NotesUnavailable(RuntimeError):
    pass


def _token() -> str:
    token = get_google_access_token(ROW_ID)
    if not token:
        raise NotesUnavailable("Google not connected - visit /auth/google/connect first")
    return token


def _folder(token: str) -> str:
    """The notes folder's id: the configured one, or 'Jarvis Notes', found
    or made once per process."""
    global _folder_id
    configured = get_settings().notes_drive_folder_id
    if configured:
        return configured
    with _folder_lock:
        if not _folder_id:
            _folder_id = google_api.drive_find_or_create_folder(token, FOLDER_NAME)
        return _folder_id


def _folder_link(folder_id: str) -> str:
    return f"https://drive.google.com/drive/folders/{folder_id}"


def note_filename(title: str) -> str:
    stamp = datetime.now(LOCAL_TZ).strftime("%Y-%m-%d %H%M")
    clean = re.sub(r"[^\w\-' ]+", " ", title).strip()
    clean = re.sub(r"\s+", " ", clean)[:70] or "Note"
    return f"{stamp} {clean}.txt"


def save_note(title: str, content: str) -> dict:
    """Uploads a note; returns the Drive file's id, name and link."""
    token = _token()
    body = f"{title}\n\n{content.rstrip()}\n"
    saved = google_api.drive_upload_text(token, _folder(token), note_filename(title), body)
    return {"id": saved["id"], "name": saved["name"], "link": saved.get("webViewLink")}


def _shape(file: dict) -> dict:
    return {
        "id": file["id"],
        "name": file["name"],
        "title": re.sub(r"^\d{4}-\d{2}-\d{2} \d{4} |\.txt$", "", file["name"]),
        "size": int(file.get("size") or 0),
        "modified_at": file.get("modifiedTime"),
        "link": file.get("webViewLink"),
    }


def list_notes(query: str | None = None, limit: int = MAX_LIST) -> dict:
    token = _token()
    folder_id = _folder(token)
    files = google_api.drive_list_folder(token, folder_id, (query or "").strip() or None, min(limit, MAX_LIST))
    return {"ok": True, "notes": [_shape(f) for f in files], "folder_link": _folder_link(folder_id)}


def read_note(note_id: str) -> dict:
    token = _token()
    meta = google_api.drive_get_metadata(token, note_id)
    if _folder(token) not in (meta.get("parents") or []):
        return {"ok": False, "error": "That file is not in the Jarvis Notes folder."}
    text = google_api.drive_download_text(token, note_id)
    return {"ok": True, **_shape(meta), "content": text[:MAX_READ_CHARS], "truncated": len(text) > MAX_READ_CHARS}


def notes(args: dict) -> dict:
    operation = args.get("operation")
    try:
        if operation == "list":
            return list_notes(args.get("query"))
        if operation == "read":
            note_id = str(args.get("note_id") or "").strip()
            if not note_id:
                return {"ok": False, "error": "note_id is required (from list)"}
            return read_note(note_id)
        return {"ok": False, "error": "operation must be list or read"}
    except Exception as exc:  # noqa: BLE001 — say why, rather than failing the turn
        return {"ok": False, "error": str(exc)}
