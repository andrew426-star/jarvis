import base64

from google.genai import types

from app.core.config import get_settings
from app.core.gemini import generate

# Photoreal renders of workshop parts: Gemini's image models restyle a clean
# snapshot of the workshop view (the part in solid mode on a plain
# background). An API stand-in for Veras, which has none. The prompt pins
# the geometry down, so the render changes materials, light and setting,
# never the part - a housing whose render moved its USB opening would be
# worse than no render.

RENDER_BRIEF = (
    "This is a screenshot of a 3D CAD part in a design tool. Render it as a photorealistic "
    "photograph. Keep the object's exact shape, proportions, wall thicknesses, holes, slots, "
    "posts and openings, and keep the camera angle and framing; change only materials, surface "
    "finish, lighting and the setting around it. Do not add, remove or move any feature of the "
    "part. No text or labels in the image.\n\nArt direction: {direction}"
)
DEFAULT_DIRECTION = (
    "a matte dark-grey 3D-printed PLA part with faint layer lines, on a clean desk, soft window "
    "light, shallow depth of field"
)


def render_image(image_b64: str, mime: str, direction: str | None) -> dict:
    """Returns {image (base64), mime, model, note} for the rendered view."""
    return _image(
        [
            types.Part.from_bytes(data=base64.b64decode(image_b64), mime_type=mime),
            RENDER_BRIEF.format(direction=(direction or DEFAULT_DIRECTION).strip()[:600]),
        ]
    )


# For the showcase window (app/tools/showcase.py): a picture from a
# description, or from the camera frame when it should follow the board.
IMAGE_BRIEF = (
    "Create the image described below. Clean and legible: if it is a diagram, graph or figure, "
    "draw it crisply on a plain background with clear labels spelled exactly as given.{reference}"
    "\n\nDescription: {prompt}"
)
REFERENCE_NOTE = (
    " The attached photo is the user's whiteboard or desk, taken just now; use what is on it as "
    "the source, and redraw it rather than photographing it again."
)


def generate_image(prompt: str, reference_b64: str | None = None, reference_mime: str = "image/jpeg") -> dict:
    """Returns {image (base64), mime, model, note}."""
    contents: list = []
    if reference_b64:
        contents.append(types.Part.from_bytes(data=base64.b64decode(reference_b64), mime_type=reference_mime))
    contents.append(IMAGE_BRIEF.format(prompt=prompt, reference=REFERENCE_NOTE if reference_b64 else ""))
    return _image(contents)


def _image(contents: list) -> dict:
    settings = get_settings()
    models = [m.strip() for m in settings.gemini_image_models.split(",") if m.strip()]
    response, model = generate(
        contents,
        types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
        models=models,
    )
    image = None
    note = []
    for part in (response.candidates[0].content.parts if response.candidates and response.candidates[0].content else None) or []:
        if part.inline_data and part.inline_data.data and image is None:
            image = part.inline_data
        elif part.text and not part.thought:
            note.append(part.text)
    if image is None:
        raise RuntimeError(" ".join(note).strip() or "The image model returned no image.")
    return {
        "image": base64.b64encode(image.data).decode(),
        "mime": image.mime_type or "image/png",
        "model": model,
        "note": " ".join(note).strip()[:400],
    }
