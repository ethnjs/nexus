from pydantic_settings import BaseSettings
from pydantic import ConfigDict, PositiveFloat, PositiveInt
from functools import lru_cache


class Settings(BaseSettings):
    # extra="ignore" so a stale key left in someone's .env (e.g. RESEND_API_KEY) doesn't crash startup
    model_config = ConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

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

    # Amazon SES — set in .env file for dev or env vars in prod, never commit here.
    # Blank keys skip sending in dev/preview (logged instead) and fail sends in production.
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-west-2"  # must match the region where the SES sending identity is verified
    email_from_address: str = "NEXUS <verify@nexus.socalscioly.org>"  # must be SES-verified in that account/region
    ses_max_send_rate: PositiveFloat = 1.0  # emails/sec — sandbox is capped at 1, raise to the account's production quota
    ses_max_attempts: PositiveInt = 4  # total attempts per send (including the first) before a throttle counts as failed

    frontend_url: str = "http://localhost:3000/" # remember to set to actual url in prod


@lru_cache()
def get_settings() -> Settings:
    """Cached settings instance — import and call this everywhere."""
    return Settings()