from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from datetime import date

from app.models.models import User

def check_if_email_exists(db: Session, email: str):
    existing = db.query(User).filter(User.email == email.lower()).first()
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

def calculate_age(birth_date: date, reference_date: date) -> int:
    return reference_date.year - birth_date.year - ((reference_date.month, reference_date.day) < (birth_date.month, birth_date.day))

def meets_age_requirement(birth_date: date, reference_date: date, min_age: int) -> bool:
    return calculate_age(birth_date, reference_date) >= min_age