from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.models.models import Event, User, UserCompetitionExperience, UserVolunteerExperience
from app.schemas.user_experience import (
    CompetitionExperienceCreate,
    CompetitionExperienceItem,
    CompetitionExperienceResponse,
    CompetitionExperienceUpdate,
    VolunteerExperienceCreate,
    VolunteerExperienceItem,
    VolunteerExperienceResponse,
    VolunteerExperienceUpdate,
)

router = APIRouter(tags=["users"])


def _require_events_exist(db: Session, event_ids: set[int]) -> None:
    if event_ids and db.query(Event).filter(Event.id.in_(event_ids)).count() != len(event_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")


def _own_entries_by_id[T: (UserCompetitionExperience, UserVolunteerExperience)](
    db: Session, model: type[T], user: User, requested_ids: list[int]
) -> dict[int, T]:
    """The user's saved entries by id; 404s if a requested id isn't one of them."""
    if len(requested_ids) != len(set(requested_ids)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Duplicate entry id"
        )
    entries = {e.id: e for e in db.query(model).filter(model.user_id == user.id).all()}
    if not set(requested_ids) <= entries.keys():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    return entries


# ---------------------------------------------------------------------------
# POST /users/me/competition-experience/ — add a competition experience entry
# ---------------------------------------------------------------------------
@router.post(
    "/users/me/competition-experience/",
    response_model=CompetitionExperienceResponse,
    status_code=status.HTTP_201_CREATED,
)
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
# PUT /users/me/competition-experience/ — replace all own entries
# ---------------------------------------------------------------------------
@router.put("/users/me/competition-experience/", response_model=list[CompetitionExperienceResponse])
def replace_competition_experience(
    body: list[CompetitionExperienceItem],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Replace your competition experience with this list. Entries with an `id` are updated,
    entries without one are created, and saved entries left out are deleted. Nothing is saved
    if any entry is invalid."""
    _require_events_exist(db, {item.event_id for item in body})
    existing = _own_entries_by_id(
        db, UserCompetitionExperience, current_user, [i.id for i in body if i.id is not None]
    )

    entries = []
    for item in body:
        data = item.model_dump(exclude={"id"})
        if item.id is None:
            entry = UserCompetitionExperience(user_id=current_user.id, **data)
            db.add(entry)
        else:
            entry = existing.pop(item.id)
            for field, value in data.items():
                setattr(entry, field, value)
        entries.append(entry)
    for entry in existing.values():
        db.delete(entry)

    db.commit()
    return entries


# ---------------------------------------------------------------------------
# PATCH /users/me/competition-experience/{id}/ — update own entry
# ---------------------------------------------------------------------------
@router.patch(
    "/users/me/competition-experience/{entry_id}/", response_model=CompetitionExperienceResponse
)
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
@router.delete(
    "/users/me/competition-experience/{entry_id}/", status_code=status.HTTP_204_NO_CONTENT
)
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
@router.post(
    "/users/me/volunteer-experience/",
    response_model=VolunteerExperienceResponse,
    status_code=status.HTTP_201_CREATED,
)
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
# PUT /users/me/volunteer-experience/ — replace all own entries
# ---------------------------------------------------------------------------
@router.put("/users/me/volunteer-experience/", response_model=list[VolunteerExperienceResponse])
def replace_volunteer_experience(
    body: list[VolunteerExperienceItem],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Replace your volunteer experience with this list. Entries with an `id` are updated,
    entries without one are created, and saved entries left out are deleted. Nothing is saved
    if any entry is invalid."""
    _require_events_exist(db, {item.event_id for item in body if item.event_id is not None})
    existing = _own_entries_by_id(
        db, UserVolunteerExperience, current_user, [i.id for i in body if i.id is not None]
    )

    entries = []
    for item in body:
        data = item.model_dump(exclude={"id", "notes"})
        data["notes"] = item.notes.model_dump(exclude_none=True) if item.notes else None
        if item.id is None:
            entry = UserVolunteerExperience(user_id=current_user.id, **data)
            db.add(entry)
        else:
            entry = existing.pop(item.id)
            for field, value in data.items():
                setattr(entry, field, value)
        entries.append(entry)
    for entry in existing.values():
        db.delete(entry)

    db.commit()
    return entries


# ---------------------------------------------------------------------------
# PATCH /users/me/volunteer-experience/{id}/ — update own entry
# ---------------------------------------------------------------------------
@router.patch(
    "/users/me/volunteer-experience/{entry_id}/", response_model=VolunteerExperienceResponse
)
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
    resulting_notes_event = (
        resulting_notes.get("event") if isinstance(resulting_notes, dict) else None
    )
    if resulting_event_id is not None and resulting_notes_event:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
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
