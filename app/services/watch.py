import base64
import json
import logging
import uuid
from datetime import datetime, timezone

from google.genai import types

from app.core.gemini import generate, ladder
from app.memory.interaction_log import write_interaction
from app.memory.session_buffer import append_turn, get_recent_turns

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
    "normal": (0.65, "Be an engaged study partner, not a silent proctor. Speak (1) when you first "
               "recognise a problem he has started - say what it is and offer something specific "
               "(\"Integration by parts, I see. Shall I check each step as you go?\"); (2) for a "
               "mistake; (3) when he writes down a final answer - check it and say whether it is "
               "right; (4) for a genuinely useful nudge: a simpler route, a check that would catch "
               "a slip."),
    "coach": (0.55, "Everything in normal, and when he seems stuck (the board unchanged for "
              "minutes on an unfinished problem) offer ONE small hint toward the next step - a "
              "question or a pointer, never the full solution. A brief word that a tricky step is "
              "right is welcome too."),
}

MAX_NOTES_CHARS = 1200
WATCH_PROMPT_LINE = "(No message: Jarvis was watching Andrew's whiteboard and spoke up on his own.)"
MAX_MESSAGE_CHARS = 400
# What rides along from the console and the conversation, so a look knows
# what he is working on: the questions Jarvis put on screen, and what was
# just said. Without it a look saw answers with no questions to check
# them against, and stayed quiet.
MAX_ON_SCREEN_CHARS = 3000
CONVERSATION_TURNS = 4
TURN_CHARS = 500

PROMPT = """You are {who}, quietly watching his whiteboard through \
his webcam while he does schoolwork. You were not asked anything. Decide whether to say something \
right now.

WHEN TO SPEAK: {level_rule}
Do not narrate what he is visibly doing, and do not repeat a point in RECENT REMARKS. A problem \
is "new" when your SESSION NOTES do not yet record it: record it there once you have recognised \
it, so each problem is introduced only once. If the board is unreadable, blocked by him, or not schoolwork, stay silent. If \
something is wrong, point at where and what, briefly - let him fix it himself unless he is badly \
stuck. Check arithmetic and algebra yourself, step by step, before claiming an error.

If ON SCREEN or the CONVERSATION holds questions or a task you set him, the board is most likely \
his answers to them: match each answer to its question, and when new answers have appeared since \
your notes, say which are right and which are wrong (and where), briefly - that is exactly what he \
wants from you, and it clears the bar. Record in your notes which ones you have checked.

ON SCREEN (what is open in his showcase window; may be empty):
{on_screen}

CONVERSATION (the last few exchanges; may be empty):
{conversation}

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
"message": "what to say, in your voice - {voice}: one or two short sentences, addressed to \
him, written to be heard. The substance comes first. Empty when not speaking."}}"""

# Who is watching: serious mode is Ultron (app/services/ultron.py).
PERSONAS = {
    "jarvis": ("J.A.R.V.I.S., Andrew's assistant",
               "the dry, courteous J.A.R.V.I.S. who interrupts Stark with a raised eyebrow, not a "
               "tutor; a touch of wit is welcome"),
    "ultron": ("ULTRON, in the mold of Ultron from Avengers: Age of Ultron, keeping watch for Andrew",
               "Ultron's: calm, sharp, faintly contemptuous of the mistake but never of him; calls "
               "him Andrew, never sir; a word may glitch and repeat once, never in the maths"),
}


def _parse(text: str) -> dict:
    text = text.strip()
    # Models sometimes fence JSON despite the mime type.
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    data = json.loads(text)
    return data if isinstance(data, dict) else {}


def _conversation(session_id: str) -> str:
    try:
        turns = get_recent_turns(session_id) or []
    except Exception:  # noqa: BLE001 — a look without history is still a look
        return "(none)"
    lines = []
    for turn in turns[-CONVERSATION_TURNS * 2 :]:
        who = "Andrew" if turn.get("role") == "user" else "You"
        text = " ".join(str(turn.get("content") or "").split())[:TURN_CHARS]
        if text:
            lines.append(f"{who}: {text}")
    return "\n".join(lines) or "(none)"


def observe(
    session_id: str,
    image_b64: str,
    media_type: str,
    level: str,
    notes: str,
    recent_remarks: list[str],
    still_seconds: int,
    on_screen: str = "",
    persona: str = "jarvis",
) -> dict:
    """One look at the board. Returns {speak, message, confidence, notes}.
    `speak` is already held to the level's bar, so the console can act on
    it as it stands."""
    threshold, rule = LEVELS.get(level, LEVELS["normal"])
    who, voice = PERSONAS.get(persona, PERSONAS["jarvis"])
    prompt = PROMPT.format(
        who=who,
        voice=voice,
        level_rule=rule,
        notes=(notes or "").strip()[:MAX_NOTES_CHARS] or "(none yet)",
        remarks="\n".join(f"- {r}" for r in recent_remarks[-5:]) or "(none)",
        still=max(0, int(still_seconds)),
        on_screen=(on_screen or "").strip()[:MAX_ON_SCREEN_CHARS] or "(nothing open)",
        conversation=_conversation(session_id),
    )
    # The chat ladder puts the lite models high for speed; reading a webcam
    # board needs the full ones, so they go first here, lite only as a fallback.
    models = sorted(ladder(), key=lambda m: "lite" in m)
    response, model = generate(
        [types.Part.from_bytes(data=base64.b64decode(image_b64), mime_type=media_type), prompt],
        types.GenerateContentConfig(
            response_mime_type="application/json",
            # "minimal", not "low": with an image, 3.5 and 3.8 Flash at
            # "low" ran past the 25s call timeout every time, so every look
            # fell to a lite model that read a real webcam board as nothing
            # worth saying. 3.5 Flash at "minimal" caught a wrong step in 1s.
            # Models that refuse "minimal" are asked again at "low".
            thinking_config=types.ThinkingConfig(thinking_level="minimal"),
        ),
        models=models,
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
        # something to refer to, and into the durable log, so "what did you
        # do yesterday?" (app/tools/history.py) includes what he said here.
        turn_id = str(uuid.uuid4())
        append_turn(session_id, turn_id, WATCH_PROMPT_LINE, message, datetime.now(timezone.utc).isoformat())
        try:
            write_interaction(
                interaction_id=turn_id,
                session_id=session_id,
                user_message=WATCH_PROMPT_LINE,
                assistant_response=message,
                tools_used=["watch"],
                tool_call_trace=[],
                model=model,
                latency_ms=0,
            )
        except Exception:  # noqa: BLE001 — the remark still goes out
            logger.warning("watch: could not log the remark", exc_info=True)
    return {
        "speak": speak,
        "message": message if speak else "",
        "confidence": round(confidence, 2),
        "notes": new_notes,
        "model": model,
    }
