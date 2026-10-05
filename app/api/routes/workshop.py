from fastapi import APIRouter, Body, Depends

from app.core.auth import require_access_token
from app.tools.workshop_project import delete_project, get_project, list_projects, save_project

# The workshop's project panel (web/src/components/workshop/project-panel.tsx):
# saving Andrew's own edits (the sketch, a part, a wire) without a model
# turn. The same save Jarvis's project tool runs: checks, compile, BOM.
router = APIRouter(prefix="/workshop", dependencies=[Depends(require_access_token)])


@router.get("/projects")
def projects_list() -> dict:
    try:
        return {"ok": True, "projects": list_projects()}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@router.get("/projects/{project_id}")
def projects_get(project_id: str) -> dict:
    try:
        project = get_project(project_id)
        if not project:
            return {"ok": False, "error": "No such project."}
        return save_project(project)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@router.post("/projects")
def projects_save(project: dict = Body(..., embed=True)) -> dict:
    try:
        return save_project(project)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@router.delete("/projects/{project_id}")
def projects_delete(project_id: str) -> dict:
    try:
        delete_project(project_id)
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
