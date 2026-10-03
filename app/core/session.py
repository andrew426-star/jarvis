import base64
import hashlib
import hmac
import json
import time

from app.core.config import get_settings

# Long-lived on purpose: the whole point of moving off the shared
# passphrase is not being asked for credentials. A stolen session is
# revoked by rotating JARVIS_SESSION_SECRET, which invalidates every
# session at once.
SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: str, secret: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def allowed_emails() -> set[str]:
    raw = get_settings().jarvis_allowed_emails or ""
    return {entry.strip().lower() for entry in raw.split(",") if entry.strip()}


def is_allowed(email: str | None) -> bool:
    """Fails CLOSED: an unset/empty allowlist admits nobody, rather than
    admitting everyone with a Google account — same stance as auth.py.
    """
    if not email:
        return False
    allowed = allowed_emails()
    return bool(allowed) and email.strip().lower() in allowed


def _issue(body: dict) -> str:
    secret = get_settings().jarvis_session_secret
    if not secret:
        raise RuntimeError("JARVIS_SESSION_SECRET is not set.")
    payload = _b64e(json.dumps(body, separators=(",", ":")).encode())
    return f"{payload}.{_sign(payload, secret)}"


def _verify(token: str) -> dict | None:
    """The token's body if it is genuine and unexpired, else None. Signature
    is checked before the payload is parsed so untrusted bytes never reach
    json.loads."""
    secret = get_settings().jarvis_session_secret
    if not secret:
        return None
    parts = token.split(".")
    if len(parts) != 2:
        return None
    payload, sig = parts
    if not hmac.compare_digest(sig, _sign(payload, secret)):
        return None
    try:
        # binascii.Error and JSONDecodeError are both ValueError subclasses.
        body = json.loads(_b64d(payload))
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    exp = body.get("exp")
    if not isinstance(exp, int) or exp < int(time.time()):
        return None
    return body


def issue_session(email: str) -> str:
    """Signed `payload.signature`, the same hand-rolled HMAC shape as
    google_oauth.py's OAuth state — deliberately not a JWT library, since
    this is one issuer verifying its own tokens with one symmetric key.
    """
    return _issue({"email": email, "exp": int(time.time()) + SESSION_MAX_AGE_SECONDS})


def verify_session(token: str) -> str | None:
    """Returns the signed-in email, or None if the token is malformed,
    forged, expired, or a scoped token (a browser extension's) rather than
    a full session.
    """
    body = _verify(token)
    if body is None or body.get("scope"):
        return None
    email = body.get("email")
    return email if isinstance(email, str) else None


# The browser extension's credential (extension/, app/services/
# browser_link.py). Scoped: it opens the browser link and Jarvis's voice
# and chat, nothing else, so a leaked copy cannot read mail or files. It
# carries a generation number; unpairing bumps the generation, which
# revokes every token issued before it.
BROWSER_MAX_AGE_SECONDS = 180 * 24 * 60 * 60


def issue_browser_token(email: str, generation: int) -> str:
    return _issue(
        {"email": email, "scope": "browser", "gen": generation, "exp": int(time.time()) + BROWSER_MAX_AGE_SECONDS}
    )


def verify_browser_token(token: str, generation: int) -> str | None:
    body = _verify(token)
    if body is None or body.get("scope") != "browser" or body.get("gen") != generation:
        return None
    email = body.get("email")
    return email if isinstance(email, str) else None
