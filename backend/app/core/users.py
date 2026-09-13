from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from datetime import date
from typing import Optional

from app.models.models import User
from app.core.auth import hash_password

def check_if_email_exists(db: Session, email: str, exclude_user_id: Optional[int] = None):
    query = db.query(User).filter(User.email == email.lower())
    if exclude_user_id is not None:
        query = query.filter(User.id != exclude_user_id)
    existing = query.first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )
    

def find_user_by_id(db: Session, id: int) -> User:
    user = db.query(User).filter(User.id == id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def require_not_last_admin(db: Session, user: User) -> None:
    """Refuses to take the platform's only admin out of service.

    Belongs on the *self-service* routes, not the admin ones. An admin acting
    on somebody else is still an admin afterwards, so once the admin routes
    refuse to act on the caller themselves they can never reach zero admins.
    Self-delete and self-deactivate are the only paths that can, and both are
    one-way: nothing outside an admin can restore an account.
    """
    if user.role != "admin":
        return
    if db.query(User).filter(User.role == "admin").count() <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The platform must keep at least one admin account",
        )

def create_user(
    db: Session,
    email: str,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    role: str = "user",
    phone: Optional[str] = None,
    password: Optional[str] = None,
    status: str = "active",
) -> User:
    user = User(
        email=email.lower(),
        phone=phone,
        hashed_password=hash_password(password) if password else None,
        first_name=first_name,
        last_name=last_name,
        role=role,
        status=status,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user