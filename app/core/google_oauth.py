import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import get_settings
from app.core.supabase_client import get_supabase_client

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

# Gmail/Calendar/Drive/Docs, per the ecosystem spec's GoogleTitan scope.
# gmail.readonly + gmail.send (not the broader gmail.modify) fully covers
# reading + sending/replying, including thread-correct replies via
# Subject + References/In-Reply-To + threadId. calendar.events (not the
# bare calendar scope) is event CRUD only, matching what GoogleTitan's
# operations actually do. drive (not drive.file) is needed to find
# pre-existing files, not just ones Jarvis itself creates — same reasoning
# kiv-console already documented for its own Drive scope.
GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/userinfo.email",
]

STATE_MAX_AGE_SECONDS = 15 * 60
TABLE = "jarvis_google_connection"
ROW_ID = "default"


def generate_oauth_state() -> str:
    """Stateless CSRF token — no server-side storage needed. Jarvis is
    single-user with no session model, so there's no user id to bind to
    (unlike kiv-console's state=user.id); an HMAC-signed nonce+timestamp
    proves the callback corresponds to a connect flow Jarvis itself
    started, without needing in-memory state that would break across
    multiple workers or a restart mid-flow.
    """
    nonce = secrets.token_urlsafe(16)
    ts = str(int(time.time()))
    payload = f"{nonce}.{ts}"
    sig = hmac.new(
        get_settings().google_oauth_state_secret.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    return f"{payload}.{sig}"


def verify_oauth_state(state: str) -> bool:
    parts = state.split(".")
    if len(parts) != 3:
        return False
    nonce, ts, sig = parts
    payload = f"{nonce}.{ts}"
    expected = hmac.new(
        get_settings().google_oauth_state_secret.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return False
    try:
        age = int(time.time()) - int(ts)
    except ValueError:
        return False
    return 0 <= age <= STATE_MAX_AGE_SECONDS


def build_auth_url() -> str:
    settings = get_settings()
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": generate_oauth_state(),
    }
    query = httpx.QueryParams(params)
    return f"{GOOGLE_AUTH_URL}?{query}"


def exchange_code_for_tokens(code: str) -> dict:
    settings = get_settings()
    res = httpx.post(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.google_redirect_uri,
            "grant_type": "authorization_code",
        },
    )
    if not res.is_success:
        raise RuntimeError(f"Google token exchange failed: {res.text}")
    return res.json()


def refresh_access_token(refresh_token: str) -> dict:
    settings = get_settings()
    res = httpx.post(
        GOOGLE_TOKEN_URL,
        data={
            "refresh_token": refresh_token,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "grant_type": "refresh_token",
        },
    )
    if not res.is_success:
        raise RuntimeError(f"Google token refresh failed: {res.text}")
    return res.json()


def fetch_google_email(access_token: str) -> str | None:
    res = httpx.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if not res.is_success:
        return None
    return res.json().get("email")


def store_connection(tokens: dict, google_email: str | None) -> None:
    supabase = get_supabase_client()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=tokens["expires_in"])
    row = {
        "id": ROW_ID,
        "google_email": google_email,
        "access_token": tokens["access_token"],
        "access_token_expires_at": expires_at.isoformat(),
        "scope": tokens.get("scope"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # refresh_token is only present on the initial exchange, not on refresh
    # calls — never overwrite a real refresh token with a missing one.
    if tokens.get("refresh_token"):
        row["refresh_token"] = tokens["refresh_token"]
    supabase.table(TABLE).upsert(row).execute()


def get_google_access_token() -> str | None:
    """The one function everything else calls — reads the singleton
    connection row, refreshing the access token first if it's missing or
    expiring within 60s, mirroring kiv-console's getWorkspaceAccessToken().
    """
    supabase = get_supabase_client()
    res = supabase.table(TABLE).select("*").eq("id", ROW_ID).maybe_single().execute()
    connection = res.data if res else None
    if not connection:
        return None

    access_token = connection.get("access_token")
    expires_at_raw = connection.get("access_token_expires_at")
    expires_at = datetime.fromisoformat(expires_at_raw) if expires_at_raw else None

    needs_refresh = (
        not access_token
        or not expires_at
        or expires_at < datetime.now(timezone.utc) + timedelta(seconds=60)
    )
    if needs_refresh:
        refreshed = refresh_access_token(connection["refresh_token"])
        access_token = refreshed["access_token"]
        new_expires_at = datetime.now(timezone.utc) + timedelta(seconds=refreshed["expires_in"])
        supabase.table(TABLE).update(
            {
                "access_token": access_token,
                "access_token_expires_at": new_expires_at.isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", ROW_ID).execute()

    return access_token
