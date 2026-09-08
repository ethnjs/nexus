"""Tests for TournamentEventAssignment.

These are database-constraint tests, not route tests — the routes land in a
later step. What they cover is the part of the design that lives in the schema
rather than in code: the two partial unique indexes, and the composite FK that
keeps an assignment's membership_id and membership_role_id from disagreeing.
"""
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from tests.conftest import grant_role, primary_track_id

from app.models.models import (
    TournamentEvent, TournamentEventAssignment, TournamentEventShift,
    TournamentMembership, TournamentMembershipRole, TournamentRole, TournamentShift,
)
from app.schemas.tournament.assignment import AssignmentRead, EventAssignmentRead


def _make_event(db, tournament, name="Boomilever"):
    event = TournamentEvent(tournament_id=tournament.id, name=name, division="C")
    db.add(event)
    db.commit()
    return event


def _make_shift(db, tournament, label="Shift 1", hour=8):
    """A shift on the tournament's primary track. Shifts only ever hang off a
    primary track — a cosmetic one has no dates for a time range to sit in."""
    start = datetime.combine(date.today(), time(hour), tzinfo=timezone.utc)
    shift = TournamentShift(
        tournament_id=tournament.id,
        track_id=primary_track_id(db, tournament.id),
        label=label,
        start=start,
        end=start + timedelta(hours=4),
    )
    db.add(shift)
    db.commit()
    return shift


def _membership_role(db, tournament, user, role_label="Test Writer"):
    """The join row an assignment actually points at."""
    grant_role(db, tournament, user, role_label)
    return (
        db.query(TournamentMembershipRole)
        .join(TournamentMembership)
        .join(TournamentRole)
        .filter(
            TournamentMembership.user_id == user.id,
            TournamentMembership.tournament_id == tournament.id,
            TournamentRole.label == role_label,
        )
        .one()
    )


def _assign(db, event, membership_role, shift=None):
    row = TournamentEventAssignment(
        tournament_event_id=event.id,
        membership_id=membership_role.membership_id,
        membership_role_id=membership_role.id,
        tournament_shift_id=shift.id if shift else None,
    )
    db.add(row)
    return row


class TestUniqueness:
    """The reason uniqueness is two partial indexes rather than one constraint:
    Postgres treats NULLs as distinct, so a plain UniqueConstraint over a
    nullable shift column would silently permit unlimited duplicates on a
    shiftless event."""

    def test_duplicate_with_shift_is_rejected(self, db, td_tournament, other_user):
        event = _make_event(db, td_tournament)
        shift = _make_shift(db, td_tournament)
        mr = _membership_role(db, td_tournament, other_user)

        _assign(db, event, mr, shift)
        db.commit()

        _assign(db, event, mr, shift)
        with pytest.raises(IntegrityError):
            db.commit()

    def test_duplicate_without_shift_is_rejected(self, db, td_tournament, other_user):
        """The case a plain UniqueConstraint would have let through."""
        event = _make_event(db, td_tournament)
        mr = _membership_role(db, td_tournament, other_user)

        _assign(db, event, mr, None)
        db.commit()

        _assign(db, event, mr, None)
        with pytest.raises(IntegrityError):
            db.commit()

    def test_same_member_and_role_on_two_shifts_is_allowed(self, db, td_tournament, other_user):
        event = _make_event(db, td_tournament)
        morning = _make_shift(db, td_tournament, label="Morning", hour=8)
        afternoon = _make_shift(db, td_tournament, label="Afternoon", hour=13)
        mr = _membership_role(db, td_tournament, other_user)

        _assign(db, event, mr, morning)
        _assign(db, event, mr, afternoon)
        db.commit()

        assert db.query(TournamentEventAssignment).count() == 2

    def test_same_member_in_two_roles_on_one_event_is_allowed(self, db, td_tournament, other_user):
        """Uniqueness is per role, not per member — one person can both write
        and review the same event."""
        event = _make_event(db, td_tournament)
        writer = _membership_role(db, td_tournament, other_user, "Test Writer")
        reviewer = _membership_role(db, td_tournament, other_user, "Test Reviewer")

        _assign(db, event, writer, None)
        _assign(db, event, reviewer, None)
        db.commit()

        assert db.query(TournamentEventAssignment).count() == 2


class TestCompositeForeignKey:
    def test_membership_id_disagreeing_with_the_role_row_is_rejected(
        self, db, td_tournament, td_user, other_user
    ):
        """membership_id is denormalized for cheap member-scoped queries. The
        composite FK is what stops it drifting from the membership behind
        membership_role_id — this must fail in the database, not rely on every
        write path remembering to check."""
        event = _make_event(db, td_tournament)
        theirs = _membership_role(db, td_tournament, other_user)
        someone_else = (
            db.query(TournamentMembership)
            .filter_by(tournament_id=td_tournament.id, user_id=td_user.id)
            .one()
        )

        db.add(TournamentEventAssignment(
            tournament_event_id=event.id,
            membership_id=someone_else.id,      # not the member behind `theirs`
            membership_role_id=theirs.id,
        ))
        with pytest.raises(IntegrityError):
            db.commit()


