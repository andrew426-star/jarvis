import re

import httpx

ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"

_BOLD_ITALIC = re.compile(r"[*_]{1,3}(.+?)[*_]{1,3}")
_HEADER = re.compile(r"^#{1,6}\s*", flags=re.MULTILINE)
_BULLET = re.compile(r"^[ \t]*[-*+][ \t]+", flags=re.MULTILINE)
_NUMBERED = re.compile(r"^[ \t]*\d+[.)][ \t]+", flags=re.MULTILINE)
_INLINE_CODE = re.compile(r"`([^`]*)`")
_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")


# Defense-in-depth behind SYSTEM_PROMPT's own "no markdown, this is read
# aloud" instruction — a prompt instruction is probabilistic; this isn't.
# Strips the formatting marks that read the worst aloud (asterisks,
# headers, bullet/numbered-list markers, backticks, markdown links) before
# anything reaches ElevenLabs, regardless of whether the model complied.
def strip_markdown_for_speech(text: str) -> str:
    text = _MD_LINK.sub(r"\1", text)
    text = _INLINE_CODE.sub(r"\1", text)
    text = _HEADER.sub("", text)
    text = _BULLET.sub("", text)
    text = _NUMBERED.sub("", text)
    text = _BOLD_ITALIC.sub(r"\1", text)
    return text.strip()


def text_to_speech(text: str, voice_id: str, api_key: str, model_id: str) -> bytes:
    res = httpx.post(
        f"{ELEVENLABS_BASE}/text-to-speech/{voice_id}",
        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
        json={"text": strip_markdown_for_speech(text), "model_id": model_id},
        timeout=30.0,
    )
    if not res.is_success:
        raise RuntimeError(f"ElevenLabs text-to-speech failed: {res.text}")
    return res.content
