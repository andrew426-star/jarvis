import mimetypes
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes.brief import router as brief_router
from app.api.routes.google_auth import router as google_auth_router
from app.api.routes.google_login import router as google_login_router
from app.api.routes.invoke import router as invoke_router
from app.api.routes.panels import router as panels_router
from app.api.routes.spotify_auth import router as spotify_auth_router
from app.api.routes.speak import router as speak_router
from app.api.routes.status import router as status_router
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
app.include_router(brief_router)
app.include_router(google_auth_router)
app.include_router(google_login_router)
app.include_router(spotify_auth_router)
app.include_router(speak_router)
app.include_router(verify_router)
app.include_router(panels_router)
app.include_router(status_router)
app.include_router(transcribe_router)
app.include_router(zoho_auth_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# The built frontend, served by this same process off this same port —
# `next build` with output: "export" (web/next.config.ts) drops a plain
# static bundle here. Mounted LAST on purpose: Starlette matches routes in
# registration order, so every API route above still wins over this
# catch-all "/" mount.
#
# html=True gives index.html for "/" and 404.html for anything unmatched.
# The directory is absent until someone runs the frontend build, which is
# the normal state during backend-only work and when running `next dev`
# separately — so skip the mount instead of crashing at import time.
# Python's mimetypes table has no entry for woff2 on several platforms,
# so next/font's self-hosted faces would go out as
# application/octet-stream. Browsers sniff and render them anyway, but
# the wrong type costs correct caching and compression for the largest
# static assets the page loads.
mimetypes.add_type("font/woff2", ".woff2")
# Same reasoning as woff2: the ambience bed is served from the static
# export, and a wrong Content-Type makes it silently unplayable.
mimetypes.add_type("audio/mpeg", ".mp3")
mimetypes.add_type("font/woff", ".woff")

_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "web" / "out"
if _FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")
