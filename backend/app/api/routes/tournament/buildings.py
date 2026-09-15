from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.permissions import MANAGE_EVENTS, require_permission
from app.db.session import get_db
from app.models.models import TournamentBuilding, TournamentTrack, User
from app.schemas.tournament.building import (
    TournamentBuildingCreate, TournamentBuildingRead, TournamentBuildingUpdate,
)


router = APIRouter(prefix="/tournaments/{tournament_id}/buildings", tags=["tournaments"])


def _name_taken(db: Session, tournament_id: int, name: str, *, excluding_id: int | None = None) -> bool:
    query = db.query(TournamentBuilding).filter(
        TournamentBuilding.tournament_id == tournament_id,
        TournamentBuilding.name == name,
    )
    if excluding_id is not None:
        query = query.filter(TournamentBuilding.id != excluding_id)
    return query.first() is not None


def _resolve_tracks(db: Session, tournament_id: int, track_ids: list[int]) -> list[TournamentTrack]:
    """The track rows for `track_ids`, or 422 naming the ones that don't
    resolve.

    A pending-delete track is rejected rather than silently dropped: tagging a
    building onto a track a TD is trying to remove is a mistake worth saying
    out loud, and the tag would be one more reference keeping that track
    alive.
    """
    if not track_ids:
        return []

    rows = db.query(TournamentTrack).filter(
        TournamentTrack.tournament_id == tournament_id,
        TournamentTrack.id.in_(track_ids),
    ).all()

    found = {track.id for track in rows}
    missing = sorted(set(track_ids) - found)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown track id(s): {', '.join(str(i) for i in missing)}",
        )

    archived = sorted(track.id for track in rows if track.is_archived)
    if archived:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Track(s) pending deletion cannot be tagged: "
                f"{', '.join(str(i) for i in archived)}"
            ),
        )
    return rows


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/buildings/
#
# No ?public=true counterpart, unlike tracks and shifts. Where an event
# physically happens is day-of logistics that stays staff-side until the
# tournament runs — the same reason EventMemberRead withholds building/room.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[TournamentBuildingRead])
def list_buildings(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    get_tournament(tournament_id, db)
    buildings = db.query(TournamentBuilding).options(
        # Every row serializes its track ids; without this the listing is one
        # extra query per building.
        selectinload(TournamentBuilding.tracks)
    ).filter(
        TournamentBuilding.tournament_id == tournament_id
    ).order_by(TournamentBuilding.name).all()
    return [TournamentBuildingRead.from_row(b) for b in buildings]


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/buildings/ — names are unique within a
# tournament, not within a track: one "Rowland Hall" serves every day that
# uses it.
# ---------------------------------------------------------------------------
@router.post("/", response_model=TournamentBuildingRead, status_code=status.HTTP_201_CREATED)
def create_building(
    tournament_id: int,
    payload: TournamentBuildingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    if _name_taken(db, tournament_id, payload.name):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A building with this name already exists",
        )

    building = TournamentBuilding(tournament_id=tournament_id, name=payload.name)
    building.tracks = _resolve_tracks(db, tournament_id, payload.track_ids)
    try:
        db.add(building)
        db.commit()
        db.refresh(building)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A building with this name already exists",
        )
    return TournamentBuildingRead.from_row(building)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/buildings/{building_id}/
#
# `track_ids` is whole-set: sending it replaces the tags. Untagging a track
# will later have to clear the event locations pointing at this building on
# that track — the composite FK added with those columns cannot be
# ON DELETE SET NULL, because track_id is half the event-track link's primary
# key and can't be nulled.
# ---------------------------------------------------------------------------
@router.patch("/{building_id}/", response_model=TournamentBuildingRead)
def update_building(
    tournament_id: int,
    building_id: int,
    payload: TournamentBuildingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    building = get_scoped_or_404(db, TournamentBuilding, building_id, tournament_id, "Building")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and _name_taken(db, tournament_id, updates["name"], excluding_id=building.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A building with this name already exists",
        )

    if "name" in updates:
        building.name = updates["name"]
    if "track_ids" in updates:
        building.tracks = _resolve_tracks(db, tournament_id, updates["track_ids"])

    try:
        db.commit()
        db.refresh(building)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A building with this name already exists",
        )
    return TournamentBuildingRead.from_row(building)


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/buildings/{building_id}/
#
# Unconditional today — nothing references a building yet. Once events carry
# a building on their track link, this has to clear those locations first for
# the same reason the PATCH above does.
# ---------------------------------------------------------------------------
@router.delete("/{building_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_building(
    tournament_id: int,
    building_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    building = get_scoped_or_404(db, TournamentBuilding, building_id, tournament_id, "Building")
    db.delete(building)
    db.commit()
