import asyncio
import logging
import threading
import time
import uuid
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout

from fastapi import WebSocket

logger = logging.getLogger(__name__)

# The live link to Andrew's browser: the J.A.R.V.I.S. extension (extension/)
# holds one WebSocket to this process (app/api/routes/browser.py) and sends
# what it sees - the page in front of him, his open tabs - as it changes.
# Jarvis's browser tool (app/tools/browser.py) reads that here, and asks the
# extension for anything it has not sent (another tab's text) over the
# same socket.
#
# In memory on purpose. Render runs one process, so there is one link to
# find; the page text is fleeting and better forgotten than stored; and a
# Redis round trip per keystroke-pause would burn the free tier. A restart
# just means the extension reconnects and sends the page again.

PAGE_TEXT_CHARS = 40_000
REQUEST_TIMEOUT_S = 8.0


class Link:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.socket: WebSocket | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self.session_id: str | None = None
        self.connected_at: float | None = None
        self.last_seen: float | None = None
        self.paused = False
        self.page: dict | None = None
        self.tabs: list[dict] = []
        self.pending: dict[str, Future] = {}


link = Link()


def attach(socket: WebSocket, loop: asyncio.AbstractEventLoop, session_id: str | None) -> WebSocket | None:
    """Makes this socket THE link; returns the one it replaced, if any (a
    second browser, or a reconnect racing the old socket's close)."""
    with link.lock:
        previous = link.socket
        link.socket = socket
        link.loop = loop
        link.session_id = session_id
        link.connected_at = link.last_seen = time.time()
        return previous


def detach(socket: WebSocket) -> None:
    with link.lock:
        if link.socket is not socket:
            return
        link.socket = None
        pending = list(link.pending.values())
        link.pending.clear()
    for future in pending:
        if not future.done():
            future.set_result({"ok": False, "error": "The browser extension disconnected."})


def seen(paused: bool | None = None) -> None:
    with link.lock:
        link.last_seen = time.time()
        if paused is not None:
            link.paused = paused


def set_page(page: dict | None) -> None:
    """The page in front of him, or None when it is one he has blocked."""
    if page is not None:
        page = {**page, "text": str(page.get("text") or "")[:PAGE_TEXT_CHARS], "seen_at": time.time()}
    with link.lock:
        link.page = page
        link.last_seen = time.time()


def set_tabs(tabs: list[dict]) -> None:
    with link.lock:
        link.tabs = tabs[:200]
        link.last_seen = time.time()


def resolve(request_id: str, result: dict) -> None:
    with link.lock:
        future = link.pending.pop(request_id, None)
    if future and not future.done():
        future.set_result(result)


def snapshot() -> dict:
    """The state, as a copy safe to read without the lock."""
    with link.lock:
        return {
            "connected": link.socket is not None,
            "paused": link.paused,
            "session_id": link.session_id,
            "connected_at": link.connected_at,
            "last_seen": link.last_seen,
            "page": dict(link.page) if link.page else None,
            "tabs": list(link.tabs),
        }


def request(kind: str, args: dict, timeout: float = REQUEST_TIMEOUT_S) -> dict:
    """Ask the extension for something and wait for its answer. Called from
    tool threads; the send is handed to the socket's event loop."""
    with link.lock:
        socket, loop = link.socket, link.loop
        if socket is None or loop is None:
            return {"ok": False, "error": "The browser extension is not connected."}
        request_id = uuid.uuid4().hex
        future: Future = Future()
        link.pending[request_id] = future
    try:
        asyncio.run_coroutine_threadsafe(
            socket.send_json({"type": "request", "id": request_id, "kind": kind, "args": args}), loop
        ).result(timeout=2)
        return future.result(timeout=timeout)
    except FutureTimeout:
        return {"ok": False, "error": "The browser did not answer in time."}
    except Exception as exc:  # noqa: BLE001 — a dead socket is an answer, not a crash
        return {"ok": False, "error": f"Could not reach the browser: {exc}"}
    finally:
        with link.lock:
            link.pending.pop(request_id, None)


def context_line() -> str | None:
    """One line for Jarvis's prompt: where Andrew is in his browser."""
    state = snapshot()
    if not state["connected"]:
        return None
    if state["paused"]:
        return "BROWSER: the extension is connected but Andrew has paused it; you cannot see his browser right now."
    page = state["page"]
    if not page:
        return "BROWSER: connected; the page in front of him is private (a blocked site), so you cannot see it."
    age = int(time.time() - page.get("seen_at", time.time()))
    return (
        f"BROWSER: he is on \"{str(page.get('title') or '')[:120]}\" ({str(page.get('url') or '')[:200]}), "
        f"as of {age}s ago. Use the browser tool to read it, his selection, or his other tabs."
    )
