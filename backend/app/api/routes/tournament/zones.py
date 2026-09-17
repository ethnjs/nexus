from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.assignments import authorize_role_grant
from app.core.tournament.permissions import (
    MANAGE_EVENTS, MANAGE_MEMBERS, require_permission,
)
from app.core.tournament.zones import (
    KIND_BUILDING, KIND_EVENT, KIND_FLOOR, events_by_zone, unplaced_event_ids,
    unzoned_event_ids,
)
from app.db.session import get_db
from app.models.models import (
    TournamentBuildingTrack, TournamentEventTrack, TournamentMembership, TournamentRole,
    TournamentTrack, TournamentTrackAssignment, TournamentZone, TournamentZoneMember, User,
)
from app.schemas.tournament.zone import (
    ZoneAssignmentCreate, ZoneAssignmentRead, ZoneCoverageRead, ZoneCreate, ZoneMember,
    ZoneRead, ZoneUpdate,
)


router = APIRouter(prefix="/tournaments/{tournament_id}/zones", tags=["tournaments"])

# Flat under the tournament rather than nested under a zone, for the same
# reason event assignments are: the page that writes these drags between a
# member list and a zone, and nesting would make one of the two a body field
# for no reason.
assignments_router = APIRouter(
    prefix="/tournaments/{tournament_id}/zone-assignments", tags=["tournaments"],
)


def _zone_query(db: Session):
    """Every hop a ZoneRead flattens. Without these each zone costs a query
    per rule for its building and event names."""
    return db.query(TournamentZone).options(
        joinedload(TournamentZone.default_role),
        selectinload(TournamentZone.members).joinedload(TournamentZoneMember.building),
        selectinload(TournamentZone.members).joinedload(
            TournamentZoneMember.tournament_event
        ),
    )


def _get_track(db: Session, tournament_id: int, track_id: int) -> TournamentTrack:
    track = get_scoped_or_404(db, TournamentTrack, track_id, tournament_id, "Track")
    if track.is_archived:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="That track is pending deletion",
        )
    return track


def _check_default_role(db: Session, tournament_id: int, role_id: int | None) -> None:
    if role_id is not None:
        get_scoped_or_404(db, TournamentRole, role_id, tournament_id, "Role")


def _validate_members(db: Session, track_id: int, members: list[ZoneMember]) -> None:
    """Every rule names something that exists on this track, and no rule is
    repeated.

    The database enforces all of this too — the composite FKs and the three
    partial unique indexes — but an IntegrityError reaches the caller as a 500
    with nothing actionable in it. Everything here is a friendlier restatement,
    not the only line of defence.
    """
    seen: set[tuple] = set()
    for member in members:
        key = member.dedupe_key()
        if key in seen:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A zone must not name the same building, floor or event twice",
            )
        seen.add(key)

    building_ids = {
        m.building_id for m in members
        if m.kind in (KIND_BUILDING, KIND_FLOOR) and m.building_id is not None
    }
    if building_ids:
        tagged = {
            row_id for (row_id,) in db.query(TournamentBuildingTrack.building_id).filter(
                TournamentBuildingTrack.track_id == track_id,
                TournamentBuildingTrack.building_id.in_(building_ids),
            )
        }
        missing = sorted(building_ids - tagged)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Building {missing[0]} is not available on this track; "
                    f"tag it with the track first"
                ),
            )

    event_ids = {
        m.tournament_event_id for m in members
        if m.kind == KIND_EVENT and m.tournament_event_id is not None
    }
    if event_ids:
        on_track = {
            row_id for (row_id,) in db.query(
                TournamentEventTrack.tournament_event_id
            ).filter(
                TournamentEventTrack.track_id == track_id,
                TournamentEventTrack.tournament_event_id.in_(event_ids),
            )
        }
        missing = sorted(event_ids - on_track)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Event {missing[0]} does not run on this track",
            )


def _set_members(zone: TournamentZone, members: list[ZoneMember]) -> None:
    """Replace a zone's rules whole-set.

    Rebuilt rather than diffed, unlike an event's track links: a rule carries
    nothing but its own identity, so there is no per-row state that recreating
    it would lose.
    """
    zone.members.clear()
    for member in members:
        zone.members.append(TournamentZoneMember(
            track_id=zone.track_id,
            kind=member.kind,
            building_id=member.building_id,
            floor=member.floor,
            tournament_event_id=member.tournament_event_id,
        ))


