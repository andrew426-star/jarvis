import base64
import json

from google.genai import types

from app.core.gemini import generate

# The workshop's `capture` action (app/tools/console_control.py): the camera
# frame itself goes to the model that writes the OpenSCAD, because the agent
# only ever sees the camera through camera_look's text description, and a
# part modelled from a paragraph comes out as a guess. One multimodal call,
# image in, a part out, on the same model ladder as the agent loop.

CAPTURE_BRIEF = (
    "You are modelling a physical object for 3D printing from a live webcam frame. Write an "
    "OpenSCAD program for the part described in the instructions, taken from what is in the "
    "frame: match its outline, proportions, holes, slots, bosses and other features as they "
    "appear. Model the object itself, not the hand holding it or the background.\n\n"
    "Scale: a photo has none of its own. Use any dimensions in the instructions first; failing "
    "that, judge size from things of known size in the frame (a hand, a pen, a phone, a "
    "keyboard key, a USB plug, a ruler), and say in the notes which dimensions are estimates "
    "and from what.\n\n"
    "Reply with JSON only: {{\"name\": short part name, \"notes\": 2-4 short lines of key "
    "dimensions and assumptions, \"code\": the OpenSCAD program}}.\n\n"
    "How to write the program:\n{guide}\n\n"
    "Instructions: {instructions}"
)


def scad_from_frame(image_b64: str, mime: str, instructions: str, guide: str) -> dict:
    """Returns {name, notes, code, model} for the part in the frame."""
    response, model = generate(
        [
            types.Part.from_bytes(data=base64.b64decode(image_b64), mime_type=mime),
            CAPTURE_BRIEF.format(guide=guide, instructions=instructions),
        ],
        types.GenerateContentConfig(
            response_mime_type="application/json",
            # Geometry is worth some thought; "low" is what every model takes.
            thinking_config=types.ThinkingConfig(thinking_level="low"),
        ),
    )
    try:
        data = json.loads(response.text or "")
    except json.JSONDecodeError as exc:
        raise RuntimeError("The model did not return a part.") from exc
    code = str(data.get("code") or "").strip()
    if not code:
        raise RuntimeError("The model returned no OpenSCAD code.")
    notes = data.get("notes") if isinstance(data.get("notes"), list) else []
    return {"name": str(data.get("name") or "Captured part"), "notes": notes, "code": code, "model": model}
