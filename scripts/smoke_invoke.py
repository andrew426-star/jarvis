"""Scripted regression check for /invoke — run against a live local/deployed server.

Usage: python scripts/smoke_invoke.py [base_url]
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
    session_a = str(uuid.uuid4())
    print("== DatabaseAgent round-trip ==")
    r1 = invoke("Add a contact: Jane Doe, my accountant, jane@example.com", session_a)
    print(r1)
    assert "database_agent" in r1["tools_used"], "expected database_agent to be used"

    r2 = invoke("What is Jane Doe's email?", session_a)
    print(r2)
    assert "database_agent" in r2["tools_used"], "expected database_agent to be used"
    assert "jane@example.com" in r2["response"], "expected the real email back"

    print("\n== WebResearch check ==")
    session_b = str(uuid.uuid4())
    r3 = invoke("What is the top story on Hacker News right now?", session_b)
    print(r3)
    assert "web_research" in r3["tools_used"], "expected web_research to be used"

    print("\n== No-tool control case ==")
    session_c = str(uuid.uuid4())
    r4 = invoke("Hi, who are you?", session_c)
    print(r4)
    assert r4["tools_used"] == [], "expected no tools for a plain greeting"

    print("\nAll smoke checks passed.")


if __name__ == "__main__":
    main()
