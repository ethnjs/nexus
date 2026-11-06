"""Tests for the canonical /events/ and /event-categories/ routes."""

from app.models.models import (
    Event,
    EventCategory,
    UserCompetitionExperience,
    UserVolunteerExperience,
)
from tests.conftest import login

# ---------------------------------------------------------------------------
# GET /events/
# ---------------------------------------------------------------------------


class TestListEvents:
    def test_list_events(self, client, event_category_factory, event_factory):
        category = event_category_factory()
        event_factory(category)
        res = client.get("/events/")
        assert res.status_code == 200
        assert len(res.json()) == 1

    def test_list_events_anonymous_allowed(self, client, event_category_factory, event_factory):
        category = event_category_factory()
        event_factory(category)
        assert client.get("/events/").status_code == 200


# ---------------------------------------------------------------------------
# POST /events/
# ---------------------------------------------------------------------------


class TestCreateEvent:
    def test_admin_can_create_event(self, client, admin_user, event_category):
        login(client, "admin@test.com", "adminpass")
        res = client.post(
            "/admin/events/", json={"name": "Boomilever", "category_id": event_category.id}
        )
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "Boomilever"
        assert data["category"]["id"] == event_category.id

    def test_non_admin_forbidden(self, client, td_user, event_category):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            "/admin/events/", json={"name": "Boomilever", "category_id": event_category.id}
        )
        assert res.status_code == 403

    def test_unauthenticated_forbidden(self, client, event_category):
        res = client.post(
            "/admin/events/", json={"name": "Boomilever", "category_id": event_category.id}
        )
        assert res.status_code == 401

    def test_invalid_category_id_404(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/admin/events/", json={"name": "Boomilever", "category_id": 9999})
        assert res.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /events/{id}/
# ---------------------------------------------------------------------------


class TestUpdateEvent:
    def test_partial_update(self, client, admin_user, event):
        login(client, "admin@test.com", "adminpass")
        res = client.patch(f"/admin/events/{event.id}/", json={"name": "Hovercraft"})
        assert res.status_code == 200
        assert res.json()["name"] == "Hovercraft"

    def test_update_category_id(self, client, admin_user, event_category_factory, event_factory):
        category = event_category_factory("Chemistry")
        other_category = event_category_factory("Physics")
        event = event_factory(category)
        login(client, "admin@test.com", "adminpass")
        res = client.patch(f"/admin/events/{event.id}/", json={"category_id": other_category.id})
        assert res.status_code == 200
        assert res.json()["category"]["id"] == other_category.id

    def test_missing_event_404(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert client.patch("/admin/events/9999/", json={"name": "Hovercraft"}).status_code == 404

    def test_invalid_category_id_404(self, client, admin_user, event):
        login(client, "admin@test.com", "adminpass")
        res = client.patch(f"/admin/events/{event.id}/", json={"category_id": 9999})
        assert res.status_code == 404

    def test_non_admin_forbidden(self, client, td_user, event):
        login(client, "td@test.com", "tdpass")
        assert (
            client.patch(f"/admin/events/{event.id}/", json={"name": "Hovercraft"}).status_code
            == 403
        )


# ---------------------------------------------------------------------------
# DELETE /events/{id}/
# ---------------------------------------------------------------------------


class TestDeleteEvent:
    def test_delete_with_no_experience_entries(self, client, db, admin_user, event):
        login(client, "admin@test.com", "adminpass")
        assert client.delete(f"/admin/events/{event.id}/").status_code == 204
        assert db.get(Event, event.id) is None

    def test_delete_blocked_by_competition_experience(self, client, db, admin_user, td_user, event):
        db.add(UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="MIT"))
        db.commit()
        login(client, "admin@test.com", "adminpass")
        res = client.delete(f"/admin/events/{event.id}/")
        assert res.status_code == 409
        assert db.get(Event, event.id) is not None

    def test_delete_blocked_by_volunteer_experience(self, client, db, admin_user, td_user, event):
        db.add(
            UserVolunteerExperience(
                user_id=td_user.id,
                event_id=event.id,
                tournament_name="Regionals",
                year=2025,
                role="Event Supervisor",
            )
        )
        db.commit()
        login(client, "admin@test.com", "adminpass")
        res = client.delete(f"/admin/events/{event.id}/")
        assert res.status_code == 409
        assert db.get(Event, event.id) is not None

    def test_delete_not_found(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert client.delete("/admin/events/9999/").status_code == 404

    def test_non_admin_forbidden(self, client, td_user, event):
        login(client, "td@test.com", "tdpass")
        assert client.delete(f"/admin/events/{event.id}/").status_code == 403


# ---------------------------------------------------------------------------
# POST/DELETE /admin/events/{id}/related/
# ---------------------------------------------------------------------------


class TestRelatedEvents:
    def _pair(self, event_factory, event_category):
        return (
            event_factory(event_category, name="Heredity"),
            event_factory(event_category, name="Designer Genes"),
        )

    def _related(self, client, event_id):
        row = next(e for e in client.get("/events/").json() if e["id"] == event_id)
        return [r["name"] for r in row["related_events"]]

    def test_relating_shows_on_both_events(self, client, admin_user, event_factory, event_category):
        heredity, genes = self._pair(event_factory, event_category)
        login(client, "admin@test.com", "adminpass")
        res = client.post(
            f"/admin/events/{genes.id}/related/", json={"related_event_id": heredity.id}
        )
        assert res.status_code == 201
        assert [r["name"] for r in res.json()["related_events"]] == ["Heredity"]
        assert self._related(client, heredity.id) == ["Designer Genes"]
        assert self._related(client, genes.id) == ["Heredity"]

    def test_relating_the_other_way_round_is_a_duplicate(
        self, client, admin_user, event_factory, event_category
    ):
        heredity, genes = self._pair(event_factory, event_category)
        login(client, "admin@test.com", "adminpass")
        client.post(f"/admin/events/{genes.id}/related/", json={"related_event_id": heredity.id})
        res = client.post(
            f"/admin/events/{heredity.id}/related/", json={"related_event_id": genes.id}
        )
        assert res.status_code == 409

    def test_cannot_relate_an_event_to_itself(self, client, admin_user, event):
        login(client, "admin@test.com", "adminpass")
        res = client.post(f"/admin/events/{event.id}/related/", json={"related_event_id": event.id})
        assert res.status_code == 422

    def test_relating_a_missing_event_404s(self, client, admin_user, event):
        login(client, "admin@test.com", "adminpass")
        res = client.post(f"/admin/events/{event.id}/related/", json={"related_event_id": 9999})
        assert res.status_code == 404

    def test_removing_clears_both_events(self, client, admin_user, event_factory, event_category):
        heredity, genes = self._pair(event_factory, event_category)
        login(client, "admin@test.com", "adminpass")
        client.post(f"/admin/events/{genes.id}/related/", json={"related_event_id": heredity.id})
        # Removed from the other side than it was added on.
        res = client.delete(f"/admin/events/{heredity.id}/related/{genes.id}/")
        assert res.status_code == 200
        assert res.json()["related_events"] == []
        assert self._related(client, genes.id) == []

    def test_removing_an_unrelated_pair_404s(
        self, client, admin_user, event_factory, event_category
    ):
        heredity, genes = self._pair(event_factory, event_category)
        login(client, "admin@test.com", "adminpass")
        assert client.delete(f"/admin/events/{heredity.id}/related/{genes.id}/").status_code == 404

    def test_deleting_an_event_drops_its_relationships(
        self, client, admin_user, event_factory, event_category
    ):
        heredity, genes = self._pair(event_factory, event_category)
        login(client, "admin@test.com", "adminpass")
        client.post(f"/admin/events/{genes.id}/related/", json={"related_event_id": heredity.id})
        assert client.delete(f"/admin/events/{genes.id}/").status_code == 204
        assert self._related(client, heredity.id) == []

    def test_embedded_events_carry_relationships(
        self, client, admin_user, event_factory, event_category
    ):
        heredity, genes = self._pair(event_factory, event_category)
        login(client, "admin@test.com", "adminpass")
        client.post(f"/admin/events/{genes.id}/related/", json={"related_event_id": heredity.id})
        client.post(
            "/admin/season-events/",
            json={"event_id": heredity.id, "year": 2027, "division": "B", "is_active": True},
        )
        [row] = client.get("/season-events/", params={"year": 2027}).json()
        assert row["event"]["related_events"] == [{"id": genes.id, "name": "Designer Genes"}]

    def test_non_admin_forbidden(self, client, td_user, event_factory, event_category):
        heredity, genes = self._pair(event_factory, event_category)
        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/admin/events/{genes.id}/related/", json={"related_event_id": heredity.id}
        )
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# GET /event-categories/
# ---------------------------------------------------------------------------


class TestListEventCategories:
    def test_list_categories(self, client, event_category):
        res = client.get("/event-categories/")
        assert res.status_code == 200
        assert len(res.json()) == 1


# ---------------------------------------------------------------------------
# POST /event-categories/
# ---------------------------------------------------------------------------


class TestCreateEventCategory:
    def test_admin_can_create_category(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/admin/event-categories/", json={"name": "Chemistry"})
        assert res.status_code == 201
        assert res.json()["name"] == "Chemistry"

    def test_non_admin_forbidden(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert (
            client.post("/admin/event-categories/", json={"name": "Chemistry"}).status_code == 403
        )

    def test_unauthenticated_forbidden(self, client):
        assert (
            client.post("/admin/event-categories/", json={"name": "Chemistry"}).status_code == 401
        )


# ---------------------------------------------------------------------------
# PATCH /event-categories/{id}/
# ---------------------------------------------------------------------------


class TestUpdateEventCategory:
    def test_partial_update(self, client, admin_user, event_category):
        login(client, "admin@test.com", "adminpass")
        res = client.patch(
            f"/admin/event-categories/{event_category.id}/", json={"name": "Physics"}
        )
        assert res.status_code == 200
        assert res.json()["name"] == "Physics"

    def test_missing_category_404(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert (
            client.patch("/admin/event-categories/9999/", json={"name": "Physics"}).status_code
            == 404
        )

    def test_non_admin_forbidden(self, client, td_user, event_category):
        login(client, "td@test.com", "tdpass")
        res = client.patch(
            f"/admin/event-categories/{event_category.id}/", json={"name": "Physics"}
        )
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# DELETE /event-categories/{id}/
# ---------------------------------------------------------------------------


class TestDeleteEventCategory:
    def test_delete_cascades_to_events(self, client, db, admin_user, event_category, event):
        login(client, "admin@test.com", "adminpass")
        assert client.delete(f"/admin/event-categories/{event_category.id}/").status_code == 204
        assert db.get(EventCategory, event_category.id) is None
        assert db.get(Event, event.id) is None

    def test_delete_blocked_when_event_has_experience_entries(
        self, client, db, admin_user, td_user, event_category, event
    ):
        db.add(UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="MIT"))
        db.commit()
        login(client, "admin@test.com", "adminpass")
        res = client.delete(f"/admin/event-categories/{event_category.id}/")
        assert res.status_code == 409
        # Rollback — category and its event should still exist.
        assert db.get(EventCategory, event_category.id) is not None
        assert db.get(Event, event.id) is not None

    def test_delete_not_found(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert client.delete("/admin/event-categories/9999/").status_code == 404

    def test_non_admin_forbidden(self, client, td_user, event_category):
        login(client, "td@test.com", "tdpass")
        assert client.delete(f"/admin/event-categories/{event_category.id}/").status_code == 403
