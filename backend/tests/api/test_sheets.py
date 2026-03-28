"""Tests for /tournaments/{tournament_id}/sheets endpoints."""
import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from tests.conftest import login
from app.schemas.sheet_config import SheetValidateResponse, SheetHeadersResponse, MappedHeader
from app.models.models import Membership

FAKE_URL = "https://docs.google.com/spreadsheets/d/fake123/edit"
FAKE_FORM_URL = "https://docs.google.com/forms/d/fake_form/edit"

SAMPLE_MAPPINGS = {
    "Email Address": {"field": "email",      "type": "string"},
    "First Name":    {"field": "first_name", "type": "string"},
    "Last Name":     {"field": "last_name",  "type": "string"},
    "Timestamp":     {"field": "__ignore__", "type": "ignore"},
}


def _make_config(client, tournament_id, **overrides):
    payload = {
        "tournament_id": tournament_id,
        "label": "Interest Form",
        "sheet_type": "volunteers",
        "sheet_url": FAKE_URL,
        "sheet_name": "Form Responses 1",
        "column_mappings": SAMPLE_MAPPINGS,
    }
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/sheets/configs/", json=payload)


# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------

def test_validate_sheet_url(client, td_user, td_tournament, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.validate_sheet_url.return_value = SheetValidateResponse(
        spreadsheet_id="fake123",
        spreadsheet_title="Interest Form 2026",
        sheet_names=["Form Responses 1", "Sheet2"],
    )
    response = client.post(
        f"/tournaments/{td_tournament.id}/sheets/validate/",
        json={"sheet_url": FAKE_URL},
    )
    assert response.status_code == 200
    assert response.json()["spreadsheet_id"] == "fake123"


def test_validate_non_member_gets_404(client, td_user, other_tournament, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    assert client.post(
        f"/tournaments/{other_tournament.id}/sheets/validate/",
        json={"sheet_url": FAKE_URL},
    ).status_code == 404


def test_validate_volunteer_member_forbidden(
    client, td_user, other_tournament, db, mock_sheets_service
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert client.post(
        f"/tournaments/{other_tournament.id}/sheets/validate/",
        json={"sheet_url": FAKE_URL},
    ).status_code == 403


# ---------------------------------------------------------------------------
# Headers endpoint
# ---------------------------------------------------------------------------

def test_get_headers_returns_mappings_list(client, td_user, td_tournament, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/sheets/headers/",
        json={"sheet_url": FAKE_URL, "sheet_name": "Form Responses 1", "sheet_type": "volunteers"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "mappings" in data
    assert isinstance(data["mappings"], list)
    assert "suggestions" not in data
    assert "headers" not in data
    assert "form_questions" not in data


def test_get_headers_requires_sheet_type(client, td_user, td_tournament, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/sheets/headers/",
        json={"sheet_url": FAKE_URL, "sheet_name": "Form Responses 1"},
    )
    assert response.status_code == 422


def test_get_headers_with_form_url(client, td_user, td_tournament, mock_sheets_service, mock_forms_service):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/sheets/headers/",
        json={
            "sheet_url": FAKE_URL,
            "sheet_name": "Form Responses 1",
            "sheet_type": "volunteers",
            "form_url": FAKE_FORM_URL,
        },
    )
    assert response.status_code == 200
    mock_forms_service.get_form_questions.assert_called_once_with(FAKE_FORM_URL)


def test_get_headers_non_member_404(client, td_user, other_tournament, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    assert client.post(
        f"/tournaments/{other_tournament.id}/sheets/headers/",
        json={"sheet_url": FAKE_URL, "sheet_name": "Form Responses 1", "sheet_type": "volunteers"},
    ).status_code == 404


# ---------------------------------------------------------------------------
# Create config
# ---------------------------------------------------------------------------

def test_create_sheet_config(client, td_user, td_tournament, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    response = _make_config(client, td_tournament.id)
    assert response.status_code == 201
    data = response.json()
    assert data["label"] == "Interest Form"
    assert data["spreadsheet_id"] == "fake123"
    assert data["column_mappings"]["Email Address"]["field"] == "email"


def test_create_sheet_config_matrix_row_missing_row_key(
    client, td_user, td_tournament, mock_sheets_service
):
    login(client, "td@test.com", "tdpass")
    response = _make_config(client, td_tournament.id, column_mappings={
        "Availability [8:00 AM - 10:00 AM]": {
            "field": "availability", "type": "matrix_row",
        },
    })
    assert response.status_code == 422


def test_create_sheet_config_invalid_sheet_type(
    client, td_user, td_tournament, mock_sheets_service
):
    login(client, "td@test.com", "tdpass")
    assert _make_config(client, td_tournament.id, sheet_type="bad_type").status_code == 422


def test_create_sheet_config_non_member_forbidden(
    client, td_user, other_tournament, mock_sheets_service
):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    response = client.post(f"/tournaments/{other_tournament.id}/sheets/configs/", json={
        "tournament_id": other_tournament.id,
        "label": "Interest Form",
        "sheet_type": "volunteers",
        "sheet_url": FAKE_URL,
        "sheet_name": "Form Responses 1",
        "column_mappings": SAMPLE_MAPPINGS,
    })
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Get / List
# ---------------------------------------------------------------------------

def test_get_sheet_config(client, td_user, td_tournament, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    created = _make_config(client, td_tournament.id).json()
    response = client.get(f"/tournaments/{td_tournament.id}/sheets/configs/{created['id']}/")
    assert response.status_code == 200
    assert response.json()["id"] == created["id"]


def test_get_sheet_config_wrong_tournament_404(
    client, td_user, td_tournament, other_tournament, db, mock_sheets_service
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["tournament_director"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    created = _make_config(client, td_tournament.id).json()
    assert client.get(
        f"/tournaments/{other_tournament.id}/sheets/configs/{created['id']}/"
    ).status_code == 404


def test_get_sheet_config_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{td_tournament.id}/sheets/configs/9999/"
    ).status_code == 404


def test_list_sheet_configs(client, td_user, td_tournament, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    _make_config(client, td_tournament.id)
    _make_config(client, td_tournament.id)
    response = client.get(f"/tournaments/{td_tournament.id}/sheets/configs/")
    assert response.status_code == 200
    assert len(response.json()) == 2


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_update_sheet_config(client, td_user, td_tournament, mock_sheets_service):
    """PATCH label only — no column_mappings validation runs."""
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    created = _make_config(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/sheets/configs/{created['id']}/",
        json={"label": "Updated Label"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["label"] == "Updated Label"
    assert "Email Address" in data["column_mappings"]


def test_update_sheet_config_merges_column_mappings(
    client, td_user, td_tournament, mock_sheets_service
):
    """PATCHing column_mappings with a complete valid set merges new keys in."""
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    created = _make_config(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/sheets/configs/{created['id']}/",
        json={
            "column_mappings": {
                "Email Address": {"field": "email",      "type": "string"},
                "First Name":    {"field": "first_name", "type": "string"},
                "Last Name":     {"field": "last_name",  "type": "string"},
                "Phone Number":  {"field": "phone",      "type": "string"},
            },
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "Phone Number" in data["column_mappings"]
    assert "Email Address" in data["column_mappings"]


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_sheet_config(client, td_user, td_tournament, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    created = _make_config(client, td_tournament.id).json()
    assert client.delete(
        f"/tournaments/{td_tournament.id}/sheets/configs/{created['id']}/"
    ).status_code == 204
    assert client.get(
        f"/tournaments/{td_tournament.id}/sheets/configs/{created['id']}/"
    ).status_code == 404


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------

def test_sync_inactive_config(client, td_user, td_tournament, mock_sheets_service):
    login(client, "td@test.com", "tdpass")
    mock_sheets_service.extract_spreadsheet_id.return_value = "fake123"
    created = _make_config(client, td_tournament.id).json()
    client.patch(
        f"/tournaments/{td_tournament.id}/sheets/configs/{created['id']}/",
        json={"is_active": False},
    )
    assert client.post(
        f"/tournaments/{td_tournament.id}/sheets/configs/{created['id']}/sync/"
    ).status_code == 400


def test_sync_config_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.post(
        f"/tournaments/{td_tournament.id}/sheets/configs/9999/sync/"
    ).status_code == 404