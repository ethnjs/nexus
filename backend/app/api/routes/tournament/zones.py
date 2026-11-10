from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.assignments import authorize_role_grant
from app.core.tournament.permissions import (
    MANAGE_EVENTS,
    MANAGE_MEMBERS,
    require_permission,
)
from app.core.tournament.zones import (
    KIND_EVENT,
    KIND_ROOM,
    events_by_zone,
    resolve_track_zones,
    unplaced_event_ids,
    unzoned_event_ids,
)
from app.db.session import get_db
from app.models.models import (
    TournamentBuildingTrack,
    TournamentEventTrack,
    TournamentMembership,
    TournamentRole,
    TournamentRoom,
    TournamentTrack,
    TournamentTrackAssignment,
    TournamentZone,
    TournamentZoneMember,
    User,
)
from app.schemas.tournament.zone import (
    ZoneAssignmentCreate,
    ZoneAssignmentRead,
    ZoneCoverageRead,
    ZoneCreate,
    ZoneMember,
    ZoneRead,
    ZoneUpdate,
)

router = APIRouter(prefix="/tournaments/{tournament_id}/zones", tags=["tournaments"])

# Flat under the tournament, like event assignments.
assignments_router = APIRouter(
    prefix="/tournaments/{tournament_id}/zone-assignments",
    tags=["tournaments"],
)


def _zone_query(db: Session):
    """Eager-loads every hop a ZoneRead flattens."""
    members = selectinload(TournamentZone.members)
    return db.query(TournamentZone).options(
        members.joinedload(TournamentZoneMember.building),
        members.joinedload(TournamentZoneMember.room),
        members.joinedload(TournamentZoneMember.tournament_event),
    )


def _get_track(db: Session, tournament_id: int, track_id: int) -> TournamentTrack:
    track = get_scoped_or_404(db, TournamentTrack, track_id, tournament_id, "Track")
    if track.is_archived:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That track is pending deletion",
        )
    return track


def _validate_members(
    db: Session, tournament_id: int, track_id: int, members: list[ZoneMember]
) -> None:
    """422 unless every rule names something on this track and none repeats.
    Fills in each room rule's building_id from its room."""
    room_ids = {m.room_id for m in members if m.kind == KIND_ROOM}
    if room_ids:
        rooms = {
            room.id: room
            for room in db.query(TournamentRoom)
            .options(joinedload(TournamentRoom.building))
            .filter(TournamentRoom.id.in_(room_ids))
        }
        for member in members:
            if member.kind != KIND_ROOM:
                continue
            room = rooms.get(member.room_id)
            if room is None or room.building.tournament_id != tournament_id:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"Room {member.room_id} not found",
                )
            member.building_id = room.building_id

    seen: set[tuple] = set()
    for member in members:
        key = member.dedupe_key()
        if key in seen:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A zone must not name the same building, floor, room or event twice",
            )
        seen.add(key)

    building_ids = {m.building_id for m in members if m.building_id is not None}
    if building_ids:
        tagged = {
            row_id
            for (row_id,) in db.query(TournamentBuildingTrack.building_id).filter(
                TournamentBuildingTrack.track_id == track_id,
                TournamentBuildingTrack.building_id.in_(building_ids),
            )
        }
        missing = sorted(building_ids - tagged)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    f"Building {missing[0]} is not available on this track; "
                    f"tag it with the track first"
                ),
            )

    event_ids = {
        m.tournament_event_id
        for m in members
        if m.kind == KIND_EVENT and m.tournament_event_id is not None
    }
    if event_ids:
        on_track = {
            row_id
            for (row_id,) in db.query(TournamentEventTrack.tournament_event_id).filter(
                TournamentEventTrack.track_id == track_id,
                TournamentEventTrack.tournament_event_id.in_(event_ids),
            )
        }
        missing = sorted(event_ids - on_track)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Event {missing[0]} does not run on this track",
            )


