from functools import lru_cache

from upstash_redis import Redis

from app.core.config import get_settings


@lru_cache
def get_redis_client() -> Redis:
    settings = get_settings()
    return Redis(url=settings.upstash_redis_rest_url, token=settings.upstash_redis_rest_token)
