import logging

from app.core.config import get_settings
from app.core.pinecone_client import get_pinecone_index

logger = logging.getLogger(__name__)

MAX_CHUNK_CHARS = 6000


def record_interaction(
    interaction_id: str,
    session_id: str,
    user_message: str,
    assistant_response: str,
    tools_used: list[str],
    created_at: str,
    model: str = "",
) -> None:
    """Tier 3 (Pinecone) write — one combined record per turn, so a later
    semantic search can match on either the question or the answer.

    Never raises: an indexing failure should just mean that turn isn't
    recallable later, not a failed request.
    """
    settings = get_settings()
    chunk_text = f"User: {user_message}\nJarvis: {assistant_response}"[:MAX_CHUNK_CHARS]

    try:
        index = get_pinecone_index()
        index.upsert_records(
            records=[
                {
                    "_id": interaction_id,
                    "chunk_text": chunk_text,
                    "session_id": session_id,
                    "created_at": created_at,
                    "tools_used": tools_used,
                    "model": model,
                }
            ],
            namespace=settings.pinecone_namespace,
        )
    except Exception:
        logger.warning("Pinecone record_interaction failed for %s", interaction_id, exc_info=True)


def get_relevant_context(query_text: str) -> str | None:
    """Tier 3 (Pinecone) read — semantically similar past interactions,
    across all sessions, formatted as a ready-to-inject system message.

    Returns None on failure or when nothing clears the minimum score —
    absence of recall should never block a reply.
    """
    settings = get_settings()
    try:
        index = get_pinecone_index()
        results = index.search(
            namespace=settings.pinecone_namespace,
            inputs={"text": query_text},
            top_k=settings.pinecone_top_k,
            fields=["chunk_text"],
        )
        hits = results.result.hits
    except Exception:
        logger.warning("Pinecone get_relevant_context failed", exc_info=True)
        return None

    survivors = [
        hit.fields["chunk_text"]
        for hit in hits
        if hit.score >= settings.pinecone_min_score and hit.fields.get("chunk_text")
    ]
    if not survivors:
        return None

    formatted = "\n\n".join(f"- {text}" for text in survivors)
    return f"Relevant past interactions (may or may not be related to the current message):\n{formatted}"
