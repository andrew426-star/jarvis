import pytest

from app.tools import browser as b
from app.tools.rounds import NOT_PROPOSABLE, _allowed

TABS = [
    {"id": 11, "title": "Lab 4 - Moodle", "url": "https://moodle.latech.edu/lab4", "active": True},
    {"id": 12, "title": "Amazon.com: Arduino", "url": "https://www.amazon.com/s?k=arduino", "active": False},
    {"id": 13, "blocked": True, "active": False},
]


@pytest.fixture
def link(monkeypatch):
    """A connected extension that records what it is asked to do."""
    sent = []

    def request(kind, args, timeout=8.0):
        sent.append((kind, args, timeout))
        return {"ok": True, "did": "done"}

    state = {"connected": True, "paused": False, "last_seen": 0, "page": None, "tabs": TABS}
    monkeypatch.setattr(b.browser_link, "snapshot", lambda: dict(state))
    monkeypatch.setattr(b.browser_link, "request", request)
    return sent


def test_click_goes_to_the_extension_with_a_long_timeout(link):
    assert b.browser({"operation": "click", "ref": "7"})["ok"]
    kind, args, timeout = link[0]
    assert kind == "act" and args == {"action": "click", "ref": 7}
    # Long enough to wait for Andrew's ALLOW, inside the orchestrator's 30s.
    assert 20 < timeout < 30


def test_type_defaults_to_replacing_without_submitting(link):
    b.browser({"operation": "type", "ref": 3, "text": "servo motor"})
    assert link[0][1] == {"action": "type", "ref": 3, "text": "servo motor", "clear": True, "submit": False}
    b.browser({"operation": "type", "ref": 3, "text": "!", "clear": False, "submit": True})
    assert link[1][1]["clear"] is False and link[1][1]["submit"] is True


def test_actions_target_a_named_tab(link):
    b.browser({"operation": "switch_tab", "tab": "amazon"})
    assert link[0][1] == {"action": "switch_tab", "tab_id": 12}
    b.browser({"operation": "elements", "tab": "moodle"})
    assert link[1][:2] == ("elements", {"tab_id": 11})


def test_private_tabs_cannot_be_named(link):
    result = b.browser({"operation": "close_tab", "tab": "13"})
    assert not result["ok"] and not link


@pytest.mark.parametrize(
    "args",
    [
        {"operation": "click"},
        {"operation": "type", "ref": 1},
        {"operation": "select", "ref": 1},
        {"operation": "press", "ref": 1, "key": "F5"},
        {"operation": "open"},
        {"operation": "switch_tab"},
        {"operation": "scroll", "direction": "sideways"},
        {"operation": "fly"},
    ],
)
def test_bad_actions_never_reach_the_browser(link, args):
    assert not b.browser(args)["ok"]
    assert not link


def test_key_aliases_and_scroll_default(link):
    b.browser({"operation": "press", "ref": 2, "key": "esc"})
    b.browser({"operation": "scroll"})
    assert link[0][1]["key"] == "Escape"
    assert link[1][1] == {"action": "scroll", "direction": "down"}


def test_open_in_the_same_tab(link):
    b.browser({"operation": "open", "url": "digikey.com", "new_tab": False})
    assert link[0][1] == {"action": "open", "url": "digikey.com", "new_tab": False}


def test_nothing_happens_while_paused_or_offline(monkeypatch, link):
    state = {"connected": True, "paused": True, "last_seen": 0, "page": None, "tabs": TABS}
    monkeypatch.setattr(b.browser_link, "snapshot", lambda: state)
    assert not b.browser({"operation": "open", "url": "example.com"})["ok"]
    state.update(connected=False, paused=False)
    assert not b.browser({"operation": "click", "ref": 1})["ok"]
    assert not link


def test_rounds_may_look_but_never_act():
    for operation in ("current_page", "tabs", "read_tab", "elements"):
        assert _allowed("browser", {"operation": operation})
    for operation in sorted(b.TAB_ACTIONS | b.PAGE_ACTIONS):
        assert not _allowed("browser", {"operation": operation})
    assert "browser" in NOT_PROPOSABLE
