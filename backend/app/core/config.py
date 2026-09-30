from pydantic_settings import BaseSettings
from pydantic import ConfigDict, PositiveFloat, PositiveInt
from functools import lru_cache


class Settings(BaseSettings):
    model_config = ConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    database_url: str = "postgresql://nexus:nexus@127.0.0.1:5432/nexus"

    # Echo every SQL statement. Off by default — the seed INSERTs alone bury
    # the request log at startup. Set SQL_ECHO=true in .env when debugging queries.
    sql_echo: bool = False

    google_service_account_file: str = "./credentials.json"
    google_service_account_json: str = ""

    api_key: str = ""  # For direct API access / Swagger only

    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-west-2"
    email_from_address: str = "NEXUS <verify@nexus.socalscioly.org>"
    ses_max_send_rate: PositiveFloat = 1.0
    ses_max_attempts: PositiveInt = 4

    frontend_url: str = "http://localhost:3000/"


@lru_cache()
def get_settings() -> Settings:
    """Cached settings instance — import and call this everywhere."""
    return Settings()