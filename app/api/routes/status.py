from fastapi import APIRouter, Depends

from app.core.auth import require_access_token
from app.core.config import get_settings
from app.core.supabase_client import get_supabase_client

router = APIRouter()

# Which integrations exist, where their singleton connection row lives,
# and which column carries the human-readable account identity.
#
# Deliberately a table rather than three near-identical blocks: adding a
# fourth provider should be one line here, not a fourth copy of the same
# try/except.
PROVIDERS = (
    ("google", "jarvis_google_connection", "google_email"),
    ("spotify", "jarvis_spotify_connection", "display_name"),
    ("zoho", "jarvis_zoho_connection", "email_address"),
)

ROW_ID = "default"


def _is_configured(provider: str) -> bool:
    """Whether this deployment has credentials for the provider at all.

    "Not configured" and "not connected" are different problems with
    different fixes - one is an environment variable, the other is an
    OAuth consent screen - so the console should never conflate them.
    """
    settings = get_settings()
    if provider == "google":
        return bool(settings.google_client_id and settings.google_redirect_uri)
    if provider == "spotify":
        return bool(settings.spotify_client_id and settings.spotify_redirect_uri)
    if provider == "zoho":
        return bool(settings.zoho_client_id and settings.zoho_redirect_uri)
    return False


def _read(table: str, identity_column: str) -> dict:
    """Reads one connection row. Never returns a token."""
    supabase = get_supabase_client()
    res = (
        supabase.table(table)
        .select(f"id,{identity_column},refresh_token,updated_at")
        .eq("id", ROW_ID)
        .maybe_single()
        .execute()
    )
    row = res.data if res else None
    if not row:
        return {"status": "disconnected", "account": None, "updated_at": None}

    # A row without a refresh token cannot survive its access token
    # expiring, so it is not a working connection however it looks.
    if not row.get("refresh_token"):
        return {"status": "disconnected", "account": row.get(identity_column), "updated_at": row.get("updated_at")}

    return {
        "status": "connected",
        "account": row.get(identity_column),
        "updated_at": row.get("updated_at"),
    }


@router.get("/status", dependencies=[Depends(require_access_token)])
def status() -> dict:
    """Connection health for the console's Settings panel.

    Authenticated: this reveals which accounts are linked and under which
    address. Returns only presence, identity and recency - no access
    tokens, no refresh tokens, no scopes.
    """
    connections = []
    for provider, table, identity_column in PROVIDERS:
        if not _is_configured(provider):
            connections.append(
                {"provider": provider, "status": "not_configured", "account": None, "updated_at": None}
            )
            continue
        try:
            connections.append({"provider": provider, **_read(table, identity_column)})
        except Exception:  # noqa: BLE001
            # One unreachable table must not take the whole panel down,
            # and "unknown" is honest where "disconnected" would be a
            # guess that reads as a real finding.
            connections.append(
                {"provider": provider, "status": "unknown", "account": None, "updated_at": None}
            )

    return {"ok": True, "connections": connections}
