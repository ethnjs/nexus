"""Integration tests for POST /tournaments/{id}/sheets/configs/{id}/sync/"""
import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from tests.conftest import login

FAKE_URL = "https://docs.google.com/spreadsheets/d/fake123/edit"

NATS_BLOCKS = [
    {"number": 1,  "label": "Thu Check-in", "date": "2026-05-21", "start": "08:00", "end": "10:00"},
    {"number": 2,  "label": "Thu Morning",  "date": "2026-05-21", "start": "10:00", "end": "12:00"},
    {"number": 3,  "label": "Fri Check-in", "date": "2026-05-22", "start": "08:00", "end": "10:00"},
    {"number": 14, "label": "Sat Block 1",  "date": "2026-05-23", "start": "08:00", "end": "09:00"},
]

COLUMN_MAPPINGS = {
    "Timestamp":       {"field": "__ignore__",      "type": "ignore"},
    "Email Address":   {"field": "email",            "type": "string"},
    "First Name":      {"field": "first_name",       "type": "string"},
    "Last Name":       {"field": "last_name",        "type": "string"},
    "Phone Number":    {"field": "phone",            "type": "string"},
    "T-Shirt Size":    {"field": "shirt_size",       "type": "string"},
    "Role Preference": {"field": "role_preference",  "type": "multi_select"},
    "Which events?":   {"field": "event_preference", "type": "string"},
    "Availability [8:00 AM - 10:00 AM]": {
        "field": "availability", "type": "matrix_row", "row_key": "8:00 AM - 10:00 AM",
        "rules": [{"condition": "always", "action": "parse_time_range"}],
    },
    "Availability [10:00 AM - NOON]": {
        "field": "availability", "type": "matrix_row", "row_key": "10:00 AM - NOON",
        "rules": [{"condition": "always", "action": "parse_time_range"}],
    },
    "Transportation": {
        "field": "extra_data", "type": "string", "extra_key": "transportation",
    },
}


def _make_tournament(client):
    return client.post("/tournaments/", json={
        "name": "2026 Nationals",
        "start_date": "2026-05-21T08:00:00",
        "end_date": "2026-05-23T18:00:00",
        "blocks": NATS_BLOCKS,
        "volunteer_schema": {"custom_fields": []},
    }).json()


def _make_config(client, tournament_id):
    r = client.post(f"/tournaments/{tournament_id}/sheets/configs/", json={
        "tournament_id": tournament_id,
        "label": "Interest Form",
        "sheet_type": "volunteers",
        "sheet_url": FAKE_URL,
        "sheet_name": "Form Responses 1",
        "column_mappings": COLUMN_MAPPINGS,
    })
    assert r.status_code == 201, f"_make_config failed {r.status_code}: {r.text}"
    return r.json()


def _sync(client, tournament_id, config_id):
    return client.post(f"/tournaments/{tournament_id}/sheets/configs/{config_id}/sync/")


def _list_memberships(client, tournament_id):
    return client.get(f"/tournaments/{tournament_id}/memberships/").json()


# ---------------------------------------------------------------------------
# Basic sync
# ---------------------------------------------------------------------------

