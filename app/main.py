import mimetypes
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes.autonomy import router as autonomy_router
from app.api.routes.brief import router as brief_router
from app.api.routes.camera_link import relay_router as camera_relay_router
from app.api.routes.camera_link import router as camera_link_router
from app.api.routes.browser import router as browser_router
from app.api.routes.checklists import router as checklists_router
from app.api.routes.files import router as files_router
from app.api.routes.google_auth import router as google_auth_router
from app.api.routes.google_login import router as google_login_router
from app.api.routes.intel import router as intel_router
from app.api.routes.invoke import router as invoke_router
from app.api.routes.notes import router as notes_router
from app.api.routes.panels import router as panels_router
from app.api.routes.spotify_auth import router as spotify_auth_router
from app.api.routes.speak import router as speak_router
from app.api.routes.status import router as status_router
from app.api.routes.transcribe import router as transcribe_router
from app.api.routes.unlock import router as unlock_router
from app.api.routes.updates import router as updates_router
from app.api.routes.verify import router as verify_router
from app.api.routes.watch import router as watch_router
from app.api.routes.workshop import router as workshop_router
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
app.include_router(intel_router)
app.include_router(brief_router)
app.include_router(autonomy_router)
app.include_router(browser_router)
app.include_router(camera_link_router)
app.include_router(camera_relay_router)
app.include_router(checklists_router)
app.include_router(files_router)
app.include_router(google_auth_router)
app.include_router(google_login_router)
app.include_router(spotify_auth_router)
app.include_router(speak_router)
app.include_router(verify_router)
app.include_router(watch_router)
app.include_router(panels_router)
app.include_router(notes_router)
app.include_router(status_router)
app.include_router(transcribe_router)
app.include_router(unlock_router)
app.include_router(updates_router)
app.include_router(zoho_auth_router)
app.include_router(workshop_router)


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
# The phone view's install manifest (web/public/manifest.webmanifest).
mimetypes.add_type("application/manifest+json", ".webmanifest")



class _ConsoleFiles(StaticFiles):
    """The static export with caching that fits it. Without explicit
    headers, browsers heuristically cache index.html and keep showing the
    previous build after a deploy. Pages revalidate on every load (a cheap
    304 via the ETag when nothing changed); /_next/static/ files carry a
    content hash in their names, so they are cached for good - which also
    keeps the 11 MB OpenSCAD chunk from downloading more than once. The
    notification worker (sw.js) revalidates like a page, so a change to it
    reaches devices on their next visit."""

    def file_response(self, full_path, stat_result, scope, status_code=200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        path = scope.get("path", "")
        if path.startswith("/_next/static/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif str(full_path).endswith(".html") or path in ("", "/", "/sw.js"):
            response.headers["Cache-Control"] = "no-cache"
        return response


_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "web" / "out"
if _FRONTEND_DIST.is_dir():
    app.mount("/", _ConsoleFiles(directory=_FRONTEND_DIST, html=True), name="frontend")
