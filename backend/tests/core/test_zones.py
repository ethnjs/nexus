"""Tests for app/core/tournament/zones.py — the derivation of an event's zone.

A zone stores rules, not events. These cover the precedence that turns those
rules into an answer (event > floor > building), and the behaviour that
precedence exists for: an event that moves between buildings moves between
zones with nothing edited on either zone.
"""
import pytest

from tests.conftest import primary_track_id

from app.core.tournament.zones import (
    events_by_zone, resolve_track_zones, unzoned_event_ids, zone_for_event,
)
from app.models.models import (
    TournamentBuilding, TournamentBuildingTrack, TournamentEvent, TournamentEventTrack,
    TournamentZone, TournamentZoneMember,
)


@pytest.fixture
def track(db, td_tournament):
    return primary_track_id(db, td_tournament.id)


def _building(db, tournament_id, track_id, name):
    building = TournamentBuilding(tournament_id=tournament_id, name=name)
    db.add(building)
    db.flush()
    db.add(TournamentBuildingTrack(building_id=building.id, track_id=track_id))
    db.flush()
    return building


def _event(db, tournament_id, track_id, name, building=None, floor=None):
    event = TournamentEvent(tournament_id=tournament_id, name=name, division="C")
    db.add(event)
    db.flush()
    db.add(TournamentEventTrack(
        tournament_event_id=event.id, track_id=track_id,
        building_id=building.id if building else None, floor=floor,
    ))
    db.flush()
    return event


def _zone(db, tournament_id, track_id, name):
    zone = TournamentZone(tournament_id=tournament_id, track_id=track_id, name=name)
    db.add(zone)
    db.flush()
    return zone


def _rule(db, zone, track_id, kind, building=None, floor=None, event=None):
    db.add(TournamentZoneMember(
        zone_id=zone.id, track_id=track_id, kind=kind,
        building_id=building.id if building else None, floor=floor,
        tournament_event_id=event.id if event else None,
    ))
    db.flush()


# ---------------------------------------------------------------------------
# Precedence
# ---------------------------------------------------------------------------

def test_a_building_rule_claims_every_event_in_it(db, td_tournament, track):
    rowland = _building(db, td_tournament.id, track, "Rowland Hall")
    anatomy = _event(db, td_tournament.id, track, "Anatomy", rowland, "2")
    chem = _event(db, td_tournament.id, track, "Chemistry", rowland, "1")
    north = _zone(db, td_tournament.id, track, "North")
    _rule(db, north, track, "building", building=rowland)

    resolved = resolve_track_zones(db, track)
    assert resolved[anatomy.id] == north.id
    assert resolved[chem.id] == north.id


def test_a_floor_rule_outranks_a_building_rule(db, td_tournament, track):
    rowland = _building(db, td_tournament.id, track, "Rowland Hall")
    upstairs = _event(db, td_tournament.id, track, "Anatomy", rowland, "2")
    downstairs = _event(db, td_tournament.id, track, "Chemistry", rowland, "1")
    north = _zone(db, td_tournament.id, track, "North")
    south = _zone(db, td_tournament.id, track, "South")
    _rule(db, north, track, "building", building=rowland)
    _rule(db, south, track, "floor", building=rowland, floor="2")

    resolved = resolve_track_zones(db, track)
    assert resolved[upstairs.id] == south.id
    assert resolved[downstairs.id] == north.id


def test_an_explicit_event_outranks_both_rules(db, td_tournament, track):
    """Why there is no exclude kind: pulling one event out of a building-wide
    zone means naming it in the zone it belongs to instead."""
    rowland = _building(db, td_tournament.id, track, "Rowland Hall")
    anatomy = _event(db, td_tournament.id, track, "Anatomy", rowland, "2")
    north = _zone(db, td_tournament.id, track, "North")
    south = _zone(db, td_tournament.id, track, "South")
    _rule(db, north, track, "building", building=rowland)
    _rule(db, south, track, "floor", building=rowland, floor="2")
    _rule(db, south, track, "event", event=anatomy)

    assert zone_for_event(db, track, anatomy.id) == south.id


