"""Tests for /tournaments/{tournament_id}/export-presets/
(app/api/routes/tournament/export_presets.py)."""
from app.models.models import TournamentExportPreset, TournamentRole
from tests.conftest import grant_role, login


def _url(tournament_id: int, preset_id: int | None = None) -> str:
    base = f"/tournaments/{tournament_id}/export-presets/"
    return base if preset_id is None else f"{base}{preset_id}/"


def _payload(**overrides) -> dict:
    payload = {
        "name": "Lunch counts",
        "row_type": "member",
        "columns": [{"key": "first_name"}, {"key": "last_name"}, {"key": "email"}],
        "sorts": [{"field": "last_name", "direction": "asc"}],
        "include_header": True,
    }
    payload.update(overrides)
    return payload


def _create(client, tournament_id: int, **overrides) -> dict:
    response = client.post(_url(tournament_id), json=_payload(**overrides))
    assert response.status_code == 201, response.json()
    return response.json()


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def test_create_preset_round_trips(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    body = _create(client, td_tournament.id)
    assert body["name"] == "Lunch counts"
    assert body["row_type"] == "member"
    assert body["columns"] == [{"key": "first_name"}, {"key": "last_name"}, {"key": "email"}]
    assert body["sorts"] == [{"field": "last_name", "direction": "asc"}]
    assert body["include_header"] is True
    assert body["created_by"] == td_user.id


def test_create_preset_trims_name(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert _create(client, td_tournament.id, name="  Lunch counts  ")["name"] == "Lunch counts"


def test_create_preset_accepts_entity_columns_and_modes(client, td_user, td_tournament):
    """Per-track and per-field keys, and a column carrying its own mode."""
    login(client, "td@test.com", "tdpass")
    body = _create(client, td_tournament.id, columns=[
        {"key": "track_shifts:3", "mode": "times"},
        {"key": "availability_track:3", "mode": "names"},
        {"key": "lunch:3:entree"},
        {"key": "form_field:abc123"},
    ], sorts=[])
    assert body["columns"][0] == {"key": "track_shifts:3", "mode": "times"}


def test_create_event_preset(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    body = _create(
        client, td_tournament.id, row_type="event",
        columns=[{"key": "event"}, {"key": "location"}, {"key": "members", "mode": "email"}],
        sorts=[{"field": "event", "direction": "asc"}],
    )
    assert body["row_type"] == "event"


def test_list_presets_ordered_by_name(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _create(client, td_tournament.id, name="Zebra")
    _create(client, td_tournament.id, name="Apple")
    response = client.get(_url(td_tournament.id))
    assert response.status_code == 200
    assert [p["name"] for p in response.json()] == ["Apple", "Zebra"]


def test_list_presets_scoped_to_tournament(client, td_user, other_user, td_tournament, other_tournament):
    login(client, "other@test.com", "otherpass")
    _create(client, other_tournament.id)
    login(client, "td@test.com", "tdpass")
    assert client.get(_url(td_tournament.id)).json() == []


def test_update_preset_partial(client, td_user, td_tournament):
    """Fields left out of the PATCH keep their values."""
    login(client, "td@test.com", "tdpass")
    preset = _create(client, td_tournament.id)
    response = client.patch(_url(td_tournament.id, preset["id"]), json={"name": "Renamed", "include_header": False})
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Renamed"
    assert body["include_header"] is False
    assert body["columns"] == preset["columns"]
    assert body["sorts"] == preset["sorts"]


def test_update_preset_replaces_columns_whole(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    preset = _create(client, td_tournament.id, sorts=[])
    response = client.patch(_url(td_tournament.id, preset["id"]), json={"columns": [{"key": "phone"}]})
    assert response.status_code == 200
    assert response.json()["columns"] == [{"key": "phone"}]


def test_update_preset_shared_across_staff(client, td_user, other_user, td_tournament, db):
    """Presets are tournament-wide, edited in place by anyone with manage_members."""
    grant_role(db, td_tournament, other_user, "Tournament Director")
    login(client, "td@test.com", "tdpass")
    preset = _create(client, td_tournament.id)

    login(client, "other@test.com", "otherpass")
    assert [p["id"] for p in client.get(_url(td_tournament.id)).json()] == [preset["id"]]
    assert client.patch(_url(td_tournament.id, preset["id"]), json={"name": "Theirs now"}).status_code == 200


def test_delete_preset(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    preset = _create(client, td_tournament.id)
    assert client.delete(_url(td_tournament.id, preset["id"])).status_code == 204
    assert client.get(_url(td_tournament.id)).json() == []


def test_update_and_delete_missing_preset_404(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.patch(_url(td_tournament.id, 99999), json={"name": "x"}).status_code == 404
    assert client.delete(_url(td_tournament.id, 99999)).status_code == 404


def test_preset_from_another_tournament_404(client, td_user, other_user, td_tournament, other_tournament):
    """A preset id is scoped to the tournament in the URL."""
    login(client, "other@test.com", "otherpass")
    theirs = _create(client, other_tournament.id)
    login(client, "td@test.com", "tdpass")
    assert client.patch(_url(td_tournament.id, theirs["id"]), json={"name": "x"}).status_code == 404
    assert client.delete(_url(td_tournament.id, theirs["id"])).status_code == 404


def test_writes_allowed_on_archived_tournament(client, td_user, td_tournament, db):
    """A preset is a way of reading the data, not the data — archiving
    doesn't freeze it, matching display config."""
    td_tournament.is_archived = True
    db.commit()
    login(client, "td@test.com", "tdpass")
    preset = _create(client, td_tournament.id)
    assert client.patch(_url(td_tournament.id, preset["id"]), json={"name": "x"}).status_code == 200


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------

def test_presets_require_manage_members(client, td_user, other_user, other_tournament, db):
    login(client, "other@test.com", "otherpass")
    preset = _create(client, other_tournament.id)

    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(_url(other_tournament.id)).status_code == 403
    assert client.post(_url(other_tournament.id), json=_payload(name="Mine")).status_code == 403
    assert client.patch(_url(other_tournament.id, preset["id"]), json={"name": "x"}).status_code == 403
    assert client.delete(_url(other_tournament.id, preset["id"])).status_code == 403


def test_manage_events_alone_cannot_touch_presets(client, td_user, other_tournament, db):
    """Exports read the roster, so the roster's gate — not the events one."""
    db.add(TournamentRole(
        tournament_id=other_tournament.id, label="Schedule Only", permissions=["manage_events"], rank=25,
    ))
    db.commit()
    grant_role(db, other_tournament, td_user, "Schedule Only")
    login(client, "td@test.com", "tdpass")
    assert client.get(_url(other_tournament.id)).status_code == 403


def test_presets_non_member_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(_url(other_tournament.id)).status_code == 404


def test_presets_unauthenticated(client, td_tournament):
    assert client.get(_url(td_tournament.id)).status_code == 401


# ---------------------------------------------------------------------------
# Unique name per tournament
# ---------------------------------------------------------------------------

def test_create_duplicate_name_conflict(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _create(client, td_tournament.id)
    assert client.post(_url(td_tournament.id), json=_payload()).status_code == 409


def test_rename_onto_taken_name_conflict(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _create(client, td_tournament.id, name="First")
    second = _create(client, td_tournament.id, name="Second")
    assert client.patch(_url(td_tournament.id, second["id"]), json={"name": "First"}).status_code == 409


def test_rename_to_own_name_is_fine(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    preset = _create(client, td_tournament.id)
    assert client.patch(_url(td_tournament.id, preset["id"]), json={"name": preset["name"]}).status_code == 200


def test_same_name_in_another_tournament_is_fine(client, td_user, other_user, td_tournament, other_tournament):
    login(client, "td@test.com", "tdpass")
    _create(client, td_tournament.id)
    login(client, "other@test.com", "otherpass")
    _create(client, other_tournament.id)


# ---------------------------------------------------------------------------
# Write validation
# ---------------------------------------------------------------------------

def test_create_rejects_invalid_payloads(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    cases = {
        "blank name":          _payload(name="   "),
        "unknown row type":    _payload(row_type="assignment"),
        "unknown column":      _payload(columns=[{"key": "shoe_size"}], sorts=[]),
        "malformed entity":    _payload(columns=[{"key": "track:abc"}], sorts=[]),
        # Not exportable: NEXUS metadata, and members-table-only columns.
        "metadata column":     _payload(columns=[{"key": "joined"}], sorts=[]),
        "unknown mode":        _payload(columns=[{"key": "track_shifts:3", "mode": "sideways"}], sorts=[]),
        "repeated column":     _payload(columns=[{"key": "email"}, {"key": "email"}], sorts=[]),
        "sort not a column":   _payload(sorts=[{"field": "phone", "direction": "asc"}]),
        "bad sort direction":  _payload(sorts=[{"field": "email", "direction": "sideways"}]),
        # Presets never store filters — who's exported is the page's call.
        "filters":             {**_payload(), "filters": {"role": ["3"]}},
        "extra column option": _payload(columns=[{"key": "email", "width": 3}], sorts=[]),
    }
    for label, payload in cases.items():
        response = client.post(_url(td_tournament.id), json=payload)
        assert response.status_code == 422, label


def test_update_sorts_checked_against_stored_columns(client, td_user, td_tournament):
    """Either half may arrive alone, so a sort-only PATCH is checked against
    the columns already saved."""
    login(client, "td@test.com", "tdpass")
    preset = _create(client, td_tournament.id)
    response = client.patch(_url(td_tournament.id, preset["id"]), json={"sorts": [{"field": "phone", "direction": "asc"}]})
    assert response.status_code == 422


def test_update_columns_cannot_drop_a_sorted_column(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    preset = _create(client, td_tournament.id)  # sorted by last_name
    response = client.patch(_url(td_tournament.id, preset["id"]), json={"columns": [{"key": "email"}]})
    assert response.status_code == 422


def test_update_rejects_invalid_fields(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    preset = _create(client, td_tournament.id)
    for body in ({"name": " "}, {"row_type": "assignment"}, {"columns": [{"key": "shoe_size"}]}):
        assert client.patch(_url(td_tournament.id, preset["id"]), json=body).status_code == 422, body


# ---------------------------------------------------------------------------
# Lenient read
# ---------------------------------------------------------------------------

def _stale_preset(db, tournament_id: int) -> TournamentExportPreset:
    """Written straight to the DB, as if its columns had been valid once:
    a deleted track, and a column name since retired."""
    preset = TournamentExportPreset(
        tournament_id=tournament_id, name="Old", row_type="member",
        columns=[{"key": "track_shifts:99999", "mode": "times"}, {"key": "retired_column"}],
        sorts=[{"field": "retired_column", "direction": "asc"}],
        include_header=True,
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return preset


def test_stale_preset_reads_back(client, td_user, td_tournament, db):
    """The frontend skips a column it can't resolve; the server never 500s."""
    _stale_preset(db, td_tournament.id)
    login(client, "td@test.com", "tdpass")
    response = client.get(_url(td_tournament.id))
    assert response.status_code == 200
    assert [c["key"] for c in response.json()[0]["columns"]] == ["track_shifts:99999", "retired_column"]


def test_stale_preset_can_still_be_renamed(client, td_user, td_tournament, db):
    """A PATCH that leaves columns and sorts alone doesn't re-check them."""
    preset = _stale_preset(db, td_tournament.id)
    login(client, "td@test.com", "tdpass")
    response = client.patch(_url(td_tournament.id, preset.id), json={"name": "Renamed"})
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Cascade
# ---------------------------------------------------------------------------

def test_deleting_tournament_deletes_its_presets(client, td_user, td_tournament, db):
    login(client, "td@test.com", "tdpass")
    preset = _create(client, td_tournament.id)
    assert client.delete(f"/tournaments/{td_tournament.id}/").status_code == 204
    db.expire_all()
    assert db.get(TournamentExportPreset, preset["id"]) is None


# ---------------------------------------------------------------------------
# Output type
# ---------------------------------------------------------------------------

def test_output_type_defaults_to_copy(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert _create(client, td_tournament.id)["output_type"] == "copy"


def test_output_type_round_trips(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    preset = _create(client, td_tournament.id, output_type="csv")
    assert preset["output_type"] == "csv"
    response = client.patch(_url(td_tournament.id, preset["id"]), json={"output_type": "txt"})
    assert response.status_code == 200
    assert client.get(_url(td_tournament.id)).json()[0]["output_type"] == "txt"


def test_output_type_rejects_unknown_value(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.post(_url(td_tournament.id), json=_payload(output_type="pdf")).status_code == 422
    preset = _create(client, td_tournament.id)
    assert client.patch(_url(td_tournament.id, preset["id"]), json={"output_type": "pdf"}).status_code == 422
