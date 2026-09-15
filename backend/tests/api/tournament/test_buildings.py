"""Tests for /tournaments/{tournament_id}/buildings/ (TournamentBuilding)."""
from tests.conftest import grant_role, login, primary_track_id

from app.models.models import TournamentTrack


def _make_building(client, tournament_id, **overrides):
    payload = {"name": "Rowland Hall"}
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
    assert data["track_ids"] == []


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
    assert client.delete(
        f"/tournaments/{td_tournament.id}/buildings/{building['id']}/"
    ).status_code == 204
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


def test_track_ids_can_be_cleared(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track_id = primary_track_id(db, td_tournament.id)
    building = _make_building(client, td_tournament.id, track_ids=[track_id]).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/buildings/{building['id']}/", json={"track_ids": []},
    )
    assert response.json()["track_ids"] == []


def test_omitting_track_ids_leaves_them_alone(client, db, td_user, td_tournament):
    """None means "not sent"; [] means "clear". A rename must not drop tags."""
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
    assert client.post(base, json={"name": "Sneaky"}).status_code == 403
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
    assert client.post(base, json={"name": "Later"}).status_code == 403
    assert client.patch(f"{base}{building['id']}/", json={"name": "Nope"}).status_code == 403
    assert client.delete(f"{base}{building['id']}/").status_code == 403
