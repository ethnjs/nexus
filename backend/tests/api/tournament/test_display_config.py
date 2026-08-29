"""Tests for GET/PUT /tournaments/{tournament_id}/display-config/
(app/api/routes/tournament/display_config.py)."""
from tests.conftest import grant_role, login


# ---------------------------------------------------------------------------
# GET — manage_members, lenient on read
# ---------------------------------------------------------------------------

def test_get_display_config_defaults_to_empty(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/display-config/")
    assert response.status_code == 200
    assert response.json() == {}


def test_get_display_config_requires_manage_members(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/display-config/").status_code == 403


def test_get_display_config_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/display-config/").status_code == 404


def test_get_display_config_lenient_on_stale_data(client, td_user, td_tournament, db):
    """A deleted track (or a surface key from a since-removed UI location)
    leaves a dangling reference behind — reading it back must never 500."""
    td_tournament.display_config = {
        "unknown_surface": {"hidden": ["track:999", "not_a_real_namespace:x"]},
    }
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/display-config/")
    assert response.status_code == 200
    assert response.json() == {"unknown_surface": {"hidden": ["track:999", "not_a_real_namespace:x"]}}


# ---------------------------------------------------------------------------
# PUT — manage_members, strict on write
# ---------------------------------------------------------------------------

def test_put_display_config_saves_valid_config(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    payload = {
        "members_panel": {"hidden": ["track:3", "lunch_category:entree"]},
        "member_page": {"hidden": ["event_pref:morning"]},
    }
    response = client.put(f"/tournaments/{td_tournament.id}/display-config/", json=payload)
    assert response.status_code == 200
    assert response.json() == payload

    follow_up = client.get(f"/tournaments/{td_tournament.id}/display-config/")
    assert follow_up.json() == payload


def test_put_display_config_rejects_unknown_surface(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"not_a_surface": {"hidden": []}},
    )
    assert response.status_code == 422


def test_put_display_config_rejects_unknown_namespace(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_panel": {"hidden": ["not_a_namespace:1"]}},
    )
    assert response.status_code == 422


def test_put_display_config_requires_manage_members(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{other_tournament.id}/display-config/",
        json={"members_panel": {"hidden": []}},
    )
    assert response.status_code == 403


def test_put_display_config_rejects_archived_tournament(client, td_user, td_tournament, db):
    td_tournament.is_archived = True
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_panel": {"hidden": []}},
    )
    assert response.status_code == 403
