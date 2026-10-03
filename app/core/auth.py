import hashlib
import hmac
import logging
import time

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings
from app.core.redis_client import get_redis_client
from app.core.session import is_allowed, verify_browser_token, verify_session
from app.core.supabase_client import get_supabase_client

_bearer = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)


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
    if not provided or not has_full_access(provided):
        raise _unauthorized()


def has_full_access(provided: str) -> bool:
    session_email = verify_session(provided)
    if session_email and is_allowed(session_email):
        return True
    expected = get_settings().jarvis_access_token
    return bool(expected and hmac.compare_digest(provided, expected))


# --- The browser extension's scoped token (app/core/session.py) ----------
#
# Its generation lives in Redis so unpairing (bumping it) revokes every
# extension token at once, across restarts. Read through a short cache:
# the extension calls /speak once per spoken sentence.

_GEN_KEY = "jarvis:browser:gen"
_GEN_TTL = 60.0
_generation: tuple[float, int | None] = (0.0, None)


def browser_generation() -> int:
    global _generation
    fetched_at, value = _generation
    if value is not None and time.time() - fetched_at < _GEN_TTL:
        return value
    try:
        value = int(get_redis_client().get(_GEN_KEY) or 0)
    except Exception:  # noqa: BLE001 — unreadable: keep the last known value, else fail closed
        logger.warning("browser generation unavailable", exc_info=True)
        return value if value is not None else -1
    _generation = (time.time(), value)
    return value


def bump_browser_generation() -> int:
    global _generation
    value = int(get_redis_client().incr(_GEN_KEY))
    _generation = (time.time(), value)
    return value


def browser_token_email(provided: str) -> str | None:
    email = verify_browser_token(provided, browser_generation())
    return email if email and is_allowed(email) else None


def require_browser_or_full(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    """For the routes the extension needs (Jarvis's voice and chat): full
    access, or a current browser token."""
    provided = credentials.credentials if credentials else None
    if not provided or not (has_full_access(provided) or browser_token_email(provided)):
        raise _unauthorized()


# The routine trigger token's SHA-256, read from Supabase and cached. The
# token itself exists only in Supabase Vault, where pg_cron reads it to
# call /routines/<name>/run (supabase/migrations/0006).
_ROUTINE_HASH_TTL = 300.0
_routine_hash: tuple[float, str | None] = (0.0, None)


def _routine_token_hash() -> str | None:
    global _routine_hash
    fetched_at, value = _routine_hash
    if time.time() - fetched_at < _ROUTINE_HASH_TTL:
        return value
    try:
        rows = (
            get_supabase_client()
            .table("jarvis_routine_trigger")
            .select("token_sha256")
            .eq("id", "default")
            .execute()
            .data
        )
        value = rows[0]["token_sha256"] if rows else None
    except Exception:  # noqa: BLE001 — an unreadable table just means this credential fails
        logger.warning("routine trigger hash unavailable", exc_info=True)
        value = None
    _routine_hash = (time.time(), value)
    return value


def require_routine_access(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    """The routine routes: everything require_access_token accepts, plus
    the Supabase scheduler's trigger token. That token can only start a
    routine - it is accepted nowhere else."""
    provided = credentials.credentials if credentials else None
    if provided:
        expected = _routine_token_hash()
        digest = hashlib.sha256(provided.encode()).hexdigest()
        if expected and hmac.compare_digest(digest, expected):
            return
    require_access_token(credentials)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing or invalid access token.",
        headers={"WWW-Authenticate": "Bearer"},
    )
