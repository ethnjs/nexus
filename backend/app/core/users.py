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

def create_user(
    db: Session,
    email: str,
    first_name: str,
    last_name: str,
    role: str,
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