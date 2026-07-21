from fastapi import FastAPI

from app.api.routes.invoke import router as invoke_router

app = FastAPI(title="J.A.R.V.I.S.")
app.include_router(invoke_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
