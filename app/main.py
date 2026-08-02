from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.google_auth import router as google_auth_router
from app.api.routes.invoke import router as invoke_router
from app.api.routes.panels import router as panels_router
from app.api.routes.spotify_auth import router as spotify_auth_router
from app.api.routes.speak import router as speak_router
from app.api.routes.transcribe import router as transcribe_router
from app.api.routes.verify import router as verify_router
from app.api.routes.zoho_auth import router as zoho_auth_router
from app.core.config import get_settings

app = FastAPI(title="J.A.R.V.I.S.")

_settings = get_settings()
_allowed_origins = ["http://localhost:3000"]
if _settings.jarvis_frontend_origin:
    _allowed_origins.append(_settings.jarvis_frontend_origin)

# allow_credentials is deliberately NOT set — that flag governs
# cookies/browser-native auth, not a manually-attached Authorization
# header (which the frontend always sends explicitly). Combining a
# wildcard origin with credentials silently becomes "allow literally any
# origin" in Starlette, which is never wanted here regardless.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(invoke_router)
app.include_router(google_auth_router)
app.include_router(spotify_auth_router)
app.include_router(speak_router)
app.include_router(verify_router)
app.include_router(panels_router)
app.include_router(transcribe_router)
app.include_router(zoho_auth_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
