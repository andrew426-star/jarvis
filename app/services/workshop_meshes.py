import json
import re
import struct
from datetime import datetime, timezone

from app.core.supabase_client import get_supabase_client

# Meshes for the workshop's printed parts: STLs Andrew has (a downloaded
# helmet, Dum-E's parts) that a printed part brings in with OpenSCAD's
# import("mesh/<name>.stl"), so the part is still OpenSCAD - the real shell,
# plus the cut-outs and mounts for the electronics. The console simplifies
# a file before it uploads it (lib/workshop/meshes.ts); this keeps it in a
# private bucket in Andrew's own Supabase project, behind the access token,
# with a small JSON beside each (its triangles and size in mm) so Jarvis can
# place parts against it without reading the mesh.

BUCKET = "workshop-meshes"
MAX_BYTES = 45 * 1024 * 1024
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")

_bucket_ready = False


def _bucket():
    global _bucket_ready
    storage = get_supabase_client().storage
    if not _bucket_ready:
        try:
            storage.get_bucket(BUCKET)
        except Exception:  # noqa: BLE001 — missing: make it, private
            storage.create_bucket(BUCKET, options={"public": False})
        _bucket_ready = True
    return storage.from_(BUCKET)


def _check_name(name: str) -> str:
    if not NAME_RE.match(name or ""):
        raise ValueError("A mesh name is lowercase letters, digits and dashes, up to 48.")
    return name


def stl_triangles(data: bytes) -> int:
    """Triangles in a binary STL, or ValueError if it is not one."""
    if len(data) < 84:
        raise ValueError("That is not a binary STL.")
    count = struct.unpack_from("<I", data, 80)[0]
    if 84 + count * 50 != len(data) or not count:
        raise ValueError("That is not a binary STL (the console sends one after simplifying).")
    return count


def save_mesh(name: str, data: bytes, size_mm: list[float] | None, source: str = "") -> dict:
    _check_name(name)
    if len(data) > MAX_BYTES:
        raise ValueError(f"Too large: {len(data) // 1_000_000} MB (45 MB at most). Simplify it further.")
    triangles = stl_triangles(data)
    meta = {
        "name": name,
        "triangles": triangles,
        "bytes": len(data),
        "size_mm": [round(float(v), 1) for v in (size_mm or [])][:3],
        "source": str(source)[:120],
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    bucket = _bucket()
    bucket.upload(f"{name}.stl", data, {"content-type": "model/stl", "upsert": "true"})
    bucket.upload(f"{name}.json", json.dumps(meta).encode(), {"content-type": "application/json", "upsert": "true"})
    return meta


def list_meshes() -> list[dict]:
    bucket = _bucket()
    out = []
    for item in bucket.list() or []:
        file = str(item.get("name") or "")
        if not file.endswith(".json"):
            continue
        try:
            out.append(json.loads(bucket.download(file)))
        except Exception:  # noqa: BLE001 — a broken sidecar just drops from the list
            continue
    return sorted(out, key=lambda m: m.get("name", ""))


def get_mesh(name: str) -> bytes:
    return _bucket().download(f"{_check_name(name)}.stl")


def delete_mesh(name: str) -> None:
    _check_name(name)
    _bucket().remove([f"{name}.stl", f"{name}.json"])


def meshes_line() -> str | None:
    """The meshes there are, for Jarvis's project tool: what a printed part can import."""
    try:
        meshes = list_meshes()
    except Exception:  # noqa: BLE001 — no storage, no line
        return None
    if not meshes:
        return None
    parts = [f"{m['name']} ({'x'.join(str(v) for v in m.get('size_mm') or [])} mm, {m.get('triangles', 0):,} triangles)" for m in meshes]
    return "MESHES a printed part can import with import(\"mesh/<name>.stl\"): " + "; ".join(parts) + "."
