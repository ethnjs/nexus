"""Tests for /users/me/competition-experience/ and /users/me/volunteer-experience/."""

from app.models.models import UserCompetitionExperience, UserVolunteerExperience
from tests.conftest import login

# ---------------------------------------------------------------------------
# POST /users/me/competition-experience/
# ---------------------------------------------------------------------------


class TestCreateCompetitionExperience:
    def test_valid_event_and_school(self, client, td_user, event):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            "/users/me/competition-experience/",
            json={
                "event_id": event.id,
                "school": "MIT",
            },
        )
        assert res.status_code == 201
        data = res.json()
        assert data["event"]["id"] == event.id
        assert data["school"] == "MIT"

    def test_invalid_event_id_404(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            "/users/me/competition-experience/",
            json={
                "event_id": 9999,
                "school": "MIT",
            },
        )
        assert res.status_code == 404

    def test_unauthenticated_forbidden(self, client, event):
        res = client.post(
            "/users/me/competition-experience/",
            json={
                "event_id": event.id,
                "school": "MIT",
            },
        )
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# PATCH /users/me/competition-experience/{id}/
# ---------------------------------------------------------------------------


class TestUpdateCompetitionExperience:
    def test_partial_update(self, client, db, td_user, event):
        entry = UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="MIT")
        db.add(entry)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(
            f"/users/me/competition-experience/{entry.id}/", json={"school": "Caltech"}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["school"] == "Caltech"
        assert data["event"]["id"] == event.id  # untouched

    def test_missing_entry_404(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.patch("/users/me/competition-experience/9999/", json={"school": "Caltech"})
        assert res.status_code == 404

    def test_other_users_entry_404(self, client, db, td_user, other_user, event):
        entry = UserCompetitionExperience(user_id=other_user.id, event_id=event.id, school="MIT")
        db.add(entry)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(
            f"/users/me/competition-experience/{entry.id}/", json={"school": "Caltech"}
        )
        assert res.status_code == 404

    def test_invalid_event_id_404(self, client, db, td_user, event):
        entry = UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="MIT")
        db.add(entry)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(f"/users/me/competition-experience/{entry.id}/", json={"event_id": 9999})
        assert res.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /users/me/competition-experience/{id}/
# ---------------------------------------------------------------------------


class TestDeleteCompetitionExperience:
    def test_delete_own_entry(self, client, db, td_user, event):
        entry = UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="MIT")
        db.add(entry)
        db.commit()
        login(client, "td@test.com", "tdpass")
        assert client.delete(f"/users/me/competition-experience/{entry.id}/").status_code == 204
        assert db.get(UserCompetitionExperience, entry.id) is None

    def test_other_users_entry_404(self, client, db, td_user, other_user, event):
        entry = UserCompetitionExperience(user_id=other_user.id, event_id=event.id, school="MIT")
        db.add(entry)
        db.commit()
        login(client, "td@test.com", "tdpass")
        assert client.delete(f"/users/me/competition-experience/{entry.id}/").status_code == 404
        assert db.get(UserCompetitionExperience, entry.id) is not None

    def test_nonexistent_entry_404(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.delete("/users/me/competition-experience/9999/").status_code == 404


# ---------------------------------------------------------------------------
# POST /users/me/volunteer-experience/
# ---------------------------------------------------------------------------


class TestCreateVolunteerExperience:
    def test_minimal_fields(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            "/users/me/volunteer-experience/",
            json={
                "tournament_name": "Regionals",
                "year": 2025,
                "role": "Event Supervisor",
            },
        )
        assert res.status_code == 201
        data = res.json()
        assert data["tournament_name"] == "Regionals"
        assert data["year"] == 2025
        assert data["role"] == "Event Supervisor"
        assert data["event"] is None
        assert data["notes"] is None

    def test_with_event_id_no_notes_event(self, client, td_user, event):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            "/users/me/volunteer-experience/",
            json={
                "tournament_name": "Regionals",
                "year": 2025,
                "role": "Event Supervisor",
                "event_id": event.id,
            },
        )
        assert res.status_code == 201
        assert res.json()["event"]["id"] == event.id

    def test_with_notes_event_no_event_id(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            "/users/me/volunteer-experience/",
            json={
                "tournament_name": "Regionals",
                "year": 2025,
                "role": "Event Supervisor",
                "notes": {"event": "Custom Event Name"},
            },
        )
        assert res.status_code == 201
        data = res.json()
        assert data["event"] is None
        assert data["notes"]["event"] == "Custom Event Name"

    def test_event_id_and_notes_event_mutually_exclusive(self, client, td_user, event):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            "/users/me/volunteer-experience/",
            json={
                "tournament_name": "Regionals",
                "year": 2025,
                "role": "Event Supervisor",
                "event_id": event.id,
                "notes": {"event": "Custom Event Name"},
            },
        )
        assert res.status_code == 422

    def test_notes_other_coexists_with_event_id(self, client, td_user, event):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            "/users/me/volunteer-experience/",
            json={
                "tournament_name": "Regionals",
                "year": 2025,
                "role": "Event Supervisor",
                "event_id": event.id,
                "notes": {"other": "Great experience"},
            },
        )
        assert res.status_code == 201
        assert res.json()["notes"]["other"] == "Great experience"

    def test_notes_other_coexists_with_notes_event(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            "/users/me/volunteer-experience/",
            json={
                "tournament_name": "Regionals",
                "year": 2025,
                "role": "Event Supervisor",
                "notes": {"event": "Custom Event Name", "other": "Great experience"},
            },
        )
        assert res.status_code == 201
        data = res.json()
        assert data["notes"]["event"] == "Custom Event Name"
        assert data["notes"]["other"] == "Great experience"

    def test_invalid_event_id_404(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            "/users/me/volunteer-experience/",
            json={
                "tournament_name": "Regionals",
                "year": 2025,
                "role": "Event Supervisor",
                "event_id": 9999,
            },
        )
        assert res.status_code == 404

    def test_unauthenticated_forbidden(self, client):
        res = client.post(
            "/users/me/volunteer-experience/",
            json={
                "tournament_name": "Regionals",
                "year": 2025,
                "role": "Event Supervisor",
            },
        )
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# PATCH /users/me/volunteer-experience/{id}/
# ---------------------------------------------------------------------------