def _set_members(db: Session, zone: TournamentZone, members: list[ZoneMember]) -> None:
    """Replace a zone's rules whole-set. Flushes when it removes rules."""
    if zone.members:
        zone.members.clear()
        # The unit of work inserts before it deletes, so a rule kept across
        # the replace would collide with its own old row in the unique indexes.
        db.flush()
    for member in members:
        zone.members.append(
            TournamentZoneMember(
                track_id=zone.track_id,
                kind=member.kind,
                building_id=member.building_id,
                floor=member.floor,
                room_id=member.room_id,
                tournament_event_id=member.tournament_event_id,
            )
        )


def _claimed_conflict(db: Session) -> None:
    """Turn the partial unique indexes into a 409 a TD can act on."""
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            "Another zone on this track already claims one of those buildings, floors, rooms "
            "or events"
        ),
    )


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/zones/?track_id=N
# ---------------------------------------------------------------------------
@router.get("/", response_model=ZoneCoverageRead)
def list_zones(
    tournament_id: int,
    track_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    get_tournament(tournament_id, db)
    _get_track(db, tournament_id, track_id)

    zones = (
        _zone_query(db)
        .filter(
            TournamentZone.track_id == track_id,
        )
        .order_by(TournamentZone.name)
        .all()
    )

    resolved = resolve_track_zones(db, track_id)
    grouped = events_by_zone(db, track_id, resolved)
    return ZoneCoverageRead(
        track_id=track_id,
        zones=[ZoneRead.from_row(z, grouped.get(z.id, [])) for z in zones],
        unzoned_event_ids=unzoned_event_ids(resolved),
        unplaced_event_ids=unplaced_event_ids(db, track_id),
    )


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/zones/
# ---------------------------------------------------------------------------
@router.post("/", response_model=ZoneRead, status_code=status.HTTP_201_CREATED)
def create_zone(
    tournament_id: int,
    payload: ZoneCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    track = _get_track(db, tournament_id, payload.track_id)
    if not track.is_primary:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Zones can only be made on a competition day",
        )
    _validate_members(db, tournament_id, payload.track_id, payload.members)

    zone = TournamentZone(
        tournament_id=tournament_id,
        track_id=payload.track_id,
        name=payload.name,
    )
    db.add(zone)
    _set_members(db, zone, payload.members)

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if "uq_tournament_zone_name" in str(error.orig):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A zone with this name already exists on this track",
            ) from error
        _claimed_conflict(db)

    db.refresh(zone)
    grouped = events_by_zone(db, zone.track_id)
    return ZoneRead.from_row(zone, grouped.get(zone.id, []))


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/zones/{zone_id}/
#
# The track is not editable: the zone's rules and assignments are scoped to it.
# ---------------------------------------------------------------------------
@router.patch("/{zone_id}/", response_model=ZoneRead)
def update_zone(
    tournament_id: int,
    zone_id: int,
    payload: ZoneUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    zone = get_scoped_or_404(db, TournamentZone, zone_id, tournament_id, "Zone")

    # Rules before the name: their queries and flush would write a pending
    # rename outside the try below, turning a duplicate name into a 500.
    if payload.members is not None:
        _validate_members(db, tournament_id, zone.track_id, payload.members)
        _set_members(db, zone, payload.members)
    if payload.name is not None:
        zone.name = payload.name

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if "uq_tournament_zone_name" in str(error.orig):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A zone with this name already exists on this track",
            ) from error
        _claimed_conflict(db)

    db.refresh(zone)
    grouped = events_by_zone(db, zone.track_id)
    return ZoneRead.from_row(zone, grouped.get(zone.id, []))


