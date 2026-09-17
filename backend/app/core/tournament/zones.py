"""Working out which zone each event falls in.

A zone does not store its events. It stores rules — a whole building, or one
floor of one — plus events added by hand, and the event list is derived from
those every time it is read. This module is that derivation.

Deriving rather than storing is the whole point. Move an event from Rowland to
Steinhaus and it leaves the zone covering Rowland and joins the one covering
Steinhaus, with no edit to either zone: the rules still describe the space, and
the space is where the event now is. A materialised list would have gone stale
the moment the event moved, and nothing would have said so.

Precedence, most specific first:

    event   an explicit member for this event
    floor   a member matching its (building, floor)
    building a member matching its building
    -       otherwise it is unzoned

`event` outranking the rules is also what removes the need for an "exclude"
kind: pulling one event out of a building-wide zone means naming it in the
zone it belongs to instead. An event inside a rule'd building therefore cannot
be made zone-*less* — the accepted cost of not having excludes.

Ambiguity is impossible rather than merely unlikely: the three partial unique
indexes on tournament_zone_members mean at most one zone per track can claim a
given building, floor, or event, so each lookup below has at most one answer.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.models import TournamentEventTrack, TournamentZone, TournamentZoneMember


KIND_BUILDING = "building"
KIND_FLOOR = "floor"
KIND_EVENT = "event"

VALID_KINDS = frozenset({KIND_BUILDING, KIND_FLOOR, KIND_EVENT})


def resolve_track_zones(db: Session, track_id: int) -> dict[int, int | None]:
    """`{event_id: zone_id or None}` for every event running on `track_id`.

    One query for the rules and one for the events, then the matching happens
    in memory — the alternative is a correlated lookup per event, and a track
    has few enough zones that the whole rule set is smaller than one page of
    results.

    An event with no building can only be matched by an explicit `event`
    member; the rules have nothing to compare against. Those are the rows the
    zones page shows as unplaced rather than merely unzoned.
    """
    members = (
        db.query(TournamentZoneMember)
        .filter(TournamentZoneMember.track_id == track_id)
        .all()
    )

    by_event = {
        m.tournament_event_id: m.zone_id for m in members if m.kind == KIND_EVENT
    }
    by_floor = {
        (m.building_id, m.floor): m.zone_id for m in members if m.kind == KIND_FLOOR
    }
    by_building = {
        m.building_id: m.zone_id for m in members if m.kind == KIND_BUILDING
    }

    links = (
        db.query(TournamentEventTrack)
        .filter(TournamentEventTrack.track_id == track_id)
        .all()
    )

    resolved: dict[int, int | None] = {}
    for link in links:
        zone_id = by_event.get(link.tournament_event_id)
        if zone_id is None and link.building_id is not None:
            if link.floor is not None:
                zone_id = by_floor.get((link.building_id, link.floor))
            if zone_id is None:
                zone_id = by_building.get(link.building_id)
        resolved[link.tournament_event_id] = zone_id
    return resolved


def events_by_zone(db: Session, track_id: int) -> dict[int, list[int]]:
    """The same answer the other way round: `{zone_id: [event_id, ...]}`.

    Zones with nothing in them are present at zero rather than absent — a zone
    a TD built and has not filled is exactly the thing they need to see.
    """
    zone_ids = [
        row_id for (row_id,) in db.query(TournamentZone.id).filter(
            TournamentZone.track_id == track_id,
        )
    ]
    grouped: dict[int, list[int]] = {zone_id: [] for zone_id in zone_ids}

    for event_id, zone_id in resolve_track_zones(db, track_id).items():
        if zone_id is not None:
            grouped.setdefault(zone_id, []).append(event_id)
    for events in grouped.values():
        events.sort()
    return grouped


def unzoned_event_ids(db: Session, track_id: int) -> list[int]:
    """Events on this track that no zone claims.

    Surfaced rather than ignored: an uncovered event is the failure mode the
    zones page exists to catch, so it gets a bucket and a count in the header
    instead of quietly not appearing anywhere.
    """
    return sorted(
        event_id
        for event_id, zone_id in resolve_track_zones(db, track_id).items()
        if zone_id is None
    )


def zone_for_event(db: Session, track_id: int, event_id: int) -> int | None:
    """One event's zone on one track. Convenience over resolve_track_zones for
    callers holding a single event; not cheaper, so prefer the bulk form in a
    loop."""
    return resolve_track_zones(db, track_id).get(event_id)
