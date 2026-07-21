"""Scripted regression check for the Redis + Pinecone memory tiers.

Usage: python scripts/smoke_memory.py [base_url]
"""

import sys
import uuid

import httpx

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"


def invoke(message: str, session_id: str) -> dict:
    res = httpx.post(
        f"{BASE_URL}/invoke",
        json={"message": message, "session_id": session_id},
        timeout=60.0,
    )
    res.raise_for_status()
    return res.json()


def main() -> None:
    print("== Redis session-window check ==")
    session_a = str(uuid.uuid4())
    invoke(
        "Remember this: my dog's name is Biscuit and he's a 4-year-old golden retriever.",
        session_a,
    )
    for i in range(5):
        invoke(f"Filler message number {i + 1}, nothing important.", session_a)
    r = invoke("What's my dog's name and breed?", session_a)
    print(r)
    assert "biscuit" in r["response"].lower(), "expected Redis's larger window to recall the fact"

    print("\n== Pinecone cross-session semantic check ==")
    session_b = str(uuid.uuid4())
    invoke(
        "For the record: my lead investor is Sarah Chen, and she prefers quarterly updates over monthly ones.",
        session_b,
    )
    session_c = str(uuid.uuid4())
    r2 = invoke("How often does my investor like to hear from me?", session_c)
    print(r2)
    assert "quarterly" in r2["response"].lower(), "expected Pinecone semantic recall across sessions"

    print("\nAll memory smoke checks passed.")


if __name__ == "__main__":
    main()
