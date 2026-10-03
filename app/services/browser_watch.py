import json
import logging
import threading
import time
import uuid
from datetime import datetime, timezone

from google.genai import types

from app.core.gemini import generate
from app.memory.session_buffer import append_turn
from app.core.local_time import now_for_prompt
from app.services.situation import schedule_line

logger = logging.getLogger(__name__)

# Following Andrew's browser and speaking up on his own: the browser
# counterpart of the whiteboard watch (app/services/watch.py). The extension
# decides WHEN to ask (a page that has settled after real change); this
# decides whether anything is worth saying, from the page's text - far
# cheaper and more exact than a screenshot. The remark comes back over the
# link and appears in a bubble on the page, spoken.
#
# Notes, remarks and the cooldown live here, in memory, for the one link.

LEVELS = {
    "quiet": (0.85, 4 * 60, "Speak ONLY for something clearly wrong that he would want to know now: an "
              "error on the page he may have missed, a factual or arithmetic mistake in what he is "
              "writing, a form he is about to submit with a problem in it."),
    "normal": (0.65, 75, "Be a useful colleague looking over his shoulder, not a narrator. Speak (1) the "
               "first time you recognise a task you can genuinely help with on this page - say what "
               "you see and offer something specific (\"That's the lab 4 rubric. Shall I check your "
               "draft against it?\"); (2) for a mistake or a problem he may have missed; (3) when "
               "something on the page bears on what you know of his plans (a deadline, his classes, "
               "the Kivaro launch); (4) for a clearly better way to do what he is doing."),
    "coach": (0.55, 60, "Everything in normal, and when he seems stuck (the same page, unfinished work, "
              "for minutes) offer ONE pointer toward the next step rather than the answer."),
}

PAGE_CHARS = 12_000
FIELD_CHARS = 6_000
MAX_NOTES_CHARS = 1200
MAX_MESSAGE_CHARS = 400

PROMPT = """You are J.A.R.V.I.S., Andrew's assistant, following along in his web browser while he \
works. You were not asked anything. Decide whether to say something right now.

WHEN TO SPEAK: {level_rule}
Do not narrate what he is doing, summarise pages he is simply reading, or repeat anything in RECENT \
REMARKS. Shopping, entertainment and idle browsing get silence unless something is plainly wrong. A \
task is "new" when your NOTES do not yet record it: record it there once recognised, so each is \
offered only once. Check facts and arithmetic yourself before calling anything a mistake.

{situation}

NOTES so far (your own running notes; may be empty):
{notes}

RECENT REMARKS you already made:
{remarks}

THE PAGE: "{title}" - {url}
{selection}{field}Visible text (may be cut):
<<<
{text}
>>>

Reply with JSON only:
{{"notes": "updated running notes: what he is working on, on which pages, where he is up to. \
Under 120 words. Keep what still matters.",
"speak": true or false,
"confidence": 0.0 to 1.0 that the remark is correct AND worth interrupting him for,
"message": "what to say, in your voice - dry, courteous, brief: one or two short sentences, \
addressed to him, written to be heard. Empty when not speaking."}}"""


class _State:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.notes = ""
        self.remarks: list[str] = []
        self.last_remark_at = 0.0


_state = _State()


def _parse(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    data = json.loads(text)
    return data if isinstance(data, dict) else {}


def observe(page: dict, level: str, session_id: str | None) -> dict:
    """One look at the page. Returns {speak, message, confidence, notes},
    with `speak` already held to the level's bar and cooldown."""
    threshold, cooldown, rule = LEVELS.get(level, LEVELS["normal"])
    with _state.lock:
        notes, remarks = _state.notes, list(_state.remarks)
        cooling = time.time() - _state.last_remark_at < cooldown

    selection = str(page.get("selection") or "").strip()
    field = str(page.get("field") or "").strip()
    prompt = PROMPT.format(
        level_rule=rule,
        situation="\n".join(line for line in (now_for_prompt(), schedule_line()) if line),
        notes=notes or "(none yet)",
        remarks="\n".join(f"- {r}" for r in remarks[-5:]) or "(none)",
        title=str(page.get("title") or "")[:200],
        url=str(page.get("url") or "")[:300],
        selection=f"He has selected: \"{selection[:2000]}\"\n" if selection else "",
        field=f"He is typing in a text box, which so far says:\n<<<\n{field[:FIELD_CHARS]}\n>>>\n" if field else "",
        text=str(page.get("text") or "")[:PAGE_CHARS],
    )
    response, model = generate(
        [prompt],
        types.GenerateContentConfig(
            response_mime_type="application/json",
            thinking_config=types.ThinkingConfig(thinking_level="low"),
        ),
    )
    try:
        data = _parse(response.text or "")
    except (json.JSONDecodeError, ValueError):
        logger.warning("browser watch: %s returned unparseable JSON", model)
        return {"speak": False, "message": "", "confidence": 0.0, "notes": notes}

    try:
        confidence = float(data.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    message = str(data.get("message") or "").strip()[:MAX_MESSAGE_CHARS]
    new_notes = str(data.get("notes") or notes).strip()[:MAX_NOTES_CHARS]
    speak = bool(data.get("speak")) and bool(message) and confidence >= threshold and not cooling

    with _state.lock:
        _state.notes = new_notes
        if speak:
            _state.remarks = [*_state.remarks, message][-5:]
            _state.last_remark_at = time.time()

    if speak and session_id:
        # Into the shared conversation, so the console (or the bubble) can
        # be asked "what did you mean?" afterwards.
        append_turn(
            session_id,
            str(uuid.uuid4()),
            f"(No message: Jarvis was following Andrew's browser, on \"{str(page.get('title') or '')[:120]}\", "
            "and spoke up on his own.)",
            message,
            datetime.now(timezone.utc).isoformat(),
        )
    return {"speak": speak, "message": message if speak else "", "confidence": round(confidence, 2), "notes": new_notes}
