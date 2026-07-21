"""One-time, idempotent Pinecone index setup. Run manually once
PINECONE_API_KEY is set — never imported from the app itself.

Usage: python scripts/setup_pinecone_index.py
"""

from pinecone import Pinecone

from app.core.config import get_settings


def main() -> None:
    settings = get_settings()
    pc = Pinecone(api_key=settings.pinecone_api_key)

    if pc.has_index(settings.pinecone_index_name):
        print(f"Index '{settings.pinecone_index_name}' already exists — nothing to do.")
        return

    pc.create_index_for_model(
        name=settings.pinecone_index_name,
        cloud="aws",
        region="us-east-1",
        embed={
            "model": settings.pinecone_embedding_model,
            "field_map": {"text": "chunk_text"},
        },
    )
    print(f"Created index '{settings.pinecone_index_name}' with model '{settings.pinecone_embedding_model}'.")


if __name__ == "__main__":
    main()
