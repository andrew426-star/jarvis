from collections.abc import Callable

from app.integrations.claude_vision import VisionNotConfigured, describe_frame

# Only offered to Groq on turns where the console sent a frame (the camera
# is on); a turn without one has nothing to look at, so the tool would
# only invite a hallucinated answer.
CAMERA_LOOK_SCHEMA = {
    "type": "function",
    "function": {
        "name": "camera_look",
        "description": (
            "Look through Andrew's webcam at this moment. The camera is on and a frame was "
            "captured when he sent this message. Use it whenever the answer depends on what "
            "is physically in front of the camera: what he is holding or showing you, what "
            "is on his desk or screen, reading a label or page, checking how he looks before "
            "a meeting. Returns a description of the frame. Do not use it for anything the "
            "camera cannot answer."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "What to look for, phrased as a question about the frame.",
                }
            },
            "required": ["question"],
        },
    },
}

CAMERA_ON_NOTE = (
    "CAMERA: Andrew's camera is on for this message, so you can see through it with "
    "camera_look. When a question is about what is in front of him, look rather than "
    "guess, then answer from what the look returned and say what you saw, confidently "
    "where it is clear and plainly where it is not. Never claim to see something the "
    "look did not report."
)


def make_camera_look(image_b64: str, media_type: str) -> Callable[[dict], dict]:
    """A camera_look handler bound to this request's frame. The frame is
    never stored: it lives only as long as this closure, which is one turn."""

    def camera_look(args: dict) -> dict:
        question = (args.get("question") or "What is in front of the camera?").strip()
        try:
            return {"ok": True, "description": describe_frame(image_b64, media_type, question)}
        except VisionNotConfigured as exc:
            return {"ok": False, "error": str(exc)}

    return camera_look
