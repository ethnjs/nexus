from app.core.tournament.form_prerequisites import (
    meets_prerequisites,
    member_meets_form_prerequisites,
)
from app.models.models import (
    Form,
    TournamentForm,
    TournamentMembership,
    TournamentRole,
    TournamentTrackAssignment,
)


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


def _condition(ids, match="any", inverse=False):
    return {"ids": ids, "match": match, "inverse": inverse}


def test_no_prerequisites_allows_member(db, td_user, td_tournament, other_user):
    membership = _membership(db, td_tournament, other_user)
    tournament_form = _standard_form(db, td_user, td_tournament)

    assert member_meets_form_prerequisites(db, membership, tournament_form) is True


def test_member_role_assignments_are_evaluated(db, td_user, td_tournament, other_user):
    membership = _membership(db, td_tournament, other_user)
    role = _role(db, td_tournament, "Prerequisite Role", 20)
    tournament_form = _standard_form(db, td_user, td_tournament, {"roles": [_condition([role.id])]})

    assert member_meets_form_prerequisites(db, membership, tournament_form) is False
    db.add(
        TournamentTrackAssignment(
            membership_id=membership.id, role_id=role.id, is_tournament_wide=True
        )
    )
    db.commit()
    assert member_meets_form_prerequisites(db, membership, tournament_form) is True


def test_any_and_all():
    any_of = {"roles": [_condition([1, 2], "any")]}
    all_of = {"roles": [_condition([1, 2], "all")]}

    assert meets_prerequisites(any_of, {1}) is True
    assert meets_prerequisites(any_of, {3}) is False
    assert meets_prerequisites(all_of, {1}) is False
    assert meets_prerequisites(all_of, {1, 2, 3}) is True


def test_inverse_any_requires_holding_none():
    none_of = {"roles": [_condition([1, 2], "any", inverse=True)]}

    assert meets_prerequisites(none_of, set()) is True
    assert meets_prerequisites(none_of, {3}) is True
    assert meets_prerequisites(none_of, {2}) is False


def test_inverse_all_requires_missing_at_least_one():
    not_all_of = {"roles": [_condition([1, 2], "all", inverse=True)]}

    assert meets_prerequisites(not_all_of, {1}) is True
    assert meets_prerequisites(not_all_of, {1, 2}) is False


def test_every_condition_must_pass():
    has_one_lacks_other = {
        "roles": [_condition([1]), _condition([2], inverse=True)],
    }

    assert meets_prerequisites(has_one_lacks_other, {1}) is True
    assert meets_prerequisites(has_one_lacks_other, {1, 2}) is False
    assert meets_prerequisites(has_one_lacks_other, set()) is False


def test_malformed_prerequisites_fail_closed():
    assert meets_prerequisites({"roles": {"ids": [1], "match": "any"}}, {1}) is False
    assert meets_prerequisites({"roles": [_condition([1], "some")]}, {1}) is False
    assert meets_prerequisites({"roles": [_condition([])]}, {1}) is False
    assert meets_prerequisites(["roles"], {1}) is False
