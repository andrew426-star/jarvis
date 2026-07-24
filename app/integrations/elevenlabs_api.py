import httpx

ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"


def text_to_speech(text: str, voice_id: str, api_key: str, model_id: str) -> bytes:
    res = httpx.post(
        f"{ELEVENLABS_BASE}/text-to-speech/{voice_id}",
        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
        json={"text": text, "model_id": model_id},
        timeout=30.0,
    )
    if not res.is_success:
        raise RuntimeError(f"ElevenLabs text-to-speech failed: {res.text}")
    return res.content
