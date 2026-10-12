from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response

from app.core.auth import require_access_token
from app.services.workshop_meshes import delete_mesh, get_mesh, list_meshes, save_mesh
from app.tools.workshop_project import delete_project, gallery, get_project, list_projects, save_project

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


@router.get("/gallery")
def projects_gallery() -> dict:
    """The project gallery: every project with its parts and printed parts
    for its hologram, and a summary for its card."""
    try:
        return {"ok": True, "projects": gallery()}
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


# Meshes for printed parts (app/services/workshop_meshes.py): the console
# uploads a simplified binary STL as the request body; printed parts import
# it by name.
@router.get("/meshes")
def meshes_list() -> dict:
    try:
        return {"ok": True, "meshes": list_meshes()}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@router.get("/meshes/{name}.stl")
def meshes_get(name: str) -> Response:
    try:
        data = get_mesh(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=404, detail="No such mesh.") from exc
    # A mesh never changes under its name without a new upload; the console
    # keeps its own copy, so a day's browser cache is plenty.
    return Response(content=data, media_type="model/stl", headers={"Cache-Control": "private, max-age=86400"})


@router.post("/meshes/{name}")
async def meshes_save(name: str, request: Request) -> dict:
    data = await request.body()
    size = [float(v) for v in (request.headers.get("x-mesh-size") or "").split(",") if v.strip()][:3]
    try:
        return {"ok": True, "mesh": save_mesh(name, data, size, request.headers.get("x-mesh-source") or "")}
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Could not store it: {exc}"}


@router.delete("/meshes/{name}")
def meshes_delete(name: str) -> dict:
    try:
        delete_mesh(name)
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
