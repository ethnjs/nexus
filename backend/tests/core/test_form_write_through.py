"""Tests for app/core/form/write_through.py — the diff-sync functions that
apply availability/lunch reserved-key answers to their structural tables.
See tests/api/test_forms.py for the route-level wiring (fires on
tournament-owned forms, no-ops on chapter-owned forms)."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.core.form.write_through import parse_lunch_field_key, sync_availability, sync_lunch
from app.models.models import (
    TournamentMembership,
    TournamentMembershipAvailability,
    TournamentMembershipLunch,
    TournamentShift,
)


def _make_shift(db, tournament, label="Shift"):
    shift = TournamentShift(
        tournament_id=tournament.id,
        label=label,
        start=datetime.now(timezone.utc),
        end=datetime.now(timezone.utc) + timedelta(hours=4),
    )
    db.add(shift)
    db.flush()
    return shift


@pytest.fixture
def membership(db, td_user, td_tournament):
    return (
        db.query(TournamentMembership)
        .filter(TournamentMembership.user_id == td_user.id, TournamentMembership.tournament_id == td_tournament.id)
        .first()
    )


def _availability_shift_ids(db, membership_id):
    return {
        shift_id
        for (shift_id,) in db.query(TournamentMembershipAvailability.tournament_shift_id)
        .filter(TournamentMembershipAvailability.membership_id == membership_id)
        .all()
    }


def _lunch_rows(db, membership_id, lunch_date, category):
    return (
        db.query(TournamentMembershipLunch)
        .filter(
            TournamentMembershipLunch.membership_id == membership_id,
            TournamentMembershipLunch.date == lunch_date,
            TournamentMembershipLunch.category == category,
        )
        .all()
    )


# ---------------------------------------------------------------------------
# sync_availability
# ---------------------------------------------------------------------------

class TestSyncAvailability:
    def test_insert_only(self, db, td_tournament, membership):
        s1 = _make_shift(db, td_tournament, "Morning")
        s2 = _make_shift(db, td_tournament, "Afternoon")
        db.commit()

        sync_availability(db, membership.id, {s1.id, s2.id}, {s1.id, s2.id})
        db.commit()

        assert _availability_shift_ids(db, membership.id) == {s1.id, s2.id}

    def test_delete_only(self, db, td_tournament, membership):
        s1 = _make_shift(db, td_tournament, "Morning")
        s2 = _make_shift(db, td_tournament, "Afternoon")
        db.commit()
        sync_availability(db, membership.id, {s1.id, s2.id}, {s1.id, s2.id})
        db.commit()

        sync_availability(db, membership.id, set(), {s1.id, s2.id})
        db.commit()

        assert _availability_shift_ids(db, membership.id) == set()

    def test_mixed_diff(self, db, td_tournament, membership):
        s1 = _make_shift(db, td_tournament, "Morning")
        s2 = _make_shift(db, td_tournament, "Afternoon")
        s3 = _make_shift(db, td_tournament, "Evening")
        owned = {s1.id, s2.id, s3.id}
        db.commit()
        sync_availability(db, membership.id, {s1.id, s2.id}, owned)
        db.commit()

        # Drop s1, keep s2, add s3.
        sync_availability(db, membership.id, {s2.id, s3.id}, owned)
        db.commit()

        assert _availability_shift_ids(db, membership.id) == {s2.id, s3.id}

    def test_resync_with_same_ids_is_a_noop(self, db, td_tournament, membership):
        s1 = _make_shift(db, td_tournament, "Morning")
        db.commit()
        sync_availability(db, membership.id, {s1.id}, {s1.id})
        db.commit()

        sync_availability(db, membership.id, {s1.id}, {s1.id})
        db.commit()

        assert _availability_shift_ids(db, membership.id) == {s1.id}

    def test_shifts_outside_the_owned_set_survive(self, db, td_tournament, membership):
        """The boundary is the day, not the answer: a shift this submission
        didn't ask about belongs to another day's question and stays put."""
        mine = _make_shift(db, td_tournament, "Saturday")
        theirs = _make_shift(db, td_tournament, "Sunday")
        db.commit()
        sync_availability(db, membership.id, {mine.id, theirs.id}, {mine.id, theirs.id})
        db.commit()

        # Answer only the day `mine` falls on, selecting nothing.
        sync_availability(db, membership.id, set(), {mine.id})
        db.commit()

        assert _availability_shift_ids(db, membership.id) == {theirs.id}


# ---------------------------------------------------------------------------
# sync_lunch
# ---------------------------------------------------------------------------

class TestSyncLunch:
    LUNCH_DATE = date(2027, 2, 13)

    def test_insert_only(self, db, membership):
        sync_lunch(
            db, membership.id, self.LUNCH_DATE, "protein",
            [{"value": "chicken", "label": "Chicken"}, {"value": "tofu", "label": "Tofu"}],
        )
        db.commit()

        rows = _lunch_rows(db, membership.id, self.LUNCH_DATE, "protein")
        assert {row.value for row in rows} == {"chicken", "tofu"}

    def test_delete_only(self, db, membership):
        sync_lunch(db, membership.id, self.LUNCH_DATE, "protein", [{"value": "chicken", "label": "Chicken"}])
        db.commit()

        sync_lunch(db, membership.id, self.LUNCH_DATE, "protein", [])
        db.commit()

        assert _lunch_rows(db, membership.id, self.LUNCH_DATE, "protein") == []

    def test_mixed_diff(self, db, membership):
        sync_lunch(
            db, membership.id, self.LUNCH_DATE, "protein",
            [{"value": "chicken", "label": "Chicken"}, {"value": "tofu", "label": "Tofu"}],
        )
        db.commit()

        # Drop chicken, keep tofu, add beef.
        sync_lunch(
            db, membership.id, self.LUNCH_DATE, "protein",
            [{"value": "tofu", "label": "Tofu"}, {"value": "beef", "label": "Beef"}],
        )
        db.commit()

        rows = _lunch_rows(db, membership.id, self.LUNCH_DATE, "protein")
        assert {row.value for row in rows} == {"tofu", "beef"}

    def test_category_isolation(self, db, membership):
        """Syncing one category never touches another category's rows for
        the same membership/date."""
        sync_lunch(db, membership.id, self.LUNCH_DATE, "protein", [{"value": "chicken", "label": "Chicken"}])
        sync_lunch(db, membership.id, self.LUNCH_DATE, "drink", [{"value": "water", "label": "Water"}])
        db.commit()

        # Resync protein down to empty — drink must survive untouched.
        sync_lunch(db, membership.id, self.LUNCH_DATE, "protein", [])
        db.commit()

        assert _lunch_rows(db, membership.id, self.LUNCH_DATE, "protein") == []
        drink_rows = _lunch_rows(db, membership.id, self.LUNCH_DATE, "drink")
        assert {row.value for row in drink_rows} == {"water"}

    def test_date_isolation(self, db, membership):
        """Same category, different date — also isolated."""
        other_date = date(2027, 2, 14)
        sync_lunch(db, membership.id, self.LUNCH_DATE, "protein", [{"value": "chicken", "label": "Chicken"}])
        sync_lunch(db, membership.id, other_date, "protein", [{"value": "tofu", "label": "Tofu"}])
        db.commit()

        sync_lunch(db, membership.id, self.LUNCH_DATE, "protein", [])
        db.commit()

        assert _lunch_rows(db, membership.id, self.LUNCH_DATE, "protein") == []
        other_rows = _lunch_rows(db, membership.id, other_date, "protein")
        assert {row.value for row in other_rows} == {"tofu"}


# ---------------------------------------------------------------------------
# parse_lunch_field_key
# ---------------------------------------------------------------------------

class TestParseLunchFieldKey:
    def test_splits_date_and_category(self):
        lunch_date, category = parse_lunch_field_key("lunch_20270213_protein")
        assert lunch_date == date(2027, 2, 13)
        assert category == "protein"

    def test_multi_word_category(self):
        lunch_date, category = parse_lunch_field_key("lunch_20270213_main_course")
        assert lunch_date == date(2027, 2, 13)
        assert category == "main_course"
