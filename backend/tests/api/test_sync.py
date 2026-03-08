"""Integration tests for POST /api/v1/sheets/configs/{id}/sync"""
import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

FAKE_URL = "https://docs.google.com/spreadsheets/d/fake123/edit"

NATS_BLOCKS = [
    {"number": 1,  "label": "Thu Check-in", "date": "2026-05-21", "start": "08:00", "end": "10:00"},
    {"number": 2,  "label": "Thu Morning",  "date": "2026-05-21", "start": "10:00", "end": "12:00"},
    {"number": 3,  "label": "Fri Check-in", "date": "2026-05-22", "start": "08:00", "end": "10:00"},
    {"number": 14, "label": "Sat Block 1",  "date": "2026-05-23", "start": "08:00", "end": "09:00"},
]

COLUMN_MAPPINGS = {
    "Timestamp":     {"field": "__ignore__",  "type": "ignore"},
    "Email Address": {"field": "email",       "type": "string"},
    "First Name":    {"field": "first_name",  "type": "string"},
    "Last Name":     {"field": "last_name",   "type": "string"},
    "T-Shirt Size":  {"field": "shirt_size",  "type": "string"},
    "Role Preference": {"field": "role_preference", "type": "multi_select"},
    "Which events?": {"field": "event_preference", "type": "category_events"},
    "Availability [8:00 AM - 10:00 AM]": {
        "field": "availability", "type": "matrix_row", "row_key": "8:00 AM - 10:00 AM"
    },
    "Availability [10:00 AM - NOON]": {
        "field": "availability", "type": "matrix_row", "row_key": "10:00 AM - NOON"
    },
    "Transportation": {"field": "extra_data", "type": "string", "extra_key": "transportation"},
}


def _make_tournament(client):
    return client.post("/api/v1/tournaments/", json={
        "name": "2026 Nationals",
        "start_date": "2026-05-21T08:00:00",
        "end_date": "2026-05-23T18:00:00",
        "blocks": NATS_BLOCKS,
        "volunteer_schema": {"custom_fields": []},
    }).json()


def _make_event(client, tournament_id):
    return client.post("/api/v1/events/", json={
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
        "category": "Technology & Engineering",
        "blocks": [14],
    }).json()


def _make_config(client, tournament_id):
    return client.post("/api/v1/sheets/configs", json={
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
    client: TestClient, mock_sheets_service: MagicMock
):
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
            "Availability [8:00 AM - 10:00 AM]": "Thursday 5/21, Saturday 5/23",
            "Availability [10:00 AM - NOON]": "Thursday 5/21",
            "Transportation": "Driving",
        }
    ]

    response = client.post(f"/api/v1/sheets/configs/{cfg['id']}/sync")
    assert response.status_code == 200
    data = response.json()
    assert data["created"] == 1
    assert data["updated"] == 0
    assert data["skipped"] == 0
    assert data["errors"] == []
    assert data["last_synced_at"] is not None

    # Verify user was created
    user_resp = client.get("/api/v1/users/by-email/alice@example.com")
    assert user_resp.status_code == 200
    user = user_resp.json()
    assert user["first_name"] == "Alice"
    assert user["shirt_size"] == "M"

    # Verify membership was created
    memberships = client.get(f"/api/v1/memberships/tournament/{t['id']}").json()
    assert len(memberships) == 1
    m = memberships[0]
    assert m["role_preference"] == ["Event Volunteer"]
    assert m["event_preference"] == ["Boomilever"]
    assert m["extra_data"]["transportation"] == "Driving"


def test_sync_merges_contiguous_availability(
    client: TestClient, mock_sheets_service: MagicMock
):
    """8-10 and 10-noon on Thursday should merge into 8-noon."""
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])

    mock_sheets_service.get_rows.return_value = [{
        "Email Address": "bob@example.com",
        "First Name": "Bob",
        "Last Name": "Jones",
        "Availability [8:00 AM - 10:00 AM]": "Thursday 5/21",
        "Availability [10:00 AM - NOON]": "Thursday 5/21",
    }]

    client.post(f"/api/v1/sheets/configs/{cfg['id']}/sync")
    memberships = client.get(f"/api/v1/memberships/tournament/{t['id']}").json()
    availability = memberships[0]["availability"]
    assert len(availability) == 1
    assert availability[0]["date"] == "2026-05-21"
    assert availability[0]["start"] == "08:00"
    assert availability[0]["end"] == "12:00"


