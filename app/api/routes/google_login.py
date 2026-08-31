from urllib.parse import urlencode

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse, RedirectResponse

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
    """Back to the console. Relative by default, which is always the host
    the request arrived on — FastAPI serves the bundle in production, so
    that is correct with nothing configured. Only `next dev` needs the
    override, and it is a dedicated setting rather than the CORS origin
    (see config.py for why that distinction is not cosmetic).
    """
    base = get_settings().jarvis_login_return_origin or ""
    return f"{base}/?{urlencode(params)}"


# This router owns exactly one callback path, so a redirect URI aimed
# anywhere else is a misconfiguration that is knowable before the round
# trip rather than after it.
LOGIN_CALLBACK_PATH = "/auth/login/callback"


@router.get("/auth/login/google")
def login_start():
    # A missing or wrong redirect URI is a server misconfiguration, not
    # something the user did, so it says so in plain text instead of
    # bouncing to the console. Redirecting here once produced a genuinely
    # baffling symptom: the error landed on an old deployment that
    # predated ?login_error and simply rendered its own stale login screen.
    uri = get_settings().google_login_redirect_uri
    if not uri:
        return PlainTextResponse(
            "Sign-in is not configured: GOOGLE_LOGIN_REDIRECT_URI is unset. "
            "Set it to this host's /auth/login/callback and register the "
            "same URL on the OAuth client in the Google Cloud console.",
            status_code=500,
        )
    # Pointing this at /auth/google/callback is an easy and very confusing
    # mistake: Google accepts the round trip, the connect handler receives
    # a login-purpose state, refuses it, and reports "Invalid or expired
    # request" — which describes the symptom and hides the cause. Catch it
    # before leaving for Google, where the real reason is still obvious.
    if not uri.rstrip("/").endswith(LOGIN_CALLBACK_PATH):
        return PlainTextResponse(
            f"GOOGLE_LOGIN_REDIRECT_URI is {uri}, which is not sign-in's "
            f"callback. It must end with {LOGIN_CALLBACK_PATH}. "
            "/auth/google/callback belongs to GOOGLE_REDIRECT_URI, the "
            "Gmail/Drive connect flow. These are two different settings "
            "with two different paths, and both must be registered on the "
            "OAuth client in the Google Cloud console.",
            status_code=500,
        )
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
        # Same reasoning as login_start: JARVIS_SESSION_SECRET being unset
        # is an operator problem, and saying so beats a vague redirect.
        return PlainTextResponse(
            "Sign-in is not configured: JARVIS_SESSION_SECRET is unset.",
            status_code=500,
        )

    return RedirectResponse(_console_url(session=session))
