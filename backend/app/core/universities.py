from fastapi import HTTPException, status
from typing import Optional, Literal
from sqlalchemy.orm import Session

from app.models.models import University

def _create_university(
        db: Session,
        name: str,
        abbreviation: Optional[str] = None,
        location: Optional[str] = None
    ) -> University:

    university = University(
        name=name,
        abbreviation=abbreviation,
        location=location
    )
    db.add(university)
    db.commit()
    db.refresh(university)
    return university

def check_if_university_exists(db: Session, name: str):
    existing = db.query(University).filter(University.name == name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="University already exists"
        )