def test_sync_none_availability_skipped(
    client: TestClient, mock_sheets_service: MagicMock
):
    """'None' in availability cell means not available — no slots generated."""
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])

    mock_sheets_service.get_rows.return_value = [{
        "Email Address": "carol@example.com",
        "First Name": "Carol",
        "Last Name": "White",
        "Availability [8:00 AM - 10:00 AM]": "None",
        "Availability [10:00 AM - NOON]": "None",
    }]

    client.post(f"/api/v1/sheets/configs/{cfg['id']}/sync")
    memberships = client.get(f"/api/v1/memberships/tournament/{t['id']}").json()
    assert memberships[0]["availability"] == []


def test_sync_updates_existing_user(
    client: TestClient, mock_sheets_service: MagicMock
):
    """Re-syncing the same email should update the user, not create a duplicate."""
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])

    row = {
        "Email Address": "alice@example.com",
        "First Name": "Alice",
        "Last Name": "Smith",
        "T-Shirt Size": "M",
    }
    mock_sheets_service.get_rows.return_value = [row]
    client.post(f"/api/v1/sheets/configs/{cfg['id']}/sync")

    # Re-sync with updated shirt size
    mock_sheets_service.get_rows.return_value = [{**row, "T-Shirt Size": "L"}]
    response = client.post(f"/api/v1/sheets/configs/{cfg['id']}/sync")
    data = response.json()
    assert data["created"] == 0
    assert data["updated"] == 1

    user = client.get("/api/v1/users/by-email/alice@example.com").json()
    assert user["shirt_size"] == "L"


def test_sync_skips_row_missing_email(
    client: TestClient, mock_sheets_service: MagicMock
):
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])

    mock_sheets_service.get_rows.return_value = [{
        "First Name": "No",
        "Last Name": "Email",
        # Email Address missing
    }]

    response = client.post(f"/api/v1/sheets/configs/{cfg['id']}/sync")
    data = response.json()
    assert data["skipped"] == 1
    assert data["created"] == 0
    assert len(data["errors"]) == 1
    assert "email" in data["errors"][0]["detail"].lower()


def test_sync_multiple_rows(
    client: TestClient, mock_sheets_service: MagicMock
):
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])

    mock_sheets_service.get_rows.return_value = [
        {"Email Address": "a@example.com", "First Name": "Alice", "Last Name": "A"},
        {"Email Address": "b@example.com", "First Name": "Bob",   "Last Name": "B"},
        {"Email Address": "c@example.com", "First Name": "Carol", "Last Name": "C"},
    ]

    response = client.post(f"/api/v1/sheets/configs/{cfg['id']}/sync")
    data = response.json()
    assert data["created"] == 3
    assert data["updated"] == 0

    memberships = client.get(f"/api/v1/memberships/tournament/{t['id']}").json()
    assert len(memberships) == 3


def test_sync_last_synced_at_updated(
    client: TestClient, mock_sheets_service: MagicMock
):
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])
    assert cfg["last_synced_at"] is None

    mock_sheets_service.get_rows.return_value = []
    client.post(f"/api/v1/sheets/configs/{cfg['id']}/sync")

    updated_cfg = client.get(f"/api/v1/sheets/configs/{cfg['id']}").json()
    assert updated_cfg["last_synced_at"] is not None


def test_sync_config_not_found(client: TestClient):
    assert client.post("/api/v1/sheets/configs/9999/sync").status_code == 404


def test_sync_inactive_config(
    client: TestClient, mock_sheets_service: MagicMock
):
    t = _make_tournament(client)
    cfg = _make_config(client, t["id"])
    client.patch(f"/api/v1/sheets/configs/{cfg['id']}", json={"is_active": False})
    assert client.post(f"/api/v1/sheets/configs/{cfg['id']}/sync").status_code == 400