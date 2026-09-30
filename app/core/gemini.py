import logging
import re
import threading
import time
from datetime import datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

from google import genai
from google.genai import errors, types

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Gemini on the free tier, stretched across several models. Each model has
# its own per-minute and per-day quota, so instead of rotating on a timer
# Jarvis always asks the best model that is not currently out of quota and
# steps down the ladder (GEMINI_MODELS, best first) only when one says so.
# A model that ran out comes back as soon as its quota does: after the
# retry delay Google gives for a per-minute limit, or at midnight Pacific,
# when per-day quotas reset.
#
# State is per process. Render runs one, and a restart only costs one
# wasted call per exhausted model while the ladder relearns.

PACIFIC = ZoneInfo("America/Los_Angeles")

# How long to leave a model alone after each kind of failure.
MINUTE_COOLDOWN = 60.0
OVERLOADED_COOLDOWN = 30.0
# 404/403: the model is gone or not offered on this key's tier. A day is
# long enough not to waste calls on it and short enough to notice if it
# comes back.
UNAVAILABLE_COOLDOWN = 24 * 3600.0


class GeminiNotConfigured(RuntimeError):
    pass


class AllModelsExhausted(RuntimeError):
    def __init__(self, retry_at: float):
        self.retry_at = retry_at
        super().__init__("Every Gemini model is out of quota.")


_lock = threading.Lock()
_cooling: dict[str, float] = {}  # model -> time.time() it is usable again


@lru_cache
def get_gemini_client() -> genai.Client:
    key = get_settings().gemini_api_key
    if not key:
        raise GeminiNotConfigured("GEMINI_API_KEY is not set.")
    return genai.Client(api_key=key)


def ladder() -> list[str]:
    return [m.strip() for m in get_settings().gemini_models.split(",") if m.strip()]


def status() -> list[dict]:
    """Each model and when it is usable again (None = now). For /status."""
    now = time.time()
    with _lock:
        return [
            {"model": m, "available_at": _cooling[m] if _cooling.get(m, 0) > now else None}
            for m in ladder()
        ]


def _next_pacific_midnight() -> float:
    now = datetime.now(PACIFIC)
    midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=5, microsecond=0)
    return midnight.timestamp()


def _cooldown_for(exc: errors.APIError) -> float | None:
    """Seconds-from-now to rest the model, or None if this error is not
    about the model (a bad request would fail on every model alike)."""
    code = exc.code
    text = str(exc)
    if code == 429:
        # Per-day quota: nothing to do until Pacific midnight.
        if re.search(r"PerDay|per.day|RequestsPerDay", text, re.IGNORECASE):
            return _next_pacific_midnight() - time.time()
        delay = re.search(r"retry(?:Delay|\s+in)['\"]?\s*[:=]?\s*['\"]?([\d.]+)s", text, re.IGNORECASE)
        return float(delay.group(1)) + 1 if delay else MINUTE_COOLDOWN
    if code in (403, 404):
        return UNAVAILABLE_COOLDOWN
    if code in (500, 502, 503, 504):
        return OVERLOADED_COOLDOWN
    return None


def generate(
    contents,
    config: types.GenerateContentConfig,
    prefer: str | None = None,
    only: str | None = None,
):
    """generate_content on the best available model. Returns (response,
    model). `prefer` tries that model first. `only` allows that model and
    no other, for a turn whose history is bound to it; if it is out of
    quota this raises AllModelsExhausted instead of falling through."""
    client = get_gemini_client()
    models = ladder()
    if only:
        models = [only]
    elif prefer in models:
        models = [prefer] + [m for m in models if m != prefer]

    for model in models:
        with _lock:
            if _cooling.get(model, 0) > time.time():
                continue
        try:
            return client.models.generate_content(model=model, contents=contents, config=config), model
        except errors.APIError as exc:
            rest = _cooldown_for(exc)
            if rest is None:
                raise
            with _lock:
                _cooling[model] = time.time() + rest
            logger.warning("Gemini %s unavailable (%s); resting %.0fs", model, exc.code, rest)

    with _lock:
        retry_at = min((_cooling.get(m, 0) for m in ladder()), default=time.time() + MINUTE_COOLDOWN)
    raise AllModelsExhausted(retry_at)