def _claimed_conflict(db: Session) -> None:
    """Turn the partial unique indexes into a 409 a TD can act on."""
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            "Another zone on this track already claims one of those buildings, "
            "floors or events"
        ),
    )


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/zones/?track_id=N
#
# One response rather than three endpoints: the zones page needs the zones,
# the events no rule reaches, and the events with no location at all, and the
# gaps are the whole point of looking. track_id is required — a zone belongs
# to exactly one track, and coverage only means anything within one.
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

    zones = _zone_query(db).filter(
        TournamentZone.track_id == track_id,
    ).order_by(TournamentZone.name).all()

    # One resolution pass feeds every zone's contents — see events_by_zone.
    grouped = events_by_zone(db, track_id)
    return ZoneCoverageRead(
        track_id=track_id,
        zones=[ZoneRead.from_row(z, grouped.get(z.id, [])) for z in zones],
        unzoned_event_ids=unzoned_event_ids(db, track_id),
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
    _get_track(db, tournament_id, payload.track_id)
    _check_default_role(db, tournament_id, payload.default_role_id)
    _validate_members(db, payload.track_id, payload.members)

    zone = TournamentZone(
        tournament_id=tournament_id,
        track_id=payload.track_id,
        name=payload.name,
        default_role_id=payload.default_role_id,
    )
    db.add(zone)
    _set_members(zone, payload.members)

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if "uq_tournament_zone_name" in str(error.orig):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A zone with this name already exists on this track",
            )
        _claimed_conflict(db)

    db.refresh(zone)
    grouped = events_by_zone(db, zone.track_id)
    return ZoneRead.from_row(zone, grouped.get(zone.id, []))


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/zones/{zone_id}/
#
# The track is not editable. A zone's rules, its assignments and its very
# meaning are all scoped to one track; moving it would invalidate all three,
# and making a new zone on the other track is both clearer and what a TD
# actually wants.
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

    updates = payload.model_dump(exclude_unset=True)
    if "default_role_id" in updates:
        _check_default_role(db, tournament_id, updates["default_role_id"])
        zone.default_role_id = updates["default_role_id"]
    if "name" in updates:
        zone.name = updates["name"]
    if payload.members is not None:
        _validate_members(db, zone.track_id, payload.members)
        _set_members(zone, payload.members)

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if "uq_tournament_zone_name" in str(error.orig):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A zone with this name already exists on this track",
            )
        _claimed_conflict(db)

    db.refresh(zone)
    grouped = events_by_zone(db, zone.track_id)
    return ZoneRead.from_row(zone, grouped.get(zone.id, []))


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/zones/{zone_id}/
#
# Unconditional, and its assignments cascade. Nothing is reported the way a
# building delete reports cleared locations: a zone holds no data a TD typed
# into anything else — its rules describe the venue, and the events it covered
# simply become unzoned, which the coverage response already surfaces.
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
    # zone_id IS NOT NULL is implicit in the join, but stated for the same
    # reason the event listing states its own: one table now holds role grants,
    # event staffing and zone coverage.
    query = (
        db.query(TournamentTrackAssignment)
        .join(TournamentZone, TournamentZone.id == TournamentTrackAssignment.zone_id)
        .options(
            joinedload(TournamentTrackAssignment.zone),
            joinedload(TournamentTrackAssignment.membership).joinedload(
                TournamentMembership.user
            ),
        )
        .filter(TournamentZone.tournament_id == tournament_id)
    )
    if track_id is not None:
        query = query.filter(TournamentZone.track_id == track_id)
    return [ZoneAssignmentRead.from_row(row) for row in query.all()]


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/zone-assignments/ — manage_members
#
# `role_id` is optional and falls back to the zone's own default, which is
# what a drag sends. As with an event assignment, a role the member doesn't
# hold is granted first (rank-bound — see resolve_membership_role), so
# staffing a runner is one action rather than a detour through the roster.
#
# Nothing here checks availability or track status. Those stay warnings the
# board renders, never refusals — the same line event assignments hold.
# ---------------------------------------------------------------------------
@assignments_router.post(
    "/", response_model=ZoneAssignmentRead, status_code=status.HTTP_201_CREATED,
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
        db, TournamentMembership, payload.membership_id, tournament_id, "Membership",
    )

    role_id = payload.role_id or zone.default_role_id
    if role_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "This zone has no default role; give the zone one or name a "
                "role on the assignment"
            ),
        )
    role = get_scoped_or_404(db, TournamentRole, role_id, tournament_id, "Role")

    authorize_role_grant(db, tournament, membership, role, current_user)

    # The track comes from the zone rather than the payload: a zone belongs to
    # exactly one, and the composite FK would reject any other answer anyway.
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
        )

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
            status_code=status.HTTP_404_NOT_FOUND, detail="Zone assignment not found",
        )

    db.delete(assignment)
    db.commit()
