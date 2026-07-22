from fastapi import APIRouter
from fastapi.responses import HTMLResponse, RedirectResponse

from app.core.google_oauth import (
    build_auth_url,
    exchange_code_for_tokens,
    fetch_google_email,
    store_connection,
    verify_oauth_state,
)

router = APIRouter()


@router.get("/auth/google/connect")
def google_connect() -> RedirectResponse:
    return RedirectResponse(build_auth_url())


# Jarvis has no frontend yet, so this returns a plain inline-HTML message
# directly rather than redirecting to a page that doesn't exist.
@router.get("/auth/google/callback")
def google_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return HTMLResponse(f"<h1>Connection failed</h1><p>{error}</p>", status_code=400)
    if not code or not state or not verify_oauth_state(state):
        return HTMLResponse("<h1>Connection failed</h1><p>Invalid or expired request.</p>", status_code=400)

    try:
        tokens = exchange_code_for_tokens(code)
        if not tokens.get("refresh_token"):
            return HTMLResponse(
                "<h1>Connection failed</h1>"
                "<p>Google didn't return a refresh token — try again and make sure to "
                "approve the consent screen (this can happen on a repeat connect; "
                "revoke Jarvis's access at myaccount.google.com/permissions and retry).</p>",
                status_code=400,
            )
        email = fetch_google_email(tokens["access_token"])
        store_connection(tokens, email)
    except Exception as exc:  # noqa: BLE001
        return HTMLResponse(f"<h1>Connection failed</h1><p>{exc}</p>", status_code=500)

    return HTMLResponse(f"<h1>Connected to Google as {email or 'your account'}</h1><p>You can close this tab.</p>")
