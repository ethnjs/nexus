"""Tests for /tournaments/{tournament_id}/saved-filters/
(app/api/routes/tournament/saved_filters.py)."""

from app.models.models import SavedFilter
from tests.conftest import grant_role, login

FILTER = {
    "op": "and",
    "conditions": [
        {"field": "track", "op": "none_of", "values": ["7:declined"]},
        {
            "op": "or",
            "conditions": [
                {"field": "role", "op": "any_of", "values": ["3"]},
                {"field": "affiliation", "op": "empty", "values": []},
            ],
        },
    ],
}


def _url(tournament_id: int, saved_id: int | None = None) -> str:
    base = f"/tournaments/{tournament_id}/saved-filters/"
    return base if saved_id is None else f"{base}{saved_id}/"


def _create(client, tournament_id: int, **overrides) -> dict:
    payload = {"surface": "members_table", "name": "Unassigned judges", "filter": FILTER}
    payload.update(overrides)
    response = client.post(_url(tournament_id), json=payload)
    assert response.status_code == 201, response.json()
    return response.json()


def test_create_round_trips(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    body = _create(client, td_tournament.id, name="  Unassigned judges  ")
    assert body["name"] == "Unassigned judges"
    assert body["surface"] == "members_table"
    assert body["filter"] == FILTER


def test_list_filters_by_surface_and_sorts_by_name(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _create(client, td_tournament.id, name="Zeta")
    _create(client, td_tournament.id, name="Alpha")
    _create(
        client,
        td_tournament.id,
        surface="events_table",
        name="Division C",
        filter={"op": "and", "conditions": [{"field": "division", "values": ["C"]}]},
    )
    names = [
        s["name"] for s in client.get(_url(td_tournament.id) + "?surface=members_table").json()
    ]
    assert names == ["Alpha", "Zeta"]
    assert len(client.get(_url(td_tournament.id)).json()) == 3


def test_list_is_per_viewer(client, td_user, other_user, td_tournament, db):
    login(client, "td@test.com", "tdpass")
    _create(client, td_tournament.id)
    grant_role(db, td_tournament, other_user, "Tournament Director")
    login(client, "other@test.com", "otherpass")
    assert client.get(_url(td_tournament.id)).json() == []


def test_duplicate_name_on_same_surface_conflicts(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _create(client, td_tournament.id)
    response = client.post(
        _url(td_tournament.id),
        json={"surface": "members_table", "name": "Unassigned judges", "filter": FILTER},
    )
    assert response.status_code == 409


def test_same_name_on_another_surface_is_allowed(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _create(client, td_tournament.id, name="Mine")
    _create(
        client,
        td_tournament.id,
        surface="assignment_card",
        name="Mine",
    )


def test_rejects_tab_scoped_surface_key(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        _url(td_tournament.id),
        json={
            "surface": "assignments_events:all",
            "name": "x",
            "filter": {"op": "and", "conditions": [{"field": "division", "values": ["C"]}]},
        },
    )
    assert response.status_code == 422


def test_rejects_surface_without_filters(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        _url(td_tournament.id),
        json={"surface": "members_panel", "name": "x", "filter": FILTER},
    )
    assert response.status_code == 422


def test_rejects_field_from_another_table(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        _url(td_tournament.id),
        json={"surface": "shifts_table", "name": "x", "filter": FILTER},
    )
    assert response.status_code == 422


def test_rejects_blank_name(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        _url(td_tournament.id),
        json={"surface": "members_table", "name": "   ", "filter": FILTER},
    )
    assert response.status_code == 422


def test_patch_renames_and_replaces_filter(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    saved = _create(client, td_tournament.id)
    new_filter = {"op": "or", "conditions": [{"field": "age", "values": ["over_18"]}]}
    response = client.patch(
        _url(td_tournament.id, saved["id"]), json={"name": "Adults", "filter": new_filter}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Adults"
    assert response.json()["filter"] == new_filter


def test_patch_rename_onto_taken_name_conflicts(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _create(client, td_tournament.id, name="Taken")
    saved = _create(client, td_tournament.id, name="Other")
    response = client.patch(_url(td_tournament.id, saved["id"]), json={"name": "Taken"})
    assert response.status_code == 409


def test_patch_validates_filter_against_its_surface(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    saved = _create(client, td_tournament.id)
    response = client.patch(
        _url(td_tournament.id, saved["id"]),
        json={"filter": {"op": "and", "conditions": [{"field": "nope", "values": []}]}},
    )
    assert response.status_code == 422


def test_delete_removes_it(client, td_user, td_tournament, db):
    login(client, "td@test.com", "tdpass")
    saved = _create(client, td_tournament.id)
    assert client.delete(_url(td_tournament.id, saved["id"])).status_code == 204
    assert db.get(SavedFilter, saved["id"]) is None


def test_another_viewers_filter_is_404(client, td_user, other_user, td_tournament, db):
    login(client, "td@test.com", "tdpass")
    saved = _create(client, td_tournament.id)
    grant_role(db, td_tournament, other_user, "Tournament Director")
    login(client, "other@test.com", "otherpass")
    assert client.patch(_url(td_tournament.id, saved["id"]), json={"name": "x"}).status_code == 404
    assert client.delete(_url(td_tournament.id, saved["id"])).status_code == 404


def test_filter_from_another_tournament_is_404(
    client, td_user, td_tournament, other_tournament, db
):
    grant_role(db, other_tournament, td_user, "Tournament Director")
    login(client, "td@test.com", "tdpass")
    saved = _create(client, other_tournament.id)
    assert client.delete(_url(td_tournament.id, saved["id"])).status_code == 404


def test_requires_manage_members_or_events(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(_url(other_tournament.id)).status_code == 403
