from app.core.google_oauth import get_google_access_token
from app.core.supabase_client import get_supabase_client
from app.integrations import google_api

# Real, pre-existing K.I.V. spreadsheets — same IDs kiv-console's own ALE
# pipeline reads/writes (src/lib/ale/spreadsheets.ts).
GLE_SPREADSHEET_ID = "1GBg4tiEVJqwQdW9zxIlnVNhln7qkcuwz8z3oSoGxKo0"
MAPS_DATA_TAB = "Maps Data"
ALE_SPREADSHEET_ID = "1iiBVFIV3qvSyqlHxGBdCRx3DlEgFKmi9P20INXmmYKs"
COMPANIES_TAB = "Companies"
SALES_PITCH_LOG_SPREADSHEET_ID = "1YEAJ0AQpaYgK7FTGXj-qRpQWNjjgVRZkUVxsqrrQCZg"
SALES_PITCH_LOG_TAB = "ALE Sales Pitch Log"

MAX_COMPANIES_LISTED = 50


def _get_prospects() -> dict:
    access_token = get_google_access_token()
    if not access_token:
        return {"connected": False}

    try:
        maps_rows = google_api.sheets_get_values(access_token, GLE_SPREADSHEET_ID, f"{MAPS_DATA_TAB}!A2:H")
        researched_names = {
            row[0]
            for row in google_api.sheets_get_values(access_token, ALE_SPREADSHEET_ID, f"{COMPANIES_TAB}!A2:A")
            if row
        }
        try:
            pitch_rows = google_api.sheets_get_values(
                access_token, SALES_PITCH_LOG_SPREADSHEET_ID, f"{SALES_PITCH_LOG_TAB}!A2:A"
            )
        except Exception:
            # Tab doesn't exist yet until the first sales pitch is ever
            # generated — same "nothing pitched yet" fallback as
            # kiv-console's own ale/queries.ts.
            pitch_rows = []
        pitched_names = {row[0] for row in pitch_rows if row}

        companies = []
        for row in maps_rows:
            name = row[0] if row else ""
            if not name:
                continue
            pitched = name in pitched_names
            researched = name in researched_names
            stage = "pitched" if pitched else "researched" if researched else "discovered"
            companies.append({"name": name, "stage": stage})

        return {
            "connected": True,
            "total": len(companies),
            "researched": sum(1 for c in companies if c["stage"] in ("researched", "pitched")),
            "pitched": sum(1 for c in companies if c["stage"] == "pitched"),
            "companies": companies[:MAX_COMPANIES_LISTED],
        }
    except Exception as exc:
        return {"connected": True, "fetch_error": str(exc)}


def _get_clients() -> dict:
    supabase = get_supabase_client()
    res = (
        supabase.table("clients")
        .select("id, name, status, source, ale_doc_url, created_at")
        .neq("status", "lead")
        .order("created_at", desc=True)
        .execute()
    )
    rows = res.data or []
    by_status = {"active": 0, "paused": 0, "completed": 0}
    for row in rows:
        if row["status"] in by_status:
            by_status[row["status"]] += 1
    return {
        "total": len(rows),
        "by_status": by_status,
        "companies": [{"name": r["name"], "status": r["status"]} for r in rows[:MAX_COMPANIES_LISTED]],
    }


def kivaro_pipeline(args: dict) -> dict:
    try:
        prospects = _get_prospects()
    except Exception as exc:  # noqa: BLE001
        prospects = {"connected": True, "fetch_error": str(exc)}

    try:
        clients = _get_clients()
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "error": f"clients lookup failed: {exc}", "prospects": prospects}

    return {"ok": True, "prospects": prospects, "clients": clients}
