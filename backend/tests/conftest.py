import os
import re
from datetime import date, timedelta

import pytest

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("API_KEY", "")
# Overrides .env, where a developer may have switched codes off; the codes_off fixture tests that.
os.environ["LOGIN_CODES_REQUIRED"] = "true"

from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.api.routes.sheets import get_forms_service, get_sheets_service
from app.core import auth
from app.core.auth import hash_password
from app.core.tournament.permissions import DEFAULT_ROLES
from app.db.session import Base, get_db
from app.models import models  # noqa: F401
from app.models.models import (
    Event,
    EventCategory,
    Tournament,
    TournamentMembership,
    TournamentRole,
    TournamentTrack,
    TournamentTrackAssignment,
    User,
)
from app.schemas.sheet_config import (
    FormQuestionOption,
    MappedHeader,
    ParseRule,
    SheetHeadersResponse,
    SheetValidateResponse,
)
from app.services.forms_service import FormsService
from app.services.sheets_service import SheetsService

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://nexus:nexus@127.0.0.1:5432/nexus_test"
)

# Tournament creation rejects past dates, so a hardcoded date would break the suite once it passes.
FUTURE_YEAR = date.today().year + 1


def future_date(month: int, day: int) -> str:
    return f"{FUTURE_YEAR}-{month:02d}-{day:02d}"


TOURNAMENT_REQUIRED_FIELDS = {
    "state": "Southern California",
    "level": "invitational",
    "timezone": "America/Los_Angeles",
    "tracks": [
        {
            "name": "Main",
            "is_primary": True,
            "start_date": future_date(5, 21),
            "end_date": future_date(5, 23),
            "location": "Test Location",
            "division": ["B", "C"],
        }
    ],
}
test_engine = create_engine(TEST_DATABASE_URL, echo=False)

# Production Argon2 costs about 80 ms per hash or verify, and every sign-in does three.
# The minimum cost runs the same algorithm and code path.
auth.pwd_context = PasswordHash(
    (Argon2Hasher(time_cost=1, memory_cost=8, parallelism=1), auth._LegacyBcryptHasher())
)


_RUN_LOCK_KEY = 0x6E657875


@pytest.fixture(scope="session")
def _schema():
    name = test_engine.url.database or ""
    # The schema setup below commits a DROP SCHEMA, so refuse anything but a test database.
    if not name.endswith("_test"):
        pytest.exit(f"TEST_DATABASE_URL must name a *_test database, not {name!r}")
    lock = test_engine.connect()
    if not lock.scalar(text("SELECT pg_try_advisory_lock(:k)"), {"k": _RUN_LOCK_KEY}):
        lock.close()
        pytest.exit(f"Another test run is using {name}; wait for it to finish")
    lock.commit()
    try:
        # CASCADE also clears tables a killed run on another branch left behind.
        with test_engine.begin() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
            Base.metadata.create_all(bind=conn)
        yield
        Base.metadata.drop_all(bind=test_engine)
    finally:
        # The pool keeps the connection open, which would keep the lock held.
        lock.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _RUN_LOCK_KEY})
        lock.close()


@pytest.fixture(scope="function")
def db(_schema):
    connection = test_engine.connect()
    transaction = connection.begin()
    # Sequences ignore rollback; resetting them keeps ids starting at 1 in every test.
    connection.execute(
        text(
            "SELECT setval(oid, 1, false) FROM pg_class"
            " WHERE relkind = 'S' AND relnamespace = 'public'::regnamespace"
        )
    )
    # commit() and rollback() act on a savepoint, so a caught IntegrityError undoes only its own
    # unit of work while the outer transaction still rolls back everything at teardown.
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
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
    """Seeds DEFAULT_ROLES, which tournament creation doesn't, and gives `owner` the
    Tournament Director role tournament-wide."""
    tournament = Tournament(
        name=name,
        owner_id=owner.id,
        state="Southern California",
        level="invitational",
        timezone="America/Los_Angeles",
    )
    db.add(tournament)
    db.flush()

    db.add(
        TournamentTrack(
            tournament_id=tournament.id,
            name="Main",
            is_primary=True,
            location="Test Location",
            start_date=date.today(),
            end_date=date.today() + timedelta(days=1),
            division=["B", "C"],
        )
    )
    db.flush()

    role_rows = [TournamentRole(tournament_id=tournament.id, **r) for r in DEFAULT_ROLES]
    db.add_all(role_rows)
    db.flush()
    td_role = next(r for r in role_rows if r.label == "Tournament Director")

    membership = TournamentMembership(
        user_id=owner.id,
        tournament_id=tournament.id,
        source="manual",
    )
    db.add(membership)
    db.flush()
    db.add(
        TournamentTrackAssignment(
            membership_id=membership.id,
            role_id=td_role.id,
            is_tournament_wide=True,
        )
    )

    db.commit()
    db.refresh(tournament)
    return tournament


