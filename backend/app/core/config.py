from pydantic_settings import BaseSettings
from pydantic import ConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = ConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    database_url: str = "postgresql://nexus:nexus@127.0.0.1:5432/nexus"

    # Echo every SQL statement. Off by default — the seed INSERTs alone bury
    # the request log at startup. Set SQL_ECHO=true in .env when debugging queries.
    sql_echo: bool = False

    google_service_account_file: str = "./credentials.json"
    google_service_account_json: str = ""  # JSON string — used in production instead of file

    api_key: str = ""  # For direct API access / Swagger only

    # Must be set to a long random string in production
    jwt_secret: str = "dev-secret-change-in-production"

    resend_api_key: str = "" # set in .env file for dev or env vars in prod, never commit here
    frontend_url: str = "http://localhost:3000/" # remember to set to actual url in prod


@lru_cache()
def get_settings() -> Settings:
    """Cached settings instance — import and call this everywhere."""
    return Settings()