import itertools
import logging
import re
import threading
import time
from datetime import datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

import httpx
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
# A call that has not answered in this long is abandoned for the next
# model rather than left to hang the turn. For a stream this bounds the
# wait for each chunk, so it also catches a stream that stalls midway.
CALL_TIMEOUT_MS = 25_000


class GeminiNotConfigured(RuntimeError):
    pass


class OutOfTime(RuntimeError):
    """The turn's deadline passed before any model answered."""


class AllModelsExhausted(RuntimeError):
    def __init__(self, retry_at: float):
        self.retry_at = retry_at
        super().__init__("Every Gemini model is out of quota.")


_lock = threading.Lock()
_cooling: dict[str, float] = {}  # model -> time.time() it is usable again
# Models that refused the configured thinking level and had to be asked at
# "low". Measured: "low" is what makes a call slow (3.6-flash took 1.2s at
# "minimal" and 16.7s at "low" for the same request), so these go to the
# back of the ladder rather than leading it.
_slow_thinkers: set[str] = set()


@lru_cache
def get_gemini_client() -> genai.Client:
    key = get_settings().gemini_api_key
    if not key:
        raise GeminiNotConfigured("GEMINI_API_KEY is not set.")
    return genai.Client(api_key=key, http_options=types.HttpOptions(timeout=CALL_TIMEOUT_MS))


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


def rest(model: str, seconds: float = OVERLOADED_COOLDOWN) -> None:
    """Take a model off the ladder for a while, for a failure seen outside
    generate()/generate_stream(), such as a stream that died midway."""
    with _lock:
        _cooling[model] = max(_cooling.get(model, 0), time.time() + seconds)


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
    models: list[str] | None = None,
):
    """generate_content on the best available model. Returns (response,
    model). `prefer` tries that model first. `only` allows that model and
    no other, for a turn whose history is bound to it; if it is out of
    quota this raises AllModelsExhausted instead of falling through."""
    client = get_gemini_client()
    # `models` swaps in a different ladder (the image models) with the same
    # quota handling.
    candidates = models or ladder()
    models = candidates
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
        except httpx.TimeoutException:
            with _lock:
                _cooling[model] = time.time() + OVERLOADED_COOLDOWN
            logger.warning("Gemini %s timed out; resting %.0fs", model, OVERLOADED_COOLDOWN)

    with _lock:
        retry_at = min((_cooling.get(m, 0) for m in candidates), default=time.time() + MINUTE_COOLDOWN)
    raise AllModelsExhausted(retry_at)


def _with_thinking(config: types.GenerateContentConfig, level: str) -> types.GenerateContentConfig:
    return config.model_copy(update={"thinking_config": types.ThinkingConfig(thinking_level=level)})


def _open_stream(client: genai.Client, model: str, contents, config: types.GenerateContentConfig):
    """The model's stream with its first chunk already pulled, since quota
    and bad-request errors only surface there. A model that does not take
    the configured thinking level is asked again at "low", which every
    thinking model accepts."""

    def opened(cfg):
        chunks = client.models.generate_content_stream(model=model, contents=contents, config=cfg)
        try:
            first = next(chunks)
        except StopIteration:
            return iter(())
        return itertools.chain([first], chunks)

    try:
        return opened(config)
    except errors.APIError as exc:
        level = config.thinking_config.thinking_level if config.thinking_config else None
        if exc.code != 400 or "thinking" not in str(exc).lower() or level in (None, "low", types.ThinkingLevel.LOW):
            raise
        logger.warning("Gemini %s rejected thinking level %s; retrying at low", model, level)
        with _lock:
            _slow_thinkers.add(model)
        return opened(_with_thinking(config, "low"))


def generate_stream(
    contents,
    config: types.GenerateContentConfig,
    prefer: str | None = None,
    only: str | None = None,
    deadline: float | None = None,
):
    """generate_content_stream on the same ladder as generate(). Returns
    (chunks, model). Quota errors surface on the first chunk, so that one
    is pulled here, inside the fallback, and chained back on the front.

    `deadline` (time.monotonic()) stops the ladder from starting another
    model once it has passed: a turn that has already waited that long is
    better answered with an apology than kept waiting for the next model.
    Raises OutOfTime then."""
    client = get_gemini_client()
    with _lock:
        # Stable: the configured order holds within each group.
        models = sorted(ladder(), key=lambda m: m in _slow_thinkers)
    if only:
        models = [only]
    elif prefer in models:
        models = [prefer] + [m for m in models if m != prefer]

    for model in models:
        if deadline is not None and time.monotonic() > deadline:
            raise OutOfTime()
        with _lock:
            if _cooling.get(model, 0) > time.time():
                continue
        try:
            return _open_stream(client, model, contents, config), model
        except errors.APIError as exc:
            rest = _cooldown_for(exc)
            if rest is None:
                raise
            with _lock:
                _cooling[model] = time.time() + rest
            logger.warning("Gemini %s unavailable (%s); resting %.0fs", model, exc.code, rest)
        except httpx.TimeoutException:
            with _lock:
                _cooling[model] = time.time() + OVERLOADED_COOLDOWN
            logger.warning("Gemini %s timed out; resting %.0fs", model, OVERLOADED_COOLDOWN)

    with _lock:
        retry_at = min((_cooling.get(m, 0) for m in ladder()), default=time.time() + MINUTE_COOLDOWN)
    raise AllModelsExhausted(retry_at)