class TestCascades:
    def test_deleting_the_event_removes_its_assignments(self, db, td_tournament, other_user):
        event = _make_event(db, td_tournament)
        mr = _membership_role(db, td_tournament, other_user)
        _assign(db, event, mr, None)
        db.commit()

        db.delete(event)
        db.commit()

        assert db.query(TournamentEventAssignment).count() == 0

    def test_removing_the_role_from_the_member_removes_the_assignment(
        self, db, td_tournament, other_user
    ):
        """Why the role PATCH needs a confirm step — dropping a role silently
        takes that member's staffing under it with them."""
        event = _make_event(db, td_tournament)
        mr = _membership_role(db, td_tournament, other_user)
        _assign(db, event, mr, None)
        db.commit()

        db.delete(mr)
        db.commit()

        assert db.query(TournamentEventAssignment).count() == 0


class TestReadSchemas:
    """from_row flattens four relationships — none of these names live on the
    assignment row, so from_attributes alone can't build either schema."""

    def test_assignment_read_flattens_event_member_role_and_shift(
        self, db, td_tournament, other_user
    ):
        event = _make_event(db, td_tournament, name="Anatomy")
        shift = _make_shift(db, td_tournament, label="Morning")
        mr = _membership_role(db, td_tournament, other_user, "Test Writer")
        row = _assign(db, event, mr, shift)
        db.commit()

        read = AssignmentRead.from_row(row)

        assert read.event_name == "Anatomy"
        assert (read.first_name, read.last_name) == (other_user.first_name, other_user.last_name)
        assert read.role_label == "Test Writer"
        assert read.membership_role_id == mr.id
        assert read.shift is not None
        assert read.shift.label == "Morning"
        assert read.shift.track_id == primary_track_id(db, td_tournament.id)

    def test_event_name_resolves_through_the_catalog_row(
        self, db, td_tournament, other_user, event_factory, event_category
    ):
        """A catalog-linked event carries its name on the joined Event row and
        reads back nameless off `.name` — from_row must use display_name."""
        catalog = event_factory(event_category, name="Codebusters")
        event = TournamentEvent(tournament_id=td_tournament.id, event_id=catalog.id, division="C")
        db.add(event)
        db.commit()

        mr = _membership_role(db, td_tournament, other_user)
        row = _assign(db, event, mr, None)
        db.commit()

        assert AssignmentRead.from_row(row).event_name == "Codebusters"

    def test_shift_is_null_not_omitted_when_the_assignment_has_none(
        self, db, td_tournament, other_user
    ):
        """Null means "no shift" — a real answer, distinct from a field the
        caller didn't ask for, which `fields` expresses by absence instead."""
        event = _make_event(db, td_tournament)
        mr = _membership_role(db, td_tournament, other_user)
        row = _assign(db, event, mr, None)
        db.commit()

        assert AssignmentRead.from_row(row).shift is None
        assert "shift" in AssignmentRead.from_row(row).model_dump()

    def test_event_assignment_read_drops_the_event_it_is_nested_under(
        self, db, td_tournament, other_user
    ):
        """The chip face. The event row already says which event this is, so
        repeating it on every nested assignment is noise."""
        event = _make_event(db, td_tournament)
        mr = _membership_role(db, td_tournament, other_user)
        row = _assign(db, event, mr, None)
        db.commit()

        dumped = EventAssignmentRead.from_row(row).model_dump()

        assert "tournament_event_id" not in dumped
        assert "event_name" not in dumped
        assert dumped["role_label"] == "Test Writer"


class TestShiftAttachment:
    def test_an_assignment_survives_its_shift_being_detached_from_the_event(
        self, db, td_tournament, other_user
    ):
        """Detaching is not deleting: the tournament_event_shifts row goes, the
        shift itself stays, and so does the staffing that referenced it. The
        route layer is what nulls the column; this only proves nothing at the
        schema level cascades it away first."""
        event = _make_event(db, td_tournament)
        shift = _make_shift(db, td_tournament)
        db.add(TournamentEventShift(tournament_event_id=event.id, tournament_shift_id=shift.id))
        db.commit()

        mr = _membership_role(db, td_tournament, other_user)
        assignment = _assign(db, event, mr, shift)
        db.commit()

        db.query(TournamentEventShift).filter_by(
            tournament_event_id=event.id, tournament_shift_id=shift.id,
        ).delete()
        db.commit()

        db.refresh(assignment)
        assert assignment.tournament_shift_id == shift.id
