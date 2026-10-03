import asyncio
import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.auth import require_browser_or_full, browser_generation, browser_token_email, bump_browser_generation, has_full_access, require_access_token
from app.core.gemini import AllModelsExhausted, GeminiNotConfigured
from app.core.session import allowed_emails, issue_browser_token, verify_session
from app.services import browser_link
from app.services.browser_watch import observe

router = APIRouter()
logger = logging.getLogger(__name__)

# The J.A.R.V.I.S. browser extension's side of the backend (extension/).
# Pairing mints it a scoped token from a signed-in console; the WebSocket
# is the live link it keeps open (app/services/browser_link.py).

HELLO_TIMEOUT_S = 10
_bearer = HTTPBearer(auto_error=False)


@router.post("/browser/pair", dependencies=[Depends(require_access_token)])
def browser_pair(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    """A token for the extension, issued to whoever is signed in (or, with
    the shared access token, to the first allowed address)."""
    provided = credentials.credentials if credentials else ""
    email = verify_session(provided) or next(iter(sorted(allowed_emails())), None)
    if not email:
        return {"ok": False, "error": "No allowed account to pair the extension to."}
    return {"ok": True, "token": issue_browser_token(email, browser_generation())}


# The extension may unpair itself, so its own token is accepted here.
@router.post("/browser/unpair", dependencies=[Depends(require_browser_or_full)])
async def browser_unpair() -> dict:
    """Revokes every extension token and drops the live link."""
    await run_in_threadpool(bump_browser_generation)
    socket = browser_link.link.socket
    if socket:
        try:
            await socket.close(code=4001, reason="unpaired")
        except Exception:  # noqa: BLE001 — already gone
            pass
    return {"ok": True}


@router.get("/browser/status", dependencies=[Depends(require_access_token)])
def browser_status() -> dict:
    state = browser_link.snapshot()
    page = state.pop("page")
    state["page"] = {"title": page.get("title"), "url": page.get("url")} if page else None
    state["tabs"] = len(state["tabs"])
    state.pop("session_id", None)
    return state


def _token_ok(token: str) -> bool:
    return bool(token) and (browser_token_email(token) is not None or has_full_access(token))


@router.websocket("/browser/ws")
async def browser_ws(socket: WebSocket) -> None:
    await socket.accept()
    # The credential comes in the first message, not the URL, so it never
    # lands in an access log.
    try:
        hello = await asyncio.wait_for(socket.receive_json(), HELLO_TIMEOUT_S)
    except (asyncio.TimeoutError, WebSocketDisconnect, ValueError):
        await socket.close(code=4001)
        return
    token = str(hello.get("token") or "") if isinstance(hello, dict) else ""
    if hello.get("type") != "hello" or not await run_in_threadpool(_token_ok, token):
        await socket.send_json({"type": "error", "error": "unauthorized"})
        await socket.close(code=4001)
        return

    session_id = str(hello.get("session_id") or "")[:128] or None
    previous = browser_link.attach(socket, asyncio.get_running_loop(), session_id)
    browser_link.seen(bool(hello.get("paused")))
    if previous is not None:
        try:
            await previous.close(code=4000, reason="replaced")
        except Exception:  # noqa: BLE001
            pass
    await socket.send_json({"type": "welcome"})

    observing = False

    async def run_observe(level: str) -> None:
        nonlocal observing
        page = browser_link.snapshot()["page"]
        try:
            if page:
                result = await run_in_threadpool(observe, page, level, session_id)
                if result["speak"]:
                    await socket.send_json({"type": "remark", "message": result["message"]})
                else:
                    await socket.send_json({"type": "observed", "notes": result["notes"]})
        except (GeminiNotConfigured, AllModelsExhausted) as exc:
            await socket.send_json({"type": "observed", "error": str(exc)})
        except Exception:  # noqa: BLE001 — one bad look must not drop the link
            logger.exception("browser observe failed")
        finally:
            observing = False

    try:
        while True:
            message = await socket.receive_json()
            if not isinstance(message, dict):
                continue
            kind = message.get("type")
            if kind == "ping":
                browser_link.seen(bool(message.get("paused")))
                await socket.send_json({"type": "pong"})
            elif kind == "page":
                page = message.get("page")
                browser_link.set_page(page if isinstance(page, dict) else None)
            elif kind == "tabs":
                tabs = message.get("tabs")
                browser_link.set_tabs(tabs if isinstance(tabs, list) else [])
            elif kind == "result":
                result = message.get("result")
                browser_link.resolve(str(message.get("id")), result if isinstance(result, dict) else {"ok": False})
            elif kind == "observe" and not observing:
                observing = True
                asyncio.create_task(run_observe(str(message.get("level") or "normal")))
    except (WebSocketDisconnect, ValueError, RuntimeError):
        pass
    finally:
        browser_link.detach(socket)
