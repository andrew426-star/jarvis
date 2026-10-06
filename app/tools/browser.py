import time

from app.services import browser_link

# Jarvis in Andrew's web browser through the J.A.R.V.I.S. extension
# (extension/, app/services/browser_link.py). He sees the page in front of
# Andrew, what he has selected or is typing, and his open tabs, can read
# another tab, and can act: open pages, click, type, choose, scroll, and
# move between tabs. Blocked sites (banking, email, health, and any he
# adds), incognito windows and paused periods are never sent and never
# acted on. The extension enforces that, and the rest of the safety, in the
# browser itself: password and card fields are never typed into, a glowing
# rim shows while Jarvis drives, anything with consequences (send, buy,
# delete, submit...) waits for Andrew's ALLOW on the page, and his STOP
# halts it. Andrew can switch actions off in the extension's popup.

READ_CHARS = 20_000
READ_OPERATIONS = {"current_page", "tabs", "read_tab", "elements"}
TAB_ACTIONS = {"open", "back", "forward", "reload", "switch_tab", "close_tab"}
PAGE_ACTIONS = {"click", "type", "select", "press", "scroll"}
OPERATIONS = sorted(READ_OPERATIONS | TAB_ACTIONS | PAGE_ACTIONS)
KEYS = {"Enter", "Escape", "Tab", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "}
KEY_ALIASES = {"space": " ", "esc": "Escape", "return": "Enter"}
# An action may wait on Andrew's ALLOW (18s) and then a page load: just
# inside the orchestrator's 30s for a round of tools.
ACT_TIMEOUT_S = 28.0

BROWSER_SCHEMA = {
    "type": "function",
    "function": {
        "name": "browser",
        "description": (
            "See and act in Andrew's web browser (Chrome/Edge, through his J.A.R.V.I.S. extension). "
            "READ: current_page (the page in front of him: title, address, visible text, his "
            "selection, the box he is typing in); tabs (his open tabs); read_tab (another tab's "
            "text); elements (the page's buttons, links and fields, numbered - call it before "
            "clicking or typing). ACT: open (url; new_tab false to go there in the same tab); "
            "back, forward, reload; switch_tab, close_tab (tab); click (ref); type (ref, text; "
            "submit true to press Enter after; clear false to append); select (ref, option) for a "
            "dropdown list; press (key, ref); scroll (direction up/down/top/bottom, or ref). Refs "
            "come from the latest elements call. Actions default to the tab you last listed or "
            "acted in. Each result says what actually happened (url, navigated, new_tab, "
            "page_start); report that, not your intent. Sending, buying, deleting, posting or "
            "submitting waits for Andrew to press ALLOW on the page; if he declines or presses "
            "STOP, stop and say so. Never type passwords or card numbers (it is refused). Use "
            "it when he says 'this page' or asks you to do something in the browser: look up, "
            "fill in, click, go to. Private sites come back as blocked; say so rather than guessing."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": OPERATIONS},
                "tab": {"type": "string", "description": "A tab id, or words from its title or address."},
                "url": {"type": "string", "description": "open: the address."},
                "new_tab": {"type": "boolean", "description": "open: false to navigate the current tab (default true)."},
                "ref": {"type": "integer", "description": "click/type/select/press/scroll: the element's number from elements."},
                "text": {"type": "string", "description": "type: what to type."},
                "clear": {"type": "boolean", "description": "type: false to add to what is there (default replaces it)."},
                "submit": {"type": "boolean", "description": "type: press Enter afterwards."},
                "option": {"type": "string", "description": "select: the option's text."},
                "key": {"type": "string", "description": "press: Enter, Escape, Tab, Backspace, ArrowUp/Down/Left/Right or space."},
                "direction": {"type": "string", "enum": ["up", "down", "top", "bottom"]},
            },
            "required": ["operation"],
        },
    },
}


def _unavailable(state: dict) -> dict | None:
    if not state["connected"]:
        seen = state["last_seen"]
        when = f" (last connected {int((time.time() - seen) / 60)} min ago)" if seen else ""
        return {
            "ok": False,
            "error": "The browser extension is not connected" + when + ". He installs it from the "
            "extension/ folder and pairs it from its toolbar button while the console is open.",
        }
    if state["paused"]:
        return {"ok": False, "error": "He has paused the browser extension, so the browser is private for now."}
    return None


def _page_view(page: dict) -> dict:
    text = str(page.get("text") or "")
    return {
        "title": page.get("title"),
        "url": page.get("url"),
        "selection": page.get("selection") or None,
        "typing_in": page.get("field") or None,
        "text": text[:READ_CHARS],
        "truncated": len(text) > READ_CHARS,
        "as_of_seconds_ago": int(time.time() - page.get("seen_at", time.time())),
    }


