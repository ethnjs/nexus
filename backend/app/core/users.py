from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.models import User

def check_if_email_exists(db: Session, email: str):
    existing = db.query(User).filter(User.email == email.lower()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )