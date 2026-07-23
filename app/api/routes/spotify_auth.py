from fastapi import APIRouter
from fastapi.responses import HTMLResponse, RedirectResponse

from app.core.spotify_oauth import (
    build_auth_url,
    exchange_code_for_tokens,
    fetch_spotify_profile,
    store_connection,
    verify_oauth_state,
)

router = APIRouter()


@router.get("/auth/spotify/connect")
def spotify_connect():
    try:
        return RedirectResponse(build_auth_url())
    except RuntimeError as exc:
        return HTMLResponse(f"<h1>Cannot connect</h1><p>{exc}</p>", status_code=503)


@router.get("/auth/spotify/callback")
def spotify_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return HTMLResponse(f"<h1>Connection failed</h1><p>{error}</p>", status_code=400)
    if not code or not state or not verify_oauth_state(state):
        return HTMLResponse("<h1>Connection failed</h1><p>Invalid or expired request.</p>", status_code=400)

    try:
        tokens = exchange_code_for_tokens(code)
        if not tokens.get("refresh_token"):
            return HTMLResponse(
                "<h1>Connection failed</h1><p>Spotify didn't return a refresh token — try again.</p>",
                status_code=400,
            )
        profile = fetch_spotify_profile(tokens["access_token"])
        store_connection(tokens, profile)
    except Exception as exc:  # noqa: BLE001
        return HTMLResponse(f"<h1>Connection failed</h1><p>{exc}</p>", status_code=500)

    name = profile.get("display_name") or profile.get("id") or "your account"
    return HTMLResponse(f"<h1>Connected to Spotify as {name}</h1><p>You can close this tab.</p>")
