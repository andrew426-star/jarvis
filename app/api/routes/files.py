from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.core.auth import require_access_token
from app.tools.files import manifest, sync, unlink

router = APIRouter()

# The console keeping Jarvis's copy of a linked folder in step
# (web/src/lib/linked-folders.ts). It asks for the manifest, then sends only
# what changed, in batches; the last batch carries every path still on disk
# so deleted files are dropped too.

MAX_FILE_CHARS = 400_000


class SyncedFile(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    content: str = Field(max_length=MAX_FILE_CHARS)
    size: int = Field(ge=0)
    modified_at: str = Field(min_length=1, max_length=40)


class SyncRequest(BaseModel):
    folder: str = Field(min_length=1, max_length=120)
    files: list[SyncedFile] = Field(default_factory=list, max_length=400)
    keep: list[str] | None = Field(default=None, max_length=5000)


@router.get("/files/manifest", dependencies=[Depends(require_access_token)])
def files_manifest(folder: str = Query(min_length=1, max_length=120)) -> dict:
    return {"files": manifest(folder)}


@router.post("/files/sync", dependencies=[Depends(require_access_token)])
def files_sync(request: SyncRequest) -> dict:
    return sync(request.folder, [f.model_dump() for f in request.files], request.keep)


@router.post("/files/unlink", dependencies=[Depends(require_access_token)])
def files_unlink(folder: str = Query(min_length=1, max_length=120)) -> dict:
    unlink(folder)
    return {"ok": True}
