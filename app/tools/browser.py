import time

from app.services import browser_link

# Jarvis reading Andrew's web browser through the J.A.R.V.I.S. extension
# (extension/, app/services/browser_link.py). Read-only: it sees the page
# in front of him, what he has selected or is typing, and his open tabs,
# and can read another tab on request. Blocked sites (banking, email,
# health, and any he adds), incognito windows and paused periods are never
# sent, so they cannot be read here either.

READ_CHARS = 20_000

BROWSER_SCHEMA = {
    "type": "function",
    "function": {
        "name": "browser",
        "description": (
            "See Andrew's web browser (Chrome/Edge, through his J.A.R.V.I.S. extension). Read-only. "
            "current_page: the page in front of him - its title, address, visible text, what he has "
            "selected, and the text box he is typing in. tabs: his open tabs. read_tab: the text of "
            "another open tab (tab: its id from tabs, or words from its title or address). Use it "
            "whenever he says 'this page', 'this article', 'what I'm reading', 'my draft', 'this "
            "error', or asks about something on his screen in the browser. Some sites are private "
            "by his choice and come back as blocked; say so rather than guessing."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["current_page", "tabs", "read_tab"]},
                "tab": {"type": "string", "description": "read_tab: a tab id, or words from its title or address."},
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
        tabs = [t for t in state["tabs"] if not t.get("blocked")]
        match = [t for t in tabs if str(t.get("id")) == wanted]
        if not match:
            words = wanted.lower()
            match = [t for t in tabs if words in f"{t.get('title', '')} {t.get('url', '')}".lower()]
        if not match:
            return {"ok": False, "error": f"No open tab matches {wanted!r}. Use tabs to see them."}
        if len(match) > 1:
            return {
                "ok": False,
                "error": "More than one tab matches.",
                "candidates": [{"id": t.get("id"), "title": t.get("title")} for t in match[:10]],
            }
        result = browser_link.request("read_tab", {"tab_id": match[0].get("id")})
        if not result.get("ok"):
            return result
        return {"ok": True, **_page_view({**result.get("page", {}), "seen_at": time.time()})}

    return {"ok": False, "error": "operation must be current_page, tabs or read_tab."}
