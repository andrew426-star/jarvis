import base64
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import get_settings
from app.core.supabase_client import get_supabase_client

SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"

# user-read-private is only needed for display_name on /v1/me, so the
# connect confirmation page can say "Connected as X" like Google's does.
SPOTIFY_SCOPES = [
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "user-read-private",
]

STATE_MAX_AGE_SECONDS = 15 * 60
TABLE = "jarvis_spotify_connection"
ROW_ID = "default"


def _state_secret() -> str:
    secret = get_settings().spotify_oauth_state_secret
    if not secret:
        raise RuntimeError("SPOTIFY_OAUTH_STATE_SECRET is not configured")
    return secret


def generate_oauth_state() -> str:
    # Own HMAC-signed nonce+timestamp, same stateless scheme as
    # google_oauth.py — but its own secret, not shared with Google's (no
    # reason to couple two unrelated services' CSRF secrets).
    nonce = secrets.token_urlsafe(16)
    ts = str(int(time.time()))
    payload = f"{nonce}.{ts}"
    sig = hmac.new(_state_secret().encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_oauth_state(state: str) -> bool:
    parts = state.split(".")
    if len(parts) != 3:
        return False
    nonce, ts, sig = parts
    payload = f"{nonce}.{ts}"
    expected = hmac.new(_state_secret().encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return False
    try:
        age = int(time.time()) - int(ts)
    except ValueError:
        return False
    return 0 <= age <= STATE_MAX_AGE_SECONDS


def _basic_auth_header() -> dict:
    settings = get_settings()
    if not settings.spotify_client_id or not settings.spotify_client_secret:
        raise RuntimeError("Spotify not configured — Client ID/Secret not set yet")
    raw = f"{settings.spotify_client_id}:{settings.spotify_client_secret}".encode()
    return {"Authorization": f"Basic {base64.b64encode(raw).decode()}"}


def build_auth_url() -> str:
    settings = get_settings()
    if not settings.spotify_client_id or not settings.spotify_redirect_uri:
        raise RuntimeError("Spotify not configured — Client ID/redirect URI not set yet")
    params = {
        "client_id": settings.spotify_client_id,
        "response_type": "code",
        "redirect_uri": settings.spotify_redirect_uri,
        "scope": " ".join(SPOTIFY_SCOPES),
        "state": generate_oauth_state(),
    }
    query = httpx.QueryParams(params)
    return f"{SPOTIFY_AUTH_URL}?{query}"


def exchange_code_for_tokens(code: str) -> dict:
    settings = get_settings()
    # Spotify authenticates via a Basic auth header, not body-embedded
    # client_id/secret the way Google's token endpoint does — a real
    # structural difference, not a copy-paste from google_oauth.py.
    res = httpx.post(
        SPOTIFY_TOKEN_URL,
        headers=_basic_auth_header(),
        data={"grant_type": "authorization_code", "code": code, "redirect_uri": settings.spotify_redirect_uri},
    )
    if not res.is_success:
        raise RuntimeError(f"Spotify token exchange failed: {res.text}")
    return res.json()


def refresh_access_token(refresh_token: str) -> dict:
    res = httpx.post(
        SPOTIFY_TOKEN_URL,
        headers=_basic_auth_header(),
        data={"grant_type": "refresh_token", "refresh_token": refresh_token},
    )
    if not res.is_success:
        raise RuntimeError(f"Spotify token refresh failed: {res.text}")
    return res.json()


def fetch_spotify_profile(access_token: str) -> dict:
    res = httpx.get("https://api.spotify.com/v1/me", headers={"Authorization": f"Bearer {access_token}"})
    if not res.is_success:
        return {}
    data = res.json()
    return {"id": data.get("id"), "display_name": data.get("display_name")}


def store_connection(tokens: dict, profile: dict) -> None:
    supabase = get_supabase_client()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=tokens["expires_in"])
    row = {
        "id": ROW_ID,
        "spotify_user_id": profile.get("id"),
        "display_name": profile.get("display_name"),
        "access_token": tokens["access_token"],
        "access_token_expires_at": expires_at.isoformat(),
        "scope": tokens.get("scope"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # Spotify may omit refresh_token on refresh calls — never overwrite a
    # real one with a missing value (same defensive handling as Google's).
    if tokens.get("refresh_token"):
        row["refresh_token"] = tokens["refresh_token"]
    supabase.table(TABLE).upsert(row).execute()


def get_spotify_access_token() -> str | None:
    settings = get_settings()
    if not settings.spotify_client_id or not settings.spotify_client_secret:
        return None

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
