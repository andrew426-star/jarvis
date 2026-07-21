from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    groq_api_key: str
    groq_model: str = "openai/gpt-oss-120b"

    supabase_url: str
    supabase_service_role_key: str

    tavily_api_key: str


@lru_cache
def get_settings() -> Settings:
    return Settings()
