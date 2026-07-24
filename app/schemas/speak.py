from pydantic import BaseModel, Field

MAX_TTS_CHARS = 5000


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TTS_CHARS)
    voice_id: str | None = None
