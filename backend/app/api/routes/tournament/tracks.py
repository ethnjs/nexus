from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.form import track_referenced_by_form_field
from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.permissions import (
    MANAGE_TOURNAMENT, require_catalog_read, require_permission,
)
from app.db.session import get_db
from app.models.models import TournamentTrack, User
from app.schemas.tournament.track import TournamentTrackCreate, TournamentTrackRead, TournamentTrackUpdate


router = APIRouter(prefix="/tournaments/{tournament_id}/tracks", tags=["tournaments"])


def _name_taken(db: Session, tournament_id: int, name: str, *, excluding_id: int | None = None) -> bool:
    query = db.query(TournamentTrack).filter(
        TournamentTrack.tournament_id == tournament_id,
        TournamentTrack.name == name,
    )
    if excluding_id is not None:
        query = query.filter(TournamentTrack.id != excluding_id)
    return query.first() is not None


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/tracks/ — manage_tournament, or any member
# with ?public=true. Archived tracks remain here either way, so staff can
# restore them and so a member's status on a retired track still resolves to
# a name.
#
# Same shape for both audiences for now — a track is a name, an archived flag
# and whether members may confirm themselves on it.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[TournamentTrackRead])
def list_tracks(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_catalog_read(MANAGE_TOURNAMENT)),
):
    get_tournament(tournament_id, db)
    return (
        db.query(TournamentTrack)
        .filter(TournamentTrack.tournament_id == tournament_id)
        .order_by(TournamentTrack.is_archived, TournamentTrack.name)
        .all()
    )


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/tracks/ — creates a tournament-scoped
# catalog entry. Names are unique within a tournament.
# ---------------------------------------------------------------------------
@router.post("/", response_model=TournamentTrackRead, status_code=status.HTTP_201_CREATED)
def create_track(
    tournament_id: int,
    payload: TournamentTrackCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    if _name_taken(db, tournament_id, payload.name):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A track with this name already exists")

    track = TournamentTrack(tournament_id=tournament_id, name=payload.name)
    try:
        db.add(track)
        db.commit()
        db.refresh(track)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A track with this name already exists")
    return track


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/tracks/{track_id}/ — rename a track or
# archive/restore it. Archiving preserves references from historical fields.
# ---------------------------------------------------------------------------
@router.patch("/{track_id}/", response_model=TournamentTrackRead)
def update_track(
    tournament_id: int,
    track_id: int,
    payload: TournamentTrackUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    track = get_scoped_or_404(db, TournamentTrack, track_id, tournament_id, "Track")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and _name_taken(db, tournament_id, updates["name"], excluding_id=track.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A track with this name already exists")
    for field, value in updates.items():
        setattr(track, field, value)

    try:
        db.commit()
        db.refresh(track)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A track with this name already exists")
    return track


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/tracks/{track_id}/ — only tracks with
# no form-field references may be removed. Referenced tracks must be archived.
#
# Every member's status on the track goes with it (CASCADE). That's deliberate:
# a track no form points at is being removed for good, and leaving orphaned
# statuses behind would mean a re-created track of the same name silently
# inherits them.
# ---------------------------------------------------------------------------
@router.delete("/{track_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_track(
    tournament_id: int,
    track_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    track = get_scoped_or_404(db, TournamentTrack, track_id, tournament_id, "Track")
    if track_referenced_by_form_field(db, tournament_id, track.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Track is referenced by a form field and cannot be deleted; archive it instead",
        )

    db.delete(track)
    db.commit()
