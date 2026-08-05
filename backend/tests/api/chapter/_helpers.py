"""Shared test data builders for chapter API tests."""
import uuid

from app.core.auth import hash_password
from app.models.models import AlumniChapter, JoinCode, University, User


def make_university(db, **kwargs):
    defaults = {
        "name": f"Test University {uuid.uuid4()}",
        "abbreviation": "TU",
        "location": "Test City",
    }
    defaults.update(kwargs)
    university = University(**defaults)
    db.add(university)
    db.commit()
    db.refresh(university)
    return university


def make_chapter(db, university_id, **kwargs):
    defaults = {"name": f"Test Chapter {uuid.uuid4()}", "university_id": university_id}
    defaults.update(kwargs)
    chapter = AlumniChapter(**defaults)
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    return chapter


def make_user(db, email, password="Password@1", role="user", **kwargs):
    defaults = {
        "first_name": "Test",
        "last_name": "User",
        "email": email,
        "hashed_password": hash_password(password),
        "role": role,
        "status": "active",
    }
    defaults.update(kwargs)
    user = User(**defaults)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_join_code(db, chapter_id, created_by, **kwargs):
    defaults = {
        "code": "JOIN1234",
        "label": "Join code",
        "expires_at": None,
        "is_active": True,
    }
    defaults.update(kwargs)
    join_code = JoinCode(
        chapter_id=chapter_id,
        created_by=created_by,
        **defaults,
    )
    db.add(join_code)
    db.commit()
    db.refresh(join_code)
    return join_code