class TestUpdateVolunteerExperience:
    def test_partial_update(self, client, db, td_user):
        entry = UserVolunteerExperience(
            user_id=td_user.id,
            tournament_name="Regionals",
            year=2025,
            role="Event Supervisor",
        )
        db.add(entry)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(f"/users/me/volunteer-experience/{entry.id}/", json={"role": "Scorer"})
        assert res.status_code == 200
        data = res.json()
        assert data["role"] == "Scorer"
        assert data["tournament_name"] == "Regionals"  # untouched

    def test_other_users_entry_404(self, client, db, td_user, other_user):
        entry = UserVolunteerExperience(
            user_id=other_user.id,
            tournament_name="Regionals",
            year=2025,
            role="Event Supervisor",
        )
        db.add(entry)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(f"/users/me/volunteer-experience/{entry.id}/", json={"role": "Scorer"})
        assert res.status_code == 404

    def test_nonexistent_entry_404(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.patch("/users/me/volunteer-experience/9999/", json={"role": "Scorer"})
        assert res.status_code == 404

    def test_adding_event_id_to_entry_with_notes_event_rejected(self, client, db, td_user, event):
        # Entry starts with notes.event set (no event_id) — PATCH only touches
        # event_id, but the merged post-update state would violate exclusivity.
        entry = UserVolunteerExperience(
            user_id=td_user.id,
            tournament_name="Regionals",
            year=2025,
            role="Event Supervisor",
            notes={"event": "Custom Event Name"},
        )
        db.add(entry)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(
            f"/users/me/volunteer-experience/{entry.id}/", json={"event_id": event.id}
        )
        assert res.status_code == 422

    def test_adding_notes_event_to_entry_with_event_id_rejected(self, client, db, td_user, event):
        # Reverse case — entry has event_id set, PATCH only touches notes.
        entry = UserVolunteerExperience(
            user_id=td_user.id,
            tournament_name="Regionals",
            year=2025,
            role="Event Supervisor",
            event_id=event.id,
        )
        db.add(entry)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(
            f"/users/me/volunteer-experience/{entry.id}/",
            json={"notes": {"event": "Custom Event Name"}},
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# DELETE /users/me/volunteer-experience/{id}/
# ---------------------------------------------------------------------------


class TestDeleteVolunteerExperience:
    def test_delete_own_entry(self, client, db, td_user):
        entry = UserVolunteerExperience(
            user_id=td_user.id,
            tournament_name="Regionals",
            year=2025,
            role="Event Supervisor",
        )
        db.add(entry)
        db.commit()
        login(client, "td@test.com", "tdpass")
        assert client.delete(f"/users/me/volunteer-experience/{entry.id}/").status_code == 204
        assert db.get(UserVolunteerExperience, entry.id) is None

    def test_other_users_entry_404(self, client, db, td_user, other_user):
        entry = UserVolunteerExperience(
            user_id=other_user.id,
            tournament_name="Regionals",
            year=2025,
            role="Event Supervisor",
        )
        db.add(entry)
        db.commit()
        login(client, "td@test.com", "tdpass")
        assert client.delete(f"/users/me/volunteer-experience/{entry.id}/").status_code == 404
        assert db.get(UserVolunteerExperience, entry.id) is not None

    def test_nonexistent_entry_404(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.delete("/users/me/volunteer-experience/9999/").status_code == 404


# ---------------------------------------------------------------------------
# PUT /users/me/competition-experience/
# ---------------------------------------------------------------------------


class TestReplaceCompetitionExperience:
    def test_creates_updates_and_deletes_in_order(self, client, db, td_user, event):
        kept = UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="MIT")
        dropped = UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="Yale")
        db.add_all([kept, dropped])
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.put(
            "/users/me/competition-experience/",
            json=[
                {"event_id": event.id, "school": "Caltech"},
                {"id": kept.id, "event_id": event.id, "school": "Stanford", "notes": "Captain"},
            ],
        )
        assert res.status_code == 200
        data = res.json()
        assert [d["school"] for d in data] == ["Caltech", "Stanford"]
        assert data[1]["id"] == kept.id
        assert data[1]["notes"] == "Captain"
        assert db.get(UserCompetitionExperience, dropped.id) is None

    def test_empty_list_deletes_all(self, client, db, td_user, event):
        db.add(UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="MIT"))
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.put("/users/me/competition-experience/", json=[])
        assert res.status_code == 200
        assert res.json() == []
        assert db.query(UserCompetitionExperience).filter_by(user_id=td_user.id).count() == 0

    def test_blank_school_422_saves_nothing(self, client, db, td_user, event):
        login(client, "td@test.com", "tdpass")
        res = client.put(
            "/users/me/competition-experience/",
            json=[
                {"event_id": event.id, "school": "MIT"},
                {"event_id": event.id, "school": "   "},
            ],
        )
        assert res.status_code == 422
        assert db.query(UserCompetitionExperience).filter_by(user_id=td_user.id).count() == 0

    def test_unknown_event_404_saves_nothing(self, client, db, td_user, event):
        login(client, "td@test.com", "tdpass")
        res = client.put(
            "/users/me/competition-experience/",
            json=[
                {"event_id": event.id, "school": "MIT"},
                {"event_id": 9999, "school": "Caltech"},
            ],
        )
        assert res.status_code == 404
        assert db.query(UserCompetitionExperience).filter_by(user_id=td_user.id).count() == 0

    def test_other_users_entry_404_saves_nothing(self, client, db, td_user, other_user, event):
        own = UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="MIT")
        theirs = UserCompetitionExperience(user_id=other_user.id, event_id=event.id, school="Yale")
        db.add_all([own, theirs])
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.put(
            "/users/me/competition-experience/",
            json=[{"id": theirs.id, "event_id": event.id, "school": "Caltech"}],
        )
        assert res.status_code == 404
        db.refresh(theirs)
        assert theirs.school == "Yale"
        assert db.get(UserCompetitionExperience, own.id) is not None

    def test_duplicate_id_422(self, client, db, td_user, event):
        entry = UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="MIT")
        db.add(entry)
        db.commit()
        login(client, "td@test.com", "tdpass")
        row = {"id": entry.id, "event_id": event.id, "school": "MIT"}
        res = client.put("/users/me/competition-experience/", json=[row, row])
        assert res.status_code == 422

    def test_unauthenticated_401(self, client):
        res = client.put("/users/me/competition-experience/", json=[])
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# PUT /users/me/volunteer-experience/
# ---------------------------------------------------------------------------


