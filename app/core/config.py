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

    # Same Alpaca paper-trading keys kiv-console already uses.
    alpaca_api_key_id: str
    alpaca_secret_key: str
    alpaca_api_base_url: str = "https://paper-api.alpaca.markets"

    # Same live Stripe key kiv-console already uses — read-only endpoints
    # only (balance/balance_transactions), nothing here can charge/refund.
    stripe_secret_key: str

    # Jarvis's own real GitHub repo — config-driven (not hardcoded) since a
    # fine-grained PAT is repo-scoped at creation and this wasn't confirmed
    # against the token's actual scope ahead of time.
    github_token: str
    github_repo_owner: str = "andrew426-star"
    github_repo_name: str = "jarvis"

    # Same NewsAPI key kiv-console already uses, reused rather than fresh.
    newsapi_key: str

    # Spotify — genuinely optional. Unlike every other integration above,
    # a missing Spotify credential must never fail the whole app's boot,
    # so these stay Optional even though real values already exist.
    spotify_client_id: str | None = None
    spotify_client_secret: str | None = None
    spotify_redirect_uri: str | None = None
    spotify_oauth_state_secret: str | None = None

    # ElevenLabs TTS — optional for the same reason as Spotify above:
    # credentials aren't in hand yet, and a missing one must not break the
    # already-running app's boot. elevenlabs_voice_id has no hardcoded
    # fallback on purpose (voice choice is Andrew's call, not a guessable
    # default) — /speak returns a clear "not configured" error if either
    # is unset, rather than the app failing to start.
    elevenlabs_api_key: str | None = None
    elevenlabs_voice_id: str | None = None
    elevenlabs_model_id: str = "eleven_flash_v2_5"


@lru_cache
def get_settings() -> Settings:
    return Settings()
