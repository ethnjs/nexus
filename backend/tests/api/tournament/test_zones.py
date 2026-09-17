"""Tests for /tournaments/{tournament_id}/zones/ and /zone-assignments/.

The resolution itself is covered in tests/core/test_zones.py; these cover the
routes around it — validation, the rules-versus-contents split in the response,
and staffing.
"""
from tests.conftest import grant_role, login, primary_track_id


def _track(db, tournament):
    return primary_track_id(db, tournament.id)


def _building(client, tournament_id, track_ids, name="Rowland Hall"):
    return client.post(f"/tournaments/{tournament_id}/buildings/", json={
        "name": name, "track_ids": track_ids,
    }).json()


def _event(client, tournament_id, track_id, name="Anatomy", building_id=None, floor=None):
    detail = {"track_id": track_id}
    if building_id is not None:
        detail["building_id"] = building_id
    if floor is not None:
        detail["floor"] = floor
    response = client.post(f"/tournaments/{tournament_id}/events/", json={
        "tournament_id": tournament_id, "name": name, "division": "C",
        "track_details": [detail],
    })
    assert response.status_code == 201, response.text
    return response.json()


def _zone(client, tournament_id, track_id, name="North", **overrides):
    payload = {"track_id": track_id, "name": name}
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/zones/", json=payload)


def _coverage(client, tournament_id, track_id):
    return client.get(f"/tournaments/{tournament_id}/zones/?track_id={track_id}").json()


def _role(client, tournament_id, label):
    roles = client.get(f"/tournaments/{tournament_id}/roles/").json()
    return next(r for r in roles if r["label"] == label)["id"]


# ---------------------------------------------------------------------------
# Zone CRUD
# ---------------------------------------------------------------------------

