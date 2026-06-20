"""Tests for /admin/users, /users/me, and /tournaments/{id}/users endpoints."""
from tests.conftest import login
from app.core.auth import hash_password
from app.models.models import Membership, User


VALID_PHONE = "9495551234"


def _db_user(db, email="alice@example.com", **kwargs):
    """Create a user directly in the DB for test setup."""
    defaults = {
        "first_name": "Alice",
        "last_name": "Smith",
        "email": email,
        "hashed_password": hash_password("Password@1"),
        "role": "user",
        "is_active": True,
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


# ---------------------------------------------------------------------------
# PATCH /admin/users/{id} — admin only, role + is_active only
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
        res = client.patch(f"/admin/users/{alice.id}/", json={"is_active": False})
        assert res.status_code == 200
        assert res.json()["is_active"] == False

    def test_disabled_user_cannot_login(self, client, admin_user, db):
        # Confirms disabling actually revokes access, not just flips a flag
        alice = _db_user(db, email="alice@example.com")
        login(client, "admin@test.com", "adminpass")
        client.patch(f"/admin/users/{alice.id}/", json={"is_active": False})
        assert login(client, "alice@example.com", "Password@1").status_code == 401

    def test_invalid_role_rejected(self, client, admin_user, db):
        alice = _db_user(db)
        login(client, "admin@test.com", "adminpass")
        assert client.patch(f"/admin/users/{alice.id}/", json={"role": "superuser"}).status_code == 422

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
        assert client.get("/auth/me/").json()["last_name"] == "User"

    def test_can_update_email(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.patch("/users/me/", json={"email": "newemail@test.com"})
        assert res.status_code == 200
        assert res.json()["email"] == "newemail@test.com"

    def test_duplicate_email_rejected(self, client, td_user, admin_user):
        login(client, "td@test.com", "tdpass")
        assert client.patch("/users/me/", json={"email": "admin@test.com"}).status_code == 409

    def test_invalid_email_rejected(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.patch("/users/me/", json={"email": "notanemail"}).status_code == 422

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
        missing = client.get("/auth/me/").json()["missing_profile_fields"]
        assert "phone" in missing
        assert "student_status" in missing

    def test_non_student_complete_profile(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={
            "phone": VALID_PHONE,
            "student_status": "Non-Student",
            "employer": "Acme Corp",
            "competition_exp": "10 years",
            "volunteering_exp": "5 years",
            "shirt_size": "M",
            "dietary_restriction": "None",
        })
        assert client.get("/auth/me/").json()["missing_profile_fields"] == []

    def test_student_complete_profile(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={
            "phone": VALID_PHONE,
            "student_status": "Undergraduate",
            "university": "MIT",
            "major": "CS",
            "year_level": 2,
            "graduation_year": 2027,
            "competition_exp": "3 years",
            "volunteering_exp": "2 years",
            "shirt_size": "L",
            "dietary_restriction": "None",
        })
        assert client.get("/auth/me/").json()["missing_profile_fields"] == []

    def test_student_missing_school_fields(self, client, td_user):
        # student_status answered but university/major not filled in yet
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={"phone": VALID_PHONE, "student_status": "Undergraduate"})
        missing = client.get("/auth/me/").json()["missing_profile_fields"]
        assert "university" in missing
        assert "major" in missing

    def test_non_student_does_not_require_university(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={
            "phone": VALID_PHONE,
            "student_status": "Non-Student",
            "employer": "Acme Corp",
            "competition_exp": "10 years",
            "volunteering_exp": "5 years",
            "shirt_size": "M",
            "dietary_restriction": "None",
        })
        missing = client.get("/auth/me/").json()["missing_profile_fields"]
        assert "university" not in missing
        assert "major" not in missing


# ---------------------------------------------------------------------------
# GET /tournaments/{id}/users/{user_id}/ — manage_volunteers or manage_tournament
# ---------------------------------------------------------------------------

class TestTournamentUser:
    def test_td_can_access_member(self, client, admin_user, td_user, td_tournament, db):
        alice = _db_user(db)
        db.add(Membership(
            user_id=alice.id,
            tournament_id=td_tournament.id,
            positions=["event_supervisor"],
            status="confirmed",
        ))
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/tournaments/{td_tournament.id}/users/{alice.id}/")
        assert res.status_code == 200
        assert res.json()["email"] == "alice@example.com"

    def test_volunteer_coordinator_can_access(
        self, client, admin_user, td_user, other_tournament, db
    ):
        db.add(Membership(
            user_id=td_user.id,
            tournament_id=other_tournament.id,
            positions=["volunteer_coordinator"],
            status="confirmed",
        ))
        alice = _db_user(db)
        db.add(Membership(
            user_id=alice.id,
            tournament_id=other_tournament.id,
            positions=["event_supervisor"],
            status="confirmed",
        ))
        db.commit()
        login(client, "td@test.com", "tdpass")
        assert client.get(
            f"/tournaments/{other_tournament.id}/users/{alice.id}/"
        ).status_code == 200

    def test_event_supervisor_forbidden(
        self, client, td_user, other_tournament, admin_user, db
    ):
        db.add(Membership(
            user_id=td_user.id,
            tournament_id=other_tournament.id,
            positions=["event_supervisor"],
            status="confirmed",
        ))
        alice = _db_user(db)
        db.add(Membership(
            user_id=alice.id,
            tournament_id=other_tournament.id,
            positions=["event_supervisor"],
            status="confirmed",
        ))
        db.commit()
        login(client, "td@test.com", "tdpass")
        assert client.get(
            f"/tournaments/{other_tournament.id}/users/{alice.id}/"
        ).status_code == 403

    def test_non_member_returns_404(self, client, admin_user, td_user, td_tournament, db):
        alice = _db_user(db)
        login(client, "td@test.com", "tdpass")
        assert client.get(
            f"/tournaments/{td_tournament.id}/users/{alice.id}/"
        ).status_code == 404
