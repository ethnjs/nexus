"""Tests for TournamentEventAssignment.

These are database-constraint tests, not route tests — the routes land in a
later step. What they cover is the part of the design that lives in the schema
rather than in code: the two partial unique indexes, and the composite FK that
keeps an assignment's membership_id and membership_role_id from disagreeing.
"""
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from tests.conftest import grant_role, login, primary_track_id

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


# ---------------------------------------------------------------------------
# Route tests — /tournaments/{tournament_id}/assignments/
# ---------------------------------------------------------------------------
def _role_id(db, tournament, label):
    return (
        db.query(TournamentRole)
        .filter_by(tournament_id=tournament.id, label=label)
        .one()
        .id
    )


def _membership_id(db, tournament, user):
    return (
        db.query(TournamentMembership)
        .filter_by(tournament_id=tournament.id, user_id=user.id)
        .one()
        .id
    )


def _post(client, tournament, **body):
    return client.post(f"/tournaments/{tournament.id}/assignments/", json=body)


class TestCreateRoute:
    def test_assigns_a_member_holding_the_role(self, client, db, td_user, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Test Writer")
        event = _make_event(db, td_tournament, name="Anatomy")
        login(client, "td@test.com", "tdpass")

        response = _post(
            client, td_tournament,
            tournament_event_id=event.id,
            membership_id=_membership_id(db, td_tournament, other_user),
            role_id=_role_id(db, td_tournament, "Test Writer"),
        )

        assert response.status_code == 201
        body = response.json()
        assert body["event_name"] == "Anatomy"
        assert body["role_label"] == "Test Writer"
        assert body["shift"] is None

    def test_grants_the_role_when_the_member_does_not_hold_it(
        self, client, db, td_user, td_tournament, other_user
    ):
        """The whole point of naming a role rather than a join row: staffing
        someone should not require leaving the board to grant a role first."""
        membership = TournamentMembership(
            user_id=other_user.id, tournament_id=td_tournament.id, source="manual",
        )
        db.add(membership)
        db.commit()
        event = _make_event(db, td_tournament)
        login(client, "td@test.com", "tdpass")

        role_id = _role_id(db, td_tournament, "Test Writer")
        response = _post(
            client, td_tournament,
            tournament_event_id=event.id, membership_id=membership.id, role_id=role_id,
        )

        assert response.status_code == 201
        assert db.query(TournamentMembershipRole).filter_by(
            membership_id=membership.id, role_id=role_id,
        ).count() == 1

    def test_a_rank_violating_auto_grant_is_refused(self, client, db, td_tournament, other_user):
        """The auto-grant is a real role grant, so the same rank rule binds it —
        a coordinator cannot hand out Tournament Director through it."""
        grant_role(db, td_tournament, other_user, "Volunteer Coordinator")
        event = _make_event(db, td_tournament)
        login(client, "other@test.com", "otherpass")

        response = _post(
            client, td_tournament,
            tournament_event_id=event.id,
            membership_id=_membership_id(db, td_tournament, other_user),
            role_id=_role_id(db, td_tournament, "Tournament Director"),
        )

        assert response.status_code == 403
        assert db.query(TournamentEventAssignment).count() == 0

    def test_a_shift_not_on_the_event_is_rejected(
        self, client, db, td_user, td_tournament, other_user
    ):
        grant_role(db, td_tournament, other_user, "Test Writer")
        event = _make_event(db, td_tournament)
        unattached = _make_shift(db, td_tournament, label="Morning")
        login(client, "td@test.com", "tdpass")

        response = _post(
            client, td_tournament,
            tournament_event_id=event.id,
            membership_id=_membership_id(db, td_tournament, other_user),
            role_id=_role_id(db, td_tournament, "Test Writer"),
            tournament_shift_id=unattached.id,
        )

        assert response.status_code == 422
        assert "Morning" in response.json()["detail"]

    def test_an_attached_shift_is_accepted(self, client, db, td_user, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Test Writer")
        event = _make_event(db, td_tournament)
        shift = _make_shift(db, td_tournament, label="Morning")
        db.add(TournamentEventShift(tournament_event_id=event.id, tournament_shift_id=shift.id))
        db.commit()
        login(client, "td@test.com", "tdpass")

        response = _post(
            client, td_tournament,
            tournament_event_id=event.id,
            membership_id=_membership_id(db, td_tournament, other_user),
            role_id=_role_id(db, td_tournament, "Test Writer"),
            tournament_shift_id=shift.id,
        )

        assert response.status_code == 201
        assert response.json()["shift"]["label"] == "Morning"

    def test_a_duplicate_is_a_conflict_not_a_server_error(
        self, client, db, td_user, td_tournament, other_user
    ):
        """Uniqueness lives in the database (a pre-check would race), so the
        route has to translate the IntegrityError — a TD dragging the same
        person twice is ordinary, not a 500."""
        grant_role(db, td_tournament, other_user, "Test Writer")
        event = _make_event(db, td_tournament)
        login(client, "td@test.com", "tdpass")
        body = dict(
            tournament_event_id=event.id,
            membership_id=_membership_id(db, td_tournament, other_user),
            role_id=_role_id(db, td_tournament, "Test Writer"),
        )

        assert _post(client, td_tournament, **body).status_code == 201
        assert _post(client, td_tournament, **body).status_code == 409
        assert db.query(TournamentEventAssignment).count() == 1

    def test_another_tournaments_event_is_not_found(
        self, client, db, td_user, td_tournament, other_tournament, other_user
    ):
        grant_role(db, td_tournament, other_user, "Test Writer")
        foreign_event = _make_event(db, other_tournament)
        login(client, "td@test.com", "tdpass")

        response = _post(
            client, td_tournament,
            tournament_event_id=foreign_event.id,
            membership_id=_membership_id(db, td_tournament, other_user),
            role_id=_role_id(db, td_tournament, "Test Writer"),
        )

        assert response.status_code == 404


class TestOverridesAreAllowed:
    """Issue #70's central rule: an assignment that contradicts what a member
    said is legal. These are warnings the board renders, never refusals."""

    def test_a_member_who_declined_the_track_can_still_be_assigned(
        self, client, db, td_user, td_tournament, other_user
    ):
        from app.models.models import TournamentMembershipTrackStatus

        grant_role(db, td_tournament, other_user, "Test Writer")
        membership_id = _membership_id(db, td_tournament, other_user)
        db.add(TournamentMembershipTrackStatus(
            membership_id=membership_id,
            track_id=primary_track_id(db, td_tournament.id),
            status="declined",
        ))
        db.commit()
        event = _make_event(db, td_tournament)
        login(client, "td@test.com", "tdpass")

        response = _post(
            client, td_tournament,
            tournament_event_id=event.id, membership_id=membership_id,
            role_id=_role_id(db, td_tournament, "Test Writer"),
        )

        assert response.status_code == 201

    def test_a_member_unavailable_for_the_shift_can_still_be_assigned(
        self, client, db, td_user, td_tournament, other_user
    ):
        grant_role(db, td_tournament, other_user, "Test Writer")
        event = _make_event(db, td_tournament)
        shift = _make_shift(db, td_tournament)
        db.add(TournamentEventShift(tournament_event_id=event.id, tournament_shift_id=shift.id))
        db.commit()
        login(client, "td@test.com", "tdpass")

        # No TournamentMembershipAvailability row for this shift at all.
        response = _post(
            client, td_tournament,
            tournament_event_id=event.id,
            membership_id=_membership_id(db, td_tournament, other_user),
            role_id=_role_id(db, td_tournament, "Test Writer"),
            tournament_shift_id=shift.id,
        )

        assert response.status_code == 201

    def test_double_booking_across_events_is_allowed(
        self, client, db, td_user, td_tournament, other_user
    ):
        grant_role(db, td_tournament, other_user, "Test Writer")
        shift = _make_shift(db, td_tournament)
        first = _make_event(db, td_tournament, name="Anatomy")
        second = _make_event(db, td_tournament, name="Astronomy")
        for event in (first, second):
            db.add(TournamentEventShift(
                tournament_event_id=event.id, tournament_shift_id=shift.id,
            ))
        db.commit()
        login(client, "td@test.com", "tdpass")

        body = dict(
            membership_id=_membership_id(db, td_tournament, other_user),
            role_id=_role_id(db, td_tournament, "Test Writer"),
            tournament_shift_id=shift.id,
        )
        assert _post(client, td_tournament, tournament_event_id=first.id, **body).status_code == 201
        assert _post(client, td_tournament, tournament_event_id=second.id, **body).status_code == 201


class TestPermissions:
    def test_manage_events_alone_can_read_but_not_write(
        self, client, db, td_tournament, other_user
    ):
        """The split: staffing is member data, seeing who is staffed is part of
        reading the event."""
        db.add(TournamentRole(
            tournament_id=td_tournament.id, label="Schedule Only",
            permissions=["manage_events"], rank=25,
        ))
        db.commit()
        grant_role(db, td_tournament, other_user, "Schedule Only")
        event = _make_event(db, td_tournament)
        login(client, "other@test.com", "otherpass")

        assert client.get(f"/tournaments/{td_tournament.id}/assignments/").status_code == 200

        response = _post(
            client, td_tournament,
            tournament_event_id=event.id,
            membership_id=_membership_id(db, td_tournament, other_user),
            role_id=_role_id(db, td_tournament, "Schedule Only"),
        )
        assert response.status_code == 403

    def test_a_plain_member_can_do_neither(self, client, db, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Volunteer")
        login(client, "other@test.com", "otherpass")

        assert client.get(f"/tournaments/{td_tournament.id}/assignments/").status_code == 403


class TestListRoute:
    def test_filters_compose_and_default_to_the_whole_tournament(
        self, client, db, td_user, td_tournament, other_user
    ):
        grant_role(db, td_tournament, other_user, "Test Writer")
        anatomy = _make_event(db, td_tournament, name="Anatomy")
        astronomy = _make_event(db, td_tournament, name="Astronomy")
        membership_id = _membership_id(db, td_tournament, other_user)
        login(client, "td@test.com", "tdpass")
        for event in (anatomy, astronomy):
            _post(
                client, td_tournament, tournament_event_id=event.id,
                membership_id=membership_id,
                role_id=_role_id(db, td_tournament, "Test Writer"),
            )

        url = f"/tournaments/{td_tournament.id}/assignments/"
        assert len(client.get(url).json()) == 2
        assert len(client.get(f"{url}?event_id={anatomy.id}").json()) == 1
        assert len(client.get(f"{url}?membership_id={membership_id}").json()) == 2


class TestUpdateAndDeleteRoutes:
    def _existing(self, client, db, tournament, user):
        grant_role(db, tournament, user, "Test Writer")
        event = _make_event(db, tournament)
        shift = _make_shift(db, tournament, label="Morning")
        db.add(TournamentEventShift(tournament_event_id=event.id, tournament_shift_id=shift.id))
        db.commit()
        created = _post(
            client, tournament, tournament_event_id=event.id,
            membership_id=_membership_id(db, tournament, user),
            role_id=_role_id(db, tournament, "Test Writer"),
            tournament_shift_id=shift.id,
        )
        return created.json(), event, shift

    def test_omitting_the_shift_leaves_it_alone(self, client, db, td_user, td_tournament, other_user):
        """Omitted and explicit-null are different requests on a nullable
        field — this is the half model_fields_set exists to protect."""
        login(client, "td@test.com", "tdpass")
        assignment, _, shift = self._existing(client, db, td_tournament, other_user)

        response = client.patch(
            f"/tournaments/{td_tournament.id}/assignments/{assignment['id']}/",
            json={"role_id": _role_id(db, td_tournament, "Test Reviewer")},
        )

        assert response.status_code == 200
        assert response.json()["role_label"] == "Test Reviewer"
        assert response.json()["shift"]["id"] == shift.id

    def test_an_explicit_null_clears_the_shift(self, client, db, td_user, td_tournament, other_user):
        login(client, "td@test.com", "tdpass")
        assignment, _, _ = self._existing(client, db, td_tournament, other_user)

        response = client.patch(
            f"/tournaments/{td_tournament.id}/assignments/{assignment['id']}/",
            json={"tournament_shift_id": None},
        )

        assert response.status_code == 200
        assert response.json()["shift"] is None

    def test_delete_removes_the_assignment_but_keeps_the_role(
        self, client, db, td_user, td_tournament, other_user
    ):
        """The grant was a fact about the member, not a detail of one
        placement — revoking it here would unstaff every other event."""
        login(client, "td@test.com", "tdpass")
        assignment, _, _ = self._existing(client, db, td_tournament, other_user)
        membership_id = _membership_id(db, td_tournament, other_user)

        response = client.delete(
            f"/tournaments/{td_tournament.id}/assignments/{assignment['id']}/"
        )

        assert response.status_code == 204
        assert db.query(TournamentEventAssignment).count() == 0
        assert db.query(TournamentMembershipRole).filter_by(
            membership_id=membership_id,
            role_id=_role_id(db, td_tournament, "Test Writer"),
        ).count() == 1

    def test_an_assignment_is_invisible_from_another_tournament(
        self, client, db, td_user, td_tournament, other_tournament, other_user
    ):
        """An assignment has no tournament_id of its own — it reaches one
        through its event — so scoping is a join, and getting it wrong would
        let an id from one tournament be edited through another."""
        login(client, "td@test.com", "tdpass")
        assignment, _, _ = self._existing(client, db, td_tournament, other_user)
        grant_role(db, other_tournament, td_user, "Tournament Director")

        response = client.delete(
            f"/tournaments/{other_tournament.id}/assignments/{assignment['id']}/"
        )

        assert response.status_code == 404
        assert db.query(TournamentEventAssignment).count() == 1


class TestAudit:
    def test_the_auto_grant_is_recorded(self, client, db, td_user, td_tournament, other_user):
        """A permission change no role_updated entry would otherwise capture."""
        from app.models.models import AuditLogEntry

        membership = TournamentMembership(
            user_id=other_user.id, tournament_id=td_tournament.id, source="manual",
        )
        db.add(membership)
        db.commit()
        event = _make_event(db, td_tournament)
        login(client, "td@test.com", "tdpass")

        _post(
            client, td_tournament, tournament_event_id=event.id,
            membership_id=membership.id,
            role_id=_role_id(db, td_tournament, "Test Writer"),
        )

        entry = (
            db.query(AuditLogEntry)
            .filter_by(tournament_id=td_tournament.id, action="assignment_created")
            .one()
        )
        assert entry.target_type == "assignment"
        assert entry.extra_data["role_granted"] is True
        assert entry.extra_data["shift_id"] is None