def primary_track_id(db: Session, tournament_id: int) -> int:
    """The tournament's primary track, the only kind a shift may belong to."""
    return (
        db.query(TournamentTrack.id)
        .filter(
            TournamentTrack.tournament_id == tournament_id,
            TournamentTrack.is_primary.is_(True),
            TournamentTrack.is_archived.is_(False),
        )
        .order_by(TournamentTrack.start_date, TournamentTrack.id)
        .limit(1)
        .scalar()
    )


def set_display_config(db, tournament, user, config: dict) -> None:
    """Display config is per viewer, stored on that user's membership."""
    membership = (
        db.query(TournamentMembership).filter_by(tournament_id=tournament.id, user_id=user.id).one()
    )
    membership.display_config = config
    db.commit()


def grant_role(
    db: Session,
    tournament: Tournament,
    user: User,
    role_label: str,
    track_id: int | None = None,
) -> TournamentMembership:
    """Gives `user` the existing role `role_label`, tournament-wide unless `track_id` is
    given, reusing their membership if they have one."""
    membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == user.id,
            TournamentMembership.tournament_id == tournament.id,
        )
        .first()
    )
    if not membership:
        membership = TournamentMembership(
            user_id=user.id, tournament_id=tournament.id, source="manual"
        )
        db.add(membership)
        db.flush()

    role = (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament.id, TournamentRole.label == role_label)
        .first()
    )
    if role is None:
        raise ValueError(
            f"No TournamentRole with label={role_label!r} on tournament {tournament.id}"
        )

    db.add(
        TournamentTrackAssignment(
            membership_id=membership.id,
            role_id=role.id,
            is_tournament_wide=track_id is None,
            tournament_track_id=track_id,
        )
    )
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
    """Patches `_send`, which every email sender goes through, so tests never send real email."""
    mock = AsyncMock()
    monkeypatch.setattr("app.services.email_service._send", mock)
    return mock


@pytest.fixture(autouse=True)
def mock_discord_http(monkeypatch):
    """Stubs every Discord OAuth call at `_request`. Set `side_effect` to answer by path;
    an unstubbed call fails the test."""
    mock = MagicMock(side_effect=AssertionError("unstubbed Discord OAuth call"))
    monkeypatch.setattr("app.services.discord.oauth._request", mock)
    return mock


@pytest.fixture(scope="function")
def client(db, mock_sheets_service, mock_forms_service):
    from app.main import app

    def override_get_db():
        try:
            yield db
        finally:
            # Production gives each request a fresh session; expiring stands in
            # for that, so one request's loaded state can't leak into the next.
            db.expire_all()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_sheets_service] = lambda: mock_sheets_service
    app.dependency_overrides[get_forms_service] = lambda: mock_forms_service

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    app.dependency_overrides.clear()


@pytest.fixture
def discord_on(client, monkeypatch):
    """Turns the Discord feature switch on, with dev-shaped settings."""
    from app.core.config import get_settings
    from app.core.discord.deps import require_discord_enabled
    from app.main import app

    settings = get_settings()
    values = {
        "discord_application_id": "1000",
        "discord_public_key": "00" * 32,
        "discord_bot_token": "bot-token",
        "discord_client_secret": "client-secret",
        "discord_link_redirect_uri": "http://localhost:3000/api/proxy/auth/oauth/discord/callback",
        "discord_install_redirect_uri": "http://localhost:3000/api/proxy/discord/install/callback",
        "frontend_url": "http://localhost:3000/",
    }
    for name, value in values.items():
        monkeypatch.setattr(settings, name, value)
    app.dependency_overrides[require_discord_enabled] = lambda: None


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------


def emailed_code() -> str:
    """The code in the last email sent through the autouse email mock."""
    from app.services import email_service

    body = email_service._send.call_args.args[2]  # ty: ignore[unresolved-attribute]
    match = re.search(r"Your code: (\d{6})", body)
    assert match is not None, body
    return match.group(1)


def login(client: TestClient, email: str, password: str):
    """
    Signs in through the password and code steps, storing the cookie on the client. Returns the
    code verify response, or the login response when it didn't ask for a code (such as a 401).
    """
    from app.services import email_service

    res = client.post("/auth/login/", json={"email": email, "password": password})
    if res.status_code != 200 or not res.json()["code_required"]:
        return res
    verify = client.post(
        "/auth/code/verify/",
        json={
            "challenge_token": res.json()["challenge"]["challenge_token"],
            "code": emailed_code(),
        },
    )
    # So tests that count sends see only their own.
    email_service._send.reset_mock()  # ty: ignore[unresolved-attribute]
    return verify


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
            MappedHeader(header="Timestamp", field="__ignore__", type="ignore"),
            MappedHeader(header="Email Address", field="email", type="string"),
            MappedHeader(header="First Name", field="first_name", type="string"),
            MappedHeader(header="Last Name", field="last_name", type="string"),
            MappedHeader(header="Phone Number", field="phone", type="string"),
            MappedHeader(header="T-Shirt Size", field="shirt_size", type="string"),
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
