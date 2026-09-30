from typing import Literal

from pydantic import BaseModel, Field


class InvokeRequest(BaseModel):
    message: str = Field(min_length=1)
    session_id: str | None = None
    # Where the reply will be read. "console" is the web HUD, where replies
    # may be spoken aloud; "terminal" is the jarvis CLI (cli/jarvis_cli.py),
    # used from VS Code and shells during programming work.
    channel: Literal["console", "terminal"] = "console"
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
