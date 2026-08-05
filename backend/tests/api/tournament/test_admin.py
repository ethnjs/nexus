"""Tests for /admin/tournaments/ endpoints (app/api/routes/tournament/admin.py)."""
from tests.conftest import login


# ---------------------------------------------------------------------------
# GET /admin/tournaments/ — platform admin only (global list)
# ---------------------------------------------------------------------------

def test_list_all_tournaments_admin_only(client, admin_user, td_user, td_tournament):
    login(client, "admin@test.com", "adminpass")
    response = client.get("/admin/tournaments/")
    assert response.status_code == 200
    assert any(t["id"] == td_tournament.id for t in response.json())


def test_list_all_tournaments_non_admin_forbidden(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get("/admin/tournaments/").status_code == 403


def test_list_all_tournaments_unauthenticated(client):
    assert client.get("/admin/tournaments/").status_code == 401