def test_sync_creates_user_and_membership(client, td_user, mock_sheets_service, db):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])

    mock_sheets_service.get_rows.return_value = [{
        "Timestamp": "2026-01-01 10:00:00",
        "Email Address": "alice@example.com",
        "First Name": "Alice",
        "Last Name": "Smith",
        "Phone Number": "9495551234",
        "T-Shirt Size": "M",
        "Role Preference": "Event Volunteer",
        "Which events?": "Technology & Engineering (Boomilever)",
        "Availability [8:00 AM - 10:00 AM]": "Thursday 5/21, Saturday 5/23",
        "Availability [10:00 AM - NOON]": "Thursday 5/21",
        "Transportation": "Driving",
    }]

    response = _sync(client, t["id"], cfg["id"])
    assert response.status_code == 200
    data = response.json()
    assert data["created"] == 1
    assert data["updated"] == 0
    assert data["skipped"] == 0
    assert data["errors"] == []
    assert data["last_synced_at"] is not None

    from app.models.models import User as UserModel
    user = db.query(UserModel).filter(UserModel.email == "alice@example.com").first()
    assert user is not None
    assert user.first_name == "Alice"
    assert user.phone == "(949) 555-1234"
    assert user.shirt_size == "M"

    memberships = _list_memberships(client, t["id"])
    alice = [m for m in memberships if m["user_id"] == user.id]
    assert len(alice) == 1
    m = alice[0]
    assert m["role_preference"] == ["Event Volunteer"]
    assert m["event_preference"] == ["Technology & Engineering (Boomilever)"]
    assert m["extra_data"]["transportation"] == "Driving"


def test_sync_merges_contiguous_availability(client, td_user, mock_sheets_service, db):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])

    mock_sheets_service.get_rows.return_value = [{
        "Email Address": "bob@example.com",
        "First Name": "Bob",
        "Last Name": "Jones",
        "Availability [8:00 AM - 10:00 AM]": "Thursday 5/21",
        "Availability [10:00 AM - NOON]": "Thursday 5/21",
    }]

    _sync(client, t["id"], cfg["id"])

    from app.models.models import User as UserModel
    user = db.query(UserModel).filter(UserModel.email == "bob@example.com").first()
    assert user is not None

    memberships = _list_memberships(client, t["id"])
    bob = [m for m in memberships if m["user_id"] == user.id]
    assert len(bob) == 1
    avail = bob[0]["availability"]
    assert len(avail) == 1
    assert avail[0] == {"date": "2026-05-21", "start": "08:00", "end": "12:00"}


def test_sync_updates_existing_user(client, td_user, mock_sheets_service, db):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])

    row = {"Email Address": "alice@example.com", "First Name": "Alice",
           "Last Name": "Smith", "T-Shirt Size": "M"}
    mock_sheets_service.get_rows.return_value = [row]
    _sync(client, t["id"], cfg["id"])

    mock_sheets_service.get_rows.return_value = [{**row, "T-Shirt Size": "L"}]
    response = _sync(client, t["id"], cfg["id"])
    assert response.json()["created"] == 0
    assert response.json()["updated"] == 1

    from app.models.models import User as UserModel
    db.expire_all()
    user = db.query(UserModel).filter(UserModel.email == "alice@example.com").first()
    assert user.shirt_size == "L"


def test_sync_skips_row_missing_email(client, td_user, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])

    mock_sheets_service.get_rows.return_value = [{"First Name": "No", "Last Name": "Email"}]
    response = _sync(client, t["id"], cfg["id"])
    data = response.json()
    assert data["skipped"] == 1
    assert data["created"] == 0
    assert len(data["errors"]) == 1
    assert "email" in data["errors"][0]["detail"].lower()


def test_sync_multiple_rows(client, td_user, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])

    mock_sheets_service.get_rows.return_value = [
        {"Email Address": "a@example.com", "First Name": "Alice", "Last Name": "A"},
        {"Email Address": "b@example.com", "First Name": "Bob",   "Last Name": "B"},
        {"Email Address": "c@example.com", "First Name": "Carol", "Last Name": "C"},
    ]
    data = _sync(client, t["id"], cfg["id"]).json()
    assert data["created"] == 3
    assert data["updated"] == 0


def test_sync_last_synced_at_updated(client, td_user, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])
    assert cfg["last_synced_at"] is None

    mock_sheets_service.get_rows.return_value = []
    _sync(client, t["id"], cfg["id"])

    updated = client.get(f"/tournaments/{t['id']}/sheets/configs/{cfg['id']}/").json()
    assert updated["last_synced_at"] is not None


