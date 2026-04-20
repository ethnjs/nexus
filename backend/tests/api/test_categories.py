"""Tests for /tournaments/{tournament_id}/categories endpoints."""
import pytest
from fastapi.testclient import TestClient
from tests.conftest import login
from app.models.models import Membership
from app.core.permissions import DEFAULT_CATEGORIES


def _make_category(client, tournament_id, name="Robotics"):
    return client.post(
        f"/tournaments/{tournament_id}/categories/", json={"name": name}
    )


def _update_category(client, tournament_id, cat_id, name):
    return client.patch(
        f"/tournaments/{tournament_id}/categories/{cat_id}/", json={"name": name}
    )


def _make_event(client, tournament_id, **overrides):
    payload = {"tournament_id": tournament_id, "name": "Boomilever", "division": "C"}
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/events/", json=payload)


# ---------------------------------------------------------------------------
# Seeding on tournament create
# ---------------------------------------------------------------------------

def test_tournament_create_seeds_default_categories(client, td_user):
    """Categories must be seeded by the POST /tournaments/ route itself."""
    login(client, "td@test.com", "tdpass")
    tournament = client.post("/tournaments/", json={"name": "Seeding Test"}).json()
    response = client.get(f"/tournaments/{tournament['id']}/categories/")
    assert response.status_code == 200
    names = {c["name"] for c in response.json()}
    assert set(DEFAULT_CATEGORIES) <= names


def test_seeded_categories_are_not_custom(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    categories = client.get(f"/tournaments/{td_tournament.id}/categories/").json()
    seeded = [c for c in categories if c["name"] in DEFAULT_CATEGORIES]
    assert len(seeded) == len(DEFAULT_CATEGORIES)
    assert all(not c["is_custom"] for c in seeded)


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def test_list_categories_includes_seeded_and_custom(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_category(client, td_tournament.id, name="Robotics")
    categories = client.get(f"/tournaments/{td_tournament.id}/categories/").json()
    names = {c["name"] for c in categories}
    assert "Robotics" in names
    assert set(DEFAULT_CATEGORIES) <= names


def test_list_categories_view_events_permission_sufficient(
    client, td_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/categories/").status_code == 200


def test_list_categories_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/categories/").status_code == 404


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def test_create_custom_category(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_category(client, td_tournament.id, name="Robotics")
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Robotics"
    assert data["is_custom"] is True
    assert data["tournament_id"] == td_tournament.id


def test_create_category_always_custom(client, td_user, td_tournament):
    """is_custom is always forced to True on create regardless of any payload."""
    login(client, "td@test.com", "tdpass")
    data = _make_category(client, td_tournament.id).json()
    assert data["is_custom"] is True


def test_create_duplicate_category_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_category(client, td_tournament.id, name="Robotics")
    assert _make_category(client, td_tournament.id, name="Robotics").status_code == 400


def test_create_category_same_name_as_seeded_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert _make_category(
        client, td_tournament.id, name=DEFAULT_CATEGORIES[0]
    ).status_code == 400


def test_create_category_requires_manage_events(
    client, td_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert _make_category(client, other_tournament.id).status_code == 403


def test_create_category_unauthenticated(client, td_tournament):
    assert _make_category(client, td_tournament.id).status_code == 401


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_update_custom_category(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_category(client, td_tournament.id, name="Robotics").json()
    response = _update_category(client, td_tournament.id, created["id"], "Engineering")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == created["id"]
    assert data["name"] == "Engineering"
    assert data["is_custom"] is True


def test_update_default_category_forbidden(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    categories = client.get(f"/tournaments/{td_tournament.id}/categories/").json()
    default_cat = next(c for c in categories if not c["is_custom"])
    response = _update_category(client, td_tournament.id, default_cat["id"], "Renamed")
    assert response.status_code == 403
    assert response.json()["detail"] == "Default categories cannot be edited"


def test_update_category_duplicate_name_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    cat_a = _make_category(client, td_tournament.id, name="Robotics").json()
    _make_category(client, td_tournament.id, name="Engineering")
    response = _update_category(client, td_tournament.id, cat_a["id"], "Engineering")
    assert response.status_code == 400
    assert response.json()["detail"] == "Category already exists"


def test_update_category_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _update_category(client, td_tournament.id, 9999, "Renamed")
    assert response.status_code == 404
    assert response.json()["detail"] == "Category not found"


def test_update_category_wrong_tournament_404(
    client, td_user, td_tournament, other_tournament, db
):
    """A category from tournament A is not reachable via tournament B's URL."""
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["tournament_director"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    cat = _make_category(client, td_tournament.id, name="Robotics").json()
    response = _update_category(client, other_tournament.id, cat["id"], "Renamed")
    assert response.status_code == 404


def test_update_category_requires_manage_events(
    client, td_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = _update_category(client, other_tournament.id, 1, "Renamed")
    assert response.status_code == 403


def test_update_category_unauthenticated(client, td_tournament):
    response = _update_category(client, td_tournament.id, 1, "Renamed")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_custom_category(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_category(client, td_tournament.id).json()
    assert client.delete(
        f"/tournaments/{td_tournament.id}/categories/{created['id']}/"
    ).status_code == 204
    names = {c["name"] for c in client.get(f"/tournaments/{td_tournament.id}/categories/").json()}
    assert "Robotics" not in names


def test_delete_seeded_category_forbidden(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    categories = client.get(f"/tournaments/{td_tournament.id}/categories/").json()
    seeded = next(c for c in categories if not c["is_custom"])
    assert client.delete(
        f"/tournaments/{td_tournament.id}/categories/{seeded['id']}/"
    ).status_code == 403


def test_delete_category_in_use_returns_409(client, td_user, td_tournament):
    """Deleting a category that events are using must return 409."""
    login(client, "td@test.com", "tdpass")
    cat = _make_category(client, td_tournament.id, name="Robotics").json()
    _make_event(client, td_tournament.id, category_id=cat["id"])
    assert client.delete(
        f"/tournaments/{td_tournament.id}/categories/{cat['id']}/"
    ).status_code == 409


def test_delete_category_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(
        f"/tournaments/{td_tournament.id}/categories/9999/"
    ).status_code == 404


def test_delete_category_wrong_tournament_404(
    client, td_user, td_tournament, other_user, other_tournament, db
):
    """A category from tournament A is not reachable via tournament B's URL."""
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["tournament_director"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    cat = _make_category(client, td_tournament.id, name="Robotics").json()
    assert client.delete(
        f"/tournaments/{other_tournament.id}/categories/{cat['id']}/"
    ).status_code == 404


def test_delete_category_requires_manage_events(
    client, td_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert client.delete(
        f"/tournaments/{other_tournament.id}/categories/1/"
    ).status_code == 403
