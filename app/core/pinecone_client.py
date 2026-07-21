from functools import lru_cache
from typing import Any

from pinecone import Pinecone

from app.core.config import get_settings


@lru_cache
def get_pinecone_client() -> Pinecone:
    return Pinecone(api_key=get_settings().pinecone_api_key)


@lru_cache
def get_pinecone_index() -> Any:
    return get_pinecone_client().Index(name=get_settings().pinecone_index_name)
