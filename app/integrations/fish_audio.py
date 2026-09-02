import re

import httpx

FISH_TTS_URL = "https://api.fish.audio/v1/tts"

_BOLD_ITALIC = re.compile(r"[*_]{1,3}(.+?)[*_]{1,3}")
_HEADER = re.compile(r"^#{1,6}\s*", flags=re.MULTILINE)
_BULLET = re.compile(r"^[ \t]*[-*+][ \t]+", flags=re.MULTILINE)
_NUMBERED = re.compile(r"^[ \t]*\d+[.)][ \t]+", flags=re.MULTILINE)
_FENCE = re.compile(r"```[\s\S]*?```")
_INLINE_CODE = re.compile(r"`([^`]*)`")
_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")


def strip_markdown_for_speech(text: str) -> str:
    """Defence in depth behind the system prompt's own "this is read
    aloud" instruction. A prompt instruction is probabilistic; this is
    not.

    Fenced code blocks are dropped entirely rather than flattened.
    Jarvis reads its own repo and quotes diffs back, and reading a block
    of Python aloud is worse than silence about it - the spoken channel
    gets the explanation, the screen gets the code.
    """
    text = _FENCE.sub(" (code shown on screen) ", text)
    text = _MD_LINK.sub(r"\1", text)
    text = _INLINE_CODE.sub(r"\1", text)
    text = _HEADER.sub("", text)
    text = _BULLET.sub("", text)
    text = _NUMBERED.sub("", text)
    text = _BOLD_ITALIC.sub(r"\1", text)
    return text.strip()


def text_to_speech(text: str, voice_id: str, api_key: str, model: str) -> bytes:
    """Fish Audio TTS.

    `reference_id` is Fish's name for the voice; the same field carries a
    catalogue voice, a Voice Design result, or a clone, which is why
    swapping between Ultron and any other voice is one value rather than
    a second integration.

    JSON rather than the msgpack the API also accepts: msgpack buys a
    little bandwidth on a request whose body is a paragraph of text, and
    costs a dependency and a debugging surface.
    """
    res = httpx.post(
        FISH_TTS_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # Model is a header, not a body field, in Fish's API.
            "model": model,
        },
        json={
            "text": strip_markdown_for_speech(text),
            "reference_id": voice_id,
            "format": "mp3",
            "mp3_bitrate": 128,
            # "normal" over "low": low latency trades audio quality, and
            # narration here follows a completed answer rather than
            # streaming alongside one.
            "latency": "normal",
            "normalize": True,
        },
        timeout=60.0,
    )
    if not res.is_success:
        raise RuntimeError(f"Fish Audio text-to-speech failed ({res.status_code}): {res.text}")
    return res.content
