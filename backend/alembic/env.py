"""
Alembic env.py — configured for Nexus.

- Reads DATABASE_URL from .env via app.core.config
- Imports all models so autogenerate can detect them
- Supports both offline (SQL dump) and online (live DB) migration modes
"""

from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

# Load app settings + models
from app.core.config import get_settings
from app.db.session import Base
import app.models.models  # noqa: F401 — ensures all models are registered on Base

settings = get_settings()

# Alembic Config object — provides access to alembic.ini values
config = context.config

# Wire up Python logging from alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override sqlalchemy.url with value from .env
config.set_main_option("sqlalchemy.url", settings.database_url)

# Metadata for autogenerate support
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode — generates SQL without a live DB connection.
    Useful for reviewing migration SQL before applying it.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Run migrations in 'online' mode — connects to the DB and applies migrations.
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()