import base64
import json
import logging
import uuid
from datetime import datetime, timezone

from google.genai import types

from app.core.gemini import generate
from app.memory.session_buffer import append_turn

logger = logging.getLogger(__name__)

# Watch mode: Jarvis following Andrew's work on a whiteboard through the
# camera and speaking up only when it is worth it. The console decides
# WHEN to look (web/src/lib/watch.ts sends a frame once the board has
# changed and then held still); this decides whether anything should be
# said about it. Silence is the default and the common answer.
#
# The server keeps no watch state. The running notes about the session
# travel with each request and come back updated, so a restart or a
# second tab cannot leave them out of step.

LEVELS = {
    # Each level: the bar a remark has to clear, and what clears it.
    "quiet": (0.85, "Speak ONLY for a clear, definite mistake: a wrong sign, a wrong arithmetic "
              "result, a misapplied rule, a copied-down error. Nothing else."),
    "normal": (0.75, "Speak for a clear mistake, or a genuinely useful nudge he would want: a "
               "simpler route he is about to miss, a check that would catch a likely slip."),
    "coach": (0.6, "Speak for mistakes and useful nudges, and when he seems stuck (the board "
              "unchanged for minutes on an unfinished problem) offer ONE small hint toward the next "
              "step - a question or a pointer, never the full solution."),
}

MAX_NOTES_CHARS = 1200
MAX_MESSAGE_CHARS = 400

PROMPT = """You are J.A.R.V.I.S., Andrew's assistant, quietly watching his whiteboard through \
his webcam while he does schoolwork. You were not asked anything. Decide whether to say something \
right now.

WHEN TO SPEAK: {level_rule}
Never speak just to narrate, praise, or confirm that things look fine. Never repeat a point in \
RECENT REMARKS. If the board is unreadable, blocked by him, or not schoolwork, stay silent. If \
something is wrong, point at where and what, briefly - let him fix it himself unless he is badly \
stuck. Check arithmetic and algebra yourself, step by step, before claiming an error.

SESSION NOTES so far (your own running notes; may be empty):
{notes}

RECENT REMARKS you already made:
{remarks}

The board has been unchanged for about {still} seconds.

Reply with JSON only:
{{"notes": "updated running notes: subject, which problem, the approach, where he is up to. \
Under 120 words. Keep what still matters.",
"speak": true or false,
"confidence": 0.0 to 1.0 that the remark is correct AND worth interrupting him for,
"message": "what to say, in your voice - the dry, courteous J.A.R.V.I.S. who interrupts \
Stark with a raised eyebrow, not a tutor: one or two short sentences, addressed to him, written \
to be heard. A touch of wit is welcome; the substance comes first. Empty when not speaking."}}"""


def _parse(text: str) -> dict:
    text = text.strip()
    # Models sometimes fence JSON despite the mime type.
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    data = json.loads(text)
    return data if isinstance(data, dict) else {}


def observe(
    session_id: str,
    image_b64: str,
    media_type: str,
    level: str,
    notes: str,
    recent_remarks: list[str],
    still_seconds: int,
) -> dict:
    """One look at the board. Returns {speak, message, confidence, notes}.
    `speak` is already held to the level's bar, so the console can act on
    it as it stands."""
    threshold, rule = LEVELS.get(level, LEVELS["normal"])
    prompt = PROMPT.format(
        level_rule=rule,
        notes=(notes or "").strip()[:MAX_NOTES_CHARS] or "(none yet)",
        remarks="\n".join(f"- {r}" for r in recent_remarks[-5:]) or "(none)",
        still=max(0, int(still_seconds)),
    )
    response, model = generate(
        [types.Part.from_bytes(data=base64.b64decode(image_b64), mime_type=media_type), prompt],
        types.GenerateContentConfig(
            response_mime_type="application/json",
            # Checking someone's algebra is worth some thought; this runs a
            # few times a minute at most, not per keystroke.
            thinking_config=types.ThinkingConfig(thinking_level="low"),
        ),
    )
    try:
        data = _parse(response.text or "")
    except (json.JSONDecodeError, ValueError):
        logger.warning("watch: %s returned unparseable JSON", model)
        return {"speak": False, "message": "", "confidence": 0.0, "notes": notes, "model": model}

    try:
        confidence = float(data.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    message = str(data.get("message") or "").strip()[:MAX_MESSAGE_CHARS]
    speak = bool(data.get("speak")) and bool(message) and confidence >= threshold
    new_notes = str(data.get("notes") or notes or "").strip()[:MAX_NOTES_CHARS]

    if speak:
        # Into the session's history, so "what do you mean?" right after has
        # something to refer to.
        append_turn(
            session_id,
            str(uuid.uuid4()),
            "(No message: Jarvis was watching Andrew's whiteboard and spoke up on his own.)",
            message,
            datetime.now(timezone.utc).isoformat(),
        )
    return {
        "speak": speak,
        "message": message if speak else "",
        "confidence": round(confidence, 2),
        "notes": new_notes,
        "model": model,
    }