def test_sync_config_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.post(
        f"/tournaments/{td_tournament.id}/sheets/configs/9999/sync/"
    ).status_code == 404


def test_sync_inactive_config(client, td_user, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])
    client.patch(
        f"/tournaments/{t['id']}/sheets/configs/{cfg['id']}/",
        json={"is_active": False},
    )
    assert _sync(client, t["id"], cfg["id"]).status_code == 400


# ---------------------------------------------------------------------------
# Backwards compatibility — legacy type names in saved configs
# ---------------------------------------------------------------------------

def test_sync_coerces_legacy_availability_row_type(client, td_user, mock_sheets_service, db):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)

    from app.models.models import SheetConfig
    legacy_mappings = {
        "Email Address":   {"field": "email",        "type": "string"},
        "First Name":      {"field": "first_name",   "type": "string"},
        "Last Name":       {"field": "last_name",    "type": "string"},
        "Availability [8:00 AM - 10:00 AM]": {
            "field": "availability", "type": "availability_row",
            "row_key": "8:00 AM - 10:00 AM",
        },
    }
    cfg_obj = SheetConfig(
        tournament_id=t["id"],
        label="Legacy Config",
        sheet_type="volunteers",
        sheet_url=FAKE_URL,
        sheet_name="Form Responses 1",
        spreadsheet_id="fake123",
        column_mappings=legacy_mappings,
        is_active=True,
    )
    db.add(cfg_obj)
    db.commit()
    db.refresh(cfg_obj)

    mock_sheets_service.get_rows.return_value = [{
        "Email Address": "legacy@example.com",
        "First Name": "Legacy",
        "Last Name": "User",
        "Availability [8:00 AM - 10:00 AM]": "Thursday 5/21",
    }]

    response = _sync(client, t["id"], cfg_obj.id)
    assert response.status_code == 200
    assert response.json()["created"] == 1
    assert response.json()["errors"] == []


def test_sync_coerces_legacy_category_events_type(client, td_user, mock_sheets_service, db):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)

    from app.models.models import SheetConfig
    legacy_mappings = {
        "Email Address": {"field": "email",            "type": "string"},
        "First Name":    {"field": "first_name",       "type": "string"},
        "Last Name":     {"field": "last_name",        "type": "string"},
        "Which events?": {"field": "event_preference", "type": "category_events"},
    }
    cfg_obj = SheetConfig(
        tournament_id=t["id"],
        label="Legacy Config",
        sheet_type="volunteers",
        sheet_url=FAKE_URL,
        sheet_name="Form Responses 1",
        spreadsheet_id="fake123",
        column_mappings=legacy_mappings,
        is_active=True,
    )
    db.add(cfg_obj)
    db.commit()
    db.refresh(cfg_obj)

    mock_sheets_service.get_rows.return_value = [{
        "Email Address": "legacy2@example.com",
        "First Name": "Legacy",
        "Last Name": "User",
        "Which events?": "Technology & Engineering (Boomilever)",
    }]

    response = _sync(client, t["id"], cfg_obj.id)
    assert response.status_code == 200
    assert response.json()["created"] == 1
    assert response.json()["errors"] == []

    memberships = _list_memberships(client, t["id"])
    from app.models.models import User as UserModel
    user = db.query(UserModel).filter(UserModel.email == "legacy2@example.com").first()
    m = [m for m in memberships if m["user_id"] == user.id][0]
    assert m["event_preference"] == ["Technology & Engineering (Boomilever)"]


# ---------------------------------------------------------------------------
# matrix_row + extra_data + extra_key nesting
# ---------------------------------------------------------------------------

