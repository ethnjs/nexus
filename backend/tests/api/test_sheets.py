"""Tests for /api/v1/sheets endpoints."""

import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from tests.conftest import login
from app.schemas.sheet_config import SheetValidateResponse, SheetHeadersResponse, ColumnMapping

FAKE_URL = "https://docs.google.com/spreadsheets/d/fake123/edit"

SAMPLE_MAPPINGS = {
    "Email Address": {"field": "email",      "type": "string"},
    "First Name":    {"field": "first_name", "type": "string"},
    "Last Name":     {"field": "last_name",  "type": "string"},
    "Timestamp":     {"field": "__ignore__", "type": "ignore"},
}


def _make_tournament(client: TestClient) -> dict:
    return client.post("/api/v1/tournaments/", json={"name": "Test Tournament"}).json()


def _make_config(client: TestClient, tournament_id: int, **overrides) -> dict:
    payload = {
        "tournament_id": tournament_id,
        "label": "Interest Form",
        "sheet_type": "interest",
        "sheet_url": FAKE_URL,
        "sheet_name": "Form Responses 1",
        "column_mappings": SAMPLE_MAPPINGS,
    }
    payload.update(overrides)
    return client.post("/api/v1/sheets/configs", json=payload)


# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------

def test_validate_sheet_url(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.validate_sheet_url.return_value = SheetValidateResponse(
        spreadsheet_id="fake123",
        spreadsheet_title="Interest Form 2026",
        sheet_names=["Form Responses 1", "Sheet2"],
    )
    response = client.post("/api/v1/sheets/validate", json={"sheet_url": FAKE_URL})
    assert response.status_code == 200
    data = response.json()
    assert data["spreadsheet_id"] == "fake123"
    assert "Form Responses 1" in data["sheet_names"]


def test_validate_invalid_url(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    response = client.post("/api/v1/sheets/validate", json={"sheet_url": "https://example.com"})
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Headers
# ---------------------------------------------------------------------------

def test_get_headers(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.get_headers.return_value = SheetHeadersResponse(
        sheet_name="Form Responses 1",
        headers=["Timestamp", "Email Address", "First Name", "Availability [8:00 AM - 10:00 AM]"],
        suggestions={
            "Timestamp":        ColumnMapping(field="__ignore__",   type="ignore"),
            "Email Address":    ColumnMapping(field="email",        type="string"),
            "First Name":       ColumnMapping(field="first_name",   type="string"),
            "Availability [8:00 AM - 10:00 AM]": ColumnMapping(
                field="availability", type="matrix_row", row_key="8:00 AM - 10:00 AM"
            ),
        },
    )
    response = client.post("/api/v1/sheets/headers", json={
        "sheet_url": FAKE_URL,
        "sheet_name": "Form Responses 1",
    })
    assert response.status_code == 200
    data = response.json()
    assert "Timestamp" in data["suggestions"]
    assert data["suggestions"]["Timestamp"]["type"] == "ignore"
    assert data["suggestions"]["Email Address"]["type"] == "string"
    assert data["suggestions"]["Availability [8:00 AM - 10:00 AM]"]["type"] == "matrix_row"
    assert data["suggestions"]["Availability [8:00 AM - 10:00 AM]"]["row_key"] == "8:00 AM - 10:00 AM"
    assert "known_fields" in data
    assert "valid_types" in data


# ---------------------------------------------------------------------------
# Create config
# ---------------------------------------------------------------------------

def test_create_sheet_config(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    t = _make_tournament(client)
    response = _make_config(client, t["id"])
    assert response.status_code == 201
    data = response.json()
    assert data["label"] == "Interest Form"
    assert data["sheet_type"] == "interest"
    assert data["spreadsheet_id"] == "fake123"
    assert data["column_mappings"]["Email Address"]["field"] == "email"
    assert data["column_mappings"]["Email Address"]["type"] == "string"
    assert data["column_mappings"]["Timestamp"]["type"] == "ignore"


def test_create_sheet_config_with_matrix_row(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    t = _make_tournament(client)
    response = _make_config(client, t["id"], column_mappings={
        "Availability [8:00 AM - 10:00 AM]": {
            "field": "availability",
            "type": "matrix_row",
            "row_key": "8:00 AM - 10:00 AM",
        },
        "Availability [10:00 AM - NOON]": {
            "field": "availability",
            "type": "matrix_row",
            "row_key": "10:00 AM - NOON",
        },
    })
    assert response.status_code == 201
    data = response.json()
    assert data["column_mappings"]["Availability [8:00 AM - 10:00 AM]"]["row_key"] == "8:00 AM - 10:00 AM"


def test_create_sheet_config_with_extra_data(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    t = _make_tournament(client)
    response = _make_config(client, t["id"], column_mappings={
        "Transportation": {
            "field": "extra_data",
            "type": "string",
            "extra_key": "transportation",
        },
    })
    assert response.status_code == 201
    data = response.json()
    assert data["column_mappings"]["Transportation"]["extra_key"] == "transportation"


def test_create_sheet_config_invalid_type(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_config(client, t["id"], column_mappings={
        "Email Address": {"field": "email", "type": "bad_type"},
    })
    assert response.status_code == 422


def test_create_sheet_config_matrix_row_missing_row_key(client: TestClient, td_user, mock_sheets_service: MagicMock):
    """matrix_row type requires row_key."""
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_config(client, t["id"], column_mappings={
        "Availability [8:00 AM - 10:00 AM]": {
            "field": "availability",
            "type": "matrix_row",
            # row_key missing
        },
    })
    assert response.status_code == 422


def test_create_sheet_config_extra_data_missing_extra_key(client: TestClient, td_user, mock_sheets_service: MagicMock):
    """extra_data field requires extra_key."""
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_config(client, t["id"], column_mappings={
        "Transportation": {"field": "extra_data", "type": "string"},
    })
    assert response.status_code == 422


def test_create_sheet_config_tournament_not_found(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    response = _make_config(client, 9999)
    assert response.status_code == 404


def test_create_sheet_config_invalid_sheet_type(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_config(client, t["id"], sheet_type="bad_type")
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Get / List
# ---------------------------------------------------------------------------

def test_get_sheet_config(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    t = _make_tournament(client)
    created = _make_config(client, t["id"]).json()
    response = client.get(f"/api/v1/sheets/configs/{created['id']}")
    assert response.status_code == 200
    assert response.json()["id"] == created["id"]


def test_get_sheet_config_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/api/v1/sheets/configs/9999").status_code == 404


def test_list_sheet_configs(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    t = _make_tournament(client)
    _make_config(client, t["id"], sheet_type="interest")
    _make_config(client, t["id"], sheet_type="confirmation")
    response = client.get(f"/api/v1/sheets/configs/tournament/{t['id']}")
    assert response.status_code == 200
    assert len(response.json()) == 2


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_update_sheet_config(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    t = _make_tournament(client)
    created = _make_config(client, t["id"]).json()
    response = client.patch(f"/api/v1/sheets/configs/{created['id']}", json={
        "label": "Updated Label",
        "column_mappings": {
            "Phone Number": {"field": "phone", "type": "string"},
        },
    })
    assert response.status_code == 200
    data = response.json()
    assert data["label"] == "Updated Label"
    assert "Phone Number" in data["column_mappings"]
    assert data["column_mappings"]["Phone Number"]["type"] == "string"
    # Original fields preserved
    assert "Email Address" in data["column_mappings"]
    assert "First Name" in data["column_mappings"]


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_sheet_config(client: TestClient, td_user, mock_sheets_service: MagicMock):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    t = _make_tournament(client)
    created = _make_config(client, t["id"]).json()
    assert client.delete(f"/api/v1/sheets/configs/{created['id']}").status_code == 204
    assert client.get(f"/api/v1/sheets/configs/{created['id']}").status_code == 404