from pydantic import BaseModel, Field


class InvokeRequest(BaseModel):
    message: str = Field(min_length=1)
    session_id: str | None = None


class ToolResult(BaseModel):
    name: str
    result: dict


class InvokeResponse(BaseModel):
    response: str
    # What /speak should be given — written for listening, not the screen.
    spoken: str
    tools_used: list[str]
    tool_results: list[ToolResult]
    session_id: str
