"""Tests for /tournaments/{tournament_id}/buildings/ (TournamentBuilding)."""
from tests.conftest import grant_role, login, primary_track_id

from app.models.models import TournamentEventTrack, TournamentTrack


def _make_building(client, tournament_id, **overrides):
    payload = {"name": "Rowland Hall"}
    # A building must be on a track, so default to the primary one.
    if "track_ids" not in overrides:
        tracks = client.get(f"/tournaments/{tournament_id}/tracks/").json()
        payload["track_ids"] = [t["id"] for t in tracks if t["is_primary"]][:1]
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/buildings/", json=payload)


def _cosmetic_track(client, tournament_id, name="Test Writing"):
    return client.post(
        f"/tournaments/{tournament_id}/tracks/", json={"name": name, "is_primary": False},
    ).json()


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def test_create_building(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_building(client, td_tournament.id)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Rowland Hall"
    assert data["tournament_id"] == td_tournament.id
    assert len(data["track_ids"]) == 1


def test_create_building_with_tracks(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track_id = primary_track_id(db, td_tournament.id)
    response = _make_building(client, td_tournament.id, track_ids=[track_id])
    assert response.status_code == 201
    assert response.json()["track_ids"] == [track_id]


def test_building_names_are_unique_per_tournament(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert _make_building(client, td_tournament.id).status_code == 201
    assert _make_building(client, td_tournament.id).status_code == 409


def test_same_building_name_allowed_in_another_tournament(
    client, db, td_user, td_tournament, other_tournament,
):
    """Scoped to the tournament, not global — two regionals both using a
    "Science Hall" is the norm, not a collision."""
    grant_role(db, other_tournament, td_user, "Tournament Director")
    login(client, "td@test.com", "tdpass")
    assert _make_building(client, td_tournament.id).status_code == 201
    assert _make_building(client, other_tournament.id).status_code == 201


def test_list_buildings_sorted_by_name(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    for name in ("Steinhaus", "Aldrich", "Rowland Hall"):
        _make_building(client, td_tournament.id, name=name)
    names = [b["name"] for b in client.get(f"/tournaments/{td_tournament.id}/buildings/").json()]
    assert names == ["Aldrich", "Rowland Hall", "Steinhaus"]


def test_rename_building(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    building = _make_building(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/buildings/{building['id']}/", json={"name": "Rowland"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Rowland"


def test_rename_onto_an_existing_name_conflicts(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_building(client, td_tournament.id, name="Aldrich")
    building = _make_building(client, td_tournament.id, name="Steinhaus").json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/buildings/{building['id']}/", json={"name": "Aldrich"},
    )
    assert response.status_code == 409


def test_delete_building(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    building = _make_building(client, td_tournament.id).json()
    response = client.delete(f"/tournaments/{td_tournament.id}/buildings/{building['id']}/")
    assert response.status_code == 200
    assert response.json()["locations_cleared"] == 0
    assert client.get(f"/tournaments/{td_tournament.id}/buildings/").json() == []


# ---------------------------------------------------------------------------
# Track tagging
# ---------------------------------------------------------------------------

def test_track_ids_are_whole_set(client, db, td_user, td_tournament):
    """A PATCH replaces the tags rather than adding to them — the same
    contract an event's shift_ids already has."""
    login(client, "td@test.com", "tdpass")
    primary = primary_track_id(db, td_tournament.id)
    cosmetic = _cosmetic_track(client, td_tournament.id)["id"]
    building = _make_building(client, td_tournament.id, track_ids=[primary, cosmetic]).json()
    assert building["track_ids"] == sorted([primary, cosmetic])

    response = client.patch(
        f"/tournaments/{td_tournament.id}/buildings/{building['id']}/",
        json={"track_ids": [cosmetic]},
    )
    assert response.json()["track_ids"] == [cosmetic]


def test_a_building_must_be_on_at_least_one_track(client, db, td_user, td_tournament):
    """It could hold nothing, so it can't be created that way, left out, or
    edited into it."""
    login(client, "td@test.com", "tdpass")
    base = f"/tournaments/{td_tournament.id}/buildings/"

    empty = client.post(base, json={"name": "Rowland Hall", "track_ids": []})
    assert empty.status_code == 422
    assert "at least one track" in empty.text
    assert client.post(base, json={"name": "Rowland Hall"}).status_code == 422

    building = _make_building(client, td_tournament.id).json()
    cleared = client.patch(f"{base}{building['id']}/", json={"track_ids": []})
    assert cleared.status_code == 422
    assert "at least one track" in cleared.text
    assert client.get(base).json()[0]["track_ids"] == building["track_ids"]


def test_omitting_track_ids_leaves_them_alone(client, db, td_user, td_tournament):
    """None means "not sent". A rename must not drop tags."""
    login(client, "td@test.com", "tdpass")
    track_id = primary_track_id(db, td_tournament.id)
    building = _make_building(client, td_tournament.id, track_ids=[track_id]).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/buildings/{building['id']}/", json={"name": "Renamed"},
    )
    assert response.json()["track_ids"] == [track_id]


def test_duplicate_track_ids_are_deduped(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track_id = primary_track_id(db, td_tournament.id)
    response = _make_building(client, td_tournament.id, track_ids=[track_id, track_id])
    assert response.json()["track_ids"] == [track_id]


def test_unknown_track_id_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_building(client, td_tournament.id, track_ids=[999999])
    assert response.status_code == 422
    assert "999999" in response.json()["detail"]


def test_track_from_another_tournament_rejected(
    client, db, td_user, td_tournament, other_tournament,
):
    """The track lookup is tournament-scoped, so another tournament's track is
    indistinguishable from one that does not exist."""
    login(client, "td@test.com", "tdpass")
    foreign = primary_track_id(db, other_tournament.id)
    assert _make_building(client, td_tournament.id, track_ids=[foreign]).status_code == 422


def test_pending_delete_track_cannot_be_tagged(client, db, td_user, td_tournament):
    """Tagging onto a track a TD is trying to remove would be one more
    reference keeping it alive."""
    login(client, "td@test.com", "tdpass")
    cosmetic = _cosmetic_track(client, td_tournament.id)
    db.query(TournamentTrack).filter(TournamentTrack.id == cosmetic["id"]).update(
        {"is_archived": True}
    )
    db.commit()
    response = _make_building(client, td_tournament.id, track_ids=[cosmetic["id"]])
    assert response.status_code == 422
    assert "pending deletion" in response.json()["detail"]


# ---------------------------------------------------------------------------
# Validation and permissions
# ---------------------------------------------------------------------------

def test_blank_name_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert _make_building(client, td_tournament.id, name="   ").status_code == 422


def test_name_is_trimmed(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_building(client, td_tournament.id, name="  Rowland Hall  ").json()
    assert created["name"] == "Rowland Hall"


def test_unknown_field_rejected(client, td_user, td_tournament):
    """extra="forbid" — a caller still sending a room is told so, rather than
    having it silently dropped."""
    login(client, "td@test.com", "tdpass")
    assert _make_building(client, td_tournament.id, room="210").status_code == 422


def test_buildings_require_manage_events(client, db, td_user, other_tournament):
    """Unlike shifts, there is no member-readable listing: where an event
    physically happens stays staff-side until the day."""
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    base = f"/tournaments/{other_tournament.id}/buildings/"
    assert client.get(base).status_code == 403
    assert client.post(base, json={"name": "Sneaky", "track_ids": [1]}).status_code == 403
    assert client.patch(f"{base}1/", json={"name": "Nope"}).status_code == 403
    assert client.delete(f"{base}1/").status_code == 403


def test_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/buildings/").status_code == 404


def test_archived_tournament_blocks_writes(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    building = _make_building(client, td_tournament.id).json()
    td_tournament.is_archived = True
    db.commit()
    base = f"/tournaments/{td_tournament.id}/buildings/"
    assert client.get(base).status_code == 200
    assert client.post(base, json={"name": "Later", "track_ids": building["track_ids"]}).status_code == 403
    assert client.patch(f"{base}{building['id']}/", json={"name": "Nope"}).status_code == 403
    assert client.delete(f"{base}{building['id']}/").status_code == 403


# ---------------------------------------------------------------------------
# Event placements
#
# There is no API for writing a location yet — the event schemas gain it in a
# later step — so these drive the link rows directly and exercise the
# constraint and the routes that have to work around it.
# ---------------------------------------------------------------------------

def _make_event(client, tournament_id, track_ids, name="Anatomy"):
    response = client.post(f"/tournaments/{tournament_id}/events/", json={
        "tournament_id": tournament_id, "name": name, "division": "C",
        "track_details": [{"track_id": t} for t in track_ids],
    })
    # Surface the body on a non-201 rather than letting the caller trip over a
    # KeyError three lines later.
    assert response.status_code == 201, response.text
    return response.json()


def _place(db, event_id, track_id, building_id, floor="2", rooms=("210",)):
    db.query(TournamentEventTrack).filter(
        TournamentEventTrack.tournament_event_id == event_id,
        TournamentEventTrack.track_id == track_id,
    ).update({"building_id": building_id, "floor": floor, "rooms": list(rooms)})
    db.commit()


def _link(db, event_id, track_id):
    return db.query(TournamentEventTrack).filter(
        TournamentEventTrack.tournament_event_id == event_id,
        TournamentEventTrack.track_id == track_id,
    ).one()


def test_delete_building_clears_placements_and_reports_the_cost(
    client, db, td_user, td_tournament,
):
    """Deleting a building plainly is a request to unplace what is in it, so
    it clears rather than refuses — but says how much it cleared."""
    login(client, "td@test.com", "tdpass")
    track_id = primary_track_id(db, td_tournament.id)
    building = _make_building(client, td_tournament.id, track_ids=[track_id]).json()
    event = _make_event(client, td_tournament.id, [track_id])
    _place(db, event["id"], track_id, building["id"])

    response = client.delete(f"/tournaments/{td_tournament.id}/buildings/{building['id']}/")
    assert response.status_code == 200
    assert response.json()["locations_cleared"] == 1

    db.expire_all()
    link = _link(db, event["id"], track_id)
    assert link.building_id is None
    # floor and rooms go with it: a room inside a building that is gone reads
    # as a location the event still has.
    assert link.floor is None and link.rooms is None


def test_untagging_a_track_still_in_use_is_refused(client, db, td_user, td_tournament):
    """Unlike a delete, untagging is not a request to wipe rooms."""
    login(client, "td@test.com", "tdpass")
    track_id = primary_track_id(db, td_tournament.id)
    cosmetic = _cosmetic_track(client, td_tournament.id)["id"]
    building = _make_building(client, td_tournament.id, track_ids=[track_id, cosmetic]).json()
    event = _make_event(client, td_tournament.id, [track_id])
    _place(db, event["id"], track_id, building["id"])

    # Keep only the other track, dropping the one the event is placed on.
    response = client.patch(
        f"/tournaments/{td_tournament.id}/buildings/{building['id']}/", json={"track_ids": [cosmetic]},
    )
    assert response.status_code == 409
    assert "move those events first" in response.json()["detail"]
    assert _link(db, event["id"], track_id).building_id == building["id"]


def test_untagging_an_unused_track_is_allowed(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track_id = primary_track_id(db, td_tournament.id)
    cosmetic = _cosmetic_track(client, td_tournament.id)["id"]
    building = _make_building(
        client, td_tournament.id, track_ids=[track_id, cosmetic],
    ).json()
    event = _make_event(client, td_tournament.id, [track_id])
    _place(db, event["id"], track_id, building["id"])

    response = client.patch(
        f"/tournaments/{td_tournament.id}/buildings/{building['id']}/",
        json={"track_ids": [track_id]},
    )
    assert response.status_code == 200
    assert response.json()["track_ids"] == [track_id]


def test_placing_an_event_in_a_building_not_on_its_track_is_rejected_by_the_db(
    client, db, td_user, td_tournament,
):
    """The composite FK, not a route check: this is what makes a Day 1 event
    in a Day 2-only building unrepresentable."""
    from sqlalchemy.exc import IntegrityError

    login(client, "td@test.com", "tdpass")
    track_id = primary_track_id(db, td_tournament.id)
    cosmetic = _cosmetic_track(client, td_tournament.id)["id"]
    # Tagged with the cosmetic track only.
    building = _make_building(client, td_tournament.id, track_ids=[cosmetic]).json()
    event = _make_event(client, td_tournament.id, [track_id])

    try:
        _place(db, event["id"], track_id, building["id"])
        raise AssertionError("expected the composite foreign key to reject this")
    except IntegrityError:
        db.rollback()
