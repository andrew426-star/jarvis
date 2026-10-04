from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.auth import require_access_token
from app.tools.checklist import list_open, set_item

# Ticking a checklist item from its card in the chat, desktop or phone
# (web/src/components/checklist-card.tsx), without a model turn. Errors
# come back as {"ok": False, ...} like the panels.
router = APIRouter(prefix="/checklists", dependencies=[Depends(require_access_token)])


class ItemState(BaseModel):
    done: bool


@router.get("")
def checklists_open() -> dict:
    try:
        return list_open()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@router.post("/{list_id}/items/{item_id}")
def checklist_item(list_id: str, item_id: str, state: ItemState) -> dict:
    try:
        return set_item(list_id, item_id, state.done)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
