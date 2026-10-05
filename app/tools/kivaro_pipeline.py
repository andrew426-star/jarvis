import re

from app.core.google_oauth import get_google_access_token
from app.core.supabase_client import get_supabase_client
from app.integrations import google_api

# Real, pre-existing K.I.V. spreadsheets — same IDs kiv-console's own ALE
# pipeline reads/writes (src/lib/ale/spreadsheets.ts).
GLE_SPREADSHEET_ID = "1GBg4tiEVJqwQdW9zxIlnVNhln7qkcuwz8z3oSoGxKo0"
MAPS_DATA_TAB = "Maps Data"
WEBSITES_TAB = "Websites"
HUNTER_TAB = "Hunter"
ALE_SPREADSHEET_ID = "1iiBVFIV3qvSyqlHxGBdCRx3DlEgFKmi9P20INXmmYKs"
COMPANIES_TAB = "Companies"
CONTACTS_TAB = "Contacts"
SALES_PITCH_LOG_SPREADSHEET_ID = "1YEAJ0AQpaYgK7FTGXj-qRpQWNjjgVRZkUVxsqrrQCZg"
SALES_PITCH_LOG_TAB = "ALE Sales Pitch Log"
EMAIL_SENT_AT_COL = 11

MAX_COMPANIES_LISTED = 100


def _url(spreadsheet_id: str) -> str:
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"


# Every tab that holds a row per company, so remove clears a lead from all
# of them. name_col is where the company name sits; place_id_col is set on
# the GLE tabs, which key on Google's place_id (the Sales Pitch Log and ALE
# spreadsheets have no place_id column and key on the name).
SPREADSHEETS = [
    {
        "name": "Geolocation Lead Engine Log",
        "id": GLE_SPREADSHEET_ID,
        "stage": "1. Discovery and contact enrichment",
        "tabs": [
            {"tab": MAPS_DATA_TAB, "name_col": 0, "place_id_col": 1,
             "holds": "every discovered company (Google Maps): name, place_id, types, rating, address, lat/long, state. This is the master lead list; the Leads count comes from here."},
            {"tab": WEBSITES_TAB, "name_col": 0, "place_id_col": 2,
             "holds": "each company's website. A company with no row here has no website and cannot be enriched."},
            {"tab": HUNTER_TAB, "name_col": 2, "place_id_col": 0,
             "holds": "contacts Hunter found (email, name, position, LinkedIn, phone), one row per person; a row with no email means Hunter searched and found nobody."},
        ],
    },
    {
        "name": "Autonomous Lead Engine Log",
        "id": ALE_SPREADSHEET_ID,
        "stage": "2. Research",
        "tabs": [
            {"tab": COMPANIES_TAB, "name_col": 0,
             "holds": "researched companies: website, location, phone, business overview, AUM."},
            {"tab": CONTACTS_TAB, "name_col": 0,
             "holds": "researched people at each company: name, title, email, LinkedIn and socials."},
        ],
    },
    {
        "name": "Sales Pitch Log",
        "id": SALES_PITCH_LOG_SPREADSHEET_ID,
        "stage": "3. Sales pitch drafting and sending",
        "tabs": [
            {"tab": "History of Company", "name_col": 0, "holds": "company history, achievements, hook."},
            {"tab": "Problems", "name_col": 0, "holds": "operational pain points and proposed AI solutions."},
            {"tab": "\"New Era\" Proposition/No Problems", "name_col": 0, "holds": "strategic opportunity and demo plan."},
            {"tab": SALES_PITCH_LOG_TAB, "name_col": 0,
             "holds": "the drafted pitch per company (doc, email, call script, video); 'Email Sent At' (column L) is filled once it is actually sent."},
        ],
    },
]


def _directory() -> list[dict]:
    return [
        {
            "spreadsheet": s["name"],
            "stage": s["stage"],
            "url": _url(s["id"]),
            "tabs": {t["tab"]: t["holds"] for t in s["tabs"]},
        }
        for s in SPREADSHEETS
    ]


def _norm(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).casefold()


