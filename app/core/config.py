from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    groq_api_key: str
    groq_model: str = "openai/gpt-oss-120b"

    supabase_url: str
    supabase_service_role_key: str

    tavily_api_key: str

    upstash_redis_rest_url: str
    upstash_redis_rest_token: str
    redis_session_window_turns: int = 10
    redis_session_ttl_seconds: int = 86400  # 24h sliding TTL

    pinecone_api_key: str
    pinecone_index_name: str = "jarvis-interactions"
    pinecone_namespace: str = "interactions"
    pinecone_embedding_model: str = "llama-text-embed-v2"
    pinecone_dimension: int = 1024
    pinecone_top_k: int = 5
    pinecone_min_score: float = 0.5

    # Same Google Cloud OAuth Client ID/Secret as kiv-console's registration
    # (Andrew added Jarvis's own redirect URI to its allowed list) — a
    # separate consent grant/refresh token from kiv-console's own, stored
    # in jarvis_google_connection, not kiv-console's calendar_connections.
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str
    google_oauth_state_secret: str

    # Same Finnhub key kiv-console already uses, reused rather than fresh.
    finnhub_api_key: str


@lru_cache
def get_settings() -> Settings:
    return Settings()
