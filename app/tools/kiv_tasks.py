from datetime import date, timedelta

from app.core.local_time import local_today
from app.core.supabase_client import get_supabase_client

# K.I.V.'s Company Dashboard task board — kiv-console's `projects` and
# `tasks` tables in the same Supabase project. Launch phases and Founder
# Development goals both live there; this lets Jarvis read and update it.

STATUSES = ("todo", "in_progress", "blocked", "done")
OPEN_STATUSES = ("todo", "in_progress", "blocked")
LIST_LIMIT = 40


def _projects(supabase) -> dict[str, dict]:
    rows = supabase.table("projects").select("id, name, status").execute().data or []
    return {r["id"]: r for r in rows}


def _match_project(projects: dict[str, dict], name: str) -> list[dict]:
    needle = name.strip().lower()
    return [p for p in projects.values() if needle in p["name"].lower()]


def _list(args: dict) -> dict:
    supabase = get_supabase_client()
    projects = _projects(supabase)
    statuses = [s for s in (args.get("statuses") or OPEN_STATUSES) if s in STATUSES]
    query = supabase.table("tasks").select("id, title, status, due_date, project_id").in_("status", statuses)

    today = local_today()
    within = args.get("due_within_days")
    if isinstance(within, (int, float)):
        query = query.lte("due_date", (today + timedelta(days=int(within))).isoformat())
    if args.get("project"):
        matches = _match_project(projects, args["project"])
        if not matches:
            return {"ok": False, "error": f"No project matching '{args['project']}'"}
        query = query.in_("project_id", [p["id"] for p in matches])

    rows = query.execute().data or []
    # Dated tasks first, soonest first; undated (daily habits) last.
    rows.sort(key=lambda r: (r["due_date"] is None, r["due_date"] or ""))
    tasks = [
        {
            "id": r["id"],
            "title": r["title"],
            "status": r["status"],
            "due_date": r["due_date"],
            "overdue": bool(r["due_date"]) and date.fromisoformat(r["due_date"]) < today and r["status"] != "done",
            "project": projects.get(r["project_id"], {}).get("name"),
        }
        for r in rows[:LIST_LIMIT]
    ]
    return {
        "ok": True,
        "today": today.isoformat(),
        "count": len(rows),
        "overdue": sum(1 for t in tasks if t["overdue"]),
        "tasks": tasks,
    }


def _find_task(supabase, args: dict) -> tuple[dict | None, list[dict]]:
    if args.get("task_id"):
        rows = supabase.table("tasks").select("id, title, status, due_date").eq("id", args["task_id"]).execute().data
        return (rows[0] if rows else None), []
    title = (args.get("title") or "").strip()
    if not title:
        return None, []
    rows = supabase.table("tasks").select("id, title, status, due_date").ilike("title", f"%{title}%").execute().data or []
    exact = [r for r in rows if r["title"].lower() == title.lower()]
    if len(exact) == 1:
        return exact[0], []
    if len(rows) == 1:
        return rows[0], []
    return None, rows


def _update(args: dict) -> dict:
    supabase = get_supabase_client()
    task, candidates = _find_task(supabase, args)
    if task is None:
        if candidates:
            return {
                "ok": False,
                "error": "More than one task matches; ask which one.",
                "candidates": [{"id": c["id"], "title": c["title"]} for c in candidates[:8]],
            }
        return {"ok": False, "error": "No matching task. Give the task_id or a closer title."}

    changes = {}
    if args.get("status"):
        if args["status"] not in STATUSES:
            return {"ok": False, "error": f"status must be one of: {', '.join(STATUSES)}"}
        changes["status"] = args["status"]
    if args.get("due_date"):
        try:
            date.fromisoformat(args["due_date"])
        except ValueError:
            return {"ok": False, "error": "due_date must be YYYY-MM-DD"}
        changes["due_date"] = args["due_date"]
    if not changes:
        return {"ok": False, "error": "Nothing to change: pass status and/or due_date."}

    supabase.table("tasks").update(changes).eq("id", task["id"]).execute()
    return {"ok": True, "task": task["title"], "changed": changes}


def _create(args: dict) -> dict:
    title = (args.get("title") or "").strip()
    if not title or not args.get("project"):
        return {"ok": False, "error": "title and project are required"}
    supabase = get_supabase_client()
    matches = _match_project(_projects(supabase), args["project"])
    if len(matches) != 1:
        return {
            "ok": False,
            "error": "Project must match exactly one project.",
            "candidates": [p["name"] for p in (matches or _projects(supabase).values())][:12],
        }
    owner = supabase.table("profiles").select("id").eq("role", "owner").limit(1).execute().data
    row = {
        "project_id": matches[0]["id"],
        "assignee_id": owner[0]["id"] if owner else None,
        "title": title,
        "description": args.get("description") or None,
        "status": args.get("status") if args.get("status") in STATUSES else "todo",
        "due_date": args.get("due_date") or None,
    }
    supabase.table("tasks").insert(row).execute()
    return {"ok": True, "created": title, "project": matches[0]["name"], "due_date": row["due_date"]}


def kiv_tasks(args: dict) -> dict:
    operation = args.get("operation", "list")
    try:
        if operation == "list":
            return _list(args)
        if operation == "update":
            return _update(args)
        if operation == "create":
            return _create(args)
        return {"ok": False, "error": f"Unknown operation: {operation}"}
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "error": f"task board unavailable: {exc}"}
