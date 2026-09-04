"""Tests for /tournaments/{tournament_id}/shifts endpoints (TournamentShift model)
and event/shift attach-detach."""
from datetime import date, timedelta

from tests.conftest import grant_role, login

from app.models.models import Form, FormField, TournamentMembership, TournamentMembershipAvailability

# td_tournament's primary track spans [today, today + 1 day] — a shift is
# bounded by its *track's* range, not the tournament's, so these are the same
# window only while the tournament has one track.
EVENT_DATE = date.today().isoformat()
BEFORE_TOURNAMENT = (date.today() - timedelta(days=1)).isoformat()
AFTER_TOURNAMENT = (date.today() + timedelta(days=3)).isoformat()


def _primary_track(client, tournament_id):
    tracks = client.get(f"/tournaments/{tournament_id}/tracks/?public=true").json()
    return next(t for t in tracks if t["is_primary"])["id"]


def _make_shift(client, tournament_id, **overrides):
    payload = {
        "track_id": _primary_track(client, tournament_id),
        "label": "Shift 1",
        "start": EVENT_DATE + "T08:00:00Z",
        "end": EVENT_DATE + "T12:00:00Z",
    }
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/shifts/", json=payload)


def _make_event(client, tournament_id, **overrides):
    payload = {
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
        "start_time": EVENT_DATE + "T08:00:00Z",
        "end_time": EVENT_DATE + "T16:00:00Z",
    }
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/events/", json=payload).json()


# ---------------------------------------------------------------------------
# Shift CRUD
# ---------------------------------------------------------------------------

