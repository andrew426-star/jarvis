from fastapi import FastAPI

from app.api.routes.google_auth import router as google_auth_router
from app.api.routes.invoke import router as invoke_router
from app.api.routes.spotify_auth import router as spotify_auth_router

app = FastAPI(title="J.A.R.V.I.S.")
app.include_router(invoke_router)
app.include_router(google_auth_router)
app.include_router(spotify_auth_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
