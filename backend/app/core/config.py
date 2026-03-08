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

    api_key: str = ""  # For direct API access / Swagger only

    # Must be set to a long random string in production — never commit the real value
    jwt_secret: str = "dev-secret-change-in-production"


@lru_cache()
def get_settings() -> Settings:
    """Cached settings instance — import and call this everywhere."""
    return Settings()