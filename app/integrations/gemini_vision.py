import base64

from google.genai import types

from app.core.gemini import generate

VISION_PROMPT = (
    "You are the eyes of a personal assistant. The image is a live frame from the user's "
    "webcam, taken just now. Describe what is actually visible that bears on the question "
    "below, concretely: objects, what the user is holding or pointing at, the setting, and "
    "any readable text quoted exactly. Say plainly when something is blurry, cut off or "
    "uncertain rather than guessing. Do not identify people by name or speculate about "
    "anyone's identity, age or other personal traits. Plain text, a few sentences, no "
    "preamble.\n\nQuestion: {question}"
)


def describe_frame(image_b64: str, media_type: str, question: str) -> str:
    """What Gemini sees in one camera frame, as it bears on `question`.
    Same model ladder as the agent loop, so a look never fails just
    because the preferred model is out of quota."""
    response, _model = generate(
        [
            types.Part.from_bytes(data=base64.b64decode(image_b64), mime_type=media_type),
            VISION_PROMPT.format(question=question),
        ],
        # Perception, not deliberation: minimal thinking keeps a look fast.
        types.GenerateContentConfig(thinking_config=types.ThinkingConfig(thinking_level="low")),
    )
    text = (response.text or "").strip()
    if not text:
        raise RuntimeError("The vision model returned no description.")
    return text
