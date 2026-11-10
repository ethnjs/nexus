"""Working out which zone each event falls in.

A zone stores rules (a building, a floor, a room) plus events added by hand,
and its event list is derived from them on every read, so an event that moves
rooms moves zones with no edit to either zone.

Precedence, most specific first: event, room, floor, building. The partial
unique indexes on tournament_zone_members allow at most one zone per track to
claim a given building, floor, room or event, so each lookup has at most one
answer.
"""

from __future__ import annotations

from sqlalchemy.orm import Session, selectinload

from app.core.rooms import room_sort_key
from app.models.models import TournamentEventTrack, TournamentZone, TournamentZoneMember

KIND_BUILDING = "building"
KIND_FLOOR = "floor"
KIND_ROOM = "room"
KIND_EVENT = "event"

VALID_KINDS = frozenset({KIND_BUILDING, KIND_FLOOR, KIND_ROOM, KIND_EVENT})


def resolve_track_zones(db: Session, track_id: int) -> dict[int, int | None]:
    """`{event_id: zone_id or None}` for every event running on `track_id`.

    An event in several rooms takes the zone of its first ruled room in
    natural order, the same room its effective floor comes from.
    """
    members = db.query(TournamentZoneMember).filter(TournamentZoneMember.track_id == track_id).all()

    by_event = {m.tournament_event_id: m.zone_id for m in members if m.kind == KIND_EVENT}
    by_room = {m.room_id: m.zone_id for m in members if m.kind == KIND_ROOM}
    by_floor = {(m.building_id, m.floor): m.zone_id for m in members if m.kind == KIND_FLOOR}
    by_building = {m.building_id: m.zone_id for m in members if m.kind == KIND_BUILDING}

    links = (
        db.query(TournamentEventTrack)
        .options(selectinload(TournamentEventTrack.rooms))
        .filter(TournamentEventTrack.track_id == track_id)
        .all()
    )

    resolved: dict[int, int | None] = {}
    for link in links:
        zone_id = by_event.get(link.tournament_event_id)
        rooms = sorted(link.rooms, key=lambda room: room_sort_key(room.name))
        if zone_id is None:
            zone_id = next((by_room[r.id] for r in rooms if r.id in by_room), None)
        building_id = rooms[0].building_id if rooms else None
        if zone_id is None and building_id is not None:
            floor = link.effective_floor
            if floor is not None:
                zone_id = by_floor.get((building_id, floor))
            if zone_id is None:
                zone_id = by_building.get(building_id)
        resolved[link.tournament_event_id] = zone_id
    return resolved


def events_by_zone(
    db: Session, track_id: int, resolved: dict[int, int | None] | None = None
) -> dict[int, list[int]]:
    """`{zone_id: [event_id, ...]}`, with empty zones present as empty lists.
    Pass `resolve_track_zones`'s result as `resolved` to reuse it."""
    zone_ids = [
        row_id
        for (row_id,) in db.query(TournamentZone.id).filter(
            TournamentZone.track_id == track_id,
        )
    ]
    grouped: dict[int, list[int]] = {zone_id: [] for zone_id in zone_ids}

    if resolved is None:
        resolved = resolve_track_zones(db, track_id)
    for event_id, zone_id in resolved.items():
        if zone_id is not None:
            grouped.setdefault(zone_id, []).append(event_id)
    for events in grouped.values():
        events.sort()
    return grouped


def unzoned_event_ids(resolved: dict[int, int | None]) -> list[int]:
    """The events in `resolve_track_zones`'s result that no zone claims."""
    return sorted(event_id for event_id, zone_id in resolved.items() if zone_id is None)


def unplaced_event_ids(db: Session, track_id: int) -> list[int]:
    """Events on this track with no room at all. Not a subset of
    unzoned_event_ids: an explicit event rule zones an unplaced event."""
    return sorted(
        link.tournament_event_id
        for link in db.query(TournamentEventTrack).filter(
            TournamentEventTrack.track_id == track_id,
            ~TournamentEventTrack.rooms.any(),
        )
    )


def zone_for_event(db: Session, track_id: int, event_id: int) -> int | None:
    """One event's zone on one track. Not cheaper than resolve_track_zones,
    so prefer that in a loop."""
    return resolve_track_zones(db, track_id).get(event_id)
