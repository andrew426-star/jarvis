from typing import Literal

from pydantic import BaseModel, Field


class InvokeRequest(BaseModel):
    message: str = Field(min_length=1)
    session_id: str | None = None
    # Where the reply will be read. "console" is the web HUD, where replies
    # may be spoken aloud; "terminal" is the jarvis CLI (cli/jarvis_cli.py),
    # used from VS Code and shells during programming work.
    channel: Literal["console", "terminal"] = "console"


class ToolResult(BaseModel):
    name: str
    result: dict


class InvokeResponse(BaseModel):
    response: str
    tools_used: list[str]
    tool_results: list[ToolResult]
    session_id: str
