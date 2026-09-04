from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.audit import (
    TRACK_DELETE_CANCELLED, TRACK_DELETE_PENDING, log_action,
)
from app.core.tournament.permissions import (
    MANAGE_TOURNAMENT, require_catalog_read, require_permission,
)
from app.core.tournament.tracks import (
    live_primary_track_count, track_blocking_references, track_member_data_count,
)
from app.db.session import get_db
from app.models.models import TournamentTrack, User
from app.schemas.tournament.track import (
    TournamentTrackCreate, TournamentTrackDeleteResult, TournamentTrackRead,
    TournamentTrackUpdate, require_primary_fields,
)


router = APIRouter(prefix="/tournaments/{tournament_id}/tracks", tags=["tournaments"])


def _name_taken(db: Session, tournament_id: int, name: str, *, excluding_id: int | None = None) -> bool:
    query = db.query(TournamentTrack).filter(
        TournamentTrack.tournament_id == tournament_id,
        TournamentTrack.name == name,
    )
    if excluding_id is not None:
        query = query.filter(TournamentTrack.id != excluding_id)
    return query.first() is not None


def _validate_state(track: TournamentTrack) -> None:
    """Runs the primary/cosmetic invariant against the track as it will be
    stored. A PATCH can't be judged on its own — sending only `location`
    still has to hold against the row's existing dates and division — so the
    check happens after the merge, not in the payload schema."""
    try:
        require_primary_fields(track)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/tracks/ — manage_tournament, or any member
# with ?public=true.
#
# Pending-delete tracks are included only for the manage_tournament audience:
# tournament settings is the one place they still exist, so a TD can see what
# is blocking the delete and restore the track if it was a mistake. Members
# get the live catalog, since a track on its way out is not something to
# answer questions about.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[TournamentTrackRead])
def list_tracks(
    tournament_id: int,
    public: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_catalog_read(MANAGE_TOURNAMENT)),
):
    get_tournament(tournament_id, db)
    query = db.query(TournamentTrack).filter(TournamentTrack.tournament_id == tournament_id)
    if public:
        query = query.filter(TournamentTrack.is_archived.is_(False))
    return query.order_by(
        TournamentTrack.is_archived, TournamentTrack.is_primary.desc(), TournamentTrack.name
    ).all()


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/tracks/ — adds a track to an existing
# tournament. Names are unique within a tournament.
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

    track = TournamentTrack(tournament_id=tournament_id, **payload.model_dump())
    try:
        db.add(track)
        db.commit()
        db.refresh(track)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A track with this name already exists")
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    return track


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/tracks/{track_id}/ — edit a track's name,
# schedule, venue, divisions or self-confirm flag.
#
# `is_archived` is not editable here: pending-delete is set by DELETE and
# cleared by /restore/, never by a TD toggling a field.
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

    # Demoting the last primary track would leave the tournament with no
    # dates, venue or divisions at all — the same hole deleting it would.
    if updates.get("is_primary") is False and track.is_primary:
        if live_primary_track_count(db, tournament_id, excluding_id=track.id) == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A tournament needs at least one primary track; make another track primary first",
            )

    for field, value in updates.items():
        setattr(track, field, value)
    _validate_state(track)

    try:
        db.commit()
        db.refresh(track)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A track with this name already exists")
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    return track


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/tracks/{track_id}/
#
# Two outcomes, both a 200 rather than a 204 — the caller needs to know which
# happened, and what is still in the way:
#
#   purged     nothing TD-authored referenced the track. Gone, along with
#              every member's data for it.
#   pending    shifts or form fields still point here. The track is hidden
#              from everyone but tournament settings and hard-deleted
#              automatically once the last of those is repointed (see
#              purge_pending_tracks). Restorable until then.
# ---------------------------------------------------------------------------
@router.delete("/{track_id}/", response_model=TournamentTrackDeleteResult)
def delete_track(
    tournament_id: int,
    track_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    track = get_scoped_or_404(db, TournamentTrack, track_id, tournament_id, "Track")

    if track.is_primary and live_primary_track_count(db, tournament_id, excluding_id=track.id) == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A tournament needs at least one primary track; make another track primary first",
        )

    blockers = track_blocking_references(db, tournament_id, track.id)
    member_rows = track_member_data_count(db, track.id)

    if blockers:
        if not track.is_archived:
            track.is_archived = True
            log_action(
                db, tournament_id, current_user.id, TRACK_DELETE_PENDING,
                target_type="track", target_id=track.id,
                extra_data={"name": track.name, "blocked_by": blockers},
            )
        db.commit()
        return TournamentTrackDeleteResult(
            purged=False, blocked_by=blockers, member_rows_deleted=member_rows,
        )

    log_action(
        db, tournament_id, current_user.id, TRACK_DELETE_PENDING,
        target_type="track", target_id=track.id,
        extra_data={"name": track.name, "blocked_by": [], "purged_immediately": True},
    )
    db.delete(track)
    db.commit()
    return TournamentTrackDeleteResult(purged=True, blocked_by=[], member_rows_deleted=member_rows)


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/tracks/{track_id}/restore/ — undo a
# pending delete. Only reachable while the track is still blocked; once the
# last reference clears it is already gone.
# ---------------------------------------------------------------------------
@router.post("/{track_id}/restore/", response_model=TournamentTrackRead)
def restore_track(
    tournament_id: int,
    track_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    track = get_scoped_or_404(db, TournamentTrack, track_id, tournament_id, "Track")
    if not track.is_archived:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This track is not pending deletion",
        )

    track.is_archived = False
    log_action(
        db, tournament_id, current_user.id, TRACK_DELETE_CANCELLED,
        target_type="track", target_id=track.id, extra_data={"name": track.name},
    )
    db.commit()
    db.refresh(track)
    return track
