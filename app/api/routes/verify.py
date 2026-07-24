from fastapi import APIRouter, Depends

from app.core.auth import require_access_token

router = APIRouter()


# A trivial, stateless check the frontend's login gate calls to validate a
# passphrase — deliberately separate from /invoke so testing a token never
# costs a real Groq call or writes a fake turn into session memory.
@router.get("/auth/verify", dependencies=[Depends(require_access_token)])
def verify() -> dict:
    return {"ok": True}