def test_create_zone(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    response = _zone(client, td_tournament.id, track)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "North"
    assert body["track_id"] == track
    assert body["members"] == []
    assert body["event_ids"] == []


def test_zone_names_are_unique_per_track(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    assert _zone(client, td_tournament.id, track).status_code == 201
    assert _zone(client, td_tournament.id, track).status_code == 409


def test_the_same_zone_name_is_fine_on_another_track(client, db, td_user, td_tournament):
    """"The north wing on Day 1" and the same corridor on Day 2 are separate
    zones, staffed separately."""
    login(client, "td@test.com", "tdpass")
    day1 = _track(db, td_tournament)
    day2 = client.post(
        f"/tournaments/{td_tournament.id}/tracks/", json={"name": "Day 2"},
    ).json()["id"]
    assert _zone(client, td_tournament.id, day1).status_code == 201
    assert _zone(client, td_tournament.id, day2).status_code == 201


def test_rename_and_set_default_role(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    runner = _role(client, td_tournament.id, "Runner")
    zone = _zone(client, td_tournament.id, track).json()

    body = client.patch(
        f"/tournaments/{td_tournament.id}/zones/{zone['id']}/",
        json={"name": "North Wing", "default_role_id": runner},
    ).json()
    assert body["name"] == "North Wing"
    assert body["default_role_label"] == "Runner"


def test_delete_zone(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    zone = _zone(client, td_tournament.id, track).json()
    assert client.delete(
        f"/tournaments/{td_tournament.id}/zones/{zone['id']}/"
    ).status_code == 204
    assert _coverage(client, td_tournament.id, track)["zones"] == []


# ---------------------------------------------------------------------------
# Rules versus contents
# ---------------------------------------------------------------------------

def test_members_are_rules_and_event_ids_are_contents(client, db, td_user, td_tournament):
    """The distinction the response exists to make: one is what the TD drew,
    the other is what it currently resolves to."""
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    building = _building(client, td_tournament.id, [track])
    anatomy = _event(client, td_tournament.id, track, "Anatomy", building["id"], "2")
    chem = _event(client, td_tournament.id, track, "Chemistry", building["id"], "1")

    body = _zone(client, td_tournament.id, track, members=[
        {"kind": "building", "building_id": building["id"]},
    ]).json()

    assert len(body["members"]) == 1
    assert body["members"][0]["building_name"] == "Rowland Hall"
    assert sorted(body["event_ids"]) == sorted([anatomy["id"], chem["id"]])


def test_moving_an_event_changes_contents_with_no_zone_edit(
    client, db, td_user, td_tournament,
):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    rowland = _building(client, td_tournament.id, [track])
    steinhaus = _building(client, td_tournament.id, [track], name="Steinhaus")
    anatomy = _event(client, td_tournament.id, track, "Anatomy", rowland["id"], "2")

    north = _zone(client, td_tournament.id, track, "North", members=[
        {"kind": "building", "building_id": rowland["id"]},
    ]).json()
    south = _zone(client, td_tournament.id, track, "South", members=[
        {"kind": "building", "building_id": steinhaus["id"]},
    ]).json()
    assert _coverage(client, td_tournament.id, track)["zones"][0]["event_ids"] == [anatomy["id"]]

    client.patch(
        f"/tournaments/{td_tournament.id}/events/{anatomy['id']}/",
        json={"track_details": [
            {"track_id": track, "building_id": steinhaus["id"], "floor": "1"},
        ]},
    )

    zones = {z["name"]: z for z in _coverage(client, td_tournament.id, track)["zones"]}
    assert zones["North"]["event_ids"] == []
    assert zones["South"]["event_ids"] == [anatomy["id"]]


def test_an_explicit_event_rule_outranks_a_building_rule(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    building = _building(client, td_tournament.id, [track])
    anatomy = _event(client, td_tournament.id, track, "Anatomy", building["id"], "2")

    _zone(client, td_tournament.id, track, "North", members=[
        {"kind": "building", "building_id": building["id"]},
    ])
    _zone(client, td_tournament.id, track, "South", members=[
        {"kind": "event", "tournament_event_id": anatomy["id"]},
    ])

    zones = {z["name"]: z for z in _coverage(client, td_tournament.id, track)["zones"]}
    assert zones["North"]["event_ids"] == []
    assert zones["South"]["event_ids"] == [anatomy["id"]]


# ---------------------------------------------------------------------------
# Coverage gaps
# ---------------------------------------------------------------------------

def test_unzoned_and_unplaced_are_reported_separately(client, db, td_user, td_tournament):
    """Different problems with different fixes — one wants a rule, the other
    wants a location."""
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    covered_b = _building(client, td_tournament.id, [track])
    other_b = _building(client, td_tournament.id, [track], name="Steinhaus")

    covered = _event(client, td_tournament.id, track, "Anatomy", covered_b["id"], "2")
    placed_but_unzoned = _event(client, td_tournament.id, track, "Chemistry", other_b["id"], "1")
    unplaced = _event(client, td_tournament.id, track, "Write-ups")

    _zone(client, td_tournament.id, track, "North", members=[
        {"kind": "building", "building_id": covered_b["id"]},
    ])

    body = _coverage(client, td_tournament.id, track)
    assert covered["id"] not in body["unzoned_event_ids"]
    assert placed_but_unzoned["id"] in body["unzoned_event_ids"]
    assert unplaced["id"] in body["unzoned_event_ids"]
    # Only the one with no building at all shows up here.
    assert body["unplaced_event_ids"] == [unplaced["id"]]


def test_an_unplaced_event_can_still_be_zoned_explicitly(client, db, td_user, td_tournament):
    """Which is why unplaced isn't a subset of unzoned."""
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    floating = _event(client, td_tournament.id, track, "Write-ups")
    _zone(client, td_tournament.id, track, "North", members=[
        {"kind": "event", "tournament_event_id": floating["id"]},
    ])

    body = _coverage(client, td_tournament.id, track)
    assert floating["id"] not in body["unzoned_event_ids"]
    assert floating["id"] in body["unplaced_event_ids"]


# ---------------------------------------------------------------------------
# Rule validation
# ---------------------------------------------------------------------------

def test_a_malformed_rule_is_rejected(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    building = _building(client, td_tournament.id, [track])
    response = _zone(client, td_tournament.id, track, members=[
        {"kind": "building", "building_id": building["id"], "floor": "2"},
    ])
    assert response.status_code == 422


def test_a_floor_rule_needs_a_floor(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    building = _building(client, td_tournament.id, [track])
    assert _zone(client, td_tournament.id, track, members=[
        {"kind": "floor", "building_id": building["id"]},
    ]).status_code == 422


def test_a_building_not_on_this_track_is_rejected(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    other = client.post(
        f"/tournaments/{td_tournament.id}/tracks/", json={"name": "Test Writing"},
    ).json()["id"]
    building = _building(client, td_tournament.id, [other])

    response = _zone(client, td_tournament.id, track, members=[
        {"kind": "building", "building_id": building["id"]},
    ])
    assert response.status_code == 422
    assert "not available on this track" in response.json()["detail"]


def test_an_event_not_on_this_track_is_rejected(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    other = client.post(
        f"/tournaments/{td_tournament.id}/tracks/", json={"name": "Test Writing"},
    ).json()["id"]
    event = _event(client, td_tournament.id, other, "Write-ups")

    response = _zone(client, td_tournament.id, track, members=[
        {"kind": "event", "tournament_event_id": event["id"]},
    ])
    assert response.status_code == 422
    assert "does not run on this track" in response.json()["detail"]


def test_repeating_a_rule_in_one_payload_is_rejected(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    building = _building(client, td_tournament.id, [track])
    response = _zone(client, td_tournament.id, track, members=[
        {"kind": "building", "building_id": building["id"]},
        {"kind": "building", "building_id": building["id"]},
    ])
    assert response.status_code == 422


def test_two_zones_cannot_claim_the_same_building(client, db, td_user, td_tournament):
    """The partial unique index, surfaced as a 409 rather than a 500."""
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    building = _building(client, td_tournament.id, [track])
    assert _zone(client, td_tournament.id, track, "North", members=[
        {"kind": "building", "building_id": building["id"]},
    ]).status_code == 201

    response = _zone(client, td_tournament.id, track, "South", members=[
        {"kind": "building", "building_id": building["id"]},
    ])
    assert response.status_code == 409
    assert "already claims" in response.json()["detail"]


def test_members_are_whole_set_on_patch(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    rowland = _building(client, td_tournament.id, [track])
    steinhaus = _building(client, td_tournament.id, [track], name="Steinhaus")
    zone = _zone(client, td_tournament.id, track, members=[
        {"kind": "building", "building_id": rowland["id"]},
    ]).json()

    body = client.patch(
        f"/tournaments/{td_tournament.id}/zones/{zone['id']}/",
        json={"members": [{"kind": "building", "building_id": steinhaus["id"]}]},
    ).json()
    assert [m["building_id"] for m in body["members"]] == [steinhaus["id"]]


def test_omitting_members_on_patch_leaves_them_alone(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    building = _building(client, td_tournament.id, [track])
    zone = _zone(client, td_tournament.id, track, members=[
        {"kind": "building", "building_id": building["id"]},
    ]).json()

    body = client.patch(
        f"/tournaments/{td_tournament.id}/zones/{zone['id']}/", json={"name": "Renamed"},
    ).json()
    assert len(body["members"]) == 1


# ---------------------------------------------------------------------------
# Zone assignments
# ---------------------------------------------------------------------------

def test_assigning_a_member_uses_the_zones_default_role(
    client, db, td_user, other_user, td_tournament,
):
    """What a drag sends: the TD picked the role once, when they made the
    zone."""
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    runner = _role(client, td_tournament.id, "Runner")
    zone = _zone(client, td_tournament.id, track, default_role_id=runner).json()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")

    response = client.post(f"/tournaments/{td_tournament.id}/zone-assignments/", json={
        "zone_id": zone["id"], "membership_id": membership.id,
    })
    assert response.status_code == 201
    assert response.json()["role"]["label"] == "Runner"
    assert response.json()["zone_name"] == "North"


def test_assigning_grants_a_role_the_member_lacks(
    client, db, td_user, other_user, td_tournament,
):
    """Same one-action behaviour event assignments have — no detour through
    the roster."""
    from app.models.models import TournamentMembershipRole

    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    runner = _role(client, td_tournament.id, "Runner")
    zone = _zone(client, td_tournament.id, track, default_role_id=runner).json()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")

    client.post(f"/tournaments/{td_tournament.id}/zone-assignments/", json={
        "zone_id": zone["id"], "membership_id": membership.id,
    })
    db.expire_all()
    held = {
        row.role_id for row in db.query(TournamentMembershipRole).filter_by(
            membership_id=membership.id,
        )
    }
    assert runner in held


def test_a_zone_with_no_default_role_needs_one_named(
    client, db, td_user, other_user, td_tournament,
):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    zone = _zone(client, td_tournament.id, track).json()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")

    response = client.post(f"/tournaments/{td_tournament.id}/zone-assignments/", json={
        "zone_id": zone["id"], "membership_id": membership.id,
    })
    assert response.status_code == 422
    assert "no default role" in response.json()["detail"]


def test_the_same_member_and_role_cannot_be_added_twice(
    client, db, td_user, other_user, td_tournament,
):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    runner = _role(client, td_tournament.id, "Runner")
    zone = _zone(client, td_tournament.id, track, default_role_id=runner).json()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    body = {"zone_id": zone["id"], "membership_id": membership.id}

    assert client.post(
        f"/tournaments/{td_tournament.id}/zone-assignments/", json=body,
    ).status_code == 201
    assert client.post(
        f"/tournaments/{td_tournament.id}/zone-assignments/", json=body,
    ).status_code == 409


def test_zone_assignments_filter_by_track(client, db, td_user, other_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    day1 = _track(db, td_tournament)
    day2 = client.post(
        f"/tournaments/{td_tournament.id}/tracks/", json={"name": "Day 2"},
    ).json()["id"]
    runner = _role(client, td_tournament.id, "Runner")
    zone1 = _zone(client, td_tournament.id, day1, "North", default_role_id=runner).json()
    zone2 = _zone(client, td_tournament.id, day2, "North", default_role_id=runner).json()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")

    for zone in (zone1, zone2):
        client.post(f"/tournaments/{td_tournament.id}/zone-assignments/", json={
            "zone_id": zone["id"], "membership_id": membership.id,
        })

    rows = client.get(
        f"/tournaments/{td_tournament.id}/zone-assignments/?track_id={day1}"
    ).json()
    assert [r["zone_id"] for r in rows] == [zone1["id"]]
    assert len(client.get(f"/tournaments/{td_tournament.id}/zone-assignments/").json()) == 2


def test_deleting_a_zone_removes_its_assignments(
    client, db, td_user, other_user, td_tournament,
):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    runner = _role(client, td_tournament.id, "Runner")
    zone = _zone(client, td_tournament.id, track, default_role_id=runner).json()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    client.post(f"/tournaments/{td_tournament.id}/zone-assignments/", json={
        "zone_id": zone["id"], "membership_id": membership.id,
    })

    client.delete(f"/tournaments/{td_tournament.id}/zones/{zone['id']}/")
    assert client.get(f"/tournaments/{td_tournament.id}/zone-assignments/").json() == []


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------

def test_zone_routes_require_manage_events(client, db, td_user, other_tournament):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    base = f"/tournaments/{other_tournament.id}/zones/"
    assert client.get(f"{base}?track_id=1").status_code == 403
    assert client.post(base, json={"track_id": 1, "name": "Sneaky"}).status_code == 403
    assert client.patch(f"{base}1/", json={"name": "Nope"}).status_code == 403
    assert client.delete(f"{base}1/").status_code == 403


def test_zone_assignment_routes_require_manage_members(client, db, td_user, other_tournament):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    base = f"/tournaments/{other_tournament.id}/zone-assignments/"
    assert client.get(base).status_code == 403
    assert client.post(base, json={"zone_id": 1, "membership_id": 1}).status_code == 403
    assert client.delete(f"{base}1/").status_code == 403


def test_archived_tournament_blocks_zone_writes(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _track(db, td_tournament)
    zone = _zone(client, td_tournament.id, track).json()
    td_tournament.is_archived = True
    db.commit()

    base = f"/tournaments/{td_tournament.id}/zones/"
    assert client.get(f"{base}?track_id={track}").status_code == 200
    assert client.post(base, json={"track_id": track, "name": "Later"}).status_code == 403
    assert client.patch(f"{base}{zone['id']}/", json={"name": "Nope"}).status_code == 403
    assert client.delete(f"{base}{zone['id']}/").status_code == 403
