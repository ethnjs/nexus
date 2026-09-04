from datetime import timedelta

from app.core.tournament.form_prerequisites import member_meets_form_prerequisites
from app.models.models import (
    Form,
    TournamentForm,
    TournamentMembership,
    TournamentMembershipAvailability,
    TournamentMembershipRole,
    TournamentRole,
    TournamentShift,
    utcnow,
)
from tests.conftest import primary_track_id


def _standard_form(db, user, tournament, prerequisites=None):
    form = Form(
        owner_type="tournament",
        tournament_id=tournament.id,
        name="Conditional form",
        created_by=user.id,
    )
    db.add(form)
    db.flush()
    tournament_form = TournamentForm(
        form_id=form.id,
        tournament_id=tournament.id,
        prerequisites=prerequisites or {},
    )
    db.add(tournament_form)
    db.commit()
    return tournament_form


def _membership(db, tournament, user):
    membership = TournamentMembership(user_id=user.id, tournament_id=tournament.id, source="manual")
    db.add(membership)
    db.commit()
    return membership


def _role(db, tournament, label, rank):
    role = TournamentRole(tournament_id=tournament.id, label=label, permissions=[], rank=rank)
    db.add(role)
    db.commit()
    return role


def _shift(db, tournament, label):
    start = utcnow()
    shift = TournamentShift(tournament_id=tournament.id, track_id=primary_track_id(db, tournament.id), label=label, start=start, end=start + timedelta(hours=2))
    db.add(shift)
    db.commit()
    return shift


def test_no_prerequisites_allows_member(db, td_user, td_tournament, other_user):
    membership = _membership(db, td_tournament, other_user)
    tournament_form = _standard_form(db, td_user, td_tournament)

    assert member_meets_form_prerequisites(db, membership, tournament_form) is True


def test_onboarding_prerequisite_requires_completion(db, td_user, td_tournament, other_user):
    membership = _membership(db, td_tournament, other_user)
    tournament_form = _standard_form(db, td_user, td_tournament, {"onboarding_complete": True})

    assert member_meets_form_prerequisites(db, membership, tournament_form) is False
    membership.onboarded_at = utcnow()
    db.commit()
    assert member_meets_form_prerequisites(db, membership, tournament_form) is True


def test_role_prerequisite_matches_any_or_all(db, td_user, td_tournament, other_user):
    membership = _membership(db, td_tournament, other_user)
    test_writer = _role(db, td_tournament, "Prerequisite Role A", 20)
    event_supervisor = _role(db, td_tournament, "Prerequisite Role B", 21)
    db.add(TournamentMembershipRole(membership_id=membership.id, role_id=test_writer.id))
    db.commit()

    any_form = _standard_form(db, td_user, td_tournament, {"roles": {"ids": [test_writer.id, event_supervisor.id], "match": "any"}})
    all_form = _standard_form(db, td_user, td_tournament, {"roles": {"ids": [test_writer.id, event_supervisor.id], "match": "all"}})

    assert member_meets_form_prerequisites(db, membership, any_form) is True
    assert member_meets_form_prerequisites(db, membership, all_form) is False
    db.add(TournamentMembershipRole(membership_id=membership.id, role_id=event_supervisor.id))
    db.commit()
    assert member_meets_form_prerequisites(db, membership, all_form) is True


def test_availability_prerequisite_matches_any_or_all(db, td_user, td_tournament, other_user):
    membership = _membership(db, td_tournament, other_user)
    first_shift = _shift(db, td_tournament, "Morning")
    second_shift = _shift(db, td_tournament, "Afternoon")
    db.add(TournamentMembershipAvailability(membership_id=membership.id, tournament_shift_id=first_shift.id))
    db.commit()

    any_form = _standard_form(db, td_user, td_tournament, {"availability": {"shift_ids": [first_shift.id, second_shift.id], "match": "any"}})
    all_form = _standard_form(db, td_user, td_tournament, {"availability": {"shift_ids": [first_shift.id, second_shift.id], "match": "all"}})

    assert member_meets_form_prerequisites(db, membership, any_form) is True
    assert member_meets_form_prerequisites(db, membership, all_form) is False
    db.add(TournamentMembershipAvailability(membership_id=membership.id, tournament_shift_id=second_shift.id))
    db.commit()
    assert member_meets_form_prerequisites(db, membership, all_form) is True


def test_every_configured_group_must_pass(db, td_user, td_tournament, other_user):
    membership = _membership(db, td_tournament, other_user)
    role = _role(db, td_tournament, "Combined prerequisite role", 20)
    shift = _shift(db, td_tournament, "Morning")
    tournament_form = _standard_form(
        db,
        td_user,
        td_tournament,
        {
            "onboarding_complete": True,
            "roles": {"ids": [role.id], "match": "all"},
            "availability": {"shift_ids": [shift.id], "match": "all"},
        },
    )

    assert member_meets_form_prerequisites(db, membership, tournament_form) is False
    membership.onboarded_at = utcnow()
    db.add(TournamentMembershipRole(membership_id=membership.id, role_id=role.id))
    db.add(TournamentMembershipAvailability(membership_id=membership.id, tournament_shift_id=shift.id))
    db.commit()
    assert member_meets_form_prerequisites(db, membership, tournament_form) is True