def test_an_event_with_no_building_can_still_be_named_explicitly(db, td_tournament, track):
    """The rules have nothing to compare against, but an explicit member does
    not need one."""
    floating = _event(db, td_tournament.id, track, "Write-ups")
    north = _zone(db, td_tournament.id, track, "North")
    _rule(db, north, track, "event", event=floating)

    assert zone_for_event(db, track, floating.id) == north.id


# ---------------------------------------------------------------------------
# The behaviour precedence exists for
# ---------------------------------------------------------------------------

def test_moving_an_event_moves_it_between_zones_with_no_zone_edit(db, td_tournament, track):
    """The whole reason zones derive their events instead of storing them."""
    rowland = _building(db, td_tournament.id, track, "Rowland Hall")
    steinhaus = _building(db, td_tournament.id, track, "Steinhaus")
    anatomy = _event(db, td_tournament.id, track, "Anatomy", rowland, "2")
    north = _zone(db, td_tournament.id, track, "North")
    south = _zone(db, td_tournament.id, track, "South")
    _rule(db, north, track, "building", building=rowland)
    _rule(db, south, track, "building", building=steinhaus)

    assert zone_for_event(db, track, anatomy.id) == north.id

    link = db.query(TournamentEventTrack).filter(
        TournamentEventTrack.tournament_event_id == anatomy.id,
        TournamentEventTrack.track_id == track,
    ).one()
    link.building_id = steinhaus.id
    db.flush()

    assert zone_for_event(db, track, anatomy.id) == south.id


def test_unplacing_an_event_makes_it_unzoned(db, td_tournament, track):
    rowland = _building(db, td_tournament.id, track, "Rowland Hall")
    anatomy = _event(db, td_tournament.id, track, "Anatomy", rowland, "2")
    north = _zone(db, td_tournament.id, track, "North")
    _rule(db, north, track, "building", building=rowland)

    link = db.query(TournamentEventTrack).filter(
        TournamentEventTrack.tournament_event_id == anatomy.id,
        TournamentEventTrack.track_id == track,
    ).one()
    link.building_id = None
    link.floor = None
    db.flush()

    assert anatomy.id in unzoned_event_ids(db, track)


def test_an_event_matching_nothing_is_unzoned(db, td_tournament, track):
    anatomy = _event(db, td_tournament.id, track, "Anatomy")
    assert resolve_track_zones(db, track)[anatomy.id] is None
    assert anatomy.id in unzoned_event_ids(db, track)


# ---------------------------------------------------------------------------
# Grouping
# ---------------------------------------------------------------------------

def test_events_by_zone_includes_empty_zones(db, td_tournament, track):
    """A zone a TD built and hasn't filled is exactly what they need to see."""
    rowland = _building(db, td_tournament.id, track, "Rowland Hall")
    _event(db, td_tournament.id, track, "Anatomy", rowland, "2")
    north = _zone(db, td_tournament.id, track, "North")
    empty = _zone(db, td_tournament.id, track, "South")
    _rule(db, north, track, "building", building=rowland)

    grouped = events_by_zone(db, track)
    assert len(grouped[north.id]) == 1
    assert grouped[empty.id] == []


def test_zones_on_another_track_do_not_leak(db, td_tournament, track):
    """Zones are per track — "the north wing on Day 1" is staffed separately
    from the same corridor on Day 2."""
    from app.models.models import TournamentTrack

    day2 = TournamentTrack(tournament_id=td_tournament.id, name="Day 2", is_primary=False)
    db.add(day2)
    db.flush()

    rowland = _building(db, td_tournament.id, track, "Rowland Hall")
    anatomy = _event(db, td_tournament.id, track, "Anatomy", rowland, "2")
    north = _zone(db, td_tournament.id, track, "North")
    _rule(db, north, track, "building", building=rowland)

    assert resolve_track_zones(db, day2.id) == {}
    assert zone_for_event(db, track, anatomy.id) == north.id
