from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.permissions import MANAGE_EVENTS, require_permission
from app.db.session import get_db
from app.models.models import (
    TournamentBuilding,
    TournamentEventTrack,
    TournamentRoom,
    TournamentTrack,
    User,
)
from app.schemas.tournament.building import (
    TournamentBuildingCreate,
    TournamentBuildingDeleteResult,
    TournamentBuildingRead,
    TournamentBuildingUpdate,
    TournamentRoomRead,
    TournamentRoomsCreate,
    TournamentRoomUpdate,
    sorted_rooms,
)

router = APIRouter(prefix="/tournaments/{tournament_id}/buildings", tags=["tournaments"])


def _name_taken(
    db: Session, tournament_id: int, name: str, *, excluding_id: int | None = None
) -> bool:
    query = db.query(TournamentBuilding).filter(
        TournamentBuilding.tournament_id == tournament_id,
        TournamentBuilding.name == name,
    )
    if excluding_id is not None:
        query = query.filter(TournamentBuilding.id != excluding_id)
    return query.first() is not None


def _resolve_tracks(db: Session, tournament_id: int, track_ids: list[int]) -> list[TournamentTrack]:
    """The track rows for `track_ids`, or 422 naming any that are unknown,
    pending deletion or not a competition day."""
    if not track_ids:
        return []

    rows = (
        db.query(TournamentTrack)
        .filter(
            TournamentTrack.tournament_id == tournament_id,
            TournamentTrack.id.in_(track_ids),
        )
        .all()
    )

    found = {track.id for track in rows}
    missing = sorted(set(track_ids) - found)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown track id(s): {', '.join(str(i) for i in missing)}",
        )

    archived = sorted(track.id for track in rows if track.is_archived)
    if archived:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Track(s) pending deletion cannot be tagged: {', '.join(str(i) for i in archived)}"
            ),
        )

    not_days = sorted(track.id for track in rows if not track.is_primary)
    if not_days:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Buildings can only be on competition days, not track(s): "
                f"{', '.join(str(i) for i in not_days)}"
            ),
        )
    return rows


def _placements_in(
    db: Session, building_id: int, track_ids: list[int] | None = None
) -> list[TournamentEventTrack]:
    """Event<->track links with a room in this building, optionally only on
    `track_ids`."""
    query = (
        db.query(TournamentEventTrack)
        .join(TournamentEventTrack.rooms)
        .filter(TournamentRoom.building_id == building_id)
    )
    if track_ids is not None:
        query = query.filter(TournamentEventTrack.track_id.in_(track_ids))
    return query.distinct().all()


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
    buildings = (
        db.query(TournamentBuilding)
        .options(
            selectinload(TournamentBuilding.tracks),
            selectinload(TournamentBuilding.rooms),
        )
        .filter(TournamentBuilding.tournament_id == tournament_id)
        .order_by(TournamentBuilding.name)
        .all()
    )
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

    building = TournamentBuilding(
        tournament_id=tournament_id, name=payload.name, short_name=payload.short_name
    )
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
        ) from None
    return TournamentBuildingRead.from_row(building)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/buildings/{building_id}/
