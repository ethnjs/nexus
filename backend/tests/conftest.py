"""
Shared pytest fixtures.

Uses a dedicated Postgres database ("nexus_test", on the same Docker Postgres
container as dev) for all tests — real Postgres semantics (savepoints, FK
enforcement) so behavior matches prod, with a separate DB so a rollback bug
can never touch real dev data. Each test runs inside an outer transaction
that's rolled back at teardown, so no cleanup is needed between tests.
The Google Sheets and Forms services are mocked so tests never hit the real API.

Fixture hierarchy:
  admin_user       — role="admin", bypasses all permission checks
  td_user          — role="user", has tournament_director membership in td_tournament
  other_user       — role="user", has tournament_director membership in other_tournament
  td_tournament    — tournament owned by td_user, DEFAULT_ROLES populated
  other_tournament — tournament owned by other_user
"""

import os
import pytest

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("API_KEY", "")

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from unittest.mock import MagicMock, AsyncMock

from app.db.session import Base, get_db
from app.models import models  # noqa: F401
from app.api.routes.sheets import get_sheets_service, get_forms_service
from app.services.sheets_service import SheetsService
from app.services.forms_service import FormsService
from app.core.auth import hash_password
from app.core.tournament.permissions import DEFAULT_ROLES
from app.models.models import (
    Tournament, TournamentMembership, TournamentMembershipRole, TournamentRole,
    User, Event, EventCategory,
)
from app.schemas.sheet_config import (
    FormQuestionOption,
    MappedHeader,
    ParseRule,
    SheetHeadersResponse,
    SheetValidateResponse,
)

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://nexus:nexus@127.0.0.1:5432/nexus_test"
)
test_engine = create_engine(TEST_DATABASE_URL, echo=False)


@pytest.fixture(scope="function")
def db():
    connection = test_engine.connect()
    transaction = connection.begin()
    Base.metadata.create_all(bind=connection)
    # create_savepoint: session.commit()/rollback() operate on a nested SAVEPOINT,
    # not the outer transaction — so a mid-test rollback (e.g. a caught IntegrityError)
    # only undoes that one unit of work, not everything committed earlier in the test.
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
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
        status="active",
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
        status="active",
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
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Tournament + membership fixtures
# ---------------------------------------------------------------------------

def _make_tournament_with_td(db: Session, owner: User, name: str) -> Tournament:
    """
    Create a tournament owned by `owner`, populate DEFAULT_ROLES, and give
    `owner` a confirmed membership holding the tournament_director role.

    POST /tournaments/ itself no longer auto-seeds roles (new tournaments
    start with zero) — this fixture seeds them directly so the rest of the
    test suite (grant_role and friends) has roles to assign without every
    test doing it itself.
    """
    tournament = Tournament(
        name=name,
        owner_id=owner.id,
        location="Test Location",
    )
    db.add(tournament)
    db.flush()

    role_rows = [TournamentRole(tournament_id=tournament.id, **r) for r in DEFAULT_ROLES]
    db.add_all(role_rows)
    db.flush()
    td_role = next(r for r in role_rows if r.key == "tournament_director")

    membership = TournamentMembership(
        user_id=owner.id,
        tournament_id=tournament.id,
        status="confirmed",
        source="manual",
    )
    db.add(membership)
    db.flush()
    db.add(TournamentMembershipRole(membership_id=membership.id, role_id=td_role.id))

    db.commit()
    db.refresh(tournament)
    return tournament


def grant_role(db: Session, tournament: Tournament, user: User, role_key: str, status: str = "confirmed") -> TournamentMembership:
    """
    Give `user` a membership in `tournament` holding the role identified by
    `role_key` (must already exist on the tournament — DEFAULT_ROLES covers
    every key used across the test suite). Reuses an existing membership if
    one is already there instead of erroring on the unique constraint.
    """
    membership = (
        db.query(TournamentMembership)
        .filter(TournamentMembership.user_id == user.id, TournamentMembership.tournament_id == tournament.id)
        .first()
    )
    if not membership:
        membership = TournamentMembership(user_id=user.id, tournament_id=tournament.id, status=status, source="manual")
        db.add(membership)
        db.flush()

    role = (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament.id, TournamentRole.key == role_key)
        .first()
    )
    if role is None:
        raise ValueError(f"No TournamentRole with key={role_key!r} on tournament {tournament.id}")

    db.add(TournamentMembershipRole(membership_id=membership.id, role_id=role.id))
    db.commit()
    db.refresh(membership)
    return membership


