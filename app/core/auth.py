import hmac

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings

_bearer = HTTPBearer(auto_error=False)


def require_access_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    """Shared gate for /invoke and /speak. Fails CLOSED: if
    JARVIS_ACCESS_TOKEN isn't set yet, every request is rejected rather
    than left open — this is a security gate being deliberately added to
    an already-deployed service, not a pre-existing integration (like
    spotify_*/elevenlabs_*) whose absence should degrade gracefully.
    """
    settings = get_settings()
    expected = settings.jarvis_access_token
    provided = credentials.credentials if credentials else None

    if not expected or not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid access token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
