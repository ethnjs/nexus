"""Tests for /api/v1/tournaments endpoints."""

import pytest
from fastapi.testclient import TestClient


def test_list_tournaments_empty(client: TestClient):
    response = client.get("/api/v1/tournaments/")
    assert response.status_code == 200
    assert response.json() == []


def test_create_tournament(client: TestClient):
    payload = {"name": "Test Invitational", "date": "2025-11-15T00:00:00", "location": "Test HS"}
    response = client.post("/api/v1/tournaments/", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Invitational"
    assert data["location"] == "Test HS"
    assert "id" in data


def test_create_tournament_minimal(client: TestClient):
    """Only name is required."""
    response = client.post("/api/v1/tournaments/", json={"name": "Minimal Tournament"})
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Minimal Tournament"
    assert data["date"] is None
    assert data["location"] is None


def test_get_tournament(client: TestClient):
    created = client.post("/api/v1/tournaments/", json={"name": "Fetch Me"}).json()
    response = client.get(f"/api/v1/tournaments/{created['id']}")
    assert response.status_code == 200
    assert response.json()["name"] == "Fetch Me"


def test_get_tournament_not_found(client: TestClient):
    response = client.get("/api/v1/tournaments/9999")
    assert response.status_code == 404


def test_list_tournaments_multiple(client: TestClient):
    client.post("/api/v1/tournaments/", json={"name": "Tournament A"})
    client.post("/api/v1/tournaments/", json={"name": "Tournament B"})
    response = client.get("/api/v1/tournaments/")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_delete_tournament(client: TestClient):
    created = client.post("/api/v1/tournaments/", json={"name": "Delete Me"}).json()
    response = client.delete(f"/api/v1/tournaments/{created['id']}")
    assert response.status_code == 204
    assert client.get(f"/api/v1/tournaments/{created['id']}").status_code == 404


def test_delete_tournament_not_found(client: TestClient):
    response = client.delete("/api/v1/tournaments/9999")
    assert response.status_code == 404