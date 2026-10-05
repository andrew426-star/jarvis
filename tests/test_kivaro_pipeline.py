import pytest

from app.tools import kivaro_pipeline as kp
from app.tools.rounds import _allowed

HUNTER_EMPTY = ["", "", "", "", "", "", ""]


@pytest.fixture
def sheets(monkeypatch):
    """The three ALE spreadsheets as {id: {tab: rows}}, header row first."""
    data = {
        kp.GLE_SPREADSHEET_ID: {
            "Maps Data": [
                ["name", "place_id"],
                ["Cloud Equity Group", "p1"],
                ["Khan Funds", "p2"],
                ["Quantz Capital Management LLC", "p3"],
            ],
            "Websites": [["name", "website", "place_id"], ["Cloud Equity Group", "cloud.com", "p1"]],
            "Hunter": [
                ["place_id", "addr", "name", "web", "n", "r", "email"],
                ["p1", "", "Cloud Equity Group", "", "", "", "a@cloud.com"],
                ["p2", "", "Khan Funds", *HUNTER_EMPTY[3:]],
            ],
        },
        kp.ALE_SPREADSHEET_ID: {
            "Companies": [["Company Name"], ["Cloud Equity Group"], ["khan  funds"]],
            "Contacts": [["Company Name"], ["Cloud Equity Group"]],
        },
        kp.SALES_PITCH_LOG_SPREADSHEET_ID: {
            "ALE Sales Pitch Log": [["Company"], ["Cloud Equity Group", *[""] * 10, "2026-10-01"]],
        },
    }

    def get_values(_token, sid, rng):
        tab = rng.strip("'").replace("''", "'")
        if tab not in data[sid]:
            raise RuntimeError("Sheets read failed: Unable to parse range: " + tab)
        return [list(r) for r in data[sid][tab]]

    def tab_ids(_token, sid):
        return {tab: i for i, tab in enumerate(data[sid])}

    def delete_rows(_token, sid, sheet_id, rows):
        tab = list(data[sid])[sheet_id]
        for n in sorted(rows, reverse=True):
            del data[sid][tab][n - 1]

    monkeypatch.setattr(kp, "get_google_access_token", lambda: "tok")
    monkeypatch.setattr(kp.google_api, "sheets_get_values", get_values)
    monkeypatch.setattr(kp.google_api, "sheets_get_tab_ids", tab_ids)
    monkeypatch.setattr(kp.google_api, "sheets_delete_rows", delete_rows)
    return data


def test_status_shows_stages_websites_and_the_spreadsheets(sheets):
    p = kp._get_prospects()
    assert p["total"] == 3 and p["sent"] == 1 and p["researched"] == 2
    assert p["no_website"] == ["Khan Funds", "Quantz Capital Management LLC"]
    cloud = next(c for c in p["companies"] if c["name"] == "Cloud Equity Group")
    assert cloud == {"name": "Cloud Equity Group", "state": "", "stage": "sent",
                     "website": "cloud.com", "contacts_with_email": 1}
    assert [s["spreadsheet"] for s in kp._directory()] == [
        "Geolocation Lead Engine Log", "Autonomous Lead Engine Log", "Sales Pitch Log"]


def test_remove_clears_every_tab_and_verifies(sheets):
    result = kp.kivaro_pipeline({"operation": "remove", "company": "khan funds"})
    assert result["ok"] and result["verified_gone"] and not result["still_present"]
    assert {(r["tab"], r["rows_deleted"]) for r in result["removed"]} == {
        ("Maps Data", 1), ("Hunter", 1), ("Companies", 1)}
    gle = sheets[kp.GLE_SPREADSHEET_ID]
    assert [r[0] for r in gle["Maps Data"]] == ["name", "Cloud Equity Group", "Quantz Capital Management LLC"]
    assert [r[0] for r in gle["Hunter"]] == ["place_id", "p1"]
    assert sheets[kp.ALE_SPREADSHEET_ID]["Companies"] == [["Company Name"], ["Cloud Equity Group"]]


def test_remove_with_no_exact_match_removes_nothing(sheets):
    result = kp.kivaro_pipeline({"operation": "remove", "company": "Khan"})
    assert not result["ok"] and result["removed"] == []
    assert result["similar_names"] == ["Khan Funds", "khan  funds"]
    assert len(sheets[kp.GLE_SPREADSHEET_ID]["Maps Data"]) == 4


def test_failed_delete_is_reported_not_claimed(sheets, monkeypatch):
    def boom(*_a):
        raise RuntimeError("Sheets delete rows failed: 403")

    monkeypatch.setattr(kp.google_api, "sheets_delete_rows", boom)
    result = kp.kivaro_pipeline({"operation": "remove", "company": "Khan Funds"})
    assert not result["ok"] and not result["verified_gone"] and result["removed"] == []
    assert len(result["failed"]) == 3 and result["still_present"]


def test_rounds_may_read_the_pipeline_but_not_remove():
    assert _allowed("kivaro_pipeline", {"operation": "status"})
    assert _allowed("kivaro_pipeline", {"operation": "find", "company": "x"})
    assert not _allowed("kivaro_pipeline", {"operation": "remove", "company": "x"})
