"""
Shared pytest fixtures.

Uses an in-memory SQLite DB for all tests — fast, isolated, no cleanup needed.
The Google Sheets service is mocked so tests never hit the real API.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from unittest.mock import MagicMock

# Must import models before Base.metadata is used so all tables are registered
from app.db.session import Base, get_db
from app.models import models  # noqa: F401
from app.api.routes.sheets import get_sheets_service
from app.services.sheets_service import SheetsService

# ---------------------------------------------------------------------------
# In-memory SQLite — use a single shared connection so all sessions see the
# same in-memory database. Without this, each new connection gets a blank DB.
# ---------------------------------------------------------------------------
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
    """
    Create all tables on a single connection and bind the session to it.
    Rolls back after each test so state never leaks between tests.
    """
    connection = test_engine.connect()
    transaction = connection.begin()

    # Create tables on THIS connection so the session below can see them
    Base.metadata.create_all(bind=connection)

    session = Session(bind=connection)

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        Base.metadata.drop_all(bind=connection)
        connection.close()


@pytest.fixture(scope="function")
def mock_sheets_service() -> MagicMock:
    """
    Exposed fixture so sheet tests can override return values per-test.
    Also used internally by the client fixture.
    """
    return _make_mock_sheets_service()


@pytest.fixture(scope="function")
def client(db, mock_sheets_service):
    """
    FastAPI TestClient with:
    - DB dependency swapped for the in-memory test DB session
    - SheetsService fully mocked via dependency_overrides
    """
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


def _make_mock_sheets_service() -> MagicMock:
    """Pre-configured mock SheetsService — no real Google API calls."""
    from app.schemas.sheet_config import SheetValidateResponse, SheetHeadersResponse, ColumnMapping

    svc = MagicMock(spec=SheetsService)

    svc.extract_spreadsheet_id.return_value = "fake_spreadsheet_id_abc123"

    svc.validate_sheet_url.return_value = SheetValidateResponse(
        spreadsheet_id="fake_spreadsheet_id_abc123",
        spreadsheet_title="2025 Volunteer Interest Form (Responses)",
        sheet_names=["Form Responses 1", "Sheet2"],
    )

    svc.get_headers.return_value = SheetHeadersResponse(
        sheet_name="Form Responses 1",
        headers=[
            "Timestamp",
            "Email Address",
            "First Name",
            "Last Name",
            "Phone Number",
            "T-Shirt Size",
            "Availability [8:00 AM - 10:00 AM]",
        ],
        suggestions={
            "Timestamp":        ColumnMapping(field="__ignore__",  type="ignore"),
            "Email Address":    ColumnMapping(field="email",       type="string"),
            "First Name":       ColumnMapping(field="first_name",  type="string"),
            "Last Name":        ColumnMapping(field="last_name",   type="string"),
            "Phone Number":     ColumnMapping(field="phone",       type="string"),
            "T-Shirt Size":     ColumnMapping(field="shirt_size",  type="string"),
            "Availability [8:00 AM - 10:00 AM]": ColumnMapping(
                field="availability", type="matrix_row", row_key="8:00 AM - 10:00 AM"
            ),
        },
    )

    return svc