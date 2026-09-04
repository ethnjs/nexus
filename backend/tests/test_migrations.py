"""Guards that the Alembic chain is the source of truth for schema.

The test suite builds its database with Base.metadata.create_all (see
conftest), which is fast but means every other test validates the *models*
while production only ever runs the *migrations*. Nothing checks the two
agree, and that gap is not hypothetical: forms.id carried an index and five
tables carried NOT NULL timestamps that existed in every migrated database but
were never declared on the models, unnoticed since March 2026.

This builds a throwaway database from the migrations alone and asserts it
matches the models exactly, so the two can't drift apart silently again.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, text

from app.core.config import get_settings
from app.db.session import Base
from app.models import models  # noqa: F401 — populates Base.metadata

BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRATCH_DB = "nexus_migration_check"


def _server_url() -> str:
    """The Postgres server, minus the database name."""
    return get_settings().database_url.rsplit("/", 1)[0]


@pytest.fixture
def migrated_db_url():
    """A fresh database with the full migration chain applied, dropped after.

    The upgrade runs in a subprocess because alembic/env.py reads the URL from
    app settings at import time — an in-process config override is silently
    clobbered by it, which is a trap worth not re-stepping into.
    """
    admin = create_engine(f"{_server_url()}/postgres", isolation_level="AUTOCOMMIT")
    url = f"{_server_url()}/{SCRATCH_DB}"
    try:
        with admin.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {SCRATCH_DB}"))
            conn.execute(text(f"CREATE DATABASE {SCRATCH_DB}"))

        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND_ROOT,
            env={**os.environ, "DATABASE_URL": url, "PYTHONIOENCODING": "utf-8"},
            capture_output=True, text=True,
        )
        assert result.returncode == 0, f"alembic upgrade head failed:\n{result.stderr}"
        yield url
    finally:
        with admin.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {SCRATCH_DB}"))
        admin.dispose()


def test_migrations_build_a_schema_matching_the_models(migrated_db_url):
    engine = create_engine(migrated_db_url)
    try:
        with engine.connect() as conn:
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    finally:
        engine.dispose()

    assert diff == [], (
        "The models and the migration chain disagree. Each entry below is a change "
        "autogenerate would apply to a migrated database to reach the models.\n"
        "Fix whichever side is wrong: add a migration if the models are right, or "
        "correct the model declaration if the migrations already describe production.\n"
        + "\n".join(f"  {d}" for d in diff)
    )


def test_migrations_create_every_model_table(migrated_db_url):
    """A migrated database must stand on its own. Asserted separately from the
    diff above because a missing table is the failure that matters most —
    create_all used to paper over it at startup, so a chain that couldn't build
    from empty still looked healthy."""
    engine = create_engine(migrated_db_url)
    try:
        with engine.connect() as conn:
            built = {
                row[0] for row in
                conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))
            }
    finally:
        engine.dispose()

    missing = set(Base.metadata.tables) - built
    assert not missing, f"Migrations don't create: {sorted(missing)}"
