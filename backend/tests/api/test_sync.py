"""Tests for the sync endpoint: POST /sheets/configs/{id}/sync/"""

import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from tests.conftest import login

FAKE_URL = "https://docs.google.com/spreadsheets/d/fake123/edit"

NATS_BLOCKS = [
    {"number": 1,  "label": "Thu 8-10am",  "date": "2026-05-21", "start": "08:00", "end": "10:00"},
    {"number": 2,  "label": "Thu 10am-12", "date": "2026-05-21", "start": "10:00", "end": "12:00"},
    {"number": 14, "label": "Sat Block 1", "date": "2026-05-23", "start": "08:00", "end": "10:00"},
]

COLUMN_MAPPINGS = {
    "Timestamp":       {"field": "__ignore__",       "type": "ignore"},
    "Email Address":   {"field": "email",             "type": "string"},
    "First Name":      {"field": "first_name",        "type": "string"},
    "Last Name":       {"field": "last_name",         "type": "string"},
    "T-Shirt Size":    {"field": "shirt_size",        "type": "string"},
    "Role Preference": {"field": "role_preference",   "type": "multi_select"},
    "Which events?":   {"field": "event_preference",  "type": "category_events"},
    "Availability [8:00 AM - 10:00 AM]": {
        "field": "availability", "type": "matrix_row", "row_key": "8:00 AM - 10:00 AM"
    },
    "Availability [10:00 AM - NOON]": {
        "field": "availability", "type": "matrix_row", "row_key": "10:00 AM - NOON"
    },
    "Transportation": {"field": "extra_data", "type": "string", "extra_key": "transportation"},
}


def _make_tournament(client):
    return client.post("/tournaments/", json={
        "name": "2026 Nationals",
        "start_date": "2026-05-21T08:00:00",
        "end_date": "2026-05-23T18:00:00",
        "blocks": NATS_BLOCKS,
        "volunteer_schema": {"custom_fields": []},
    }).json()


def _make_event(client, tournament_id):
    return client.post("/events/", json={
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
        "category": "Technology & Engineering",
        "blocks": [14],
    }).json()


def _make_config(client, tournament_id):
    return client.post("/sheets/configs/", json={
        "tournament_id": tournament_id,
        "label": "Interest Form",
        "sheet_type": "interest",
        "sheet_url": FAKE_URL,
        "sheet_name": "Form Responses 1",
        "column_mappings": COLUMN_MAPPINGS,
    }).json()


# ---------------------------------------------------------------------------
# Basic sync
# ---------------------------------------------------------------------------

def test_sync_creates_user_and_membership(
    client: TestClient, td_user, mock_sheets_service: MagicMock
):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    _make_event(client, t["id"])
    cfg = _make_config(client, t["id"])

    mock_sheets_service.get_rows.return_value = [
        {
            "Timestamp": "2026-01-01 10:00:00",
            "Email Address": "alice@example.com",
            "First Name": "Alice",
            "Last Name": "Smith",
            "T-Shirt Size": "M",
            "Role Preference": "Event Volunteer",
            "Which events?": "Technology & Engineering (Boomilever)",
            "Availability [8:00 AM - 10:00 AM]": "Thursday 5/21",
            "Availability [10:00 AM - NOON]": "None",
            "Transportation": "Driving",
        }
    ]

    response = client.post(f"/sheets/configs/{cfg['id']}/sync/")
    assert response.status_code == 200
    result = response.json()
    assert result["created"] == 1   # 1 user created
    assert result["errors"] == []

    members = client.get(f"/memberships/tournament/{t['id']}/").json()
    assert len(members) == 1
    m = members[0]
    assert m["extra_data"]["transportation"] == "Driving"
    assert len(m["availability"]) == 1
    assert m["availability"][0]["start"] == "08:00"


def test_sync_updates_existing_user(
    client: TestClient, td_user, mock_sheets_service: MagicMock
):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])

    row = {
        "Email Address": "alice@example.com",
        "First Name": "Alice",
        "Last Name": "Smith",
        "T-Shirt Size": "M",
        "Role Preference": "",
        "Which events?": "",
        "Availability [8:00 AM - 10:00 AM]": "None",
        "Availability [10:00 AM - NOON]": "None",
        "Transportation": "",
    }
    mock_sheets_service.get_rows.return_value = [row]
    client.post(f"/sheets/configs/{cfg['id']}/sync/")

    # Second sync with updated shirt size
    row["T-Shirt Size"] = "L"
    mock_sheets_service.get_rows.return_value = [row]
    response = client.post(f"/sheets/configs/{cfg['id']}/sync/")
    assert response.status_code == 200
    result = response.json()
    assert result["created"] == 0
    assert result["updated"] == 1

    users = client.get("/users/").json()
    alice = next(u for u in users if u["email"] == "alice@example.com")
    assert alice["shirt_size"] == "L"


def test_sync_empty_sheet(
    client: TestClient, td_user, mock_sheets_service: MagicMock
):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])
    mock_sheets_service.get_rows.return_value = []

    response = client.post(f"/sheets/configs/{cfg['id']}/sync/")
    assert response.status_code == 200
    result = response.json()
    assert result["created"] == 0
    assert result["updated"] == 0


def test_sync_last_synced_at_updated(
    client: TestClient, td_user, mock_sheets_service: MagicMock
):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])
    assert cfg["last_synced_at"] is None

    mock_sheets_service.get_rows.return_value = []
    client.post(f"/sheets/configs/{cfg['id']}/sync/")

    updated_cfg = client.get(f"/sheets/configs/{cfg['id']}/").json()
    assert updated_cfg["last_synced_at"] is not None


def test_sync_config_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.post("/sheets/configs/9999/sync/").status_code == 404


def test_sync_inactive_config(
    client: TestClient, td_user, mock_sheets_service: MagicMock
):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])
    client.patch(f"/sheets/configs/{cfg['id']}/", json={"is_active": False})
    assert client.post(f"/sheets/configs/{cfg['id']}/sync/").status_code == 400