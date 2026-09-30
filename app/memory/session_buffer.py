import json
import logging

from app.core.config import get_settings
from app.core.redis_client import get_redis_client

logger = logging.getLogger(__name__)


def _key(session_id: str) -> str:
    return f"jarvis:session:{session_id}"


def append_turn(
    session_id: str,
    interaction_id: str,
    user_message: str,
    assistant_response: str,
    created_at: str,
) -> None:
    """Tier 1 (Redis) write — sliding window of recent turns for fast recall.

    Never raises: a Redis outage should mean "less context next turn," not a
    failed request (mirrors database_agent/web_research's "never raise" tool
    contract).
    """
    settings = get_settings()
    key = _key(session_id)
    blob = json.dumps(
        {"id": interaction_id, "user": user_message, "assistant": assistant_response, "ts": created_at}
    )
    try:
        redis = get_redis_client()
        redis.lpush(key, blob)
        redis.ltrim(key, 0, settings.redis_session_window_turns - 1)
        # Sliding TTL — an active session stays warm as long as it's used,
        # only cooling off after real inactivity.
        redis.expire(key, settings.redis_session_ttl_seconds)
    except Exception:
        logger.warning("Redis append_turn failed for session %s", session_id, exc_info=True)


def count_turns(session_id: str) -> int | None:
    """How many exchanges Redis holds for this session, which is what the
    next message will be sent with. None if Redis could not be reached."""
    try:
        return int(get_redis_client().llen(_key(session_id)))
    except Exception:
        logger.warning("Redis count_turns failed for session %s", session_id, exc_info=True)
        return None


def get_recent_turns(session_id: str) -> list[dict[str, str]] | None:
    """Tier 1 (Redis) read — last N turns for this session, as chat messages.

    Returns None on failure (caller should fall back to Supabase), or []
    if the key is genuinely missing/expired (caller should also fall back —
    a quiet session shouldn't lose its Supabase history just because Redis's
    TTL passed).
    """
    try:
        redis = get_redis_client()
        raw = redis.lrange(_key(session_id), 0, -1)
    except Exception:
        logger.warning("Redis get_recent_turns failed for session %s", session_id, exc_info=True)
        return None

    if not raw:
        return []

    turns: list[dict[str, str]] = []
    # LRANGE returns newest-first (LPUSH order) — reverse to chronological.
    for blob in reversed(raw):
        try:
            row = json.loads(blob)
        except json.JSONDecodeError:
            continue
        turns.append({"role": "user", "content": row["user"]})
        if row.get("assistant"):
            turns.append({"role": "assistant", "content": row["assistant"]})
    return turns
