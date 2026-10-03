import re
from datetime import datetime, timezone

from app.core.supabase_client import get_supabase_client

# Andrew's linked local folders, read-only. Jarvis's backend runs in the
# cloud and cannot see his PC, so the console copies the folders' code and
# text files into jarvis_files while it is open (web/src/lib/
# linked-folders.ts, POST /files/sync) and this reads that copy. It is as
# fresh as the console's last sync; `synced_at` says when that was.

TABLE = "jarvis_files"
MAX_READ_CHARS = 20_000
MAX_MATCHES = 40
MAX_LIST = 300

FILES_SCHEMA = {
    "type": "function",
    "function": {
        "name": "files",
        "description": (
            "Read Andrew's linked folders from his PC - his CSC 1013 Python projects and anything "
            "else he has linked in the console. Read-only: you cannot change his files. "
            "list: the folders, or the files in one (folder). read: one file's contents (path; "
            "a file name alone is enough when it is unique). search: find text across the files "
            "(query; optionally folder) - use it to find where something is defined or used. "
            "When he refers to 'my project', 'lab 3', 'my code' or an assignment, look here first "
            "rather than asking him to paste it. Results are a copy synced while his console is "
            "open; synced_at says how fresh."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["list", "read", "search"]},
                "folder": {"type": "string", "description": "A linked folder's name, e.g. 'CSC 1013'."},
                "path": {"type": "string", "description": "read: the file's path within its folder, or its name."},
                "query": {"type": "string", "description": "search: the text to find (case-insensitive)."},
            },
            "required": ["operation"],
        },
    },
}


def _folder_match(rows: list[dict], folder: str | None) -> list[dict]:
    if not folder:
        return rows
    wanted = folder.strip().lower()
    exact = [r for r in rows if r["folder"].lower() == wanted]
    return exact or [r for r in rows if wanted in r["folder"].lower()]


def _list(folder: str | None) -> dict:
    rows = (
        get_supabase_client().table(TABLE).select("folder,path,size,modified_at,synced_at").execute().data or []
    )
    if not rows:
        return {"ok": True, "folders": [], "note": "No folders are linked yet. He links one in the console: Settings > Files."}
    if not folder:
        folders: dict[str, dict] = {}
        for row in rows:
            entry = folders.setdefault(row["folder"], {"folder": row["folder"], "files": 0, "synced_at": row["synced_at"]})
            entry["files"] += 1
            entry["synced_at"] = max(entry["synced_at"], row["synced_at"])
        return {"ok": True, "folders": list(folders.values())}
    rows = _folder_match(rows, folder)
    if not rows:
        return {"ok": False, "error": f"No linked folder called {folder!r}."}
    rows.sort(key=lambda r: r["path"])
    return {
        "ok": True,
        "folder": rows[0]["folder"],
        "files": [{"path": r["path"], "size": r["size"], "modified_at": r["modified_at"]} for r in rows[:MAX_LIST]],
        "total": len(rows),
        "synced_at": max(r["synced_at"] for r in rows),
    }


def _read(folder: str | None, path: str) -> dict:
    if not path.strip():
        return {"ok": False, "error": "read needs a path."}
    rows = get_supabase_client().table(TABLE).select("folder,path").execute().data or []
    rows = _folder_match(rows, folder)
    wanted = path.strip().replace("\\", "/").lstrip("./").lower()
    # Exact path, then a path ending in what he said, then the bare name.
    for test in (
        lambda p: p.lower() == wanted,
        lambda p: p.lower().endswith("/" + wanted),
        lambda p: p.rsplit("/", 1)[-1].lower() == wanted.rsplit("/", 1)[-1],
    ):
        hits = [r for r in rows if test(r["path"])]
        if hits:
            break
    else:
        return {"ok": False, "error": f"No file matching {path!r}. Use list to see what is there."}
    if len(hits) > 1:
        return {"ok": False, "error": "More than one file matches.", "candidates": [f"{h['folder']}/{h['path']}" for h in hits[:20]]}
    hit = hits[0]
    row = (
        get_supabase_client()
        .table(TABLE)
        .select("*")
        .eq("folder", hit["folder"])
        .eq("path", hit["path"])
        .single()
        .execute()
        .data
    )
    content = row["content"]
    return {
        "ok": True,
        "folder": row["folder"],
        "path": row["path"],
        "modified_at": row["modified_at"],
        "synced_at": row["synced_at"],
        "content": content[:MAX_READ_CHARS],
        "truncated": len(content) > MAX_READ_CHARS,
    }


def _search(folder: str | None, query: str) -> dict:
    query = query.strip()
    if not query:
        return {"ok": False, "error": "search needs a query."}
    # Postgres narrows to the files containing it; the lines are found here.
    pattern = "%" + query.replace("%", r"\%").replace("_", r"\_") + "%"
    rows = get_supabase_client().table(TABLE).select("folder,path,content").ilike("content", pattern).execute().data or []
    rows = _folder_match(rows, folder)
    needle = re.compile(re.escape(query), re.IGNORECASE)
    matches = []
    for row in sorted(rows, key=lambda r: (r["folder"], r["path"])):
        for number, line in enumerate(row["content"].splitlines(), 1):
            if needle.search(line):
                matches.append({"file": f"{row['folder']}/{row['path']}", "line": number, "text": line.strip()[:200]})
                if len(matches) >= MAX_MATCHES:
                    return {"ok": True, "matches": matches, "more": True}
    return {"ok": True, "matches": matches, "more": False}


def files(args: dict) -> dict:
    operation = args.get("operation")
    folder = args.get("folder") or None
    try:
        if operation == "list":
            return _list(folder)
        if operation == "read":
            return _read(folder, str(args.get("path") or ""))
        if operation == "search":
            return _search(folder, str(args.get("query") or ""))
    except Exception as exc:  # noqa: BLE001 — never raise into the agent loop
        return {"ok": False, "error": f"Could not read the linked files: {exc}"}
    return {"ok": False, "error": "operation must be list, read or search."}


# --- Sync, from the console (app/api/routes/files.py) ---------------------


def manifest(folder: str) -> dict[str, str]:
    """path -> modified_at, so the console uploads only what changed."""
    rows = get_supabase_client().table(TABLE).select("path,modified_at").eq("folder", folder).execute().data or []
    return {r["path"]: r["modified_at"] for r in rows}


def sync(folder: str, upserts: list[dict], keep: list[str] | None) -> dict:
    client = get_supabase_client()
    now = datetime.now(timezone.utc).isoformat()
    if upserts:
        client.table(TABLE).upsert(
            [{**f, "folder": folder, "synced_at": now} for f in upserts], on_conflict="folder,path"
        ).execute()
    removed = 0
    if keep is not None:
        present = set(keep)
        gone = [path for path in manifest(folder) if path not in present]
        for start in range(0, len(gone), 100):
            client.table(TABLE).delete().eq("folder", folder).in_("path", gone[start : start + 100]).execute()
        removed = len(gone)
    return {"ok": True, "upserted": len(upserts), "removed": removed}


def unlink(folder: str) -> None:
    get_supabase_client().table(TABLE).delete().eq("folder", folder).execute()