@pytest.fixture
def td_tournament(db, td_user):
    return _make_tournament_with_td(db, td_user, "TD Test Tournament")


@pytest.fixture
def other_tournament(db, other_user):
    return _make_tournament_with_td(db, other_user, "Other Test Tournament")


# ---------------------------------------------------------------------------
# Event / EventCategory fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def event_category_factory(db):
    def _make(name="Chemistry"):
        category = EventCategory(name=name)
        db.add(category)
        db.commit()
        db.refresh(category)
        return category
    return _make


@pytest.fixture
def event_category(event_category_factory):
    return event_category_factory()


@pytest.fixture
def event_factory(db):
    def _make(category, name="Boomilever"):
        event = Event(name=name, category_id=category.id)
        db.add(event)
        db.commit()
        db.refresh(event)
        return event
    return _make


@pytest.fixture
def event(event_factory, event_category):
    return event_factory(event_category)


# ---------------------------------------------------------------------------
# Service mocks
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def mock_sheets_service() -> MagicMock:
    return _make_mock_sheets_service()


@pytest.fixture(scope="function")
def mock_forms_service() -> MagicMock:
    return _make_mock_forms_service()


# ---------------------------------------------------------------------------
# Test client
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def mock_send_email(monkeypatch):
    """
    Stubs the actual Resend call so no test run consumes real email quota.
    Patched at _send() — the one low-level function every sender (signup
    verify, email change, password reset, account setup, etc.) funnels
    through — so new senders are covered automatically without needing
    their own mock.
    """
    mock = AsyncMock()
    monkeypatch.setattr("app.services.email_service._send", mock)
    return mock


@pytest.fixture(scope="function")
def client(db, mock_sheets_service, mock_forms_service):
    from app.main import app

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_sheets_service] = lambda: mock_sheets_service
    app.dependency_overrides[get_forms_service] = lambda: mock_forms_service

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

    mock.validate_sheet_url.return_value = SheetValidateResponse(
        spreadsheet_id="fake_spreadsheet_id",
        spreadsheet_title="2025 Volunteer Interest Form (Responses)",
        sheet_names=["Form Responses 1", "Sheet2"],
    )

    mock.get_headers.return_value = SheetHeadersResponse(
        sheet_name="Form Responses 1",
        sheet_type="volunteers",
        mappings=[
            MappedHeader(header="Timestamp",     field="__ignore__", type="ignore"),
            MappedHeader(header="Email Address", field="email",      type="string"),
            MappedHeader(header="First Name",    field="first_name", type="string"),
            MappedHeader(header="Last Name",     field="last_name",  type="string"),
            MappedHeader(header="Phone Number",  field="phone",      type="string"),
            MappedHeader(header="T-Shirt Size",  field="shirt_size", type="string"),
            MappedHeader(
                header="Availability [8:00 AM - 10:00 AM]",
                field="availability",
                type="matrix_row",
                row_key="8:00 AM - 10:00 AM",
                rules=[ParseRule(condition="always", action="parse_time_range")],
            ),
        ],
    )

    mock.get_rows.return_value = []
    return mock


# ---------------------------------------------------------------------------
# Forms mock factory
# Returns plain dicts matching the real FormsService.get_form_questions shape.
# ---------------------------------------------------------------------------

def _make_mock_forms_service() -> MagicMock:
    mock = MagicMock(spec=FormsService)
    mock.extract_form_id.return_value = "fake_form_id_abc123"
    mock.get_form_questions.return_value = [
        {
            "question_id": "q001",
            "title": "Email Address",
            "google_type": "TEXT",
            "nexus_type": "string",
            "options": None,
            "grid_rows": None,
            "grid_columns": None,
        },
        {
            "question_id": "q002",
            "title": "Which events are you interested in supervising?",
            "google_type": "CHECKBOX",
            "nexus_type": "multi_select",
            "options": [
                FormQuestionOption(
                    raw="Anatomy and Physiology - Study the human body",
                    alias="Anatomy and Physiology",
                ),
                FormQuestionOption(
                    raw="Chemistry Lab - Hands-on laboratory skills",
                    alias="Chemistry Lab",
                ),
            ],
            "grid_rows": None,
            "grid_columns": None,
        },
        {
            "question_id": "q003",
            "title": "Availability",
            "google_type": "GRID",
            "nexus_type": "matrix_row",
            "options": None,
            "grid_rows": ["8:00 AM - 10:00 AM", "10:00 AM - 12:00 PM"],
            "grid_columns": ["Available", "Maybe"],
        },
    ]
    return mock