def _read_tab(access_token: str, spreadsheet_id: str, tab: str) -> list[list[str]] | None:
    """Every row of a tab, header included (index i is sheet row i + 1), or
    None if the tab doesn't exist yet."""
    try:
        return google_api.sheets_get_values(access_token, spreadsheet_id, "'" + tab.replace("'", "''") + "'")
    except RuntimeError as exc:
        if "Unable to parse range" in str(exc):
            return None
        raise


def _cell(row: list[str], col: int) -> str:
    return row[col] if len(row) > col else ""


def _get_prospects() -> dict:
    access_token = get_google_access_token()
    if not access_token:
        return {"connected": False}

    try:
        maps_rows = (_read_tab(access_token, GLE_SPREADSHEET_ID, MAPS_DATA_TAB) or [])[1:]
        website_rows = (_read_tab(access_token, GLE_SPREADSHEET_ID, WEBSITES_TAB) or [])[1:]
        hunter_rows = (_read_tab(access_token, GLE_SPREADSHEET_ID, HUNTER_TAB) or [])[1:]
        researched_names = {
            _norm(_cell(r, 0)) for r in (_read_tab(access_token, ALE_SPREADSHEET_ID, COMPANIES_TAB) or [])[1:]
        }
        # The tab doesn't exist until the first sales pitch is ever generated
        # — same "nothing pitched yet" fallback as kiv-console's ale/queries.ts.
        pitch_rows = (_read_tab(access_token, SALES_PITCH_LOG_SPREADSHEET_ID, SALES_PITCH_LOG_TAB) or [])[1:]

        website_by_place = {_cell(r, 2): _cell(r, 1) for r in website_rows if _cell(r, 1)}
        contacts_by_place: dict[str, int] = {}
        for r in hunter_rows:
            if _cell(r, 6):
                contacts_by_place[_cell(r, 0)] = contacts_by_place.get(_cell(r, 0), 0) + 1
        # Last write wins per company, in case of a re-pitch.
        pitch_by_name = {_norm(_cell(r, 0)): r for r in pitch_rows if _cell(r, 0)}

        companies = []
        for r in maps_rows:
            name = _cell(r, 0)
            if not name:
                continue
            place_id = _cell(r, 1)
            pitch = pitch_by_name.get(_norm(name))
            sent = bool(pitch and _cell(pitch, EMAIL_SENT_AT_COL))
            stage = (
                "sent" if sent
                else "drafted" if pitch
                else "researched" if _norm(name) in researched_names
                else "discovered"
            )
            companies.append({
                "name": name,
                "state": _cell(r, 7),
                "stage": stage,
                "website": website_by_place.get(place_id),
                "contacts_with_email": contacts_by_place.get(place_id, 0),
            })

        return {
            "connected": True,
            "total": len(companies),
            "researched": sum(1 for c in companies if c["stage"] != "discovered"),
            "drafted": sum(1 for c in companies if c["stage"] in ("drafted", "sent")),
            "sent": sum(1 for c in companies if c["stage"] == "sent"),
            "no_website": [c["name"] for c in companies if not c["website"]],
            # Newest first, like K.I.V.'s Leads list.
            "companies": companies[::-1][:MAX_COMPANIES_LISTED],
            "truncated": len(companies) > MAX_COMPANIES_LISTED,
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


def _locate(access_token: str, company: str) -> tuple[list[dict], list[str]]:
    """Every row across the ALE spreadsheets that belongs to `company`
    (exact name, ignoring case and spacing, or a GLE row sharing its
    place_id), and the names that only partly match, for when there is no
    exact one."""
    target = _norm(company)
    found: list[dict] = []
    near: set[str] = set()
    place_ids: set[str] = set()

    for sheet in SPREADSHEETS:
        for t in sheet["tabs"]:
            rows = _read_tab(access_token, sheet["id"], t["tab"])
            if rows is None:
                continue
            hits = []
            for i, row in enumerate(rows[1:], start=2):
                name = _cell(row, t["name_col"])
                pid = _cell(row, t["place_id_col"]) if "place_id_col" in t else ""
                if _norm(name) == target or (pid and pid in place_ids):
                    hits.append(i)
                    if t["tab"] == MAPS_DATA_TAB and pid:
                        place_ids.add(pid)
                    if t["tab"] == SALES_PITCH_LOG_TAB and _cell(row, EMAIL_SENT_AT_COL):
                        found.append({"note": f"an outreach email to {name} was already sent at {_cell(row, EMAIL_SENT_AT_COL)}"})
                elif target and name and (target in _norm(name) or _norm(name) in target):
                    near.add(name)
            if hits:
                found.append({
                    "spreadsheet": sheet["name"],
                    "spreadsheet_id": sheet["id"],
                    "tab": t["tab"],
                    "rows": hits,
                })
    return found, sorted(near)


def _find(args: dict) -> dict:
    company = (args.get("company") or "").strip()
    if not company:
        return {"ok": False, "error": "company is required"}
    access_token = get_google_access_token()
    if not access_token:
        return {"ok": False, "error": "Google is not connected; visit /auth/google/connect"}
    found, near = _locate(access_token, company)
    locations = [f for f in found if "tab" in f]
    return {
        "ok": True,
        "company": company,
        "found": bool(locations),
        "locations": locations,
        "notes": [f["note"] for f in found if "note" in f],
        "similar_names": near if not locations else [],
    }


def _remove(args: dict) -> dict:
    company = (args.get("company") or "").strip()
    if not company:
        return {"ok": False, "error": "company is required"}
    access_token = get_google_access_token()
    if not access_token:
        return {"ok": False, "error": "Google is not connected; visit /auth/google/connect"}

    found, near = _locate(access_token, company)
    locations = [f for f in found if "tab" in f]
    if not locations:
        return {
            "ok": False,
            "removed": [],
            "error": f"No rows named exactly '{company}' in any ALE spreadsheet. Nothing was removed.",
            "similar_names": near,
        }

    removed, failed = [], []
    tab_ids: dict[str, dict[str, int]] = {}
    for loc in locations:
        try:
            if loc["spreadsheet_id"] not in tab_ids:
                tab_ids[loc["spreadsheet_id"]] = google_api.sheets_get_tab_ids(access_token, loc["spreadsheet_id"])
            google_api.sheets_delete_rows(
                access_token, loc["spreadsheet_id"], tab_ids[loc["spreadsheet_id"]][loc["tab"]], loc["rows"]
            )
            removed.append({"spreadsheet": loc["spreadsheet"], "tab": loc["tab"], "rows_deleted": len(loc["rows"])})
        except Exception as exc:  # noqa: BLE001 — report each tab honestly, keep going
            failed.append({"spreadsheet": loc["spreadsheet"], "tab": loc["tab"], "error": str(exc)})

    # Read it all back: only what is actually gone counts as removed.
    remaining, _ = _locate(access_token, company)
    remaining = [{"spreadsheet": r["spreadsheet"], "tab": r["tab"], "rows": r["rows"]} for r in remaining if "tab" in r]
    return {
        "ok": not failed and not remaining,
        "company": company,
        "removed": removed,
        "failed": failed,
        "verified_gone": not remaining,
        "still_present": remaining,
        "notes": [f["note"] for f in found if "note" in f] + [
            "Discovery dedupes on Maps Data place_ids, so a future search covering this area "
            "could add the company back."
        ],
    }


def kivaro_pipeline(args: dict) -> dict:
    operation = args.get("operation") or "status"
    if operation == "find":
        return _find(args)
    if operation == "remove":
        return _remove(args)

    try:
        prospects = _get_prospects()
    except Exception as exc:  # noqa: BLE001
        prospects = {"connected": True, "fetch_error": str(exc)}

    try:
        clients = _get_clients()
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "error": f"clients lookup failed: {exc}", "prospects": prospects, "spreadsheets": _directory()}

    return {"ok": True, "prospects": prospects, "clients": clients, "spreadsheets": _directory()}
