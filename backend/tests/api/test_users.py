"""Tests for /admin/users and /users/me endpoints."""
from tests.conftest import grant_role, login
from app.core.auth import hash_password
from app.models.models import (
    User, Event, EventCategory, UserCompetitionExperience, UserVolunteerExperience, University,
)


VALID_PHONE = "9495551234"


def _db_user(db, email="alice@example.com", **kwargs):
    """Create a user directly in the DB for test setup."""
    defaults = {
        "first_name": "Alice",
        "last_name": "Smith",
        "email": email,
        "hashed_password": hash_password("Password@1"),
        "role": "user",
        "status": "active",
    }
    defaults.update(kwargs)
    user = User(**defaults)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# GET /admin/users/ — admin only
# ---------------------------------------------------------------------------

class TestAdminListUsers:
    def test_admin_can_list_users(self, client, admin_user, td_user):
        login(client, "admin@test.com", "adminpass")
        res = client.get("/admin/users/")
        assert res.status_code == 200
        assert len(res.json()) >= 2

    def test_non_admin_forbidden(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.get("/admin/users/").status_code == 403

    def test_unauthenticated_forbidden(self, client):
        assert client.get("/admin/users/").status_code == 401


# ---------------------------------------------------------------------------
# GET /admin/users/{id}/ — admin only
# ---------------------------------------------------------------------------

class TestAdminGetUser:
    def test_admin_can_get_user(self, client, admin_user, db):
        alice = _db_user(db)
        login(client, "admin@test.com", "adminpass")
        assert client.get(f"/admin/users/{alice.id}/").status_code == 200

    def test_non_admin_forbidden(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.get("/admin/users/1/").status_code == 403

    def test_not_found(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert client.get("/admin/users/9999/").status_code == 404

    def test_unauthenticated_forbidden(self, client):
        assert client.get("/admin/users/1/").status_code == 401


# ---------------------------------------------------------------------------
# GET /admin/users/by-email/{email}/ — admin only
# ---------------------------------------------------------------------------

class TestAdminGetUserByEmail:
    def test_admin_can_get_by_email(self, client, admin_user, db):
        _db_user(db)
        login(client, "admin@test.com", "adminpass")
        assert client.get("/admin/users/by-email/alice@example.com/").status_code == 200

    def test_not_found(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert client.get("/admin/users/by-email/nobody@example.com/").status_code == 404

    def test_non_admin_forbidden(self, client, td_user, db):
        _db_user(db)
        login(client, "td@test.com", "tdpass")
        assert client.get("/admin/users/by-email/alice@example.com/").status_code == 403

    def test_unauthenticated_forbidden(self, client, db):
        _db_user(db)
        assert client.get("/admin/users/by-email/alice@example.com/").status_code == 401


# ---------------------------------------------------------------------------
# PATCH /admin/users/{id} — admin only, role + status only
# ---------------------------------------------------------------------------

class TestAdminUpdateUser:
    def test_admin_can_change_role(self, client, admin_user, db):
        alice = _db_user(db)
        login(client, "admin@test.com", "adminpass")
        res = client.patch(f"/admin/users/{alice.id}/", json={"role": "admin"})
        assert res.status_code == 200
        assert res.json()["role"] == "admin"

    def test_admin_can_disable_user(self, client, admin_user, db):
        alice = _db_user(db)
        login(client, "admin@test.com", "adminpass")
        res = client.patch(f"/admin/users/{alice.id}/", json={"status": "deactivated"})
        assert res.status_code == 200
        assert res.json()["status"] == "deactivated"

    def test_disabled_user_cannot_login(self, client, admin_user, db):
        # Confirms disabling actually revokes access, not just flips a flag
        alice = _db_user(db, email="alice@example.com")
        login(client, "admin@test.com", "adminpass")
        client.patch(f"/admin/users/{alice.id}/", json={"status": "deactivated"})
        assert login(client, "alice@example.com", "Password@1").status_code == 401

    def test_invalid_role_rejected(self, client, admin_user, db):
        alice = _db_user(db)
        login(client, "admin@test.com", "adminpass")
        assert client.patch(f"/admin/users/{alice.id}/", json={"role": "superuser"}).status_code == 422

    def test_locking_revokes_existing_session(self, client, admin_user, db):
        # Locking must cut off an already-logged-in device immediately, not
        # just block future logins the way plain deactivation does.
        alice = _db_user(db, email="alice@example.com")
        login(client, "alice@example.com", "Password@1")
        alice_cookie = client.cookies.get("access_token")
        assert client.get("/users/me/").status_code == 200

        login(client, "admin@test.com", "adminpass")
        res = client.patch(f"/admin/users/{alice.id}/", json={"status": "locked"})
        assert res.status_code == 200
        assert res.json()["status"] == "locked"

        client.cookies.set("access_token", alice_cookie)
        assert client.get("/users/me/").status_code == 401

    def test_non_admin_forbidden(self, client, td_user, db):
        alice = _db_user(db)
        login(client, "td@test.com", "tdpass")
        assert client.patch(f"/admin/users/{alice.id}/", json={"role": "admin"}).status_code == 403

    def test_not_found(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert client.patch("/admin/users/9999/", json={"role": "user"}).status_code == 404


# ---------------------------------------------------------------------------
# DELETE /admin/users/{id}/ — admin only
# ---------------------------------------------------------------------------

class TestAdminDeleteUser:
    def test_admin_can_delete_user(self, client, admin_user, db):
        alice = _db_user(db)
        login(client, "admin@test.com", "adminpass")
        assert client.delete(f"/admin/users/{alice.id}/").status_code == 204
        assert client.get(f"/admin/users/{alice.id}/").status_code == 404

    def test_non_admin_forbidden(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.delete("/admin/users/1/").status_code == 403

    def test_not_found(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert client.delete("/admin/users/9999/").status_code == 404

    def test_unauthenticated_forbidden(self, client):
        assert client.delete("/admin/users/1/").status_code == 401


# ---------------------------------------------------------------------------
# POST /users/me/deactivate/ — authenticated self-service deactivation
# ---------------------------------------------------------------------------

class TestDeactivateMe:
    def test_deactivate_success(self, client, td_user, db):
        login(client, "td@test.com", "tdpass")
        res = client.post("/users/me/deactivate/", json={"password": "tdpass"})
        assert res.status_code == 200
        db.refresh(td_user)
        assert td_user.status == "deactivated"

    def test_wrong_password_rejected(self, client, td_user, db):
        login(client, "td@test.com", "tdpass")
        res = client.post("/users/me/deactivate/", json={"password": "wrongpass"})
        assert res.status_code == 401
        db.refresh(td_user)
        assert td_user.status == "active"

    def test_deactivate_revokes_session(self, client, td_user):
        # The session used to make this request should itself be dead
        # afterward, not just future logins blocked.
        login(client, "td@test.com", "tdpass")
        assert client.post("/users/me/deactivate/", json={"password": "tdpass"}).status_code == 200
        assert client.get("/users/me/").status_code == 401

    def test_deactivated_user_cannot_login(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.post("/users/me/deactivate/", json={"password": "tdpass"})
        assert login(client, "td@test.com", "tdpass").status_code == 401

    def test_unauthenticated_forbidden(self, client):
        assert client.post("/users/me/deactivate/", json={"password": "whatever"}).status_code == 401


# ---------------------------------------------------------------------------
# DELETE /users/me/ — authenticated self-service hard delete
# ---------------------------------------------------------------------------

class TestDeleteMe:
    def test_delete_success(self, client, td_user, db):
        login(client, "td@test.com", "tdpass")
        res = client.request("DELETE", "/users/me/", json={"password": "tdpass"})
        assert res.status_code == 200
        assert db.query(User).filter(User.id == td_user.id).first() is None

    def test_wrong_password_rejected(self, client, td_user, db):
        login(client, "td@test.com", "tdpass")
        res = client.request("DELETE", "/users/me/", json={"password": "wrongpass"})
        assert res.status_code == 401
        assert db.query(User).filter(User.id == td_user.id).first() is not None

    def test_delete_cascades_membership(self, client, admin_user, td_tournament, db):
        # admin_user here is a plain member, not the tournament owner — a
        # user who owns a tournament can't be hard-deleted yet (owner_id is
        # NOT NULL with no cascade rule defined); tracked separately in
        # docs/deferred-items.md rather than handled by this route.
        from app.models.models import TournamentMembership
        grant_role(db, td_tournament, admin_user, "event_supervisor")

        login(client, "admin@test.com", "adminpass")
        assert db.query(TournamentMembership).filter(TournamentMembership.user_id == admin_user.id).count() > 0
        assert client.request("DELETE", "/users/me/", json={"password": "adminpass"}).status_code == 200
        assert db.query(TournamentMembership).filter(TournamentMembership.user_id == admin_user.id).count() == 0

    def test_unauthenticated_forbidden(self, client):
        assert client.request("DELETE", "/users/me/", json={"password": "whatever"}).status_code == 401


# ---------------------------------------------------------------------------
# GET /users/me/sessions/ — list active sessions
# ---------------------------------------------------------------------------

class TestListMySessions:
    def test_lists_active_session_with_current_flag(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.get("/users/me/sessions/")
        assert res.status_code == 200
        sessions = res.json()
        assert len(sessions) == 1
        assert sessions[0]["is_current"] is True

    def test_second_login_creates_separate_session(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        login(client, "td@test.com", "tdpass")  # simulates a second device
        res = client.get("/users/me/sessions/")
        sessions = res.json()
        assert len(sessions) == 2
        assert sum(s["is_current"] for s in sessions) == 1

    def test_unauthenticated_forbidden(self, client):
        assert client.get("/users/me/sessions/").status_code == 401


# ---------------------------------------------------------------------------
# POST /users/me/sessions/logout-others/ — "log out everywhere" except here
# ---------------------------------------------------------------------------

class TestLogoutOtherSessions:
    def test_revokes_other_sessions_keeps_current(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        first_cookie = client.cookies.get("access_token")

        login(client, "td@test.com", "tdpass")  # second device, now current
        second_cookie = client.cookies.get("access_token")

        res = client.post("/users/me/sessions/logout-others/")
        assert res.status_code == 200

        client.cookies.set("access_token", first_cookie)
        assert client.get("/users/me/").status_code == 401

        client.cookies.set("access_token", second_cookie)
        assert client.get("/users/me/").status_code == 200

    def test_unauthenticated_forbidden(self, client):
        assert client.post("/users/me/sessions/logout-others/").status_code == 401


# ---------------------------------------------------------------------------
# GET /users/me/ (default, no ?full) — slim shape, folded in from old /auth/me/
# ---------------------------------------------------------------------------

class TestGetMe:
    def test_returns_current_user(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.get("/users/me/")
        assert res.status_code == 200
        data = res.json()
        assert data["email"] == "td@test.com"
        assert "is_profile_complete" in data
        # Slim shape — full-only fields must not be present.
        assert "missing_profile_fields" not in data
        assert "competition_experience" not in data

    def test_unauthenticated_forbidden(self, client):
        assert client.get("/users/me/").status_code == 401


# ---------------------------------------------------------------------------
# GET /users/me/?full=true — full shape with experience lists eagerly loaded
# ---------------------------------------------------------------------------

class TestGetMeFull:
    def test_returns_full_shape(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.get("/users/me/?full=true")
        assert res.status_code == 200
        data = res.json()
        assert data["email"] == "td@test.com"
        assert "missing_profile_fields" in data
        assert "competition_experience" in data
        assert "volunteer_experience" in data
        # UserMeFullResponse inherits from UserMeSlimResponse for the shared
        # account fields (email_verified/role/status/timestamps), so these
        # onboarding flags come along too — same info as the slim response.
        assert "is_profile_complete" in data

    def test_unauthenticated_forbidden(self, client):
        assert client.get("/users/me/?full=true").status_code == 401

    def test_competition_and_volunteer_experience_populated(self, client, td_user, db):
        category = EventCategory(name="Chemistry")
        db.add(category)
        db.commit()
        event = Event(name="Boomilever", category_id=category.id)
        db.add(event)
        db.commit()

        db.add(UserCompetitionExperience(user_id=td_user.id, event_id=event.id, school="MIT"))
        db.add(UserVolunteerExperience(
            user_id=td_user.id, event_id=event.id,
            tournament_name="Regionals", year=2025, role="Event Supervisor",
        ))
        db.commit()

        login(client, "td@test.com", "tdpass")
        data = client.get("/users/me/?full=true").json()

        assert len(data["competition_experience"]) == 1
        assert data["competition_experience"][0]["school"] == "MIT"
        assert data["competition_experience"][0]["event"]["id"] == event.id

        assert len(data["volunteer_experience"]) == 1
        assert data["volunteer_experience"][0]["tournament_name"] == "Regionals"
        assert data["volunteer_experience"][0]["year"] == 2025
        assert data["volunteer_experience"][0]["role"] == "Event Supervisor"

    def test_no_experience_rows_returns_empty_lists(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        data = client.get("/users/me/?full=true").json()
        assert data["competition_experience"] == []
        assert data["volunteer_experience"] == []


# ---------------------------------------------------------------------------
# PATCH /users/me/ — authenticated user updates own profile
# ---------------------------------------------------------------------------

class TestUpdateMe:
    def test_can_update_name(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.patch("/users/me/", json={"first_name": "Updated"})
        assert res.status_code == 200
        assert res.json()["first_name"] == "Updated"

    def test_unset_fields_unchanged(self, client, td_user):
        # exclude_unset=True — omitted fields must not overwrite existing data
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={"first_name": "Updated"})
        assert client.get("/users/me/").json()["last_name"] == "User"

    def test_email_field_ignored(self, client, td_user):
        # Email changes must go through the verify-before-apply flow
        # (POST /auth/email/request-change/ + GET /auth/email/confirm-change/),
        # not this generic partial-update route. `email` isn't a declared
        # field on UserUpdate, so pydantic silently drops it.
        login(client, "td@test.com", "tdpass")
        res = client.patch("/users/me/", json={"email": "newemail@test.com", "first_name": "Updated"})
        assert res.status_code == 200
        assert res.json()["email"] == "td@test.com"
        assert res.json()["first_name"] == "Updated"

    def test_null_clears_optional_field(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={"pronouns": "she/her"})
        res = client.patch("/users/me/", json={"pronouns": None})
        assert res.status_code == 200
        assert res.json()["pronouns"] is None

    def test_null_first_name_rejected(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.patch("/users/me/", json={"first_name": None}).status_code == 422

    def test_null_last_name_rejected(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.patch("/users/me/", json={"last_name": None}).status_code == 422

    def test_null_phone_rejected(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.patch("/users/me/", json={"phone": None}).status_code == 422

    def test_phone_stored_as_digits(self, client, td_user):
        # Formatted input should be normalized to raw digits
        login(client, "td@test.com", "tdpass")
        res = client.patch("/users/me/", json={"phone": "(949) 555-1234"})
        assert res.status_code == 200
        assert res.json()["phone"] == "9495551234"

    def test_invalid_phone_rejected(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.patch("/users/me/", json={"phone": "notaphone"}).status_code == 422

    def test_unauthenticated_forbidden(self, client):
        assert client.patch("/users/me/", json={"first_name": "X"}).status_code == 401


# ---------------------------------------------------------------------------
# missing_profile_fields — computed field on UserResponse
# ---------------------------------------------------------------------------

class TestMissingProfileFields:
    def test_fresh_user_has_missing_fields(self, client, td_user):
        # td_user has no profile data — phone and student_status should be missing
        login(client, "td@test.com", "tdpass")
        missing = client.get("/users/me/?full=true").json()["missing_profile_fields"]
        assert "phone" in missing
        assert "student_status" in missing

    def test_non_student_complete_profile(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={
            "phone": VALID_PHONE,
            "date_of_birth": "2000-01-01",
            "pronouns": "she/her",
            "student_status": "Non-Student",
            "employer": "Acme Corp",
            "has_competition_experience": False,
            "has_volunteer_experience": False,
            "shirt_size": "M",
            "dietary_restriction": "None",
        })
        assert client.get("/users/me/?full=true").json()["missing_profile_fields"] == []

    def test_student_complete_profile(self, client, td_user, db):
        university = University(name="MIT")
        db.add(university)
        db.commit()

        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={
            "phone": VALID_PHONE,
            "date_of_birth": "2000-01-01",
            "pronouns": "she/her",
            "student_status": "Undergraduate",
            "university_id": university.id,
            "major": "CS",
            "year_level": 2,
            "graduation_year": 2027,
            "has_competition_experience": False,
            "has_volunteer_experience": False,
            "shirt_size": "L",
            "dietary_restriction": "None",
        })
        assert client.get("/users/me/?full=true").json()["missing_profile_fields"] == []

    def test_student_missing_school_fields(self, client, td_user):
        # student_status answered but university/major not filled in yet
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={"phone": VALID_PHONE, "student_status": "Undergraduate"})
        missing = client.get("/users/me/?full=true").json()["missing_profile_fields"]
        assert "university" in missing
        assert "major" in missing

    def test_non_student_does_not_require_university(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={
            "phone": VALID_PHONE,
            "date_of_birth": "2000-01-01",
            "pronouns": "she/her",
            "student_status": "Non-Student",
            "employer": "Acme Corp",
            "has_competition_experience": False,
            "has_volunteer_experience": False,
            "shirt_size": "M",
            "dietary_restriction": "None",
        })
        missing = client.get("/users/me/?full=true").json()["missing_profile_fields"]
        assert "university" not in missing
        assert "major" not in missing


# ---------------------------------------------------------------------------
# is_profile_complete — boolean field on UserMeSlimResponse (GET /users/me/)
# ---------------------------------------------------------------------------

class TestIsProfileComplete:
    def test_fresh_user_is_not_complete(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.get("/users/me/").json()["is_profile_complete"] is False

    def test_non_student_complete_profile(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={
            "phone": VALID_PHONE,
            "date_of_birth": "2000-01-01",
            "pronouns": "she/her",
            "student_status": "Non-Student",
            "employer": "Acme Corp",
            "has_competition_experience": False,
            "has_volunteer_experience": False,
            "shirt_size": "M",
            "dietary_restriction": "None",
        })
        assert client.get("/users/me/").json()["is_profile_complete"] is True

    def test_student_complete_profile(self, client, td_user, db):
        university = University(name="MIT")
        db.add(university)
        db.commit()

        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={
            "phone": VALID_PHONE,
            "date_of_birth": "2000-01-01",
            "pronouns": "she/her",
            "student_status": "Undergraduate",
            "university_id": university.id,
            "major": "CS",
            "year_level": 2,
            "graduation_year": 2027,
            "has_competition_experience": False,
            "has_volunteer_experience": False,
            "shirt_size": "L",
            "dietary_restriction": "None",
        })
        assert client.get("/users/me/").json()["is_profile_complete"] is True

    def test_student_missing_school_fields_is_not_complete(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={"phone": VALID_PHONE, "student_status": "Undergraduate"})
        assert client.get("/users/me/").json()["is_profile_complete"] is False

    def test_partial_update_does_not_flip_to_complete(self, client, td_user):
        # Only phone answered — plenty of other required fields still missing.
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={"phone": VALID_PHONE})
        assert client.get("/users/me/").json()["is_profile_complete"] is False
