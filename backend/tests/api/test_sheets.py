"""Tests for /api/v1/sheets endpoints."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock


VALID_SHEET_URL = "https://docs.google.com/spreadsheets/d/fake_id_abc123/edit#gid=0"


def _make_tournament(client: TestClient) -> dict:
    return client.post("/api/v1/tournaments/", json={"name": "Test Tournament"}).json()


# ---------------------------------------------------------------------------
# POST /sheets/validate
# ---------------------------------------------------------------------------

def test_validate_sheet_url(client: TestClient):
    response = client.post("/api/v1/sheets/validate", json={"sheet_url": VALID_SHEET_URL})
    assert response.status_code == 200
    data = response.json()
    assert data["spreadsheet_id"] == "fake_spreadsheet_id_abc123"
    assert "Form Responses 1" in data["sheet_names"]


def test_validate_sheet_url_invalid(client: TestClient):
    response = client.post("/api/v1/sheets/validate", json={"sheet_url": "https://example.com"})
    assert response.status_code == 422  # Pydantic validation error


# ---------------------------------------------------------------------------
# POST /sheets/headers
# ---------------------------------------------------------------------------

def test_get_sheet_headers(client: TestClient):
    response = client.post(
        "/api/v1/sheets/headers",
        json={"sheet_url": VALID_SHEET_URL, "sheet_name": "Form Responses 1"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "Email Address" in data["headers"]
    assert data["suggestions"]["Email Address"] == "email"
    assert data["suggestions"]["Timestamp"] == "__ignore__"
    assert "known_fields" in data
    assert "email" in data["known_fields"]


# ---------------------------------------------------------------------------
# POST /sheets/configs
# ---------------------------------------------------------------------------

def test_create_sheet_config(client: TestClient):
    tournament = _make_tournament(client)
    payload = {
        "tournament_id": tournament["id"],
        "label": "Interest Form",
        "sheet_type": "interest",
        "sheet_url": VALID_SHEET_URL,
        "sheet_name": "Form Responses 1",
        "column_mappings": {
            "Email Address": "email",
            "First Name": "first_name",
            "Last Name": "last_name",
            "Timestamp": "__ignore__",
        },
    }
    response = client.post("/api/v1/sheets/configs", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["label"] == "Interest Form"
    assert data["sheet_type"] == "interest"
    assert data["spreadsheet_id"] == "fake_spreadsheet_id_abc123"
    assert data["column_mappings"]["Email Address"] == "email"


def test_create_sheet_config_invalid_tournament(client: TestClient):
    payload = {
        "tournament_id": 9999,
        "label": "Interest Form",
        "sheet_type": "interest",
        "sheet_url": VALID_SHEET_URL,
        "sheet_name": "Form Responses 1",
        "column_mappings": {},
    }
    response = client.post("/api/v1/sheets/configs", json=payload)
    assert response.status_code == 404


def test_create_sheet_config_invalid_sheet_type(client: TestClient):
    tournament = _make_tournament(client)
    payload = {
        "tournament_id": tournament["id"],
        "label": "Bad Config",
        "sheet_type": "nonsense",  # invalid
        "sheet_url": VALID_SHEET_URL,
        "sheet_name": "Sheet1",
        "column_mappings": {},
    }
    response = client.post("/api/v1/sheets/configs", json=payload)
    assert response.status_code == 422


def test_create_sheet_config_unknown_field_mapping(client: TestClient):
    tournament = _make_tournament(client)
    payload = {
        "tournament_id": tournament["id"],
        "label": "Bad Mapping",
        "sheet_type": "interest",
        "sheet_url": VALID_SHEET_URL,
        "sheet_name": "Sheet1",
        "column_mappings": {"Email": "not_a_real_field"},  # unknown DB field
    }
    response = client.post("/api/v1/sheets/configs", json=payload)
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /sheets/configs/tournament/{tournament_id}
# ---------------------------------------------------------------------------

def test_list_sheet_configs_for_tournament(client: TestClient):
    tournament = _make_tournament(client)
    payload = {
        "tournament_id": tournament["id"],
        "label": "Interest Form",
        "sheet_type": "interest",
        "sheet_url": VALID_SHEET_URL,
        "sheet_name": "Form Responses 1",
        "column_mappings": {"Email Address": "email"},
    }
    client.post("/api/v1/sheets/configs", json=payload)
    response = client.get(f"/api/v1/sheets/configs/tournament/{tournament['id']}")
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_list_sheet_configs_empty(client: TestClient):
    tournament = _make_tournament(client)
    response = client.get(f"/api/v1/sheets/configs/tournament/{tournament['id']}")
    assert response.status_code == 200
    assert response.json() == []


# ---------------------------------------------------------------------------
# PATCH /sheets/configs/{config_id}
# ---------------------------------------------------------------------------

def test_update_sheet_config(client: TestClient):
    tournament = _make_tournament(client)
    created = client.post(
        "/api/v1/sheets/configs",
        json={
            "tournament_id": tournament["id"],
            "label": "Old Label",
            "sheet_type": "interest",
            "sheet_url": VALID_SHEET_URL,
            "sheet_name": "Sheet1",
            "column_mappings": {},
        },
    ).json()

    response = client.patch(
        f"/api/v1/sheets/configs/{created['id']}",
        json={"label": "New Label", "is_active": False},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["label"] == "New Label"
    assert data["is_active"] is False


# ---------------------------------------------------------------------------
# DELETE /sheets/configs/{config_id}
# ---------------------------------------------------------------------------

def test_delete_sheet_config(client: TestClient):
    tournament = _make_tournament(client)
    created = client.post(
        "/api/v1/sheets/configs",
        json={
            "tournament_id": tournament["id"],
            "label": "Delete Me",
            "sheet_type": "interest",
            "sheet_url": VALID_SHEET_URL,
            "sheet_name": "Sheet1",
            "column_mappings": {},
        },
    ).json()

    assert client.delete(f"/api/v1/sheets/configs/{created['id']}").status_code == 204
    assert client.get(f"/api/v1/sheets/configs/{created['id']}").status_code == 404