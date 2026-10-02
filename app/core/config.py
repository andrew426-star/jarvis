from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Groq now only transcribes voice (Whisper). Jarvis's brain and eyes
    # are Gemini, below.
    groq_api_key: str
    groq_whisper_model: str = "whisper-large-v3-turbo"

    # Gemini: the agent loop and camera vision. Optional so a deploy that
    # has not set it yet still boots; /invoke then says what is missing.
    gemini_api_key: str | None = None
    # Best first. app/core/gemini.py uses the first one with quota left and
    # falls down the list on quota errors, so this order is also the order
    # of preference. Free-tier quotas are per model, so every entry adds
    # headroom.
    #
    # Ordered by measured speed, not version: 3.6-flash and the flash-lite
    # models take "minimal" thinking and answered in 0.5-2.5s; 3.8 and 3.7
    # refuse "minimal", run at "low" and took 7-30s or reported overload
    # (Oct 2026). gemini.py also demotes any model that refuses the level.
    gemini_models: str = (
        "gemini-3.6-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite,"
        "gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash"
    )
    # Image models for workshop renders (app/integrations/gemini_render.py),
    # best first, on the same quota-aware fallback.
    # How long the model thinks before answering. "minimal" keeps a spoken
    # exchange quick: at "low", a one-line reply spent nine seconds
    # thinking first. A model that does not offer the level is asked at
    # "low" instead (app/core/gemini.py).
    gemini_thinking_level: str = "minimal"
    gemini_image_models: str = "gemini-3.1-flash-image,gemini-3.1-flash-lite-image,gemini-3-pro-image"

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
    # Every hit rides along on every model call of the turn, so a few
    # short ones (semantic_recall.HIT_CHARS) beat many long ones.
    pinecone_top_k: int = 3
    pinecone_min_score: float = 0.5

    # Same Google Cloud OAuth Client ID/Secret as kiv-console's registration
    # (Andrew added Jarvis's own redirect URI to its allowed list) — a
    # separate consent grant/refresh token from kiv-console's own, stored
    # in jarvis_google_connection, not kiv-console's calendar_connections.
    google_client_id: str
    google_client_secret: str
    google_oauth_state_secret: str

    # Optional, despite the connect flow being unusable without it. It was
    # required once, and a deploy where it went missing crashed the whole
    # service at import — sign-in, chat, panels and voice all died for a
    # setting only /auth/google/connect reads. Failing fast is worth it
    # for config the app cannot run without; this is not that, so the
    # connect route reports it instead and everything else keeps serving.
    google_redirect_uri: str | None = None

    # Sign-in is a SEPARATE Google flow from the connect flow above, and
    # needs its own registered redirect URI. Kept apart deliberately:
    # connect asks for the broad Gmail/Drive/Docs scopes with
    # prompt=consent and stores a refresh token, while login asks only for
    # `openid email` and stores nothing — folding them together would
    # re-consent the world every time someone signs in, and risks a login
    # callback overwriting the service connection's refresh token.
    google_login_redirect_uri: str | None = None

    # Comma-separated addresses allowed to sign in. Fails CLOSED: unset
    # means nobody gets in, so a missing value can't silently turn a
    # public URL into an open one (see app/core/session.py).
    jarvis_allowed_emails: str | None = None

    # HMAC key for the session tokens issued after a successful sign-in.
    # Machine-generated (openssl rand -hex 32), never typed by a human.
    # Rotating it invalidates every existing session at once, which is the
    # intended revocation mechanism.
    jarvis_session_secret: str | None = None

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

    # Zoho Mail — read-only inbox access, optional for the same reason as
    # Spotify above: credentials aren't in hand yet and a missing one must
    # not break boot. zoho_accounts_domain/zoho_api_domain get real
    # defaults (not None) since the US data center is almost certainly
    # correct (Kivaro AI is a Dallas, TX company) — override only if
    # Zoho's API Console shows a different data center (e.g.
    # accounts.zoho.eu/mail.zoho.eu). Note: Zoho's OAuth token response
    # includes its own "api_domain" field, but that's a different, generic
    # zohoapis.<tld> host — not the same as Mail's own mail.zoho.<tld> API
    # host — so it's deliberately not used; these two settings are the
    # single source of truth instead.
    zoho_client_id: str | None = None
    zoho_client_secret: str | None = None
    zoho_redirect_uri: str | None = None
    zoho_oauth_state_secret: str | None = None
    zoho_accounts_domain: str = "accounts.zoho.com"
    zoho_api_domain: str = "mail.zoho.com"

    # Fish Audio TTS — replaced ElevenLabs so Jarvis and Ultron share one
    # provider, one bill and one integration to keep working. Optional for
    # the same reason as Spotify above: a missing credential must not break
    # the already-running app's boot. fish_audio_voice_id is Fish's
    # `reference_id`, which carries a catalogue voice, a Voice Design
    # result or a clone interchangeably — so changing Jarvis's voice is one
    # value, not a second integration. No hardcoded fallback on purpose
    # (the voice is Andrew's call) — /speak returns a clear "not
    # configured" error if either is unset.
    fish_audio_api_key: str | None = None
    fish_audio_voice_id: str | None = None
    # s2.1-pro-free bills at $0.00 per million UTF-8 bytes where
    # s2.1-pro bills $15.00, and it is the only model an empty API
    # credit wallet will serve. Verified returning real audio.
    fish_audio_model: str = "s2.1-pro-free"

    # JARVIS_ACCESS_TOKEN — the ORIGINAL shared-secret gate. Google
    # sign-in (above) is now the console's way in; this stays as the
    # non-browser path, so curl/scripts/smoke tests keep working without
    # running an OAuth flow. Unset it to disable that path entirely.
    # Historical note on the comment below: it predates sign-in, when this
    # was the only gate.
    # shared-secret gate for /invoke and /speak, added
    # to an already-deployed service, so it must stay Optional the same way
    # spotify_*/fish_audio_* are (a missing value can't break boot) — but
    # unlike those, an unset value here does NOT mean "degrade gracefully":
    # app/core/auth.py fails CLOSED (401s everything) until this is set,
    # since this is a security gate being deliberately added, not a
    # pre-existing integration. A human-chosen passphrase Andrew types once
    # into the frontend's login screen (the browser remembers it via
    # localStorage after that) — unlike GOOGLE_OAUTH_STATE_SECRET, which is
    # machine-generated (openssl rand -hex 32) and never typed by a human.
    jarvis_access_token: str | None = None

    # Where the scheduled morning brief (POST /brief/run) is emailed.
    # Optional: unset means the connected Google account's own address,
    # i.e. the brief is sent from Andrew's Gmail to itself.
    jarvis_brief_email: str | None = None

    # CORS only — the frontend's origin (scheme+host, no
    # trailing slash). Optional so the backend still boots before the
    # frontend has a domain; until set, only http://localhost:3000
    # (hardcoded in main.py, for local frontend dev against this deployed
    # backend) can call /invoke or /speak from a browser. Server-to-server/
    # curl calls are unaffected either way — CORS is a browser-enforced
    # restriction, not the actual security boundary (JARVIS_ACCESS_TOKEN
    # above is).
    jarvis_frontend_origin: str | None = None

    # Where sign-in returns the browser. Deliberately NOT
    # jarvis_frontend_origin: that one is a CORS allowance, it long
    # outlives the host it names, and a stale value there silently
    # redirected sign-in to a decommissioned deployment once already.
    # Unset (the production case) means a relative redirect, which is
    # always the host the user actually came from. Set it only for
    # `next dev`, where the console is on :3000 and the API on :8000.
    jarvis_login_return_origin: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