def _find_tab(wanted: str, tabs: list[dict]) -> tuple[dict | None, dict | None]:
    """The one open, readable tab `wanted` names (an id, or words from its
    title or address), or the error to return instead."""
    readable = [t for t in tabs if not t.get("blocked")]
    match = [t for t in readable if str(t.get("id")) == wanted]
    if not match:
        words = wanted.lower()
        match = [t for t in readable if words in f"{t.get('title', '')} {t.get('url', '')}".lower()]
    if not match:
        return None, {"ok": False, "error": f"No open tab matches {wanted!r}. Use tabs to see them."}
    if len(match) > 1:
        return None, {
            "ok": False,
            "error": "More than one tab matches.",
            "candidates": [{"id": t.get("id"), "title": t.get("title")} for t in match[:10]],
        }
    return match[0], None


def _act(operation: str, args: dict, tabs: list[dict]) -> dict:
    """Checks an action's arguments and has the extension carry it out."""
    request: dict = {"action": operation}
    wanted = str(args.get("tab") or "").strip()
    if wanted:
        tab, problem = _find_tab(wanted, tabs)
        if problem:
            return problem
        request["tab_id"] = tab.get("id")
    elif operation in {"switch_tab", "close_tab"}:
        return {"ok": False, "error": f"{operation} needs a tab: an id from tabs, or words from its title."}

    if operation == "open":
        url = str(args.get("url") or "").strip()
        if not url:
            return {"ok": False, "error": "open needs a url."}
        request["url"] = url
        if args.get("new_tab") is False:
            request["new_tab"] = False

    if operation in {"click", "type", "select", "press"} or (operation == "scroll" and args.get("ref") is not None):
        try:
            request["ref"] = int(args.get("ref"))
        except (TypeError, ValueError):
            return {"ok": False, "error": f"{operation} needs ref: an element's number from elements."}
    if operation == "type":
        if args.get("text") is None:
            return {"ok": False, "error": "type needs text."}
        request["text"] = str(args["text"])
        request["clear"] = args.get("clear") is not False
        request["submit"] = bool(args.get("submit"))
    if operation == "select":
        if not str(args.get("option") or "").strip():
            return {"ok": False, "error": "select needs option: the text of the choice."}
        request["option"] = str(args["option"])
    if operation == "press":
        key = str(args.get("key") or "")
        key = KEY_ALIASES.get(key.lower(), key)
        if key not in KEYS:
            return {"ok": False, "error": "press supports Enter, Escape, Tab, Backspace, the arrow keys and space."}
        request["key"] = key
    if operation == "scroll" and "ref" not in request:
        direction = str(args.get("direction") or "down")
        if direction not in {"up", "down", "top", "bottom"}:
            return {"ok": False, "error": "direction must be up, down, top or bottom."}
        request["direction"] = direction

    return browser_link.request("act", request, timeout=ACT_TIMEOUT_S)


def browser(args: dict) -> dict:
    state = browser_link.snapshot()
    problem = _unavailable(state)
    if problem:
        return problem
    operation = args.get("operation")

    if operation == "current_page":
        page = state["page"]
        if not page:
            return {"ok": False, "error": "The page in front of him is one of his private (blocked) sites."}
        return {"ok": True, **_page_view(page)}

    if operation == "tabs":
        return {
            "ok": True,
            "tabs": [
                {"id": t.get("id"), "title": t.get("title"), "url": t.get("url"), "active": t.get("active")}
                if not t.get("blocked")
                else {"id": t.get("id"), "private": True, "active": t.get("active")}
                for t in state["tabs"]
            ],
        }

    if operation == "read_tab":
        wanted = str(args.get("tab") or "").strip()
        if not wanted:
            return {"ok": False, "error": "read_tab needs a tab: an id from tabs, or words from its title."}
        tab, problem = _find_tab(wanted, state["tabs"])
        if problem:
            return problem
        result = browser_link.request("read_tab", {"tab_id": tab.get("id")})
        if not result.get("ok"):
            return result
        return {"ok": True, **_page_view({**result.get("page", {}), "seen_at": time.time()})}

    if operation == "elements":
        request: dict = {}
        wanted = str(args.get("tab") or "").strip()
        if wanted:
            tab, problem = _find_tab(wanted, state["tabs"])
            if problem:
                return problem
            request["tab_id"] = tab.get("id")
        return browser_link.request("elements", request)

    if operation in TAB_ACTIONS | PAGE_ACTIONS:
        return _act(operation, args, state["tabs"])

    return {"ok": False, "error": f"operation must be one of {', '.join(OPERATIONS)}."}
