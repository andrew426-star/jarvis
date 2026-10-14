import re

from app.tools.rounds import READ_ONLY

# The REPORTING ACTIONS rule in the system prompt says Jarvis never claims
# an action no tool performed. A prompt rule is probabilistic, and he has
# broken it ("Done, sir" with nothing done), so this checks it in code: a
# finished reply that claims a completed action, in a turn where nothing
# that changes anything ran and succeeded, goes back to him once, to either
# do it with his tools or say plainly that it is not done.

# First person, completed: "I've sent", "I have scheduled", "I just opened".
_FIRST_PERSON = re.compile(
    r"\bI(?:'ve|’ve| have)?\s+(?:just\s+|now\s+|already\s+|gone ahead and\s+)?"
    r"(sent|set|scheduled|booked|saved|logged|added|removed|deleted|cancell?ed|queued|opened|closed|"
    r"clicked|typed|filled|submitted|muted|unmuted|started|stopped|turned|played|paused|moved|updated|"
    r"marked|filed|created|texted|called|emailed|replied|archived|tracked|launched|initiated|engaged|"
    r"held|put|switched|dimmed|locked|unlocked|declined|dismissed|posted|ordered|paid)\b",
    re.IGNORECASE,
)
# A bare confirmation opening a sentence: "Done.", "Sent, sir.", "Reminder set for 3 PM."
_CONFIRMATION = re.compile(
    r"(?:^|[.!?]\s+|\n\s*)(?:(?:done|sent|set|scheduled|booked|saved|logged|queued|filed|cancell?ed|"
    r"deleted|removed|posted)\b|(?:reminder|timer|alarm|hold|protocol|note|email|text|message|event|"
    r"meeting|task|lead|list)\s+(?:is\s+)?(?:set|sent|saved|logged|scheduled|added|created|removed|"
    r"cancell?ed|initiated|engaged|on|off)\b)",
    re.IGNORECASE,
)


# "Shall I set", "I can't send", "should I call": an offer or a limit, not a
# report. Words that, just before "I", make it one.
_NOT_A_REPORT = re.compile(r"\b(shall|should|can|could|will|would|may|might|must|do|did|if|when|once|let me)\s+$", re.IGNORECASE)


def _sentence_of(text: str, start: int, end: int) -> str:
    left = max(text.rfind(c, 0, start) for c in ".!?\n") + 1
    right = min((i for i in (text.find(c, end) for c in ".!?\n") if i != -1), default=len(text))
    return text[left : right + 1]


def claimed_action(text: str) -> str | None:
    """The phrase in which the reply claims a completed action, if any."""
    text = text or ""
    for pattern in (_FIRST_PERSON, _CONFIRMATION):
        for match in pattern.finditer(text):
            # Questions ("Shall I set it?") offer; they do not report.
            if _sentence_of(text, match.start(), match.end()).rstrip().endswith("?"):
                continue
            if _NOT_A_REPORT.search(text[max(0, match.start() - 12) : match.start()]):
                continue
            return match.group(0).strip(" .!?\n")
    return None


def _changes_something(name: str, args: dict) -> bool:
    """Not a read: any tool or operation the rounds' read-only list does not
    name (the console, the workshop, sending, setting, logging, acting)."""
    if name not in READ_ONLY:
        return name not in ("think", "calculator")
    ops = READ_ONLY[name]
    return ops is not None and args.get("operation") not in ops


def acted(executed: list[tuple[str, dict, dict]]) -> bool:
    """Did anything that changes something run, and not fail, this turn?"""
    for name, args, result in executed:
        failed = isinstance(result, dict) and (result.get("ok") is False or result.get("held"))
        if not failed and _changes_something(name, args or {}):
            return True
    return False


def unbacked_claim(text: str, executed: list[tuple[str, dict, dict]]) -> str | None:
    """The claimed action, when nothing this turn could have performed it."""
    # The voice line is checked too: a claim heard is as false as one read.
    claim = claimed_action(re.sub(r"</?spoken>", "\n", text or "", flags=re.IGNORECASE))
    return claim if claim and not acted(executed) else None


def correction(claim: str) -> str:
    return (
        f"CHECK BEFORE ANSWERING: your reply claims an action (\"{claim}\"), but no tool that changes "
        "anything ran successfully in this turn, so it has not happened. If one of your tools can do it, "
        "call it now and then report its real result. If none can, or it needs Andrew, write the reply "
        "again saying plainly what you did not do and why. Never claim it. Do not mention this check."
    )
