"""
Shared pytest fixtures.

Uses an in-memory SQLite DB for all tests — fast, isolated, no cleanup needed.
The Google Sheets service is mocked so tests never hit the real API.

Fixture hierarchy:
  admin_user       — role="admin", bypasses all permission checks
  td_user          — role="user", has tournament_director membership in td_tournament
  other_user       — role="user", has tournament_director membership in other_tournament
  td_tournament    — tournament owned by td_user, default positions in schema
  other_tournament — tournament owned by other_user
"""

import os
import pytest

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("API_KEY", "")

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from unittest.mock import MagicMock

from app.db.session import Base, get_db
from app.models import models  # noqa: F401
from app.api.routes.sheets import get_sheets_service
from app.services.sheets_service import SheetsService
from app.core.auth import hash_password
from app.core.permissions import DEFAULT_POSITIONS
from app.models.models import Membership, Tournament, User

test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    echo=False,
)

@event.listens_for(test_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


@pytest.fixture(scope="function")
def db():
    connection = test_engine.connect()
    transaction = connection.begin()
    Base.metadata.create_all(bind=connection)
    session = Session(bind=connection)
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        Base.metadata.drop_all(bind=connection)
        connection.close()


# ---------------------------------------------------------------------------
# Auth fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def admin_user(db):
    user = User(
        email="admin@test.com",
        hashed_password=hash_password("adminpass"),
        first_name="Admin",
        last_name="User",
        role="admin",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def td_user(db):
    user = User(
        email="td@test.com",
        hashed_password=hash_password("tdpass"),
        first_name="TD",
        last_name="User",
        role="user",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def other_user(db):
    user = User(
        email="other@test.com",
        hashed_password=hash_password("otherpass"),
        first_name="Other",
        last_name="User",
        role="user",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Tournament + membership fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def td_tournament(db, td_user):
    tournament = Tournament(
        name="TD Test Tournament",
        owner_id=td_user.id,
        blocks=[],
        volunteer_schema={"custom_fields": [], "positions": DEFAULT_POSITIONS},
    )
    db.add(tournament)
    db.flush()
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=tournament.id,
        positions=["tournament_director"],
        status="confirmed",
    ))
    db.commit()
    db.refresh(tournament)
    return tournament


@pytest.fixture
def other_tournament(db, other_user):
    tournament = Tournament(
        name="Other Test Tournament",
        owner_id=other_user.id,
        blocks=[],
        volunteer_schema={"custom_fields": [], "positions": DEFAULT_POSITIONS},
    )
    db.add(tournament)
    db.flush()
    db.add(Membership(
        user_id=other_user.id,
        tournament_id=tournament.id,
        positions=["tournament_director"],
        status="confirmed",
    ))
    db.commit()
    db.refresh(tournament)
    return tournament


# ---------------------------------------------------------------------------
# Sheets mock
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def mock_sheets_service() -> MagicMock:
    return _make_mock_sheets_service()


# ---------------------------------------------------------------------------
# Test client
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def client(db, mock_sheets_service):
    from app.main import app

    def override_get_db():
        try:
            yield db
        finally:
            pass

    def override_get_sheets_service():
        return mock_sheets_service

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_sheets_service] = override_get_sheets_service

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def login(client: TestClient, email: str, password: str):
    """POST /auth/login and store the resulting cookie on the client."""
    return client.post("/auth/login/", json={"email": email, "password": password})


# ---------------------------------------------------------------------------
# Sheets mock factory
# ---------------------------------------------------------------------------

def _make_mock_sheets_service() -> MagicMock:
    mock = MagicMock(spec=SheetsService)
    mock.extract_spreadsheet_id.return_value = "fake_spreadsheet_id"
    mock.validate_sheet_url.return_value = {
        "spreadsheet_id": "fake_spreadsheet_id",
        "title": "Fake Sheet",
        "tabs": ["Form Responses 1"],
    }
    mock.get_headers.return_value = {
        "headers": ["Email Address", "First Name", "Last Name"],
        "suggested_mappings": {},
    }
    mock.get_rows.return_value = []
    return mock