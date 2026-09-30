from functools import lru_cache

import anthropic

from app.core.config import get_settings

# Anthropic's recommended substitute, picked per refusal category. A camera
# frame of someone's desk is about as benign as input gets, but a declined
# look should still come back as an answer rather than a dead end.
FALLBACK_BETA = "server-side-fallback-2026-07-01"

VISION_PROMPT = (
    "You are the eyes of a personal assistant. The image is a live frame from the user's "
    "webcam, taken just now. Describe what is actually visible that bears on the question "
    "below, concretely: objects, what the user is holding or pointing at, the setting, and "
    "any readable text quoted exactly. Say plainly when something is blurry, cut off or "
    "uncertain rather than guessing. Do not identify people by name or speculate about "
    "anyone's identity, age or other personal traits. Plain text, a few sentences, no "
    "preamble.\n\nQuestion: {question}"
)


class VisionNotConfigured(RuntimeError):
    pass


@lru_cache
def _client() -> anthropic.Anthropic:
    key = get_settings().anthropic_api_key
    if not key:
        raise VisionNotConfigured("Camera vision is not configured: set ANTHROPIC_API_KEY.")
    # A look happens mid-conversation, so a stalled request should fail
    # fast enough for Jarvis to say so instead of hanging the turn.
    return anthropic.Anthropic(api_key=key, timeout=45.0, max_retries=1)


def describe_frame(image_b64: str, media_type: str, question: str) -> str:
    """What Claude sees in one camera frame, as it bears on `question`."""
    response = _client().beta.messages.create(
        model=get_settings().vision_model,
        max_tokens=2048,
        # Perception, not deliberation: low effort keeps a look to a
        # couple of seconds, which is what a spoken exchange can afford.
        output_config={"effort": "low"},
        betas=[FALLBACK_BETA],
        extra_body={"fallbacks": "default"},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": image_b64},
                    },
                    {"type": "text", "text": VISION_PROMPT.format(question=question)},
                ],
            }
        ],
    )

    if response.stop_reason == "refusal":
        raise RuntimeError("The vision model declined to describe this frame.")
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if not text:
        raise RuntimeError("The vision model returned no description.")
    return text