def _claim_of(db: Session, track_id: int, member: ZoneMember) -> TournamentZoneMember | None:
    """The rule row on this track that claims what `member` names, if any."""
    query = db.query(TournamentZoneMember).filter(
        TournamentZoneMember.track_id == track_id,
        TournamentZoneMember.kind == member.kind,
    )
    if member.kind == KIND_ROOM:
        query = query.filter(TournamentZoneMember.room_id == member.room_id)
    elif member.kind == KIND_EVENT:
        query = query.filter(TournamentZoneMember.tournament_event_id == member.tournament_event_id)
    else:
        query = query.filter(
            TournamentZoneMember.building_id == member.building_id,
            TournamentZoneMember.floor == member.floor,
        )
    return query.first()


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/zones/{zone_id}/rules/
# ---------------------------------------------------------------------------
@router.post("/{zone_id}/rules/", response_model=ZoneRead)
def add_zone_rule(
    tournament_id: int,
    zone_id: int,
    payload: ZoneMember,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    """Add one rule to a zone. If another zone on the same track holds that
    rule, it moves here in the same transaction. Adding a rule the zone already
    holds changes nothing."""
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    zone = get_scoped_or_404(db, TournamentZone, zone_id, tournament_id, "Zone")
    _validate_members(db, tournament_id, zone.track_id, [payload])

    claim = _claim_of(db, zone.track_id, payload)
    if claim is None or claim.zone_id != zone.id:
        if claim is not None:
            db.delete(claim)
            db.flush()
        zone.members.append(
            TournamentZoneMember(
                track_id=zone.track_id,
                kind=payload.kind,
                building_id=payload.building_id,
                floor=payload.floor,
                room_id=payload.room_id,
                tournament_event_id=payload.tournament_event_id,
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            _claimed_conflict(db)

    db.refresh(zone)
    grouped = events_by_zone(db, zone.track_id)
    return ZoneRead.from_row(zone, grouped.get(zone.id, []))


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/zones/{zone_id}/ — assignments cascade.
# ---------------------------------------------------------------------------
@router.delete("/{zone_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_zone(
    tournament_id: int,
    zone_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    zone = get_scoped_or_404(db, TournamentZone, zone_id, tournament_id, "Zone")
    db.delete(zone)
    db.commit()


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/zone-assignments/?track_id=N
# ---------------------------------------------------------------------------
@assignments_router.get("/", response_model=list[ZoneAssignmentRead])
def list_zone_assignments(
    tournament_id: int,
    track_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    get_tournament(tournament_id, db)
    query = (
        db.query(TournamentTrackAssignment)
        .join(TournamentZone, TournamentZone.id == TournamentTrackAssignment.zone_id)
        .options(
            joinedload(TournamentTrackAssignment.zone),
            joinedload(TournamentTrackAssignment.membership).joinedload(TournamentMembership.user),
        )
        .filter(TournamentZone.tournament_id == tournament_id)
    )
    if track_id is not None:
        query = query.filter(TournamentZone.track_id == track_id)
    return [ZoneAssignmentRead.from_row(row) for row in query.all()]


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/zone-assignments/ — manage_members
#
# `role_id` falls back to the track's zone_default_role_id. As with an event
# assignment, a role the member doesn't hold is granted first, and
# availability and track status stay warnings rather than refusals.
# ---------------------------------------------------------------------------
@assignments_router.post(
    "/",
    response_model=ZoneAssignmentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_zone_assignment(
    tournament_id: int,
    payload: ZoneAssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    zone = get_scoped_or_404(db, TournamentZone, payload.zone_id, tournament_id, "Zone")
    membership = get_scoped_or_404(
        db,
        TournamentMembership,
        payload.membership_id,
        tournament_id,
        "Membership",
    )

    role_id = payload.role_id or zone.track.zone_default_role_id
    if role_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "This day has no zone role; set one for the day or name a role on the assignment"
            ),
        )
    role = get_scoped_or_404(db, TournamentRole, role_id, tournament_id, "Role")

    authorize_role_grant(db, tournament, membership, role, current_user)

    assignment = TournamentTrackAssignment(
        zone_id=zone.id,
        membership_id=membership.id,
        role_id=role.id,
        tournament_track_id=zone.track_id,
    )
    db.add(assignment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That member already covers this zone in that role",
        ) from None

    db.refresh(assignment)
    return ZoneAssignmentRead.from_row(assignment)


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/zone-assignments/{assignment_id}/
# ---------------------------------------------------------------------------
@assignments_router.delete("/{assignment_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_zone_assignment(
    tournament_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    assignment = (
        db.query(TournamentTrackAssignment)
        .join(TournamentZone, TournamentZone.id == TournamentTrackAssignment.zone_id)
        .filter(
            TournamentTrackAssignment.id == assignment_id,
            TournamentZone.tournament_id == tournament_id,
        )
        .first()
    )
    if assignment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Zone assignment not found",
        )

    db.delete(assignment)
    db.commit()
