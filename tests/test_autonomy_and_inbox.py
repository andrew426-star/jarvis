import json

from app.services import inbox
from app.tools import checklist as cl
from app.tools.inbox import inbox as inbox_tool
from app.tools.rounds import _allowed, round_tools


def test_rounds_read_but_never_write():
    assert _allowed("kiv_tasks", {"operation": "list"})
    assert not _allowed("kiv_tasks", {"operation": "update"})
    assert not _allowed("google_titan", {"operation": "gmail_send_message"})
    assert _allowed("google_titan", {"operation": "calendar_list_events"})
    assert not _allowed("github", {})
    assert _allowed("trade_signals", {})
    _, handlers, _ = round_tools("rounds-test")
    held = handlers["checklist"]({"operation": "create", "title": "x", "items": ["a"]})
    assert held["held"] and not held["ok"]
    assert "inbox" not in handlers  # rounds cannot approve anything


def test_proposals_are_validated_deduplicated_and_capped(db, monkeypatch):
    _, handlers, filed = round_tools("rounds-test")
    call = {"title": "Make a lab list", "why": "Lab due Friday", "tool": "checklist",
            "args_json": json.dumps({"operation": "create", "title": "Lab", "items": ["Read spec"]})}
    assert handlers["propose"](call)["filed"]
    assert handlers["propose"](call)["skipped"]
    assert not handlers["propose"]({**call, "tool": "inbox"})["ok"]
    assert not handlers["propose"]({**call, "title": "x", "args_json": "[1]"})["ok"]
    assert not handlers["propose"]({**call, "title": "y", "args_json": "{bad"})["ok"]
    for i in range(3):
        handlers["propose"]({**call, "title": f"another {i}", "args_json": json.dumps({"operation": "list", "n": i})})
    assert sum(1 for f in filed if f["kind"] == "proposal") == 3


def test_approval_runs_once_and_records_the_result(db):
    item = inbox.add_item("proposal", "Make a list", "why", tool="checklist",
                          args={"operation": "create", "title": "Errands", "items": ["Milk"]})
    out = inbox.approve(item["id"])
    assert out["ok"] and out["item"]["status"] == "done"
    assert out["result"]["checklist"]["title"] == "Errands"
    again = inbox.approve(item["id"])
    assert not again["ok"]
    assert len(db.tables["jarvis_checklists"]) == 1


def test_jarvis_can_list_and_dismiss_but_not_approve(db):
    inbox.add_item("notice", "Pitch moved to 4pm", "body", "high")
    assert inbox_tool({"operation": "list"})["count"] == 1
    assert not inbox_tool({"operation": "approve", "item": "1"})["ok"]
    assert inbox_tool({"operation": "dismiss", "item": "pitch"})["item"]["status"] == "dismissed"


def test_topics_are_kept_and_checked(db):
    assert inbox.add_item("notice", "NVDA up 4%", "b", topic="markets")["topic"] == "markets"
    assert inbox.add_item("notice", "Locked", "b", topic="security")["topic"] == "security"
    assert inbox.add_item("notice", "Odd", "b", topic="nonsense")["topic"] == "rounds"


def test_checklists(db):
    made = cl.checklist({"operation": "create", "title": "Errands", "items": ["- Buy milk", "Email Dr. Lee", "  "]})
    assert made["checklist"]["total"] == 2
    ticked = cl.checklist({"operation": "check", "items": ["2", "nope"]})
    assert ticked["checklist"]["done"] == 1 and ticked["not_found"] == ["nope"]
    assert cl.checklist({"operation": "add", "list": "errand", "items": ["Bank"]})["checklist"]["total"] == 3
    item_id = made["checklist"]["items"][0]["id"]
    assert cl.set_item(made["checklist"]["id"], item_id, True)["checklist"]["done"] == 2
    cl.checklist({"operation": "archive"})
    assert cl.list_open()["checklists"] == []
