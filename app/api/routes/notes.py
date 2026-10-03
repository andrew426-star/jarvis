from fastapi import APIRouter, Depends, Query

from app.core.auth import require_access_token
from app.tools.notes import list_notes, read_note

# The console's NOTES panel (web/src/components/panels/notes-panel.tsx):
# the .txt notes Jarvis saved to Drive, listed and opened without a model
# turn. Errors come back as {"ok": False, ...} like the other panels.
router = APIRouter(prefix="/notes", dependencies=[Depends(require_access_token)])


@router.get("")
def notes_list(query: str | None = Query(default=None, max_length=120)) -> dict:
    try:
        return list_notes(query)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@router.get("/{note_id}")
def notes_read(note_id: str) -> dict:
    try:
        return read_note(note_id)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