class TestReplaceVolunteerExperience:
    def test_creates_updates_and_deletes_in_order(self, client, db, td_user, event):
        kept = UserVolunteerExperience(
            user_id=td_user.id, tournament_name="Regionals", year=2024, role="Proctor"
        )
        dropped = UserVolunteerExperience(
            user_id=td_user.id, tournament_name="States", year=2024, role="Proctor"
        )
        db.add_all([kept, dropped])
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.put(
            "/users/me/volunteer-experience/",
            json=[
                {
                    "tournament_name": "Nationals",
                    "year": 2025,
                    "role": "Event Supervisor",
                    "notes": {"event": "Custom Event"},
                },
                {
                    "id": kept.id,
                    "tournament_name": "Regionals",
                    "year": 2025,
                    "role": "Grader",
                    "event_id": event.id,
                },
            ],
        )
        assert res.status_code == 200
        data = res.json()
        assert [d["tournament_name"] for d in data] == ["Nationals", "Regionals"]
        assert data[0]["notes"] == {"event": "Custom Event", "other": None}
        assert data[1]["id"] == kept.id
        assert data[1]["role"] == "Grader"
        assert data[1]["event"]["id"] == event.id
        assert db.get(UserVolunteerExperience, dropped.id) is None

    def test_blank_role_422_saves_nothing(self, client, db, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.put(
            "/users/me/volunteer-experience/",
            json=[
                {"tournament_name": "Regionals", "year": 2025, "role": "Proctor"},
                {"tournament_name": "States", "year": 2025, "role": ""},
            ],
        )
        assert res.status_code == 422
        assert db.query(UserVolunteerExperience).filter_by(user_id=td_user.id).count() == 0

    def test_event_id_and_notes_event_mutually_exclusive(self, client, td_user, event):
        login(client, "td@test.com", "tdpass")
        res = client.put(
            "/users/me/volunteer-experience/",
            json=[
                {
                    "tournament_name": "Regionals",
                    "year": 2025,
                    "role": "Proctor",
                    "event_id": event.id,
                    "notes": {"event": "Custom Event"},
                }
            ],
        )
        assert res.status_code == 422

    def test_other_users_entry_404(self, client, db, td_user, other_user):
        theirs = UserVolunteerExperience(
            user_id=other_user.id, tournament_name="Regionals", year=2024, role="Proctor"
        )
        db.add(theirs)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.put(
            "/users/me/volunteer-experience/",
            json=[{"id": theirs.id, "tournament_name": "States", "year": 2025, "role": "Grader"}],
        )
        assert res.status_code == 404
        db.refresh(theirs)
        assert theirs.tournament_name == "Regionals"
