"""Tests for /admin/season-events endpoints (SeasonEvent model) and the
/tournaments/{tournament_id}/events/load-defaults bulk-load action."""
from tests.conftest import login
from app.models.models import SeasonEvent


def _login_admin(client):
    login(client, "admin@test.com", "adminpass")


def _make_season_event(client, **overrides):
    payload = {"year": 2026, "division": "C", "is_active": True}
    payload.update(overrides)
    return client.post("/admin/season-events/", json=payload)


# ---------------------------------------------------------------------------
# Admin CRUD
# ---------------------------------------------------------------------------

def test_create_season_event(client, admin_user, event):
    _login_admin(client)
    response = _make_season_event(client, event_id=event.id)
    assert response.status_code == 201
    data = response.json()
    assert data["event_id"] == event.id
    assert data["year"] == 2026
    assert data["division"] == "C"
    assert data["is_active"] is True
    assert data["event"]["name"] == event.name


def test_create_season_event_duplicate_rejected(client, admin_user, event):
    _login_admin(client)
    assert _make_season_event(client, event_id=event.id).status_code == 201
    assert _make_season_event(client, event_id=event.id).status_code == 409


def test_list_season_events_filter_by_year_division(client, admin_user, event_factory, event_category):
    _login_admin(client)
    e1 = event_factory(event_category, name="Boomilever")
    e2 = event_factory(event_category, name="Hovercraft")
    _make_season_event(client, event_id=e1.id, year=2026, division="C")
    _make_season_event(client, event_id=e2.id, year=2027, division="B")

    response = client.get("/admin/season-events/", params={"year": 2026})
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["event_id"] == e1.id


def test_update_season_event_toggle_active(client, admin_user, event):
    _login_admin(client)
    created = _make_season_event(client, event_id=event.id, is_active=False).json()
    response = client.patch(f"/admin/season-events/{created['id']}/", json={"is_active": True})
    assert response.status_code == 200
    assert response.json()["is_active"] is True


def test_delete_season_event(client, admin_user, event):
    _login_admin(client)
    created = _make_season_event(client, event_id=event.id).json()
    assert client.delete(f"/admin/season-events/{created['id']}/").status_code == 204


def test_season_event_routes_require_admin(client, td_user, event):
    """A regular (non-admin) user gets 403 on every admin route."""
    login(client, "td@test.com", "tdpass")
    assert _make_season_event(client, event_id=event.id).status_code == 403
    assert client.get("/admin/season-events/").status_code == 403


# ---------------------------------------------------------------------------
# Bulk-load
# ---------------------------------------------------------------------------

def test_load_defaults_only_pulls_supported_divisions(client, admin_user, td_user, td_tournament, db, event_factory, event_category):
    """td_tournament supports divisions B/C only (see conftest)."""
    e_c = event_factory(event_category, name="Boomilever")
    e_a = event_factory(event_category, name="Elementary Event")
    db.add_all([
        SeasonEvent(event_id=e_c.id, year=2026, division="C", is_active=True),
        SeasonEvent(event_id=e_a.id, year=2026, division="A", is_active=True),
    ])
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/events/load-defaults/")
    assert response.status_code == 201
    data = response.json()
    assert len(data["created"]) == 1
    assert data["created"][0]["event_id"] == e_c.id
    assert data["skipped"] == []


def test_load_defaults_skips_already_loaded(client, admin_user, td_user, td_tournament, db, event_factory, event_category):
    e_c = event_factory(event_category, name="Boomilever")
    db.add(SeasonEvent(event_id=e_c.id, year=2026, division="C", is_active=True))
    db.commit()

    login(client, "td@test.com", "tdpass")
    first = client.post(f"/tournaments/{td_tournament.id}/events/load-defaults/")
    assert len(first.json()["created"]) == 1

    second = client.post(f"/tournaments/{td_tournament.id}/events/load-defaults/")
    assert second.status_code == 201
    assert second.json()["created"] == []
    assert len(second.json()["skipped"]) == 1
    assert second.json()["skipped"][0]["event_id"] == e_c.id


def test_load_defaults_no_active_season_events_is_noop(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/events/load-defaults/")
    assert response.status_code == 201
    assert response.json() == {"created": [], "skipped": []}


def test_load_defaults_ignores_inactive_season_events(client, td_user, td_tournament, db, event_factory, event_category):
    e_c = event_factory(event_category, name="Boomilever")
    db.add(SeasonEvent(event_id=e_c.id, year=2026, division="C", is_active=False))
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/events/load-defaults/")
    assert response.status_code == 201
    assert response.json() == {"created": [], "skipped": []}


def test_load_defaults_requires_manage_events(client, td_user, other_tournament, db):
    from tests.conftest import grant_role
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.post(f"/tournaments/{other_tournament.id}/events/load-defaults/").status_code == 403
