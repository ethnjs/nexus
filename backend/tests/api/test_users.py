"""Tests for /admin/users and /users/me endpoints."""
from tests.conftest import login
from app.core.auth import hash_password
from app.models.models import User


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

    def test_not_found(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        assert client.delete("/admin/users/9999/").status_code == 404

    def test_unauthenticated_forbidden(self, client):
        assert client.delete("/admin/users/1/").status_code == 401


# ---------------------------------------------------------------------------
# GET /users/me/ — authenticated user's own full profile
# ---------------------------------------------------------------------------

class TestGetMe:
    def test_returns_current_user(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.get("/users/me/")
        assert res.status_code == 200
        data = res.json()
        assert data["email"] == "td@test.com"
        assert "missing_profile_fields" in data

    def test_unauthenticated_forbidden(self, client):
        assert client.get("/users/me/").status_code == 401


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

    def test_duplicate_email_case_insensitive_rejected(self, client, td_user, admin_user):
        login(client, "td@test.com", "tdpass")
        assert client.patch("/users/me/", json={"email": "ADMIN@TEST.COM"}).status_code == 409

    def test_same_email_unchanged_not_rejected(self, client, td_user):
        # Re-submitting your own current email should not conflict with yourself.
        login(client, "td@test.com", "tdpass")
        res = client.patch("/users/me/", json={"email": "td@test.com", "first_name": "Still TD"})
        assert res.status_code == 200
        assert res.json()["email"] == "td@test.com"

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

    def test_null_email_rejected(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.patch("/users/me/", json={"email": None}).status_code == 422

    def test_null_phone_rejected(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.patch("/users/me/", json={"phone": None}).status_code == 422

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
        missing = client.get("/users/me/").json()["missing_profile_fields"]
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
        assert client.get("/users/me/").json()["missing_profile_fields"] == []

    def test_student_complete_profile(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={
            "phone": VALID_PHONE,
            "date_of_birth": "2000-01-01",
            "pronouns": "she/her",
            "student_status": "Undergraduate",
            "university": "MIT",
            "major": "CS",
            "year_level": 2,
            "graduation_year": 2027,
            "has_competition_experience": False,
            "has_volunteer_experience": False,
            "shirt_size": "L",
            "dietary_restriction": "None",
        })
        assert client.get("/users/me/").json()["missing_profile_fields"] == []

    def test_student_missing_school_fields(self, client, td_user):
        # student_status answered but university/major not filled in yet
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={"phone": VALID_PHONE, "student_status": "Undergraduate"})
        missing = client.get("/users/me/").json()["missing_profile_fields"]
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
        missing = client.get("/users/me/").json()["missing_profile_fields"]
        assert "university" not in missing
        assert "major" not in missing


# ---------------------------------------------------------------------------
# is_profile_complete — boolean field on UserMeSlimResponse (GET /auth/me/)
# ---------------------------------------------------------------------------

class TestIsProfileComplete:
    def test_fresh_user_is_not_complete(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.get("/auth/me/").json()["is_profile_complete"] is False

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
        assert client.get("/auth/me/").json()["is_profile_complete"] is True

    def test_student_complete_profile(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={
            "phone": VALID_PHONE,
            "date_of_birth": "2000-01-01",
            "pronouns": "she/her",
            "student_status": "Undergraduate",
            "university": "MIT",
            "major": "CS",
            "year_level": 2,
            "graduation_year": 2027,
            "has_competition_experience": False,
            "has_volunteer_experience": False,
            "shirt_size": "L",
            "dietary_restriction": "None",
        })
        assert client.get("/auth/me/").json()["is_profile_complete"] is True

    def test_student_missing_school_fields_is_not_complete(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={"phone": VALID_PHONE, "student_status": "Undergraduate"})
        assert client.get("/auth/me/").json()["is_profile_complete"] is False

    def test_partial_update_does_not_flip_to_complete(self, client, td_user):
        # Only phone answered — plenty of other required fields still missing.
        login(client, "td@test.com", "tdpass")
        client.patch("/users/me/", json={"phone": VALID_PHONE})
        assert client.get("/auth/me/").json()["is_profile_complete"] is False
