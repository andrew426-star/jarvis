import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import get_settings
from app.core.supabase_client import get_supabase_client
from app.integrations import zoho_mail_api

# Comma-separated — unlike Google/Spotify's space-separated scope strings.
ZOHO_SCOPES = [
    "ZohoMail.accounts.READ",
    "ZohoMail.folders.READ",
    "ZohoMail.messages.READ",
]

STATE_MAX_AGE_SECONDS = 15 * 60
TABLE = "jarvis_zoho_connection"
ROW_ID = "default"


def _state_secret() -> str:
    secret = get_settings().zoho_oauth_state_secret
    if not secret:
        raise RuntimeError("ZOHO_OAUTH_STATE_SECRET is not configured")
    return secret


def generate_oauth_state() -> str:
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


def build_auth_url() -> str:
    settings = get_settings()
    if not settings.zoho_client_id or not settings.zoho_redirect_uri:
        raise RuntimeError("Zoho Mail not configured — Client ID/redirect URI not set yet")
    params = {
        "client_id": settings.zoho_client_id,
        "response_type": "code",
        "redirect_uri": settings.zoho_redirect_uri,
        "scope": ",".join(ZOHO_SCOPES),
        "access_type": "offline",
        "prompt": "consent",  # forces a refresh_token even on a repeat connect
        "state": generate_oauth_state(),
    }
    query = httpx.QueryParams(params)
    return f"https://{settings.zoho_accounts_domain}/oauth/v2/auth?{query}"


def _token_request(data: dict) -> dict:
    settings = get_settings()
    if not settings.zoho_client_id or not settings.zoho_client_secret:
        raise RuntimeError("Zoho Mail not configured — Client ID/Secret not set yet")
    res = httpx.post(
        f"https://{settings.zoho_accounts_domain}/oauth/v2/token",
        data={
            **data,
            "client_id": settings.zoho_client_id,
            "client_secret": settings.zoho_client_secret,
        },
    )
    if not res.is_success:
        raise RuntimeError(f"Zoho token request failed: {res.text}")
    return res.json()


def exchange_code_for_tokens(code: str) -> dict:
    settings = get_settings()
    return _token_request(
        {"grant_type": "authorization_code", "code": code, "redirect_uri": settings.zoho_redirect_uri}
    )


def refresh_access_token(refresh_token: str) -> dict:
    return _token_request({"grant_type": "refresh_token", "refresh_token": refresh_token})


def resolve_account_id(access_token: str) -> tuple[str, str | None]:
    """Called once, in the OAuth callback right after token exchange."""
    accounts = zoho_mail_api.get_accounts(access_token, get_settings().zoho_api_domain)
    if not accounts:
        raise RuntimeError("Zoho returned no mail accounts for this login")
    account = accounts[0]
    email_address = None
    for addr in account.get("emailAddress", []):
        if addr.get("isPrimary"):
            email_address = addr.get("mailId")
            break
    if not email_address and account.get("emailAddress"):
        email_address = account["emailAddress"][0].get("mailId")
    return account["accountId"], email_address


def resolve_inbox_folder_id(access_token: str, account_id: str) -> str | None:
    return zoho_mail_api.get_inbox_folder_id(access_token, get_settings().zoho_api_domain, account_id)


def store_connection(
    tokens: dict, account_id: str, inbox_folder_id: str | None, email_address: str | None
) -> None:
    supabase = get_supabase_client()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=tokens["expires_in"])
    row = {
        "id": ROW_ID,
        "email_address": email_address,
        "account_id": account_id,
        "inbox_folder_id": inbox_folder_id,
        "access_token": tokens["access_token"],
        "access_token_expires_at": expires_at.isoformat(),
        "scope": tokens.get("scope"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # refresh_token is only present on the initial exchange, not on refresh
    # calls — never overwrite a real one with a missing value.
    if tokens.get("refresh_token"):
        row["refresh_token"] = tokens["refresh_token"]
    supabase.table(TABLE).upsert(row).execute()


def get_zoho_connection() -> dict | None:
    """The one function zoho_mail.py calls. Refreshes the access token if
    missing/expiring within 60s (same pattern as get_google_access_token/
    get_spotify_access_token), and lazily re-resolves inbox_folder_id if
    it's missing (e.g. connect-time resolution failed) rather than forcing
    a full reconnect for what's likely a transient lookup failure —
    bounded to one extra GET per call until it succeeds.
    """
    settings = get_settings()
    if not settings.zoho_client_id or not settings.zoho_client_secret:
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

    account_id = connection.get("account_id")
    inbox_folder_id = connection.get("inbox_folder_id")
    if account_id and not inbox_folder_id:
        try:
            inbox_folder_id = resolve_inbox_folder_id(access_token, account_id)
            if inbox_folder_id:
                supabase.table(TABLE).update({"inbox_folder_id": inbox_folder_id}).eq("id", ROW_ID).execute()
        except Exception:  # noqa: BLE001 — leave it None, caller surfaces a clear error
            pass

    return {
        "access_token": access_token,
        "account_id": account_id,
        "inbox_folder_id": inbox_folder_id,
        "email_address": connection.get("email_address"),
    }