def test_create_shift(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_shift(client, td_tournament.id)
    assert response.status_code == 201
    data = response.json()
    assert data["label"] == "Shift 1"
    assert data["tournament_id"] == td_tournament.id


def test_create_shift_end_before_start_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_shift(client, td_tournament.id, start=EVENT_DATE + "T12:00:00Z", end=EVENT_DATE + "T08:00:00Z")
    assert response.status_code == 422


def test_create_shift_before_track_start_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_shift(client, td_tournament.id, start=BEFORE_TOURNAMENT + "T08:00:00Z", end=BEFORE_TOURNAMENT + "T12:00:00Z")
    assert response.status_code == 409


def test_create_shift_after_track_end_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_shift(client, td_tournament.id, start=AFTER_TOURNAMENT + "T08:00:00Z", end=AFTER_TOURNAMENT + "T12:00:00Z")
    assert response.status_code == 409


def test_update_shift_outside_track_bounds_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_shift(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/shifts/{created['id']}/",
        json={"start": AFTER_TOURNAMENT + "T08:00:00Z", "end": AFTER_TOURNAMENT + "T12:00:00Z"},
    )
    assert response.status_code == 409


def test_list_shifts(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_shift(client, td_tournament.id, label="Shift 1")
    _make_shift(client, td_tournament.id, label="Shift 2", start=EVENT_DATE + "T12:00:00Z", end=EVENT_DATE + "T16:00:00Z")
    response = client.get(f"/tournaments/{td_tournament.id}/shifts/")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_list_shifts_readable_by_plain_member(client, td_user, other_tournament, db):
    """Membership is the whole gate: the member edit page needs the catalog to
    render its own availability, and a shift is only a label and a time range,
    which any member answering an availability question already sees."""
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/shifts/").status_code == 200


def test_list_shifts_still_requires_membership(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/shifts/").status_code == 404


def test_shift_writes_still_require_manage_events(client, td_user, other_tournament, db):
    """Relaxing the read must not relax the write."""
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{other_tournament.id}/shifts/",
        json={"track_id": 1, "label": "Sneaky",
              "start": EVENT_DATE + "T08:00:00Z", "end": EVENT_DATE + "T12:00:00Z"},
    )
    assert response.status_code == 403


def test_list_shifts_filtered_by_track(client, db, td_user, td_tournament):
    """Availability is scoped to a track's day, so the catalog can be too."""
    login(client, "td@test.com", "tdpass")
    _make_shift(client, td_tournament.id, label="On main")
    main = _primary_track(client, td_tournament.id)

    body = client.get(f"/tournaments/{td_tournament.id}/shifts/?track_id={main}").json()
    assert [s["label"] for s in body] == ["On main"]
    assert client.get(f"/tournaments/{td_tournament.id}/shifts/?track_id={main + 999}").json() == []


def test_shift_cannot_be_placed_on_a_cosmetic_track(client, td_user, td_tournament):
    """A cosmetic track has no dates, so there is no range for the shift to
    fall inside — and nothing would ever validate it."""
    login(client, "td@test.com", "tdpass")
    track = client.post(
        f"/tournaments/{td_tournament.id}/tracks/", json={"name": "Test Writing"},
    ).json()
    response = _make_shift(client, td_tournament.id, track_id=track["id"])
    assert response.status_code == 409
    assert "no dates" in response.json()["detail"]


def test_track_with_shifts_cannot_be_deleted(client, td_user, td_tournament, db):
    """Shifts carry member availability — deleting a track is not a licence to
    destroy answers people gave."""
    login(client, "td@test.com", "tdpass")
    second = client.post(f"/tournaments/{td_tournament.id}/tracks/", json={
        "name": "Day 2", "is_primary": True,
        "start_date": EVENT_DATE, "end_date": EVENT_DATE,
        "location": "Elsewhere", "division": ["B"],
    }).json()
    _make_shift(client, td_tournament.id, track_id=second["id"])

    response = client.delete(f"/tournaments/{td_tournament.id}/tracks/{second['id']}/")
    assert response.status_code == 200
    assert response.json()["purged"] is False
    assert response.json()["blocked_by"] == ["1 shift(s)"]


def test_moving_the_last_shift_off_a_pending_track_purges_it(client, td_user, td_tournament, db):
    """Repointing the blocker - not deleting it - is what finishes the delete."""
    from app.models.models import TournamentTrack

    login(client, "td@test.com", "tdpass")
    main = _primary_track(client, td_tournament.id)
    second = client.post(f"/tournaments/{td_tournament.id}/tracks/", json={
        "name": "Day 2", "is_primary": True,
        "start_date": EVENT_DATE, "end_date": EVENT_DATE,
        "location": "Elsewhere", "division": ["B"],
    }).json()
    shift = _make_shift(client, td_tournament.id, track_id=second["id"]).json()

    assert client.delete(
        f"/tournaments/{td_tournament.id}/tracks/{second['id']}/"
    ).json()["purged"] is False

    moved = client.patch(
        f"/tournaments/{td_tournament.id}/shifts/{shift['id']}/", json={"track_id": main},
    )
    assert moved.status_code == 200
    assert db.query(TournamentTrack).filter(TournamentTrack.id == second["id"]).count() == 0


def test_deleting_the_last_shift_on_a_pending_track_purges_it(client, td_user, td_tournament, db):
    from app.models.models import TournamentTrack

    login(client, "td@test.com", "tdpass")
    second = client.post(f"/tournaments/{td_tournament.id}/tracks/", json={
        "name": "Day 2", "is_primary": True,
        "start_date": EVENT_DATE, "end_date": EVENT_DATE,
        "location": "Elsewhere", "division": ["B"],
    }).json()
    shift = _make_shift(client, td_tournament.id, track_id=second["id"]).json()
    client.delete(f"/tournaments/{td_tournament.id}/tracks/{second['id']}/")

    assert client.delete(
        f"/tournaments/{td_tournament.id}/shifts/{shift['id']}/"
    ).status_code == 204
    assert db.query(TournamentTrack).filter(TournamentTrack.id == second["id"]).count() == 0


def test_update_shift(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_shift(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/shifts/{created['id']}/",
        json={"label": "Renamed Shift"},
    )
    assert response.status_code == 200
    assert response.json()["label"] == "Renamed Shift"


def test_shift_event_count(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    shift = _make_shift(client, td_tournament.id).json()
    assert shift["event_count"] == 0

    event1 = _make_event(client, td_tournament.id, name="Boomilever")
    event2 = _make_event(client, td_tournament.id, name="Hovercraft")
    client.post(f"/tournaments/{td_tournament.id}/events/{event1['id']}/shifts/{shift['id']}/")
    client.post(f"/tournaments/{td_tournament.id}/events/{event2['id']}/shifts/{shift['id']}/")

    listed = client.get(f"/tournaments/{td_tournament.id}/shifts/").json()
    assert next(s for s in listed if s["id"] == shift["id"])["event_count"] == 2


def test_delete_shift(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_shift(client, td_tournament.id).json()
    assert client.delete(f"/tournaments/{td_tournament.id}/shifts/{created['id']}/").status_code == 204


def test_delete_shift_attached_to_two_events_detaches_both(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    shift = _make_shift(client, td_tournament.id).json()
    event1 = _make_event(client, td_tournament.id, name="Boomilever")
    event2 = _make_event(client, td_tournament.id, name="Hovercraft")

    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event1['id']}/shifts/{shift['id']}/"
    ).status_code == 201
    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event2['id']}/shifts/{shift['id']}/"
    ).status_code == 201

    assert client.delete(f"/tournaments/{td_tournament.id}/shifts/{shift['id']}/").status_code == 204

    e1 = client.get(f"/tournaments/{td_tournament.id}/events/{event1['id']}/").json()
    e2 = client.get(f"/tournaments/{td_tournament.id}/events/{event2['id']}/").json()
    assert e1["shifts"] == []
    assert e2["shifts"] == []


def test_delete_shift_blocked_when_referenced_by_availability(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    shift = _make_shift(client, td_tournament.id).json()

    membership = (
        db.query(TournamentMembership)
        .filter(TournamentMembership.user_id == td_user.id, TournamentMembership.tournament_id == td_tournament.id)
        .first()
    )
    db.add(TournamentMembershipAvailability(membership_id=membership.id, tournament_shift_id=shift["id"]))
    db.commit()

    response = client.delete(f"/tournaments/{td_tournament.id}/shifts/{shift['id']}/")
    assert response.status_code == 409
    assert "1" in response.json()["detail"]

    # Not deleted.
    listed = client.get(f"/tournaments/{td_tournament.id}/shifts/").json()
    assert any(s["id"] == shift["id"] for s in listed)


def test_delete_shift_blocked_when_referenced_by_live_field_option(client, db, td_user, td_tournament):
    """Guard fires even with zero answers — a shift grouped into a live
    availability option can't be pulled out from under it, independent of
    the separate MembershipAvailability guard above."""
    login(client, "td@test.com", "tdpass")
    shift = _make_shift(client, td_tournament.id).json()

    form = Form(owner_type="tournament", tournament_id=td_tournament.id, name="Volunteer form", created_by=td_user.id)
    db.add(form)
    db.flush()
    db.add(FormField(
        form_id=form.id, order=1, label="Availability", field_key="availability_20260315",
        question_type="multi_select_checkbox",
        config={"options": [{"option_id": "opt_1", "value": [shift["id"]], "label": "All Day"}]},
        is_archived=False,
    ))
    db.commit()

    response = client.delete(f"/tournaments/{td_tournament.id}/shifts/{shift['id']}/")
    assert response.status_code == 409

    listed = client.get(f"/tournaments/{td_tournament.id}/shifts/").json()
    assert any(s["id"] == shift["id"] for s in listed)


def test_delete_shift_allowed_when_only_referenced_by_archived_field(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    shift = _make_shift(client, td_tournament.id).json()

    form = Form(owner_type="tournament", tournament_id=td_tournament.id, name="Old form", created_by=td_user.id)
    db.add(form)
    db.flush()
    db.add(FormField(
        form_id=form.id, order=1, label="Availability", field_key="availability_archived_1",
        question_type="multi_select_checkbox",
        config={"options": [{"option_id": "opt_1", "value": [shift["id"]], "label": "All Day"}]},
        is_archived=True,
    ))
    db.commit()

    assert client.delete(f"/tournaments/{td_tournament.id}/shifts/{shift['id']}/").status_code == 204


def test_shift_write_routes_require_manage_events(client, td_user, other_tournament, db):
    """The read is membership-gated (see above); every write still isn't."""
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    base = f"/tournaments/{other_tournament.id}/shifts/"
    assert client.post(base, json={
        "track_id": 1, "label": "Nope",
        "start": EVENT_DATE + "T08:00:00Z", "end": EVENT_DATE + "T12:00:00Z",
    }).status_code == 403
    assert client.patch(f"{base}1/", json={"label": "Nope"}).status_code == 403
    assert client.delete(f"{base}1/").status_code == 403


# ---------------------------------------------------------------------------
# Attach / detach
# ---------------------------------------------------------------------------

def test_attach_shift_success(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id)
    shift = _make_shift(client, td_tournament.id).json()
    response = client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift['id']}/"
    )
    assert response.status_code == 201
    updated_event = client.get(f"/tournaments/{td_tournament.id}/events/{event['id']}/").json()
    assert len(updated_event["shifts"]) == 1


def test_attach_shift_outside_event_bounds_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, start_time=EVENT_DATE + "T08:00:00Z", end_time=EVENT_DATE + "T10:00:00Z")
    shift = _make_shift(client, td_tournament.id, start=EVENT_DATE + "T09:00:00Z", end=EVENT_DATE + "T11:00:00Z").json()
    response = client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift['id']}/"
    )
    assert response.status_code == 409


