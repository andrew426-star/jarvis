import httpx

PLAYER_BASE = "https://api.spotify.com/v1/me/player"
SEARCH_URL = "https://api.spotify.com/v1/search"


class NoActiveDeviceError(Exception):
    pass


def _headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


def _raise_for_player_error(res: httpx.Response) -> None:
    if res.is_success:
        return
    if res.status_code == 404:
        try:
            reason = res.json().get("error", {}).get("reason")
        except Exception:
            reason = None
        if reason == "NO_ACTIVE_DEVICE":
            raise NoActiveDeviceError("No active Spotify device — open Spotify on a device first")
    raise RuntimeError(f"Spotify player request failed: {res.text}")


def get_player_state(access_token: str) -> dict | None:
    res = httpx.get(PLAYER_BASE, headers=_headers(access_token))
    if res.status_code == 204 or not res.content:
        return None
    if not res.is_success:
        raise RuntimeError(f"Spotify player state fetch failed: {res.text}")
    return res.json()


def get_currently_playing(access_token: str) -> dict | None:
    res = httpx.get(f"{PLAYER_BASE}/currently-playing", headers=_headers(access_token))
    if res.status_code == 204 or not res.content:
        return None
    if not res.is_success:
        raise RuntimeError(f"Spotify currently-playing fetch failed: {res.text}")
    data = res.json()
    return data if data.get("item") else None


def start_playback(access_token: str, uris: list[str] | None = None) -> None:
    body = {"uris": uris} if uris else None
    res = httpx.put(f"{PLAYER_BASE}/play", headers=_headers(access_token), json=body)
    _raise_for_player_error(res)


def pause_playback(access_token: str) -> None:
    res = httpx.put(f"{PLAYER_BASE}/pause", headers=_headers(access_token))
    _raise_for_player_error(res)


def skip_next(access_token: str) -> None:
    # Confirmed: next/previous are POST, unlike play/pause's PUT.
    res = httpx.post(f"{PLAYER_BASE}/next", headers=_headers(access_token))
    _raise_for_player_error(res)


def skip_previous(access_token: str) -> None:
    res = httpx.post(f"{PLAYER_BASE}/previous", headers=_headers(access_token))
    _raise_for_player_error(res)


def add_to_queue(access_token: str, track_uri: str) -> None:
    res = httpx.post(f"{PLAYER_BASE}/queue", headers=_headers(access_token), params={"uri": track_uri})
    _raise_for_player_error(res)


def search_tracks(access_token: str, query: str, limit: int = 5) -> list[dict]:
    res = httpx.get(
        SEARCH_URL,
        headers=_headers(access_token),
        params={"q": query, "type": "track", "limit": limit},
    )
    if not res.is_success:
        raise RuntimeError(f"Spotify search failed: {res.text}")
    items = res.json().get("tracks", {}).get("items", [])
    return [
        {
            "uri": t["uri"],
            "name": t["name"],
            "artists": [a["name"] for a in t.get("artists", [])],
            "album": t.get("album", {}).get("name"),
        }
        for t in items
    ]