def test_sync_matrix_row_extra_data_nested_under_extra_key(client, td_user, mock_sheets_service, db):
    """
    field=extra_data + type=matrix_row + extra_key nests row values under
    extra_data[extra_key][row_key], not flat at extra_data[row_key].
    """
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)

    lunch_mappings = {
        "Email Address": {"field": "email",       "type": "string"},
        "First Name":    {"field": "first_name",  "type": "string"},
        "Last Name":     {"field": "last_name",   "type": "string"},
        "Which protein?": {
            "field": "extra_data", "type": "matrix_row",
            "row_key": "protein", "extra_key": "lunch",
        },
        "Which drink?": {
            "field": "extra_data", "type": "matrix_row",
            "row_key": "drink", "extra_key": "lunch",
        },
        "Transportation": {"field": "extra_data", "type": "string", "extra_key": "transportation"},
    }
    r = client.post(f"/tournaments/{t['id']}/sheets/configs/", json={
        "tournament_id": t["id"], "label": "Lunch Test", "sheet_type": "volunteers",
        "sheet_url": FAKE_URL, "sheet_name": "Sheet1", "column_mappings": lunch_mappings,
    })
    assert r.status_code == 201
    cfg = r.json()

    mock_sheets_service.get_rows.return_value = [{
        "Email Address": "alice@example.com",
        "First Name": "Alice", "Last Name": "Smith",
        "Which protein?": "Beef Barbacoa",
        "Which drink?": "Dr. Pepper",
        "Transportation": "Driving",
    }]

    response = _sync(client, t["id"], cfg["id"])
    assert response.status_code == 200
    assert response.json()["created"] == 1

    memberships = _list_memberships(client, t["id"])
    from app.models.models import User as UserModel
    user = db.query(UserModel).filter(UserModel.email == "alice@example.com").first()
    m = [m for m in memberships if m["user_id"] == user.id][0]

    # Values must be nested under "lunch", not at the top level of extra_data
    assert "protein" not in m["extra_data"]
    assert "drink" not in m["extra_data"]
    assert m["extra_data"]["lunch"] == {"protein": "Beef Barbacoa", "drink": "Dr. Pepper"}
    assert m["extra_data"]["transportation"] == "Driving"


def test_sync_matrix_row_extra_data_resync_replaces_nested_dict(client, td_user, mock_sheets_service, db):
    """Re-syncing replaces the entire nested extra_key dict with the new values."""
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)

    lunch_mappings = {
        "Email Address": {"field": "email",       "type": "string"},
        "First Name":    {"field": "first_name",  "type": "string"},
        "Last Name":     {"field": "last_name",   "type": "string"},
        "Which protein?": {
            "field": "extra_data", "type": "matrix_row",
            "row_key": "protein", "extra_key": "lunch",
        },
        "Which drink?": {
            "field": "extra_data", "type": "matrix_row",
            "row_key": "drink", "extra_key": "lunch",
        },
    }
    r = client.post(f"/tournaments/{t['id']}/sheets/configs/", json={
        "tournament_id": t["id"], "label": "Lunch Resync", "sheet_type": "volunteers",
        "sheet_url": FAKE_URL, "sheet_name": "Sheet1", "column_mappings": lunch_mappings,
    })
    cfg = r.json()

    mock_sheets_service.get_rows.return_value = [{
        "Email Address": "bob@example.com", "First Name": "Bob", "Last Name": "Jones",
        "Which protein?": "Chicken", "Which drink?": "Water",
    }]
    _sync(client, t["id"], cfg["id"])

    mock_sheets_service.get_rows.return_value = [{
        "Email Address": "bob@example.com", "First Name": "Bob", "Last Name": "Jones",
        "Which protein?": "Steak", "Which drink?": "Coke",
    }]
    _sync(client, t["id"], cfg["id"])

    memberships = _list_memberships(client, t["id"])
    from app.models.models import User as UserModel
    db.expire_all()
    user = db.query(UserModel).filter(UserModel.email == "bob@example.com").first()
    m = [m for m in memberships if m["user_id"] == user.id][0]
    assert m["extra_data"]["lunch"] == {"protein": "Steak", "drink": "Coke"}
