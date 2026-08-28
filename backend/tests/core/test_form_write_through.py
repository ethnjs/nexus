"""Tests for app/core/form/write_through.py — the sync functions that apply
availability/lunch/track_status reserved-key answers to their structural
tables. See tests/api/test_forms.py for the route-level wiring (fires on
tournament-owned forms, no-ops on chapter-owned forms)."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.core.form.write_through import (
    can_set_track_status,
    parse_lunch_field_key,
    sync_availability,
    sync_lunch,
    sync_track_statuses,
)
from app.models.models import (
    Form,
    FormField,
    FormResponse,
    TournamentMembership,
    TournamentMembershipAvailability,
    TournamentMembershipLunch,
    TournamentMembershipTrackStatus,
    TournamentShift,
    TournamentTrack,
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
# Track statuses
# ---------------------------------------------------------------------------

class TestCanSetTrackStatus:
    """The whole rule: a track never falls back to `interested` once it's
    moved past it."""

    @pytest.mark.parametrize("incoming", ["interested", "confirmed", "declined"])
    def test_anything_may_be_set_from_unset(self, incoming):
        assert can_set_track_status(None, incoming) is True

    @pytest.mark.parametrize(
        "current,incoming",
        [
            ("interested", "interested"),
            ("interested", "confirmed"),
            ("interested", "declined"),
            ("confirmed", "confirmed"),
            ("confirmed", "declined"),
            # Someone who declined and changed their mind can still commit.
            ("declined", "confirmed"),
            ("declined", "declined"),
        ],
    )
    def test_allowed_transitions(self, current, incoming):
        assert can_set_track_status(current, incoming) is True

    @pytest.mark.parametrize("current", ["confirmed", "declined"])
    def test_nothing_falls_back_to_interested(self, current):
        assert can_set_track_status(current, "interested") is False


class TestSyncTrackStatuses:
    def _track(self, db, tournament, name="Test Writing"):
        track = TournamentTrack(tournament_id=tournament.id, name=name)
        db.add(track)
        db.flush()
        return track

    def _status(self, db, membership_id, track_id):
        row = (
            db.query(TournamentMembershipTrackStatus)
            .filter(
                TournamentMembershipTrackStatus.membership_id == membership_id,
                TournamentMembershipTrackStatus.track_id == track_id,
            )
            .one_or_none()
        )
        return row.status if row else None

    def test_insert_from_unset(self, db, td_tournament, membership):
        track = self._track(db, td_tournament)
        db.commit()

        sync_track_statuses(db, membership.id, {track.id: {"status": "interested"}})
        db.commit()

        assert self._status(db, membership.id, track.id) == "interested"

    def test_upsert_does_not_duplicate(self, db, td_tournament, membership):
        track = self._track(db, td_tournament)
        db.commit()
        sync_track_statuses(db, membership.id, {track.id: {"status": "interested"}})
        db.commit()

        sync_track_statuses(db, membership.id, {track.id: {"status": "confirmed"}})
        db.commit()

        rows = db.query(TournamentMembershipTrackStatus).filter(
            TournamentMembershipTrackStatus.membership_id == membership.id,
            TournamentMembershipTrackStatus.track_id == track.id,
        ).all()
        assert len(rows) == 1
        assert rows[0].status == "confirmed"

    def test_demotion_to_interested_is_refused(self, db, td_tournament, membership):
        """The case the rule exists for: a stale answer replayed out of order
        must not walk a confirmed track back down."""
        track = self._track(db, td_tournament)
        db.commit()
        sync_track_statuses(db, membership.id, {track.id: {"status": "confirmed"}})
        db.commit()

        sync_track_statuses(db, membership.id, {track.id: {"status": "interested"}})
        db.commit()

        assert self._status(db, membership.id, track.id) == "confirmed"

    def test_declining_a_confirmed_track_is_allowed(self, db, td_tournament, membership):
        track = self._track(db, td_tournament)
        db.commit()
        sync_track_statuses(db, membership.id, {track.id: {"status": "confirmed"}})
        db.commit()

        sync_track_statuses(db, membership.id, {track.id: {"status": "declined"}})
        db.commit()

        assert self._status(db, membership.id, track.id) == "declined"

    def _response(self, db, td_user, tournament, field_key="track_status_interest"):
        """A real Form/FormField/FormResponse trio — source_response_id and
        source_field_id are real FKs, so provenance can't be faked with
        made-up ids."""
        form = Form(
            owner_type="tournament", tournament_id=tournament.id, chapter_id=None,
            name="Track form", created_by=td_user.id,
        )
        db.add(form)
        db.flush()
        field = FormField(
            form_id=form.id, order=1, field_key=field_key, label="Interested?",
            question_type="single_select_radio", config={"required": True, "options": []},
        )
        response = FormResponse(form_id=form.id, user_id=td_user.id)
        db.add_all([field, response])
        db.flush()
        return response, field

    def _row(self, db, membership_id, track_id):
        return (
            db.query(TournamentMembershipTrackStatus)
            .filter(
                TournamentMembershipTrackStatus.membership_id == membership_id,
                TournamentMembershipTrackStatus.track_id == track_id,
            )
            .one()
        )

    def test_provenance_is_recorded(self, db, td_user, td_tournament, membership):
        track = self._track(db, td_tournament)
        response, field = self._response(db, td_user, td_tournament)
        db.commit()

        sync_track_statuses(
            db, membership.id,
            {track.id: {"status": "confirmed", "field_id": field.id}},
            response.id,
        )
        db.commit()

        row = self._row(db, membership.id, track.id)
        assert row.source_response_id == response.id
        assert row.source_field_id == field.id

    def test_a_refused_write_leaves_provenance_alone(self, db, td_user, td_tournament, membership):
        track = self._track(db, td_tournament)
        first_response, first_field = self._response(db, td_user, td_tournament)
        second_response, second_field = self._response(db, td_user, td_tournament, "track_status_later")
        db.commit()

        sync_track_statuses(
            db, membership.id,
            {track.id: {"status": "confirmed", "field_id": first_field.id}},
            first_response.id,
        )
        db.commit()

        sync_track_statuses(
            db, membership.id,
            {track.id: {"status": "interested", "field_id": second_field.id}},
            second_response.id,
        )
        db.commit()

        row = self._row(db, membership.id, track.id)
        assert row.status == "confirmed"
        assert row.source_response_id == first_response.id
        assert row.source_field_id == first_field.id

    def test_untouched_tracks_survive(self, db, td_tournament, membership):
        """Rows are shared across questions and forms — a submission only
        speaks to the tracks it named."""
        mine = self._track(db, td_tournament, "Day 1")
        theirs = self._track(db, td_tournament, "Test Writing")
        db.commit()
        sync_track_statuses(db, membership.id, {
            mine.id: {"status": "interested"},
            theirs.id: {"status": "confirmed"},
        })
        db.commit()

        sync_track_statuses(db, membership.id, {mine.id: {"status": "declined"}})
        db.commit()

        assert self._status(db, membership.id, mine.id) == "declined"
        assert self._status(db, membership.id, theirs.id) == "confirmed"

    def test_nothing_is_ever_deleted(self, db, td_tournament, membership):
        """No delete path at all — an empty intent is a no-op, not a clear."""
        track = self._track(db, td_tournament)
        db.commit()
        sync_track_statuses(db, membership.id, {track.id: {"status": "confirmed"}})
        db.commit()

        sync_track_statuses(db, membership.id, {})
        db.commit()

        assert self._status(db, membership.id, track.id) == "confirmed"


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
