from app.core.config import get_settings
from app.core.spotify_oauth import get_spotify_access_token
from app.integrations import spotify_api
from app.integrations.spotify_api import NoActiveDeviceError


def _ok(operation: str, data) -> dict:
    return {"ok": True, "operation": operation, "data": data}


def _err(operation: str, message: str) -> dict:
    return {"ok": False, "operation": operation, "error": message}


def spotify(args: dict) -> dict:
    operation = args.get("operation")

    if not get_settings().spotify_client_id:
        return _err(str(operation), "Spotify not configured yet")

    try:
        access_token = get_spotify_access_token()
        if not access_token:
            return _err(str(operation), "Spotify not connected — visit /auth/spotify/connect first")

        if operation == "get_now_playing":
            state = spotify_api.get_currently_playing(access_token)
            return _ok(operation, state or {"playing": False})

        if operation == "get_player_state":
            state = spotify_api.get_player_state(access_token)
            return _ok(operation, state or {"active_device": False})

        if operation == "play":
            uris = args.get("track_uris")
            spotify_api.start_playback(access_token, uris)
            return _ok(operation, {"started": True})

        if operation == "pause":
            spotify_api.pause_playback(access_token)
            return _ok(operation, {"paused": True})

        if operation == "next":
            spotify_api.skip_next(access_token)
            return _ok(operation, {"skipped": True})

        if operation == "previous":
            spotify_api.skip_previous(access_token)
            return _ok(operation, {"skipped": True})

        if operation == "queue":
            track_uri = args.get("track_uri")
            if not track_uri:
                return _err(operation, "track_uri is required")
            spotify_api.add_to_queue(access_token, track_uri)
            return _ok(operation, {"queued": track_uri})

        if operation == "search":
            query = args.get("query")
            if not query:
                return _err(operation, "query is required")
            results = spotify_api.search_tracks(access_token, query, int(args.get("max_results") or 5))
            return _ok(operation, results)

        return _err(str(operation), f"Unknown operation: {operation}")
    except NoActiveDeviceError as exc:
        return _err(str(operation), str(exc))
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return _err(str(operation), str(exc))
