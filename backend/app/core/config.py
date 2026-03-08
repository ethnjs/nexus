from pydantic_settings import BaseSettings
from pydantic import ConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = ConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    database_url: str = "sqlite:///./nexus.db"

    google_service_account_file: str = "./credentials.json"
    google_service_account_json: str = ""  # JSON string — used in production instead of file

    api_key: str = ""  # Required in production — set API_KEY in .env


@lru_cache()
def get_settings() -> Settings:
    """Cached settings instance — import and call this everywhere."""
    return Settings()