def test_attach_shift_event_missing_times_rejected(client, td_user, td_tournament):
    """Event start_time/end_time are nullable at create time — but a shift
    can't be bounds-checked against an event that has neither set."""
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, start_time=None, end_time=None)
    shift = _make_shift(client, td_tournament.id).json()
    response = client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift['id']}/"
    )
    assert response.status_code == 409


def test_attach_overlapping_shift_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, start_time=EVENT_DATE + "T08:00:00Z", end_time=EVENT_DATE + "T16:00:00Z")
    shift1 = _make_shift(client, td_tournament.id, start=EVENT_DATE + "T08:00:00Z", end=EVENT_DATE + "T12:00:00Z").json()
    shift2 = _make_shift(client, td_tournament.id, start=EVENT_DATE + "T11:00:00Z", end=EVENT_DATE + "T15:00:00Z").json()

    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift1['id']}/"
    ).status_code == 201
    response = client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift2['id']}/"
    )
    assert response.status_code == 409


def test_attach_adjacent_shift_succeeds(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, start_time=EVENT_DATE + "T08:00:00Z", end_time=EVENT_DATE + "T16:00:00Z")
    shift1 = _make_shift(client, td_tournament.id, start=EVENT_DATE + "T08:00:00Z", end=EVENT_DATE + "T12:00:00Z").json()
    shift2 = _make_shift(client, td_tournament.id, start=EVENT_DATE + "T12:00:00Z", end=EVENT_DATE + "T16:00:00Z").json()

    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift1['id']}/"
    ).status_code == 201
    response = client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift2['id']}/"
    )
    assert response.status_code == 201


def test_same_shift_attached_to_multiple_events_succeeds(client, td_user, td_tournament):
    """Reuse case — a shift isn't scoped to a single event."""
    login(client, "td@test.com", "tdpass")
    shift = _make_shift(client, td_tournament.id).json()
    event1 = _make_event(client, td_tournament.id, name="Boomilever")
    event2 = _make_event(client, td_tournament.id, name="Hovercraft")

    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event1['id']}/shifts/{shift['id']}/"
    ).status_code == 201
    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event2['id']}/shifts/{shift['id']}/"
    ).status_code == 201


def test_detach_shift(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id)
    shift = _make_shift(client, td_tournament.id).json()
    client.post(f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift['id']}/")

    response = client.delete(f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift['id']}/")
    assert response.status_code == 204

    updated_event = client.get(f"/tournaments/{td_tournament.id}/events/{event['id']}/").json()
    assert updated_event["shifts"] == []