#
# `track_ids` is whole-set: sending it replaces the tags. Untagging a track
# that events are placed on here is a 409.
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
    if "name" in updates and _name_taken(
        db, tournament_id, updates["name"], excluding_id=building.id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A building with this name already exists",
        )

    if "name" in updates:
        building.name = updates["name"]
    if "short_name" in updates:
        building.short_name = updates["short_name"]
    if "track_ids" in updates:
        resolved = _resolve_tracks(db, tournament_id, updates["track_ids"])
        # Untagging a track is not a request to unplace events, so it is refused
        # rather than obeyed destructively — unlike DELETE below, where
        # removing the building plainly is that request.
        removed = sorted({t.id for t in building.tracks} - {t.id for t in resolved})
        placed = len(_placements_in(db, building.id, removed)) if removed else 0
        if placed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"{placed} event location(s) still use this building on the "
                    f"track(s) being removed; move those events first"
                ),
            )
        building.tracks = resolved

    try:
        db.commit()
        db.refresh(building)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A building with this name already exists",
        ) from None
    return TournamentBuildingRead.from_row(building)


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/buildings/{building_id}/
#
# Unplaces the events in its rooms rather than refusing, because deleting
# the building *is* that request — and reports how many it unplaced,
# the way a track delete reports the member rows it costs. A 200 with that
# count, not a 204: the price of the delete should never be discovered after
# the fact.
# ---------------------------------------------------------------------------
@router.delete("/{building_id}/", response_model=TournamentBuildingDeleteResult)
def delete_building(
    tournament_id: int,
    building_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    building = get_scoped_or_404(db, TournamentBuilding, building_id, tournament_id, "Building")

    # Its rooms go with it, which unplaces their events; a floor override left
    # behind would read as a location the event still has.
    placements = _placements_in(db, building.id)
    for placement in placements:
        placement.floor = None
    cleared = len(placements)
    db.delete(building)
    db.commit()
    return TournamentBuildingDeleteResult(locations_cleared=cleared)


def _room_name_taken(
    db: Session, building_id: int, name: str, *, excluding_id: int | None = None
) -> bool:
    query = db.query(TournamentRoom).filter(
        TournamentRoom.building_id == building_id,
        func.lower(TournamentRoom.name) == name.lower(),
    )
    if excluding_id is not None:
        query = query.filter(TournamentRoom.id != excluding_id)
    return query.first() is not None


def _get_room_or_404(db: Session, building: TournamentBuilding, room_id: int) -> TournamentRoom:
    room = db.get(TournamentRoom, room_id)
    if room is None or room.building_id != building.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return room


@router.post(
    "/{building_id}/rooms/",
    response_model=list[TournamentRoomRead],
    status_code=status.HTTP_201_CREATED,
)
def create_rooms(
    tournament_id: int,
    building_id: int,
    payload: TournamentRoomsCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    """Add rooms to a building. Names it already has, in any case, are skipped,
    so a list can be pasted again safely. Returns all of the building's rooms in natural
    order."""
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    building = get_scoped_or_404(db, TournamentBuilding, building_id, tournament_id, "Building")

    existing = {room.name.lower() for room in building.rooms}
    for name in payload.names:
        if name.lower() not in existing:
            building.rooms.append(TournamentRoom(name=name))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A room with this name was added at the same time; try again",
        ) from None
    db.refresh(building)
    return sorted_rooms(building.rooms)


@router.patch("/{building_id}/rooms/{room_id}/", response_model=TournamentRoomRead)
def update_room(
    tournament_id: int,
    building_id: int,
    room_id: int,
    payload: TournamentRoomUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    """Rename a room or set its floor. A null `floor` derives it from the name
    again."""
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    building = get_scoped_or_404(db, TournamentBuilding, building_id, tournament_id, "Building")
    room = _get_room_or_404(db, building, room_id)

    updates = payload.model_dump(exclude_unset=True)
    if updates.get("name") is None:
        updates.pop("name", None)
    if "name" in updates and _room_name_taken(
        db, building.id, updates["name"], excluding_id=room.id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This building already has a room with this name",
        )
    for field, value in updates.items():
        setattr(room, field, value)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This building already has a room with this name",
        ) from None
    db.refresh(room)
    return TournamentRoomRead.model_validate(room)


@router.delete("/{building_id}/rooms/{room_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_room(
    tournament_id: int,
    building_id: int,
    room_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    """Delete a room. An event whose only room this was is unplaced on that
    day; one in other rooms too keeps them."""
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    building = get_scoped_or_404(db, TournamentBuilding, building_id, tournament_id, "Building")
    room = _get_room_or_404(db, building, room_id)

    placements = (
        db.query(TournamentEventTrack)
        .join(TournamentEventTrack.rooms)
        .filter(TournamentRoom.id == room.id)
        .all()
    )
    for placement in placements:
        if len(placement.rooms) == 1:
            placement.floor = None
    db.delete(room)
    db.commit()
