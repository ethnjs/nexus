from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.models.models import User, Event, UserCompetitionExperience, UserVolunteerExperience
from app.schemas.user_experience import (
    CompetitionExperienceCreate, CompetitionExperienceUpdate, CompetitionExperienceResponse,
    VolunteerExperienceCreate, VolunteerExperienceUpdate, VolunteerExperienceResponse
)


router = APIRouter(tags=["users"])


# ---------------------------------------------------------------------------
# POST /users/me/competition-experience/ — add a competition experience entry
# ---------------------------------------------------------------------------
@router.post("/users/me/competition-experience/", response_model=CompetitionExperienceResponse, status_code=status.HTTP_201_CREATED)
def create_competition_experience(
    body: CompetitionExperienceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.get(Event, body.event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    entry = UserCompetitionExperience(user_id=current_user.id, **body.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


# ---------------------------------------------------------------------------
# PATCH /users/me/competition-experience/{id}/ — update own entry
# ---------------------------------------------------------------------------
@router.patch("/users/me/competition-experience/{entry_id}/", response_model=CompetitionExperienceResponse)
def update_competition_experience(
    entry_id: int,
    body: CompetitionExperienceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = db.get(UserCompetitionExperience, entry_id)
    if not entry or entry.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")

    data = body.model_dump(exclude_unset=True)
    if "event_id" in data:
        event = db.get(Event, data["event_id"])
        if not event:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    for field, value in data.items():
        setattr(entry, field, value)

    db.commit()
    db.refresh(entry)
    return entry


# ---------------------------------------------------------------------------
# DELETE /users/me/competition-experience/{id}/ — delete own entry
# ---------------------------------------------------------------------------
@router.delete("/users/me/competition-experience/{entry_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_competition_experience(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = db.get(UserCompetitionExperience, entry_id)
    if not entry or entry.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")

    db.delete(entry)
    db.commit()



# ---------------------------------------------------------------------------
# POST /users/me/volunteer-experience/ — add a volunteer experience entry
# (manual entry only — see model note: auto-populate from NEXUS is future work)
# ---------------------------------------------------------------------------
@router.post("/users/me/volunteer-experience/", response_model=VolunteerExperienceResponse, status_code=status.HTTP_201_CREATED)
def create_volunteer_experience(
    body: VolunteerExperienceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.event_id is not None:
        event = db.get(Event, body.event_id)
        if not event:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    entry = UserVolunteerExperience(
        user_id=current_user.id,
        tournament_name=body.tournament_name,
        year=body.year,
        event_id=body.event_id,
        role=body.role,
        notes=body.notes.model_dump(exclude_none=True) if body.notes else None,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


# ---------------------------------------------------------------------------
# PATCH /users/me/volunteer-experience/{id}/ — update own entry
# ---------------------------------------------------------------------------
@router.patch("/users/me/volunteer-experience/{entry_id}/", response_model=VolunteerExperienceResponse)
def update_volunteer_experience(
    entry_id: int,
    body: VolunteerExperienceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = db.get(UserVolunteerExperience, entry_id)
    if not entry or entry.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")

    data = body.model_dump(exclude_unset=True)

    if "event_id" in data and data["event_id"] is not None:
        event = db.get(Event, data["event_id"])
        if not event:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # re-check mutual exclusivity against the merged post-update state
    resulting_event_id = data.get("event_id", entry.event_id)
    resulting_notes = data.get("notes", entry.notes)
    resulting_notes_event = resulting_notes.get("event") if isinstance(resulting_notes, dict) else None
    if resulting_event_id is not None and resulting_notes_event:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="event_id and notes.event are mutually exclusive",
        )

    if "notes" in data:
        data["notes"] = data["notes"].model_dump(exclude_none=True) if data["notes"] else None

    for field, value in data.items():
        setattr(entry, field, value)

    db.commit()
    db.refresh(entry)
    return entry


# ---------------------------------------------------------------------------
# DELETE /users/me/volunteer-experience/{id}/ — delete own entry
# ---------------------------------------------------------------------------
@router.delete("/users/me/volunteer-experience/{entry_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_volunteer_experience(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = db.get(UserVolunteerExperience, entry_id)
    if not entry or entry.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")

    db.delete(entry)
    db.commit()