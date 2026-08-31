from urllib.parse import urlencode

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

from app.core.config import get_settings
from app.core.google_oauth import (
    build_login_url,
    exchange_code_for_tokens,
    fetch_google_email,
    verify_oauth_state,
)
from app.core.session import is_allowed, issue_session

router = APIRouter()


def _console_url(**params: str) -> str:
    """Back to the console. Same-origin in production (FastAPI serves the
    bundle), so a bare "/" is right; JARVIS_FRONTEND_ORIGIN exists for
    `next dev`, where the console is on :3000 and the API on :8000.
    """
    base = get_settings().jarvis_frontend_origin or ""
    return f"{base}/?{urlencode(params)}"


@router.get("/auth/login/google")
def login_start() -> RedirectResponse:
    if not get_settings().google_login_redirect_uri:
        return RedirectResponse(_console_url(login_error="not_configured"))
    return RedirectResponse(build_login_url())


@router.get("/auth/login/callback")
def login_callback(
    code: str | None = None, state: str | None = None, error: str | None = None
) -> RedirectResponse:
    # Every failure lands back on the console with a reason rather than
    # rendering a dead-end page, so the user is never stranded on the API.
    if error:
        return RedirectResponse(_console_url(login_error="denied"))
    if not code or not state or not verify_oauth_state(state, "login"):
        return RedirectResponse(_console_url(login_error="bad_request"))

    settings = get_settings()
    try:
        tokens = exchange_code_for_tokens(code, settings.google_login_redirect_uri)
        email = fetch_google_email(tokens["access_token"])
    except Exception:  # noqa: BLE001
        return RedirectResponse(_console_url(login_error="exchange_failed"))

    # The identity check. Proving you hold *a* Google account is not
    # enough — it has to be one of the allowlisted ones.
    if not is_allowed(email):
        return RedirectResponse(_console_url(login_error="not_allowed"))

    try:
        session = issue_session(email)
    except RuntimeError:
        return RedirectResponse(_console_url(login_error="not_configured"))

    return RedirectResponse(_console_url(session=session))
