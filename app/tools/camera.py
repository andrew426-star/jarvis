import re
from collections.abc import Callable

from app.core.gemini import AllModelsExhausted, GeminiNotConfigured
from app.integrations.gemini_vision import describe_frame

# Only offered to the model on turns where the console sent a frame (the camera
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
    "look did not report.\n"
    "CHECKING HIS ANSWERS: his answers are whatever a camera_look in THIS reply read off "
    "the board - never ones you expect him to have written. The questions are the ones you "
    "set him, word for word, from the showcase window in CONSOLE_STATE or the conversation - "
    "never new ones. Match by number. Where the look could not read an answer, say so for "
    "that number instead of guessing; if you cannot find the questions, say that and ask."
)

# A message asking for his written work to be checked. The look is taken
# before the model runs, so a model that would skip camera_look (lite ones
# did, and graded answers it invented) still answers from the board.
CHECK_WORK = re.compile(
    r"\b(check|grade|mark|score|review|go over|correct)\b.*\b(answers?|work|board|responses?|solutions?|quiz)\b"
    r"|\b(grade|mark) (this|that|it|me)\b|\bhow did i do\b|\bdid i get\b",
    re.IGNORECASE,
)
CHECK_WORK_LOOK = (
    "Transcribe exactly what is handwritten on the board or paper, item by item, keeping his "
    "numbering. Copy each answer as written, mistakes included - do not correct, complete or "
    "interpret it. Mark an item [unreadable] or [blocked] where you cannot read it, and list "
    "numbers that seem to be missing."
)


def make_camera_look(image_b64: str, media_type: str) -> Callable[[dict], dict]:
    """A camera_look handler bound to this request's frame. The frame is
    never stored: it lives only as long as this closure, which is one turn."""

    def camera_look(args: dict) -> dict:
        question = (args.get("question") or "What is in front of the camera?").strip()
        try:
            return {"ok": True, "description": describe_frame(image_b64, media_type, question)}
        except GeminiNotConfigured as exc:
            return {"ok": False, "error": str(exc)}
        except AllModelsExhausted:
            return {"ok": False, "error": "Every vision model is at its free-tier limit right now."}

    return camera_look
