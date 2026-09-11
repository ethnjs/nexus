"""Tests for GET /tournaments/{tournament_id}/members/summary/."""
from datetime import datetime, timezone
from app.models.models import (
    Form, FormField, TournamentMembership, TournamentMembershipAvailability,
    TournamentMembershipTrackStatus, TournamentShift, User,
)
from tests.conftest import grant_role, login, primary_track_id


def _url(tournament):
    return f"/tournaments/{tournament.id}/members/summary/"


def _shift(db, tournament, track_id, label, hour):
    shift = TournamentShift(
        tournament_id=tournament.id, track_id=track_id, label=label,
        start=datetime(2026, 3, 1, hour, tzinfo=timezone.utc),
        end=datetime(2026, 3, 1, hour + 2, tzinfo=timezone.utc),
    )
    db.add(shift)
    db.flush()
    return shift


def _member(db, tournament, email, *, track_id=None, status=None, shifts=(), **overrides):
    user = User(first_name="Test", last_name="Member", email=email)
    db.add(user)
    db.flush()
    membership = TournamentMembership(user_id=user.id, tournament_id=tournament.id, source="manual", **overrides)
    db.add(membership)
    db.flush()
    if status:
        db.add(TournamentMembershipTrackStatus(membership_id=membership.id, track_id=track_id, status=status))
    for shift in shifts:
        db.add(TournamentMembershipAvailability(membership_id=membership.id, tournament_shift_id=shift.id))
    db.commit()
    return membership


def _availability_field(db, tournament, owner, track_id, options, *, form_status="published"):
    form = Form(
        owner_type="tournament", tournament_id=tournament.id, chapter_id=None,
        name="Interest", title="Interest", status=form_status, created_by=owner.id,
    )
    db.add(form)
    db.flush()
    db.add(FormField(
        form_id=form.id, order=1, label="Availability", question_type="multi_select_checkbox",
        field_key=f"availability_{track_id}",
        config={"required": False, "options": [
            {"option_id": option_id, "label": label, "value": [shift.id for shift in shifts]}
            for option_id, label, shifts in options
        ]},
    ))
    db.commit()


def _track(body, track_id):
    return next(track for track in body["tracks"] if track["track_id"] == track_id)


def test_counts_statuses_and_availability_by_largest_covered_option(client, td_user, td_tournament, db):
    track_id = primary_track_id(db, td_tournament.id)
    morning = _shift(db, td_tournament, track_id, "Morning", 8)
    afternoon = _shift(db, td_tournament, track_id, "Afternoon", 12)
    impound = _shift(db, td_tournament, track_id, "Impound", 16)
    _availability_field(db, td_tournament, td_user, track_id, [
        ("opt_m", "Morning", [morning]),
        ("opt_a", "Afternoon", [afternoon]),
        ("opt_all", "All day", [morning, afternoon, impound]),
        ("opt_ni", "Not impound", [morning, afternoon]),
    ])
    _member(db, td_tournament, "allday@test.com", track_id=track_id, status="confirmed",
            shifts=[morning, afternoon, impound])
    _member(db, td_tournament, "noimpound@test.com", track_id=track_id, status="confirmed",
            shifts=[morning, afternoon])
    _member(db, td_tournament, "morning@test.com", track_id=track_id, status="interested", shifts=[morning])
    # A declined member's leftover shifts aren't availability.
    _member(db, td_tournament, "declined@test.com", track_id=track_id, status="declined", shifts=[morning])

    login(client, "td@test.com", "tdpass")
    response = client.get(_url(td_tournament))

    assert response.status_code == 200
    body = response.json()
    # The four above plus the TD, who has no status on the track.
    assert body["member_count"] == 5
    track = _track(body, track_id)
    assert (track["confirmed"], track["interested"], track["declined"], track["pending"]) == (2, 1, 1, 1)
    # All day holds Not impound holds Morning — each member counts once, under the largest.
    counts = {option["label"]: (option["confirmed"], option["interested"]) for option in track["availability"]}
    assert counts == {"Morning": (0, 1), "Afternoon": (0, 0), "All day": (1, 0), "Not impound": (1, 0)}


def test_age_declined_members_are_left_out(client, td_user, td_tournament, db):
    track_id = primary_track_id(db, td_tournament.id)
    _member(db, td_tournament, "gone@test.com", track_id=track_id, status="confirmed", age_disclosure="declined")

    login(client, "td@test.com", "tdpass")
    body = client.get(_url(td_tournament)).json()

    assert body["member_count"] == 1
    assert _track(body, track_id)["confirmed"] == 0


def test_draft_form_options_are_not_offered(client, td_user, td_tournament, db):
    track_id = primary_track_id(db, td_tournament.id)
    morning = _shift(db, td_tournament, track_id, "Morning", 8)
    _availability_field(db, td_tournament, td_user, track_id, [("opt_m", "Morning", [morning])], form_status="draft")

    login(client, "td@test.com", "tdpass")
    body = client.get(_url(td_tournament)).json()

    assert _track(body, track_id)["availability"] == []


def test_onboarding_is_null_without_live_steps(client, td_user, td_tournament, db):
    login(client, "td@test.com", "tdpass")
    assert client.get(_url(td_tournament)).json()["onboarding"] is None


def test_requires_manage_members(client, other_user, td_tournament, db):
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "other@test.com", "otherpass")
    assert client.get(_url(td_tournament)).status_code == 403
