from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from datetime import date
from typing import Optional

from app.models.models import User

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