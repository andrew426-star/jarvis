from typing import Literal

from pydantic import BaseModel, Field, model_validator


# Upper bound on what one message can carry, base64 included: comfortably
# inside Gemini's inline-request limit.
MAX_ATTACHMENT_CHARS = 18_000_000


class Attachment(BaseModel):
    """A file sent with a message. Images and PDFs come as base64 `data` and
    go to the model as they are; text files come as `text`."""

    name: str = Field(max_length=200)
    mime: str = Field(max_length=120)
    data: str | None = None
    text: str | None = None


class InvokeRequest(BaseModel):
    message: str = Field(min_length=1)
    session_id: str | None = None
    # Where the reply will be read. "console" is the web HUD, where replies
    # may be spoken aloud; "terminal" is the jarvis CLI (cli/jarvis_cli.py),
    # used from VS Code and shells during programming work; "mobile" is the
    # phone view of the console, spoken like the console but with nothing
    # on screen for Jarvis to operate.
    channel: Literal["console", "terminal", "mobile"] = "console"
    # A webcam frame, base64 without the data: prefix, attached by the
    # console while its camera is on. Used for this turn only and never
    # stored. ~8MB of base64 is far above the console's downscaled JPEGs
    # and well under Claude's per-image limit.
    image: str | None = Field(default=None, max_length=8_000_000)
    image_type: Literal["image/jpeg", "image/png", "image/webp"] = "image/jpeg"
    # Look button: describe the frame up front rather than leaving it to
    # the model to decide whether to call camera_look.
    look: bool = False
    # What the console currently has open (panels, workshop items, camera),
    # so Jarvis can operate it: see app/tools/console_control.py.
    console_state: dict | None = None
    attachments: list[Attachment] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def _attachments_fit(self):
        total = sum(len(a.data or "") + len(a.text or "") for a in self.attachments)
        if total > MAX_ATTACHMENT_CHARS:
            raise ValueError("Attachments are too large for one message (about 13 MB of files at most).")
        return self


class ToolResult(BaseModel):
    name: str
    result: dict


class InvokeResponse(BaseModel):
    response: str
    # What /speak should be given: written for listening, not the screen.
    spoken: str
    tools_used: list[str]
    tool_results: list[ToolResult]
    session_id: str
    # Exchanges held in the session's short-term memory, out of the window.
    context_turns: int
    context_window: int
    # Per-step durations (memory, each model call, each tool, total), shown
    # in the console's system log.
    timings: list[dict] = []


class SessionContext(BaseModel):
    # None when Redis could not be read, so the console can leave its
    # gauge alone rather than show a false zero.
    turns: int | None
    window: int
