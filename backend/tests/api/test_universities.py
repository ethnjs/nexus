import uuid
from typing import Generator

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes.universities import create_university, delete_university, get_universities
from app.db.session import SessionLocal
from app.main import app
from app.models.models import University, User
from app.schemas.university import UniversityCreate

client = TestClient(app)


@pytest.fixture
def db() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def make_admin_user() -> User:
    return User(
        email="admin@example.com",
        hashed_password="fakehashedpassword",
        first_name="Admin",
        last_name="User",
        role="admin",
        is_active=True,
    )


def test_get_universities_returns_created_university(db: Session):
    unique_name = f"Test University {uuid.uuid4()}"
    university = University(name=unique_name, abbreviation="TU", location="Test City")
    db.add(university)
    db.commit()
    db.refresh(university)

    results = get_universities(db)

    assert any(item.name == unique_name for item in results)


def test_create_university_creates_record(db: Session):
    unique_name = f"New University {uuid.uuid4()}"
    body = UniversityCreate(name=unique_name, abbreviation="NU", location="Nowhere")

    created = create_university(body, db, make_admin_user())

    assert created.id is not None
    assert created.name == unique_name
    assert created.abbreviation == "NU"
    assert created.location == "Nowhere"

    fetched = db.query(University).filter_by(id=created.id).first()
    assert fetched is not None
    assert fetched.name == unique_name


def test_create_university_rejects_duplicate_name(db: Session):
    unique_name = f"Duplicate University {uuid.uuid4()}"
    body = UniversityCreate(name=unique_name, abbreviation="DU", location="City")

    create_university(body, db, make_admin_user())

    with pytest.raises(HTTPException):
        create_university(body, db, make_admin_user())


def test_delete_university_removes_record(db: Session):
    unique_name = f"Delete University {uuid.uuid4()}"
    university = University(name=unique_name, abbreviation="DU", location="City")
    db.add(university)
    db.commit()
    db.refresh(university)

    delete_university(university.id, db, make_admin_user())

    assert db.query(University).filter_by(id=university.id).first() is None