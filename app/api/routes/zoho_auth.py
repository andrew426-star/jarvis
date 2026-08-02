from fastapi import APIRouter
from fastapi.responses import HTMLResponse, RedirectResponse

from app.core.zoho_oauth import (
    build_auth_url,
    exchange_code_for_tokens,
    resolve_account_id,
    resolve_inbox_folder_id,
    store_connection,
    verify_oauth_state,
)

router = APIRouter()


@router.get("/auth/zoho/connect")
def zoho_connect():
    try:
        return RedirectResponse(build_auth_url())
    except RuntimeError as exc:
        return HTMLResponse(f"<h1>Cannot connect</h1><p>{exc}</p>", status_code=503)


@router.get("/auth/zoho/callback")
def zoho_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return HTMLResponse(f"<h1>Connection failed</h1><p>{error}</p>", status_code=400)
    if not code or not state or not verify_oauth_state(state):
        return HTMLResponse("<h1>Connection failed</h1><p>Invalid or expired request.</p>", status_code=400)

    try:
        tokens = exchange_code_for_tokens(code)
        if not tokens.get("refresh_token"):
            return HTMLResponse(
                "<h1>Connection failed</h1><p>Zoho didn't return a refresh token — try again.</p>",
                status_code=400,
            )
        account_id, email_address = resolve_account_id(tokens["access_token"])
        inbox_folder_id = resolve_inbox_folder_id(tokens["access_token"], account_id)
        store_connection(tokens, account_id, inbox_folder_id, email_address)
    except Exception as exc:  # noqa: BLE001
        return HTMLResponse(f"<h1>Connection failed</h1><p>{exc}</p>", status_code=500)

    name = email_address or "your account"
    return HTMLResponse(f"<h1>Connected to Zoho Mail as {name}</h1><p>You can close this tab.</p>")
