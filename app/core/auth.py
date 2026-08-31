import hmac

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings
from app.core.session import is_allowed, verify_session

_bearer = HTTPBearer(auto_error=False)


def require_access_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    """Shared gate for every non-OAuth route. Two accepted credentials:

    1. A Google sign-in session (app/core/session.py) — how the console
       authenticates. The allowlist is re-checked on every request, not
       just at sign-in, so removing an address from JARVIS_ALLOWED_EMAILS
       takes effect immediately instead of waiting out the session.
    2. JARVIS_ACCESS_TOKEN, the original shared secret — kept for
       curl/scripts, which have no way to run a browser OAuth flow.

    Fails CLOSED in every direction: no credential, an unconfigured
    server, or a valid signature for a no-longer-allowed address are all
    rejected. This guards tools that can send mail as the account owner,
    so "open by accident" must not be reachable.
    """
    provided = credentials.credentials if credentials else None
    if not provided:
        raise _unauthorized()

    session_email = verify_session(provided)
    if session_email and is_allowed(session_email):
        return

    expected = get_settings().jarvis_access_token
    if expected and hmac.compare_digest(provided, expected):
        return

    raise _unauthorized()


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing or invalid access token.",
        headers={"WWW-Authenticate": "Bearer"},
    )
