"""Tests for the canonical /events/ and /event-categories/ routes."""
from tests.conftest import login
from app.models.models import Event, EventCategory, UserCompetitionExperience, UserVolunteerExperience


def _make_category(db, name="Chemistry"):
    category = EventCategory(name=name)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


def _make_event(db, category, name="Boomilever"):
    event = Event(name=name, category_id=category.id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


# ---------------------------------------------------------------------------
# GET /events/
# ---------------------------------------------------------------------------

class TestListEvents:
    def test_list_events(self, client, db):
        category = _make_category(db)
        _make_event(db, category)
        res = client.get("/events/")
        assert res.status_code == 200
        assert len(res.json()) == 1

    def test_list_events_anonymous_allowed(self, client, db):
        category = _make_category(db)
        _make_event(db, category)
        assert client.get("/events/").status_code == 200


# ---------------------------------------------------------------------------
# POST /events/
# ---------------------------------------------------------------------------

class TestCreateEvent:
    def test_admin_can_create_event(self, client, db, admin_user):
        category = _make_category(db)
        login(client, "admin@test.com", "adminpass")
        res = client.post("/events/", json={"name": "Boomilever", "category_id": category.id})
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "Boomilever"
        assert data["category_id"] == category.id

    def test_non_admin_forbidden(self, client, db, td_user):
        category = _make_category(db)
        login(client, "td@test.com", "tdpass")
        res = client.post("/events/", json={"name": "Boomilever", "category_id": category.id})
        assert res.status_code == 403

    def test_unauthenticated_forbidden(self, client, db):
        category = _make_category(db)
        res = client.post("/events/", json={"name": "Boomilever", "category_id": category.id})
        assert res.status_code == 401

    def test_invalid_category_id_404(self, client, db, admin_user):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/events/", json={"name": "Boomilever", "category_id": 9999})
        assert res.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /events/{id}/
# ---------------------------------------------------------------------------

class TestUpdateEvent:
    def test_partial_update(self, client, db, admin_user):
        category = _make_category(db)
        event = _make_event(db, category)
        login(client, "admin@test.com", "adminpass")
        res = client.patch(f"/events/{event.id}/", json={"name": "Hovercraft"})
        assert res.status_code == 200
        assert res.json()["name"] == "Hovercraft"

    def test_update_category_id(self, client, db, admin_user):
        category = _make_category(db, "Chemistry")
        other_category = _make_category(db, "Physics")
        event = _make_event(db, category)
        login(client, "admin@test.com", "adminpass")
        res = client.patch(f"/events/{event.id}/", json={"category_id": other_category.id})
        assert res.status_code == 200
        assert res.json()["category_id"] == other_category.id

    def test_missing_event_404(self, client, db, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert client.patch("/events/9999/", json={"name": "Hovercraft"}).status_code == 404

    def test_invalid_category_id_404(self, client, db, admin_user):
        category = _make_category(db)
        event = _make_event(db, category)
        login(client, "admin@test.com", "adminpass")
        res = client.patch(f"/events/{event.id}/", json={"category_id": 9999})
        assert res.status_code == 404

    def test_non_admin_forbidden(self, client, db, td_user):
        category = _make_category(db)
        event = _make_event(db, category)
        login(client, "td@test.com", "tdpass")
        assert client.patch(f"/events/{event.id}/", json={"name": "Hovercraft"}).status_code == 403


# ---------------------------------------------------------------------------
# DELETE /events/{id}/
# ---------------------------------------------------------------------------

class TestDeleteEvent:
    def test_delete_with_no_experience_entries(self, client, db, admin_user):
        category = _make_category(db)
        event = _make_event(db, category)
        login(client, "admin@test.com", "adminpass")
        assert client.delete(f"/events/{event.id}/").status_code == 204
        assert db.get(Event, event.id) is None

    def test_delete_blocked_by_competition_experience(self, client, db, admin_user, td_user):
        category = _make_category(db)
        event = _make_event(db, category)
        db.add(UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="MIT"))
        db.commit()
        login(client, "admin@test.com", "adminpass")
        res = client.delete(f"/events/{event.id}/")
        assert res.status_code == 409
        assert db.get(Event, event.id) is not None

    def test_delete_blocked_by_volunteer_experience(self, client, db, admin_user, td_user):
        category = _make_category(db)
        event = _make_event(db, category)
        db.add(UserVolunteerExperience(
            user_id=td_user.id, event_id=event.id,
            tournament_name="Regionals", year=2025, role="Event Supervisor",
        ))
        db.commit()
        login(client, "admin@test.com", "adminpass")
        res = client.delete(f"/events/{event.id}/")
        assert res.status_code == 409
        assert db.get(Event, event.id) is not None

    def test_delete_not_found(self, client, db, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert client.delete("/events/9999/").status_code == 404

    def test_non_admin_forbidden(self, client, db, td_user):
        category = _make_category(db)
        event = _make_event(db, category)
        login(client, "td@test.com", "tdpass")
        assert client.delete(f"/events/{event.id}/").status_code == 403


# ---------------------------------------------------------------------------
# GET /event-categories/
# ---------------------------------------------------------------------------

class TestListEventCategories:
    def test_list_categories(self, client, db):
        _make_category(db)
        res = client.get("/event-categories/")
        assert res.status_code == 200
        assert len(res.json()) == 1


# ---------------------------------------------------------------------------
# POST /event-categories/
# ---------------------------------------------------------------------------

class TestCreateEventCategory:
    def test_admin_can_create_category(self, client, db, admin_user):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/event-categories/", json={"name": "Chemistry"})
        assert res.status_code == 201
        assert res.json()["name"] == "Chemistry"

    def test_non_admin_forbidden(self, client, db, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.post("/event-categories/", json={"name": "Chemistry"}).status_code == 403

    def test_unauthenticated_forbidden(self, client, db):
        assert client.post("/event-categories/", json={"name": "Chemistry"}).status_code == 401


# ---------------------------------------------------------------------------
# PATCH /event-categories/{id}/
# ---------------------------------------------------------------------------

class TestUpdateEventCategory:
    def test_partial_update(self, client, db, admin_user):
        category = _make_category(db, "Chemistry")
        login(client, "admin@test.com", "adminpass")
        res = client.patch(f"/event-categories/{category.id}/", json={"name": "Physics"})
        assert res.status_code == 200
        assert res.json()["name"] == "Physics"

    def test_missing_category_404(self, client, db, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert client.patch("/event-categories/9999/", json={"name": "Physics"}).status_code == 404

    def test_non_admin_forbidden(self, client, db, td_user):
        category = _make_category(db)
        login(client, "td@test.com", "tdpass")
        res = client.patch(f"/event-categories/{category.id}/", json={"name": "Physics"})
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# DELETE /event-categories/{id}/
# ---------------------------------------------------------------------------

class TestDeleteEventCategory:
    def test_delete_cascades_to_events(self, client, db, admin_user):
        category = _make_category(db)
        event = _make_event(db, category)
        login(client, "admin@test.com", "adminpass")
        assert client.delete(f"/event-categories/{category.id}/").status_code == 204
        assert db.get(EventCategory, category.id) is None
        assert db.get(Event, event.id) is None

    def test_delete_blocked_when_event_has_experience_entries(self, client, db, admin_user, td_user):
        category = _make_category(db)
        event = _make_event(db, category)
        db.add(UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="MIT"))
        db.commit()
        login(client, "admin@test.com", "adminpass")
        res = client.delete(f"/event-categories/{category.id}/")
        assert res.status_code == 409
        # Rollback — category and its event should still exist.
        assert db.get(EventCategory, category.id) is not None
        assert db.get(Event, event.id) is not None

    def test_delete_not_found(self, client, db, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert client.delete("/event-categories/9999/").status_code == 404

    def test_non_admin_forbidden(self, client, db, td_user):
        category = _make_category(db)
        login(client, "td@test.com", "tdpass")
        assert client.delete(f"/event-categories/{category.id}/").status_code == 403
