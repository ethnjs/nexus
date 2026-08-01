from fastapi import HTTPException, status, Depends
from typing import Optional
from sqlalchemy.orm import Session

from app.models.models import University
from app.db.session import get_db

def create_university_record(
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

def find_university(
        university_id: int,
        db: Session = Depends(get_db)
    ) -> University:
    university = db.query(University).filter(University.id == university_id).first()
    if not university:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="University not found"
        )
    return university