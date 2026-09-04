"""Tests for /tournaments/{tournament_id}/memberships endpoints."""
from datetime import date, datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from app.core.tournament.display_config import MEMBERS_PANEL
from app.core.tournament.permissions import MANAGE_MEMBERS
from app.models.models import (
    Form, FormAnswer, FormField, FormResponse,
    TournamentMembership, TournamentMembershipRole, TournamentRole,
)
from tests.conftest import grant_role, login, primary_track_id, set_display_config


def get_role_id_by_label(db, tournament_id: int, label: str) -> int:
    return (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament_id, TournamentRole.label == label)
        .first()
        .id
    )


def _make_user(db, email="alice@example.com", first_name="Alice", last_name="Smith"):
    """Create a user directly in the DB — bypasses the admin-only POST /users/ route."""
    from app.models.models import User as UserModel
    user = UserModel(first_name=first_name, last_name=last_name, email=email)
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "email": user.email}


def _db_user_for_filter(db, email):
    """The ORM row, unlike _make_user's dict — grant_role and _make_membership
    both want the object."""
    from app.models.models import User as UserModel
    user = UserModel(first_name="Test", last_name="Member", email=email)
    db.add(user)
    db.flush()
    return user


def _make_event(client, tournament_id):
    return client.post(f"/tournaments/{tournament_id}/events/", json={
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
    }).json()


def _make_membership(db, tournament_id, user_id, **overrides):
    """Create a membership directly in the DB — memberships are created via
    join codes or sync now, there's no manual-create route anymore."""
    defaults = {"user_id": user_id, "tournament_id": tournament_id, "source": "manual"}
    defaults.update(overrides)
    membership = TournamentMembership(**defaults)
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return membership


def _make_form(db, user, tournament_id, **overrides):
    defaults = dict(
        owner_type="tournament", tournament_id=tournament_id, chapter_id=None,
        name="Test form", title="Test form", status="published", created_by=user.id,
    )
    defaults.update(overrides)
    form = Form(**defaults)
    db.add(form)
    db.flush()
    return form


def _make_field(db, form, *, order=1, field_key="favorite_color", question_type="single_select_dropdown", **overrides):
    defaults = dict(
        form_id=form.id, order=order, label="Favorite color", question_type=question_type,
        field_key=field_key, config={"required": False, "options": []},
    )
    defaults.update(overrides)
    field = FormField(**defaults)
    db.add(field)
    db.flush()
    return field


def _make_answer(db, user_id, form, field, value):
    response = FormResponse(form_id=form.id, user_id=user_id)
    db.add(response)
    db.flush()
    answer = FormAnswer(response_id=response.id, field_id=field.id, value=value)
    db.add(answer)
    db.commit()
    return answer


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def test_list_memberships(client, td_user, td_tournament, db):
    u1 = _make_user(db, "alice@example.com")
    u2 = _make_user(db, "bob@example.com")
    _make_membership(db, td_tournament.id, u1["id"])
    _make_membership(db, td_tournament.id, u2["id"])
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/")
    assert response.status_code == 200
    # td_user's own membership (from tournament creation) + the two above
    assert len(response.json()) >= 2


# ---------------------------------------------------------------------------
# `fields` — the query param that replaced the second response schema
# ---------------------------------------------------------------------------

def test_fields_narrows_to_the_named_groups(client, td_user, td_tournament, db):
    """A role picker wants a name and an email. It should not have to accept a
    whole profile plus every onboarding answer to get them."""
    u = _make_user(db, "alice@example.com")
    _make_membership(db, td_tournament.id, u["id"], notes="Allergic to nuts")
    login(client, "td@test.com", "tdpass")

    url = f"/tournaments/{td_tournament.id}/members/?fields=contact"
    row = next(r for r in client.get(url).json() if r["user"]["id"] == u["id"])

    assert row["user"]["email"] == u["email"]
    # Identity is not a group — it comes without being asked for.
    assert row["user"]["first_name"] == "Alice"
    assert row["id"] and row["created_at"]
    # Everything else is absent, not null.
    for key in ("notes", "roles", "lunch", "availability", "track_statuses",
                "event_preferences", "custom_responses", "source", "join_code"):
        assert key not in row, f"{key} should be absent without its group"
    for key in ("shirt_size", "volunteer_experience", "university"):
        assert key not in row["user"]


def test_empty_fields_returns_identity_only(client, td_user, td_tournament, db):
    """Distinct from omitting the param: an explicit empty value is a caller
    saying it needs nothing but the row's identity."""
    u = _make_user(db, "alice@example.com")
    _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")

    url = f"/tournaments/{td_tournament.id}/members/?fields="
    row = next(r for r in client.get(url).json() if r["user"]["id"] == u["id"])
    assert row["user"]["first_name"] == "Alice"
    assert "email" not in row["user"]
    assert "roles" not in row


def test_omitting_fields_still_returns_everything(client, td_user, td_tournament, db):
    """A caller with no opinion is never punished with a surprise-empty
    response — that would make `fields` a breaking change for every existing
    client."""
    u = _make_user(db, "alice@example.com")
    _make_membership(db, td_tournament.id, u["id"], notes="Allergic to nuts")
    login(client, "td@test.com", "tdpass")

    row = next(
        r for r in client.get(f"/tournaments/{td_tournament.id}/members/").json()
        if r["user"]["id"] == u["id"]
    )
    for key in ("notes", "roles", "lunch", "availability", "track_statuses",
                "event_preferences", "custom_responses", "source", "user"):
        assert key in row


def test_unknown_field_group_is_rejected(client, td_user, td_tournament, db):
    """A typo must fail loudly — a silently dropped section is indistinguishable
    from a member having no data."""
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/?fields=contact,rolez")
    assert response.status_code == 422
    assert "rolez" in response.json()["detail"]


def test_fields_applies_to_the_detail_route_too(client, td_user, td_tournament, db):
    """Same contract on one row as on the roster — one serializer, not two."""
    u = _make_user(db, "alice@example.com")
    m = _make_membership(db, td_tournament.id, u["id"], notes="Allergic to nuts")
    login(client, "td@test.com", "tdpass")

    body = client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/?fields=notes"
    ).json()
    assert body["notes"] == "Allergic to nuts"
    assert "lunch" not in body
    assert "email" not in body["user"]


def test_fields_on_me_skips_the_builders(client, td_tournament, other_user, db):
    """The provider that wraps every dashboard page reads four fields. Asking
    for roles must not run the track/lunch/event-preference/custom builders."""
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "other@test.com", "otherpass")

    body = client.get(f"/tournaments/{td_tournament.id}/members/me/?fields=roles").json()
    # Identity is never in a group — this is exactly what the provider reads.
    assert body["id"]
    # Volunteer grants none, but the key is always there — the provider
    # branches on it, so an absent key would break hasPermission().
    assert body["permissions"] == []
    assert body["is_owner"] is False
    assert body["needs_age_consent"] is False
    assert [r["label"] for r in body["roles"]] == ["Volunteer"]
    for key in ("lunch", "availability", "track_statuses", "event_preferences",
                "custom_responses"):
        assert key not in body


def test_explicit_fields_wins_over_the_surface_preset(client, td_user, td_tournament, db):
    """`surface` only fills in for a caller with no preference. Unioning the
    two would make narrowing unpredictable."""
    u = _make_user(db, "alice@example.com")
    _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")

    # members_table's defaults imply contact + membership + roles.
    url = f"/tournaments/{td_tournament.id}/members/?surface=members_table&fields=notes"
    row = next(r for r in client.get(url).json() if r["user"]["id"] == u["id"])
    assert "notes" in row
    assert "roles" not in row
    assert "email" not in row["user"]


def test_list_memberships_roster_shape(client, td_user, td_tournament, db):
    """Roster and detail are one schema now. The route is manage_members-only,
    so the staff-side fields are part of the row rather than a reason for a
    second, narrower response class — what a caller does not want, it leaves
    out of `fields`."""
    u = _make_user(db, "alice@example.com")
    _make_membership(db, td_tournament.id, u["id"], notes="Allergic to nuts")
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/")
    assert response.status_code == 200
    row = next(m for m in response.json() if m["user"]["id"] == u["id"])
    assert row["user"]["email"] == u["email"]
    assert row["roles"] == []
    assert row["notes"] == "Allergic to nuts"


def test_list_memberships_includes_track_statuses(client, td_user, td_tournament, db):
    """3.5 — the roster table's Tracks column reads off the same list
    response, not a per-row detail fetch."""
    from app.models.models import TournamentTrack, TournamentMembershipTrackStatus

    u = _make_user(db, "alice@example.com")
    m = _make_membership(db, td_tournament.id, u["id"])
    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    db.add(track)
    db.flush()
    db.add(TournamentMembershipTrackStatus(membership_id=m.id, track_id=track.id, status="confirmed"))
    db.commit()

    login(client, "td@test.com", "tdpass")
    row = next(r for r in client.get(f"/tournaments/{td_tournament.id}/members/").json() if r["id"] == m.id)
    assert row["track_statuses"] == [{
        "track_id": track.id, "name": "Test Writing", "is_archived": False,
        "status": "confirmed", "allow_confirm": False,
        "updated_at": row["track_statuses"][0]["updated_at"],
    }]


def test_list_memberships_applies_the_requested_surface_config(client, td_user, td_tournament, db):
    """The roster renders the members *table* surface, so that's the config it
    honours — the panel's own hidden set is a separate surface now that each
    has its own controls.

    Also pins how `fields` and `surface` compose: the track column is what
    makes the tracks group requested at all, and `hidden` then empties it. A
    present-but-empty list is filtering; an absent key would mean the group
    was never asked for."""
    from app.models.models import TournamentTrack, TournamentMembershipTrackStatus

    u = _make_user(db, "alice@example.com")
    m = _make_membership(db, td_tournament.id, u["id"])
    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    db.add(track)
    db.flush()
    db.add(TournamentMembershipTrackStatus(membership_id=m.id, track_id=track.id, status="confirmed"))
    set_display_config(db, td_tournament, td_user, {"members_table": {
        "columns": [f"track:{track.id}"], "hidden": [f"track:{track.id}"],
    }})

    login(client, "td@test.com", "tdpass")
    url = f"/tournaments/{td_tournament.id}/members/?surface=members_table"
    row = next(r for r in client.get(url).json() if r["id"] == m.id)
    assert row["track_statuses"] == []


def test_list_memberships_without_a_surface_is_unfiltered(client, td_user, td_tournament, db):
    """No surface means no opinion — the caller gets the plain roster rather
    than some surface's filtering applied by default."""
    from app.models.models import TournamentTrack, TournamentMembershipTrackStatus

    u = _make_user(db, "alice@example.com")
    m = _make_membership(db, td_tournament.id, u["id"])
    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    db.add(track)
    db.flush()
    db.add(TournamentMembershipTrackStatus(membership_id=m.id, track_id=track.id, status="confirmed"))
    set_display_config(db, td_tournament, td_user, {"members_table": {"hidden": [f"track:{track.id}"]}})

    login(client, "td@test.com", "tdpass")
    row = next(r for r in client.get(f"/tournaments/{td_tournament.id}/members/").json() if r["id"] == m.id)
    assert [t["track_id"] for t in row["track_statuses"]] == [track.id]


def test_list_memberships_enriches_only_configured_columns(client, td_user, td_tournament, db):
    """Column data is loaded only when a column asks for it — a roster is
    every member, so loading lunch/availability nobody turned on would cost
    on every page load.

    `surface` resolves to the field groups its saved columns need (see
    fields_for_surface), so a group no column reads is absent from the row
    rather than empty: [] would claim this member has no lunch answers, and
    they have one."""
    from app.models.models import TournamentMembershipLunch

    u = _make_user(db, "alice@example.com")
    m = _make_membership(db, td_tournament.id, u["id"])
    db.add(TournamentMembershipLunch(
        membership_id=m.id, track_id=primary_track_id(db, td_tournament.id), category="entree", value="pizza", label="Pizza",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")

    url = f"/tournaments/{td_tournament.id}/members/?surface=members_table"
    row = next(r for r in client.get(url).json() if r["id"] == m.id)
    assert "lunch" not in row

    set_display_config(db, td_tournament, td_user, {"members_table": {"columns": [
        f"lunch:{primary_track_id(db, td_tournament.id)}:entree",
    ]}})
    row = next(r for r in client.get(url).json() if r["id"] == m.id)
    assert [entry["value"] for entry in row["lunch"]] == ["pizza"]


def test_availability_column_carries_shifts_with_their_local_day(client, td_user, td_tournament, db):
    """The table shows a badge per shift, so the rows carry the shifts
    themselves — each tagged with the tournament-local day its column keys by,
    resolved server-side rather than from the instant in the browser."""
    from app.models.models import TournamentMembershipAvailability, TournamentShift

    u = _make_user(db, "alice@example.com")
    m = _make_membership(db, td_tournament.id, u["id"])
    shift = TournamentShift(tournament_id=td_tournament.id, track_id=primary_track_id(db, td_tournament.id), label="Morning",
        start=datetime(2026, 3, 1, 15, 0, tzinfo=timezone.utc),
        end=datetime(2026, 3, 1, 19, 0, tzinfo=timezone.utc),
    )
    db.add(shift)
    db.flush()
    db.add(TournamentMembershipAvailability(membership_id=m.id, tournament_shift_id=shift.id))
    set_display_config(
        db, td_tournament, td_user, {"members_table": {"columns": [
            f"availability_track:{primary_track_id(db, td_tournament.id)}",
        ]}},
    )

    login(client, "td@test.com", "tdpass")
    url = f"/tournaments/{td_tournament.id}/members/?surface=members_table"
    row = next(r for r in client.get(url).json() if r["id"] == m.id)
    assert row["availability"] == [
        {
            "shift_id": shift.id, "track_id": shift.track_id,
            "label": "Morning", "day": "2026-03-01",
            "start": "2026-03-01T15:00:00Z", "end": "2026-03-01T19:00:00Z",
        },
    ]


def test_list_memberships_age_column_still_respects_consent(client, td_user, td_tournament, db):
    """Turning the Age column on cannot override a member's withheld
    consent — display config is not a second privacy mechanism."""
    from app.models.models import User

    u = _make_user(db, "alice@example.com")
    m = _make_membership(db, td_tournament.id, u["id"])
    # is_over_18 is derived from date_of_birth, not stored — so give them one.
    db.query(User).filter(User.id == u["id"]).one().date_of_birth = date(1990, 1, 1)
    m.age_disclosure = None
    td_tournament.collect_is_over_18 = True
    db.commit()
    set_display_config(db, td_tournament, td_user, {"members_table": {"columns": ["age"]}})

    login(client, "td@test.com", "tdpass")
    url = f"/tournaments/{td_tournament.id}/members/?surface=members_table"
    row = next(r for r in client.get(url).json() if r["id"] == m.id)
    assert "is_over_18" not in row


class TestRosterFilters:
    """Filters match against data the roster response doesn't carry, so they
    run in SQL. Different filters AND; values within one OR."""

    def _roster(self, client, tournament_id, query=""):
        res = client.get(f"/tournaments/{tournament_id}/members/{query}")
        assert res.status_code == 200, res.json()
        return {r["user"]["email"] for r in res.json()}

    def test_role_filter_matches_any_named_role(self, client, db, td_user, td_tournament):
        from tests.conftest import grant_role

        alice = _db_user_for_filter(db, "alice@example.com")
        bob = _db_user_for_filter(db, "bob@example.com")
        volunteer = grant_role(db, td_tournament, alice, "Volunteer")
        grant_role(db, td_tournament, bob, "Runner")
        db.commit()

        login(client, "td@test.com", "tdpass")
        role_id = volunteer.roles[0].role_id
        assert self._roster(client, td_tournament.id, f"?role={role_id}") == {"alice@example.com"}

    def test_role_filter_none_finds_members_without_roles(self, client, db, td_user, td_tournament):
        from tests.conftest import grant_role

        grant_role(db, td_tournament, _db_user_for_filter(db, "alice@example.com"), "Volunteer")
        _make_membership(db, td_tournament.id, _db_user_for_filter(db, "bob@example.com").id)
        db.commit()

        login(client, "td@test.com", "tdpass")
        assert "bob@example.com" in self._roster(client, td_tournament.id, "?role=none")
        assert "alice@example.com" not in self._roster(client, td_tournament.id, "?role=none")

    def test_track_filter_pairs_track_with_status(self, client, db, td_user, td_tournament):
        """A member confirmed on one track and declined on another must not
        match "declined on the first" — which is why the pair travels together."""
        from app.models.models import TournamentMembershipTrackStatus, TournamentTrack

        writing = TournamentTrack(tournament_id=td_tournament.id, name="Writing")
        running = TournamentTrack(tournament_id=td_tournament.id, name="Running")
        db.add_all([writing, running])
        db.flush()
        alice = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id)
        db.add_all([
            TournamentMembershipTrackStatus(membership_id=alice.id, track_id=writing.id, status="confirmed"),
            TournamentMembershipTrackStatus(membership_id=alice.id, track_id=running.id, status="declined"),
        ])
        db.commit()

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, f"?track={writing.id}:confirmed") == {"alice@example.com"}
        assert self._roster(client, td_tournament.id, f"?track={writing.id}:declined") == set()

    def test_filters_of_different_kinds_and_together(self, client, db, td_user, td_tournament):
        from app.models.models import TournamentMembershipLunch, TournamentMembershipTrackStatus, TournamentTrack

        track = TournamentTrack(tournament_id=td_tournament.id, name="Writing")
        db.add(track)
        db.flush()
        alice = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id)
        bob = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "bob@example.com").id)
        db.add_all([
            TournamentMembershipTrackStatus(membership_id=alice.id, track_id=track.id, status="confirmed"),
            TournamentMembershipTrackStatus(membership_id=bob.id, track_id=track.id, status="confirmed"),
            TournamentMembershipLunch(
                membership_id=alice.id, track_id=primary_track_id(db, td_tournament.id), category="entree", value="pizza", label="Pizza",
            ),
        ])
        db.commit()

        login(client, "td@test.com", "tdpass")
        both = f"?track={track.id}:confirmed&lunch=entree:pizza"
        assert self._roster(client, td_tournament.id, both) == {"alice@example.com"}

    def test_malformed_pair_is_ignored_not_fatal(self, client, td_user, td_tournament):
        """A bad value off a stale bookmark shouldn't 422 the roster — that
        leaves a TD staring at an error with no way to clear it."""
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/tournaments/{td_tournament.id}/members/?track=nonsense")
        assert res.status_code == 200

    def test_age_filter_respects_consent_and_collection(self, client, db, td_user, td_tournament):
        """A member who never consented must not appear in a 21+ list. Their
        presence would reveal the flag as surely as printing it — and the row
        would render "21+ Unknown", since the response omits the value."""
        from app.models.models import User as UserModel

        consented = _db_user_for_filter(db, "consented@example.com")
        withheld = _db_user_for_filter(db, "withheld@example.com")
        for user in (consented, withheld):
            db.query(UserModel).filter(UserModel.id == user.id).one().date_of_birth = date(1980, 1, 1)
        yes = _make_membership(db, td_tournament.id, consented.id)
        no = _make_membership(db, td_tournament.id, withheld.id)
        yes.age_disclosure = "consented"
        no.age_disclosure = None
        td_tournament.collect_is_over_21 = True
        db.commit()

        login(client, "td@test.com", "tdpass")
        emails = self._roster(client, td_tournament.id, "?age=over_21")
        assert "consented@example.com" in emails
        assert "withheld@example.com" not in emails

    def test_age_filter_ignores_a_flag_the_tournament_does_not_collect(self, client, db, td_user, td_tournament):
        from app.models.models import User as UserModel

        user = _db_user_for_filter(db, "adult@example.com")
        db.query(UserModel).filter(UserModel.id == user.id).one().date_of_birth = date(1980, 1, 1)
        m = _make_membership(db, td_tournament.id, user.id)
        m.age_disclosure = "consented"
        td_tournament.collect_is_over_18 = False
        db.commit()

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, "?age=over_18") == set()

    def test_filter_options_lists_what_the_tournament_holds(self, client, db, td_user, td_tournament):
        from app.models.models import TournamentMembershipLunch, TournamentTrack

        db.add(TournamentTrack(tournament_id=td_tournament.id, name="Writing"))
        m = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id)
        db.add(TournamentMembershipLunch(
            membership_id=m.id, track_id=primary_track_id(db, td_tournament.id), category="entree", value="pizza", label="Pizza",
        ))
        db.commit()

        login(client, "td@test.com", "tdpass")
        body = client.get(f"/tournaments/{td_tournament.id}/members/filter-options/").json()
        # "Main" is the fixture's primary track — every tournament has one.
        assert [t["label"] for t in body["tracks"]] == ["Main", "Writing"]
        # Lunch comes back grouped by category: the modal adds the category
        # as a chip and narrows it from that chip's pill. Answered/not
        # answered aren't options — they're the pill's own toggle.
        entree = next(g for g in body["lunch_categories"] if g["value"] == "entree")
        assert entree["label"] == "Entree"
        assert [o["value"] for o in entree["options"]] == ["pizza"]
        assert body["collect_is_over_18"] is False

    def test_lunch_options_come_from_the_question_not_the_answers(self, client, db, td_user, td_tournament):
        """A choice nobody picked is still offerable — that's how a TD finds
        who didn't pick it."""
        from app.models.models import Form, FormField

        form = Form(owner_type="tournament", tournament_id=td_tournament.id, name="Signup", created_by=td_user.id)
        db.add(form)
        db.flush()
        db.add(FormField(
            form_id=form.id, order=0, label="Protein", field_key=f"lunch_{primary_track_id(db, td_tournament.id)}_protein",
            question_type="single_select_radio",
            config={"options": [
                {"option_id": "opt_1", "value": "Sofritas", "label": "Sofritas"},
                {"option_id": "opt_2", "value": "Chicken", "label": "Chicken", "is_archived": True},
            ]},
        ))
        db.commit()

        login(client, "td@test.com", "tdpass")
        body = client.get(f"/tournaments/{td_tournament.id}/members/filter-options/").json()
        protein = next(g for g in body["lunch_categories"] if g["value"] == "protein")
        assert [o["value"] for o in protein["options"]] == ["Sofritas"]

    def test_lunch_any_and_unanswered_split_on_a_stored_row(self, client, db, td_user, td_tournament):
        """"Answered" and "not answered" are the whole point of the sentinels:
        a free-text lunch question has no options to name."""
        from app.models.models import TournamentMembershipLunch

        alice = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id)
        _make_membership(db, td_tournament.id, _db_user_for_filter(db, "bob@example.com").id)
        db.add(TournamentMembershipLunch(
            membership_id=alice.id, track_id=primary_track_id(db, td_tournament.id), category="dietary", value="none", label="none",
        ))
        db.commit()

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, "?lunch=dietary:__any__") == {"alice@example.com"}
        assert self._roster(client, td_tournament.id, "?lunch=dietary:__unanswered__") == {
            "bob@example.com", "td@test.com",
        }
        # "none" is an answer; a missing row is not the same as answering none.
        assert self._roster(client, td_tournament.id, "?lunch=dietary:__none__") == {"alice@example.com"}
        assert self._roster(client, td_tournament.id, "?lunch=dietary:__not_none__") == set()

    def test_track_any_status_matches_any_answer(self, client, db, td_user, td_tournament):
        from app.models.models import TournamentMembershipTrackStatus, TournamentTrack

        track = TournamentTrack(tournament_id=td_tournament.id, name="Writing")
        db.add(track)
        db.flush()
        alice = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id)
        db.add(TournamentMembershipTrackStatus(membership_id=alice.id, track_id=track.id, status="declined"))
        db.commit()

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, f"?track={track.id}:__any__") == {"alice@example.com"}

    def test_shift_filter_takes_a_track_or_one_shift(self, client, db, td_user, td_tournament):
        """A track-level value resolves to every shift on that track. Was
        day-level, which couldn't separate two sites running the same day."""
        from datetime import datetime, timezone as dt_timezone
        from app.models.models import TournamentMembershipAvailability, TournamentShift

        track_id = primary_track_id(db, td_tournament.id)
        morning = TournamentShift(tournament_id=td_tournament.id, track_id=track_id, label="Impound",
            start=datetime(2026, 5, 21, 15, 0, tzinfo=dt_timezone.utc),
            end=datetime(2026, 5, 21, 17, 0, tzinfo=dt_timezone.utc),
        )
        db.add(morning)
        db.flush()
        alice = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id)
        _make_membership(db, td_tournament.id, _db_user_for_filter(db, "bob@example.com").id)
        db.add(TournamentMembershipAvailability(membership_id=alice.id, tournament_shift_id=morning.id))
        db.commit()

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, f"?shift={track_id}:{morning.id}") == {"alice@example.com"}
        assert self._roster(client, td_tournament.id, f"?shift={track_id}:__any__") == {"alice@example.com"}


def test_list_memberships_requires_manage_members(
    client, td_user, other_tournament, db
):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/members/"
    ).status_code == 403


def test_list_memberships_no_membership_in_tournament(client, td_user):
    """Membership existence check fires before permission — 404, not 403, so
    a tournament the user isn't in never leaks its existence."""
    login(client, "td@test.com", "tdpass")
    assert client.get("/tournaments/9999/members/").status_code == 404


def test_list_memberships_excludes_declined_by_default(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "td@test.com", "tdpass")
    ids = [m["id"] for m in client.get(f"/tournaments/{td_tournament.id}/members/").json()]
    assert membership.id not in ids


def test_list_memberships_includes_declined_when_opted_in(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/?include_declined=true")
    row = next(m for m in response.json() if m["id"] == membership.id)
    assert row["age_disclosure"] == "declined"


def test_search_memberships_excludes_declined(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "td@test.com", "tdpass")
    ids = [m["id"] for m in client.get(f"/tournaments/{td_tournament.id}/members/").json()]
    assert membership.id not in ids


def test_list_memberships_includes_roles(client, td_user, td_tournament, db):
    """Roles are unwrapped from TournamentMembershipRole to RoleRead in the slim response too."""
    from app.models.models import User as UserModel
    u = _make_user(db, "coach@example.com")
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    membership = grant_role(db, td_tournament, user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/")
    assert response.status_code == 200
    row = next(m for m in response.json() if m["id"] == membership.id)
    assert [r["label"] for r in row["roles"]] == ["Volunteer"]


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/members/?q=&role_id=&exclude_role_id=
# manage_members. The role pickers: the same roster route, narrowed. There is
# no separate search endpoint — it only ever existed because the roster
# returned too much, which `fields` now answers.
# ---------------------------------------------------------------------------

def test_the_search_route_is_gone(client, td_user, td_tournament):
    """Pinned so the route can't quietly come back the next time a screen
    wants a narrower list.

    422 rather than 404: with no literal /search/ route left, the path falls
    through to /{membership_id}/ and "search" fails to coerce to an int. The
    point is that it no longer returns a member list."""
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/search/")
    assert response.status_code == 422


def test_search_params_combine_with_roster_filters(client, td_user, td_tournament, db):
    """The point of folding the two routes together: a name search and a
    member-data filter are now expressible in one request, which they never
    were while they lived on separate endpoints."""
    from app.models.models import TournamentTrack, TournamentMembershipTrackStatus

    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    db.add(track)
    db.flush()
    for email, first, confirmed in [
        ("ana@example.com", "Ana", True),
        ("anil@example.com", "Anil", False),
        ("bea@example.com", "Bea", True),
    ]:
        u = _make_user(db, email, first_name=first)
        m = _make_membership(db, td_tournament.id, u["id"])
        if confirmed:
            db.add(TournamentMembershipTrackStatus(
                membership_id=m.id, track_id=track.id, status="confirmed",
            ))
    db.commit()

    login(client, "td@test.com", "tdpass")
    url = f"/tournaments/{td_tournament.id}/members/?q=an&track={track.id}:confirmed"
    names = sorted(r["user"]["first_name"] for r in client.get(url).json())
    assert names == ["Ana"]


def test_search_memberships_by_name(client, td_user, td_tournament, db):
    zed = _make_user(db, "zed@example.com", first_name="Zed", last_name="Zephyr")
    priya = _make_user(db, "priya@example.com", first_name="Priya", last_name="Patel")
    _make_membership(db, td_tournament.id, zed["id"])
    _make_membership(db, td_tournament.id, priya["id"])
    login(client, "td@test.com", "tdpass")

    response = client.get(f"/tournaments/{td_tournament.id}/members/?q=Priya")
    assert response.status_code == 200
    emails = [m["user"]["email"] for m in response.json()]
    assert emails == ["priya@example.com"]


def test_search_memberships_by_email(client, td_user, td_tournament, db):
    zed = _make_user(db, "zed@example.com", first_name="Zed", last_name="Zephyr")
    priya = _make_user(db, "priya@example.com", first_name="Priya", last_name="Patel")
    _make_membership(db, td_tournament.id, zed["id"])
    _make_membership(db, td_tournament.id, priya["id"])
    login(client, "td@test.com", "tdpass")

    response = client.get(f"/tournaments/{td_tournament.id}/members/?q=zed@example")
    assert response.status_code == 200
    emails = [m["user"]["email"] for m in response.json()]
    assert emails == ["zed@example.com"]


def test_search_memberships_by_role_id(client, td_user, td_tournament, db):
    from app.models.models import User as UserModel
    u = _make_user(db, "coach@example.com")
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    grant_role(db, td_tournament, user, "Volunteer")
    login(client, "td@test.com", "tdpass")

    role_id = get_role_id_by_label(db, td_tournament.id, "Volunteer")
    response = client.get(f"/tournaments/{td_tournament.id}/members/?role_id={role_id}")
    assert response.status_code == 200
    emails = [m["user"]["email"] for m in response.json()]
    assert emails == ["coach@example.com"]


def test_search_memberships_exclude_role_id(client, td_user, td_tournament, db):
    """td_user already holds Tournament Director from the fixture — excluding
    that role should drop them from the results."""
    role_id = get_role_id_by_label(db, td_tournament.id, "Tournament Director")
    login(client, "td@test.com", "tdpass")

    response = client.get(f"/tournaments/{td_tournament.id}/members/?exclude_role_id={role_id}")
    assert response.status_code == 200
    emails = [m["user"]["email"] for m in response.json()]
    assert "td@test.com" not in emails


def test_search_memberships_no_filters_returns_all(client, td_user, td_tournament, db):
    zed = _make_user(db, "zed@example.com")
    _make_membership(db, td_tournament.id, zed["id"])
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/")
    assert response.status_code == 200
    assert len(response.json()) >= 2


def test_search_memberships_max_rank_excludes_equal_and_higher_authority(
    client, td_user, td_tournament, db
):
    """max_rank powers the "who can this actor act on" pickers. Rank is
    authority-ascending-numeric (lower number = more authority), so a member is
    kept only if their strongest role is strictly *less* authoritative than
    max_rank — an equal rank ties, and a tie must not be actionable."""
    from app.models.models import User as UserModel

    td_role = db.query(TournamentRole).filter(
        TournamentRole.tournament_id == td_tournament.id,
        TournamentRole.label == "Tournament Director",
    ).one()

    peer = db.query(UserModel).filter(
        UserModel.id == _make_user(db, "peer@example.com")["id"]
    ).first()
    _make_low_rank_role(db, td_tournament, "Peer Staff", rank=50)
    grant_role(db, td_tournament, peer, "Peer Staff")

    junior = db.query(UserModel).filter(
        UserModel.id == _make_user(db, "junior@example.com")["id"]
    ).first()
    _make_low_rank_role(db, td_tournament, "Junior Staff", rank=90)
    grant_role(db, td_tournament, junior, "Junior Staff")

    login(client, "td@test.com", "tdpass")
    response = client.get(
        f"/tournaments/{td_tournament.id}/members/?max_rank=50"
    )
    assert response.status_code == 200
    emails = [m["user"]["email"] for m in response.json()]

    assert "junior@example.com" in emails       # rank 90, less authority — actionable
    assert "peer@example.com" not in emails     # rank 50, exact tie — excluded
    assert "td@test.com" not in emails          # rank 10, outranks — excluded
    assert td_role.rank < 50


def test_search_memberships_max_rank_keeps_roleless_members(
    client, td_user, td_tournament, db
):
    """A member with no roles has no authority at all, so they always pass the
    max_rank filter — the NOT IN subquery only matches members that hold roles."""
    roleless = _make_user(db, "roleless@example.com")
    _make_membership(db, td_tournament.id, roleless["id"])

    login(client, "td@test.com", "tdpass")
    response = client.get(
        f"/tournaments/{td_tournament.id}/members/?max_rank=50"
    )
    assert response.status_code == 200
    assert "roleless@example.com" in [m["user"]["email"] for m in response.json()]


def test_search_memberships_requires_manage_members(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/members/"
    ).status_code == 403


def test_search_memberships_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/members/"
    ).status_code == 404


# ---------------------------------------------------------------------------
# Get single
# ---------------------------------------------------------------------------

def test_get_membership(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"], notes="Allergic to nuts")
    login(client, "td@test.com", "tdpass")
    response = client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == m.id
    assert data["notes"] == "Allergic to nuts"
    assert data["user"]["email"] == u["email"]


def test_get_membership_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{td_tournament.id}/members/9999/"
    ).status_code == 404


def test_get_membership_wrong_tournament(client, td_user, td_tournament, other_tournament, db):
    """A real membership ID from a different tournament still 404s — no cross-tournament leak."""
    u = _make_user(db)
    m = _make_membership(db, other_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/"
    ).status_code == 404


def test_get_membership_rejects_a_member_reading_their_own_row(client, td_user, other_tournament, db):
    """One rule, no exceptions: this route is manage_members, and that
    includes your own row. Your own row has its own route.

    Self-access here used to be allowed and then redacted after the fact,
    which meant every field added had to be re-reasoned about for the weaker
    audience. A route per audience makes the permission check the whole
    answer."""
    grant_role(db, other_tournament, td_user, "Volunteer")
    m = (
        db.query(TournamentMembership)
        .filter_by(tournament_id=other_tournament.id, user_id=td_user.id)
        .one()
    )
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/members/{m.id}/"
    ).status_code == 403

    # ...and the member still reads their own membership, just not here.
    me = client.get(f"/tournaments/{other_tournament.id}/members/me/")
    assert me.status_code == 200
    assert me.json()["id"] == m.id


def test_me_returns_the_same_membership_data_a_manager_sees(client, td_user, other_tournament, db):
    """A member is not shown less about themselves than a coordinator is —
    the two responses differ by audience, not by fidelity. Notes are the
    exception that proves it: written *about* the member by staff, so not
    part of the membership data at all."""
    grant_role(db, other_tournament, td_user, "Volunteer")
    m = (
        db.query(TournamentMembership)
        .filter_by(tournament_id=other_tournament.id, user_id=td_user.id)
        .one()
    )
    m.notes = "Flaky, do not schedule alone"
    db.commit()

    login(client, "td@test.com", "tdpass")
    body = client.get(f"/tournaments/{other_tournament.id}/members/me/").json()

    assert body["id"] == m.id
    assert body["user"]["email"] == td_user.email
    assert body["created_at"]
    # Audience-specific extras, meaningless on a manager's read of someone else.
    assert body["permissions"] == []
    assert body["needs_age_consent"] is False
    # Staff-side fields have no place on the self response.
    assert "notes" not in body
    assert "join_code" not in body


def _join_code_membership(db, tournament, member_user, creator_user):
    """A membership sourced from a join code, so its response carries a
    resolved `join_code.creator` — the reference shape under test."""
    from app.models.models import JoinCode

    code = JoinCode(
        tournament_id=tournament.id, created_by=creator_user.id,
        code=f"JC{creator_user.id:03d}{member_user.id:03d}"[:8], label="Staff",
    )
    db.add(code)
    db.flush()
    # Reuse the row if the member already has one (grant_role makes one), the
    # same way conftest's grant_role does — a second insert violates
    # uq_user_tournament.
    membership = (
        db.query(TournamentMembership)
        .filter_by(tournament_id=tournament.id, user_id=member_user.id)
        .first()
    )
    if membership is None:
        membership = TournamentMembership(
            tournament_id=tournament.id, user_id=member_user.id, source="join_code",
        )
        db.add(membership)
    membership.source = "join_code"
    membership.join_code_id = code.id
    db.commit()
    db.refresh(membership)
    return membership


def test_join_code_creator_carries_name_and_roles_only(client, td_user, td_tournament, db):
    """The reference used to embed the creator's whole roster row — email,
    phone, age flags, lunch choices, custom form answers. It credits an
    action; it is not a directory entry."""
    member = _db_user_for_filter(db, "invitee@example.com")
    m = _join_code_membership(db, td_tournament, member, td_user)

    login(client, "td@test.com", "tdpass")
    creator = client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/"
    ).json()["join_code"]["creator"]
    assert set(creator) == {"user_id", "membership_id", "first_name", "last_name", "roles"}
    assert creator["user_id"] == td_user.id
    assert [r["label"] for r in creator["roles"]] == ["Tournament Director"]


def test_get_membership_does_not_leak_others(client, td_user, other_tournament, db):
    """A plain member reads nobody's row here, their own included — see
    test_get_membership_rejects_a_member_reading_their_own_row."""
    grant_role(db, other_tournament, td_user, "Volunteer")
    other = _make_user(db)
    m = _make_membership(db, other_tournament.id, other["id"])
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/members/{m.id}/"
    ).status_code == 403


def test_get_membership_requires_manage_members(client, td_user, other_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, other_tournament.id, u["id"])
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/members/{m.id}/"
    ).status_code == 403


def test_get_membership_includes_roles(client, td_user, td_tournament, db):
    from app.models.models import User as UserModel
    u = _make_user(db, "coach2@example.com")
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    membership = grant_role(db, td_tournament, user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{membership.id}/")
    assert response.status_code == 200
    assert [r["label"] for r in response.json()["roles"]] == ["Volunteer"]


def test_get_membership_availability_and_lunch_empty(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/")
    assert response.status_code == 200
    data = response.json()
    assert data["availability"] == []
    assert data["lunch"] == []


def test_get_membership_availability_and_lunch_populated(client, td_user, td_tournament, db):
    from datetime import datetime
    from app.models.models import (
        TournamentMembershipAvailability, TournamentMembershipLunch, TournamentShift,
    )

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])

    shift = TournamentShift(tournament_id=td_tournament.id, track_id=primary_track_id(db, td_tournament.id), label="Morning",
        start=datetime(2026, 5, 21, 8, 0), end=datetime(2026, 5, 21, 12, 0),
    )
    db.add(shift)
    db.flush()
    db.add(TournamentMembershipAvailability(membership_id=m.id, tournament_shift_id=shift.id))
    db.add(TournamentMembershipLunch(
        membership_id=m.id, track_id=primary_track_id(db, td_tournament.id), category="entree", value="pizza", label="Pizza",
    ))
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/")
    assert response.status_code == 200
    data = response.json()

    assert len(data["availability"]) == 1
    assert data["availability"][0]["shift_id"] == shift.id
    assert data["availability"][0]["label"] == "Morning"

    assert len(data["lunch"]) == 1
    # value ("pizza"), not label ("Pizza") — see MembershipLunchRead.
    # question_type is None here: no form field defines this track's entree
    # question, so there is nothing to say whether it was a pick or free text.
    assert data["lunch"][0] == {
        "track_id": primary_track_id(db, td_tournament.id), "track_name": "Main",
        "category": "entree", "value": "pizza", "question_type": None,
    }


def test_get_membership_custom_responses_empty(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/")
    assert response.status_code == 200
    assert response.json()["custom_responses"] == []


def test_get_membership_custom_responses_populated(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    form = _make_form(db, td_user, td_tournament.id, title="Volunteer interest")
    field = _make_field(db, form, field_key="favorite_color", label="Favorite color")
    _make_answer(db, u["id"], form, field, "opt_1")

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/")
    assert response.status_code == 200
    custom = response.json()["custom_responses"]
    assert custom == [{
        "form_title": "Volunteer interest", "field_label": "Favorite color",
        "field_key": "favorite_color", "question_type": "single_select_dropdown",
        "value": "opt_1", "field_id": field.id,
    }]


def test_get_membership_custom_responses_excludes_reserved_field_keys(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    form = _make_form(db, td_user, td_tournament.id)
    reserved = _make_field(
        db, form, field_key="track_status_writer", question_type="single_select_radio",
    )
    _make_answer(db, u["id"], form, reserved, "confirmed")

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/")
    assert response.status_code == 200
    assert response.json()["custom_responses"] == []


def test_get_membership_custom_responses_excludes_unpublished_forms(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    draft_form = _make_form(db, td_user, td_tournament.id, status="draft")
    field = _make_field(db, draft_form)
    _make_answer(db, u["id"], draft_form, field, "opt_1")

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/")
    assert response.status_code == 200
    assert response.json()["custom_responses"] == []


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/members/{id}/?surface= — display_config
# application (TASK.md 3.3)
# ---------------------------------------------------------------------------

def _set_display_config(db, tournament, viewer, surface, hidden):
    """The config is the *viewer's* now, so these all set the TD's own — the
    TD is who every one of these tests logs in as."""
    membership = (
        db.query(TournamentMembership)
        .filter_by(tournament_id=tournament.id, user_id=viewer.id)
        .one()
    )
    membership.display_config = {**(membership.display_config or {}), surface: {"hidden": hidden}}
    db.commit()


def test_get_membership_surface_hides_track_status(client, td_user, td_tournament, db):
    from app.models.models import TournamentTrack, TournamentMembershipTrackStatus

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    db.add(track)
    db.flush()
    db.add(TournamentMembershipTrackStatus(membership_id=m.id, track_id=track.id, status="confirmed"))
    db.commit()
    _set_display_config(db, td_tournament, td_user, MEMBERS_PANEL, [f"track:{track.id}"])

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/?surface={MEMBERS_PANEL}")
    assert response.status_code == 200
    # Only the hidden track drops; the tournament's own primary track still
    # pads in as pending.
    assert [t["name"] for t in response.json()["track_statuses"]] == ["Main"]


def test_get_membership_surface_hides_lunch_category(client, td_user, td_tournament, db):
    from app.models.models import TournamentMembershipLunch

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    db.add(TournamentMembershipLunch(
        membership_id=m.id, track_id=primary_track_id(db, td_tournament.id), category="entree", value="veggie", label="Veggie wrap",
    ))
    db.commit()
    _set_display_config(db, td_tournament, td_user, MEMBERS_PANEL, [
        f"lunch:{primary_track_id(db, td_tournament.id)}:entree",
    ])

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/?surface={MEMBERS_PANEL}")
    assert response.status_code == 200
    assert response.json()["lunch"] == []


def test_get_membership_surface_hides_event_preference(client, td_user, td_tournament, db):
    from app.models.models import TournamentMembershipEventPreference

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id)
    db.add(TournamentMembershipEventPreference(
        membership_id=m.id, tournament_event_id=event["id"], track_id=primary_track_id(db, td_tournament.id), rank=1,
    ))
    db.commit()
    _set_display_config(db, td_tournament, td_user, MEMBERS_PANEL, [
        f"event_pref:{primary_track_id(db, td_tournament.id)}",
    ])

    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/?surface={MEMBERS_PANEL}")
    assert response.status_code == 200
    assert response.json()["event_preferences"] == []


def test_get_membership_surface_hides_custom_response(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    form = _make_form(db, td_user, td_tournament.id, title="Volunteer interest")
    field = _make_field(db, form, field_key="favorite_color", label="Favorite color")
    _make_answer(db, u["id"], form, field, "opt_1")
    _set_display_config(db, td_tournament, td_user, MEMBERS_PANEL, [f"form_field:{field.id}"])

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/?surface={MEMBERS_PANEL}")
    assert response.status_code == 200
    assert response.json()["custom_responses"] == []


def test_get_membership_surface_hides_availability_day(client, td_user, td_tournament, db):
    """Availability items key by tournament-local day, so this is the one
    hidden namespace that needs the tournament's timezone to resolve — the
    path that had no coverage when apply_display_config lost that argument."""
    from app.core.tournament import tournament_local_date
    from app.models.models import TournamentMembershipAvailability

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    shift = _make_shift(db, td_tournament.id, "Morning", day=1)
    db.add(TournamentMembershipAvailability(membership_id=m.id, tournament_shift_id=shift.id))
    db.commit()
    day = tournament_local_date(td_tournament, shift.start).isoformat()
    _set_display_config(db, td_tournament, td_user, MEMBERS_PANEL, [
        f"availability_track:{primary_track_id(db, td_tournament.id)}",
    ])

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/?surface={MEMBERS_PANEL}")
    assert response.status_code == 200
    assert response.json()["availability"] == []


def test_get_membership_no_surface_is_unfiltered(client, td_user, td_tournament, db):
    """No `surface` query param at all is a no-op — existing callers with no
    opinion on filtering keep getting the full payload even if display_config
    has hidden items configured for some other surface."""
    from app.models.models import TournamentTrack, TournamentMembershipTrackStatus

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    db.add(track)
    db.flush()
    db.add(TournamentMembershipTrackStatus(membership_id=m.id, track_id=track.id, status="confirmed"))
    db.commit()
    _set_display_config(db, td_tournament, td_user, MEMBERS_PANEL, [f"track:{track.id}"])

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/")
    assert response.status_code == 200
    # Both the answered track and the fixture's pending "Main".
    assert len(response.json()["track_statuses"]) == 2


def test_get_membership_surface_hiding_never_affects_age_flags(client, td_user, td_tournament, db):
    """display_config must never become a second privacy mechanism — hiding
    every namespaced item on a surface must not resurrect is_over_18/21 for a
    member who hasn't consented (gate_age_flags still applies independently)."""
    td_tournament.collect_is_over_18 = True
    db.add(td_tournament)
    db.commit()

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"], age_disclosure=None)
    track_id = primary_track_id(db, td_tournament.id)
    _set_display_config(db, td_tournament, td_user, MEMBERS_PANEL, [
        "track:1", f"lunch:{track_id}:entree", f"event_pref:{track_id}",
    ])

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/?surface={MEMBERS_PANEL}")
    assert response.status_code == 200
    assert "is_over_18" not in response.json()


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/members/me/ — any member
# ---------------------------------------------------------------------------

def test_get_my_membership_owner(client, td_user, td_tournament):
    """td_user is both the owner and holds Tournament Director — is_owner
    True and permissions come back as the full set regardless of role."""
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/me/")
    assert response.status_code == 200
    data = response.json()
    assert data["is_owner"] is True
    assert data["id"] is not None
    assert [r["label"] for r in data["roles"]] == ["Tournament Director"]
    assert len(data["permissions"]) > 0


def test_get_my_membership_non_owner_with_role(client, td_tournament, db):
    """A plain member sees is_owner False and permissions scoped to their role."""
    from app.core.auth import hash_password
    from app.models.models import User as UserModel

    u = _make_user(db, "volunteer@example.com")
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    user.hashed_password = hash_password("volpass")
    db.commit()
    membership = grant_role(db, td_tournament, user, "Volunteer")

    login(client, "volunteer@example.com", "volpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/me/")
    assert response.status_code == 200
    data = response.json()
    assert data["is_owner"] is False
    assert data["id"] == membership.id
    assert [r["label"] for r in data["roles"]] == ["Volunteer"]


def test_get_my_membership_includes_enrichment(client, td_tournament, db):
    """/me/ carries the same enrichment MembershipFullResponse gives
    manage_members about someone else — a plain member with no special
    permission still reads their own availability/lunch/custom answers/age
    flags."""
    from datetime import datetime
    from app.core.auth import hash_password
    from app.models.models import (
        TournamentMembershipAvailability, TournamentMembershipLunch, TournamentShift, User as UserModel,
    )

    u = _make_user(db, "volunteer2@example.com")
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    user.hashed_password = hash_password("volpass")
    db.commit()
    membership = grant_role(db, td_tournament, user, "Volunteer")

    shift = TournamentShift(tournament_id=td_tournament.id, track_id=primary_track_id(db, td_tournament.id), label="Morning",
        start=datetime(2026, 5, 21, 8, 0), end=datetime(2026, 5, 21, 12, 0),
    )
    db.add(shift)
    db.flush()
    db.add(TournamentMembershipAvailability(membership_id=membership.id, tournament_shift_id=shift.id))
    db.add(TournamentMembershipLunch(
        membership_id=membership.id, track_id=primary_track_id(db, td_tournament.id), category="entree", value="pizza", label="Pizza",
    ))
    db.commit()

    login(client, "volunteer2@example.com", "volpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/me/")
    assert response.status_code == 200
    data = response.json()
    # td_tournament doesn't collect either flag — omitted, not null (see the
    # gating tests below this file's age-flags section).
    assert "is_over_18" not in data
    assert "is_over_21" not in data
    assert len(data["availability"]) == 1
    assert data["availability"][0]["label"] == "Morning"
    assert len(data["lunch"]) == 1
    assert data["lunch"][0]["value"] == "pizza"
    assert data["custom_responses"] == []


def test_get_my_membership_track_statuses_include_pending(client, td_user, td_tournament, db):
    """A track the member has never answered comes back as "pending" — those
    are exactly the ones a self-service control has to offer."""
    track = _make_track(db, td_tournament.id, "Test Writing", allow_confirm=True)
    login(client, "td@test.com", "tdpass")
    statuses = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()["track_statuses"]
    entry = next(t for t in statuses if t["track_id"] == track.id)
    assert entry["status"] == "pending"
    assert entry["allow_confirm"] is True


def test_track_statuses_carry_allow_confirm(client, td_user, td_tournament, db):
    """The member page can't read GET /tracks/, so the flag rides on the
    status itself — without it there's no way to know whether to offer a
    Confirm control."""
    from app.models.models import TournamentMembershipTrackStatus

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    track = _make_track(db, td_tournament.id, "Test Writing", allow_confirm=True)
    db.add(TournamentMembershipTrackStatus(membership_id=m.id, track_id=track.id, status="confirmed"))
    db.commit()

    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/").json()
    entry = next(t for t in data["track_statuses"] if t["track_id"] == track.id)
    assert entry["allow_confirm"] is True


def test_build_lunch_prefers_the_live_field_over_an_archived_one(client, td_user, td_tournament, db):
    """An archived field doesn't reserve its key, so a live and an archived
    lunch question can share one — question_type decides free-text vs badge
    rendering, so the live one has to win rather than whichever came back
    first."""
    from app.models.models import TournamentMembershipLunch

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    form = _make_form(db, td_user, td_tournament.id)
    _make_field(
        db, form, order=1, field_key=f"lunch_{primary_track_id(db, td_tournament.id)}_entree",
        question_type="short_text", is_archived=True,
    )
    _make_field(
        db, form, order=2, field_key=f"lunch_{primary_track_id(db, td_tournament.id)}_entree",
        question_type="single_select_radio",
    )
    db.add(TournamentMembershipLunch(
        membership_id=m.id, track_id=primary_track_id(db, td_tournament.id), category="entree", value="pizza", label="Pizza",
    ))
    db.commit()

    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/").json()
    assert data["lunch"][0]["question_type"] == "single_select_radio"


def test_get_my_membership_needs_age_consent_when_collected_and_unanswered(client, td_tournament, other_user, db):
    td_tournament.collect_is_over_18 = True
    db.commit()
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "other@test.com", "otherpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()
    assert data["needs_age_consent"] is True


def test_get_my_membership_needs_age_consent_false_once_answered(client, td_tournament, other_user, db):
    td_tournament.collect_is_over_18 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "other@test.com", "otherpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()
    assert data["needs_age_consent"] is False


def test_get_my_membership_needs_age_consent_false_when_not_collected(client, td_tournament, other_user, db):
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "other@test.com", "otherpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()
    assert data["needs_age_consent"] is False


def test_get_my_membership_admin_without_membership(client, admin_user, td_tournament):
    """A site admin who never joined the tournament still gets in via
    require_membership()'s admin bypass — membership_id/roles are
    null/empty but permissions come back as the full admin set."""
    login(client, "admin@test.com", "adminpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/me/")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] is None
    assert data["is_owner"] is False
    assert data["roles"] == []
    assert len(data["permissions"]) > 0


def test_get_my_membership_no_membership_returns_null_id(client, td_user, other_tournament):
    """No membership at all in the tournament — 200 with membership_id=None,
    same shape as the site-admin-without-a-row case. This route deliberately
    doesn't gate on require_membership() (see 2.4d): a declined member must
    still be able to check their own status here, and there's no way to
    special-case "declined" from "never joined" without also opening the
    door to "never joined"."""
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{other_tournament.id}/members/me/")
    assert response.status_code == 200
    assert response.json()["id"] is None


def test_get_my_membership_still_reachable_when_declined(client, td_tournament, other_user, db):
    """The escape hatch 2.4d relies on: a declined member can still see
    their own row (not just membership_id=None) to know they're declined
    and re-consent via POST .../me/age-disclosure/."""
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "other@test.com", "otherpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/me/")
    assert response.status_code == 200
    assert response.json()["id"] == membership.id


def test_get_my_membership_not_found_tournament(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/tournaments/9999/members/me/").status_code == 404


# ---------------------------------------------------------------------------
# POST .../members/me/age-disclosure/ — self-service consent/decline
# ---------------------------------------------------------------------------

def test_age_disclosure_consent_sets_status_and_timestamp(client, td_tournament, other_user, db):
    td_tournament.collect_is_over_18 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "other@test.com", "otherpass")

    response = client.post(
        f"/tournaments/{td_tournament.id}/members/me/age-disclosure/", json={"consent": True},
    )
    assert response.status_code == 200
    assert response.json()["needs_age_consent"] is False

    db.refresh(membership)
    assert membership.age_disclosure == "consented"
    assert membership.age_disclosure_at is not None


def test_age_disclosure_decline_is_soft_and_keeps_data(client, td_tournament, other_user, db):
    """Declining sets the status column only — availability, lunch, track
    statuses, and event preferences all survive."""
    from datetime import datetime
    from app.models.models import (
        TournamentMembershipAvailability, TournamentMembershipLunch, TournamentShift,
    )

    td_tournament.collect_is_over_21 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")

    shift = TournamentShift(tournament_id=td_tournament.id, track_id=primary_track_id(db, td_tournament.id), label="Morning",
        start=datetime(2026, 5, 21, 8, 0), end=datetime(2026, 5, 21, 12, 0),
    )
    db.add(shift)
    db.flush()
    db.add(TournamentMembershipAvailability(membership_id=membership.id, tournament_shift_id=shift.id))
    db.add(TournamentMembershipLunch(
        membership_id=membership.id, track_id=primary_track_id(db, td_tournament.id), category="entree", value="pizza", label="Pizza",
    ))
    db.commit()

    login(client, "other@test.com", "otherpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/members/me/age-disclosure/", json={"consent": False},
    )
    assert response.status_code == 200

    db.refresh(membership)
    assert membership.age_disclosure == "declined"
    assert membership.age_disclosure_at is not None
    assert db.query(TournamentMembershipAvailability).filter_by(membership_id=membership.id).count() == 1
    assert db.query(TournamentMembershipLunch).filter_by(membership_id=membership.id).count() == 1


def test_age_disclosure_recanting_flips_back_to_consented(client, td_tournament, other_user, db):
    """Re-answering after a decline moves straight to consented — no rejoin."""
    td_tournament.collect_is_over_18 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()

    login(client, "other@test.com", "otherpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/members/me/age-disclosure/", json={"consent": True},
    )
    assert response.status_code == 200
    db.refresh(membership)
    assert membership.age_disclosure == "consented"


def test_age_disclosure_not_found_without_membership(client, td_tournament, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id + 9999}/members/me/age-disclosure/", json={"consent": True},
    )
    assert response.status_code == 404


def test_age_disclosure_unauthenticated_forbidden(client, td_tournament):
    assert client.post(
        f"/tournaments/{td_tournament.id}/members/me/age-disclosure/", json={"consent": True},
    ).status_code == 401


# ---------------------------------------------------------------------------
# Coordinator update — PATCH .../{membership_id}/
# ---------------------------------------------------------------------------

def test_update_membership_notes(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/members/{m.id}/",
        json={"notes": "Needs early lunch"},
    )
    assert response.status_code == 200
    assert response.json()["notes"] == "Needs early lunch"


def test_update_membership_ignores_onboarding_fields(client, td_user, td_tournament, db):
    """lunch_order/role_preference/etc aren't in MembershipCoordinatorUpdate
    (or on the model at all anymore) — sending them is a no-op."""
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/members/{m.id}/",
        json={"lunch_order": "Changed by staff"},
    )
    assert response.status_code == 200
    assert "lunch_order" not in response.json()


def test_update_membership_requires_manage_members(client, td_user, other_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, other_tournament.id, u["id"])
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{other_tournament.id}/members/{m.id}/",
        json={"notes": "no permission"},
    )
    assert response.status_code == 403


def test_update_membership_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/members/9999/",
        json={"notes": "no such membership"},
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Self-service: availability and track status (PUT .../me/...)
# ---------------------------------------------------------------------------

def _make_shift(db, tournament_id, label="Morning", day=1):
    from app.models.models import TournamentShift

    shift = TournamentShift(tournament_id=tournament_id, track_id=primary_track_id(db, tournament_id), label=label,
        start=datetime(2026, 3, day, 15, 0, tzinfo=timezone.utc),
        end=datetime(2026, 3, day, 19, 0, tzinfo=timezone.utc),
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return shift


def _make_track(db, tournament_id, name="Test Writing", allow_confirm=False):
    from app.models.models import TournamentTrack

    track = TournamentTrack(tournament_id=tournament_id, name=name, allow_confirm=allow_confirm)
    db.add(track)
    db.commit()
    db.refresh(track)
    return track


def _my_membership(db, tournament, user):
    return (
        db.query(TournamentMembership)
        .filter_by(tournament_id=tournament.id, user_id=user.id)
        .one()
    )


def _lunch_field(db, td_user, tournament, track_id, category, question_type="single_select_radio", options=None):
    """A published lunch question the member is allowed to answer."""
    from app.models.models import Form, FormField

    form = Form(
        name=f"lunch-{track_id}-{category}", title="Lunch", owner_type="tournament",
        tournament_id=tournament.id, status="published", created_by=td_user.id,
    )
    db.add(form)
    db.flush()
    config = {"required": False}
    if options is not None:
        config["options"] = options
    field = FormField(
        form_id=form.id, order=0, label=category.title(),
        question_type=question_type, field_key=f"lunch_{track_id}_{category}", config=config,
    )
    db.add(field)
    db.commit()
    return field


def _pref_field(db, td_user, tournament, track_id, options, question_type="ranked_choice", ranks=None):
    from app.models.models import Form, FormField

    form = Form(
        name=f"prefs-{track_id}", title="Events", owner_type="tournament",
        tournament_id=tournament.id, status="published", created_by=td_user.id,
    )
    db.add(form)
    db.flush()
    config = {"required": False, "options": options}
    if ranks is not None:
        config["ranks"] = ranks
    field = FormField(
        form_id=form.id, order=0, label="Events",
        question_type=question_type, field_key=f"event_preference_{track_id}", config=config,
    )
    db.add(field)
    db.commit()
    return field


def test_put_my_availability_replaces_the_whole_set_for_that_track(client, td_user, td_tournament, db):
    """Whole-set within the track: the page shows that track's groups all at
    once, so a shift left out is a withdrawal."""
    morning = _make_shift(db, td_tournament.id, "Morning", day=1)
    afternoon = _make_shift(db, td_tournament.id, "Afternoon", day=2)
    track_id = primary_track_id(db, td_tournament.id)
    login(client, "td@test.com", "tdpass")

    response = client.put(
        f"/tournaments/{td_tournament.id}/members/me/availability/{track_id}/",
        json={"shift_ids": [morning.id, afternoon.id]},
    )
    assert response.status_code == 200
    assert {row["shift_id"] for row in response.json()} == {morning.id, afternoon.id}

    dropped = client.put(
        f"/tournaments/{td_tournament.id}/members/me/availability/{track_id}/",
        json={"shift_ids": [afternoon.id]},
    )
    assert [row["shift_id"] for row in dropped.json()] == [afternoon.id]


def test_put_my_availability_leaves_another_track_alone(client, td_user, td_tournament, db):
    """Saving Day 1 must not touch Day 2 — the member may not even have been
    shown it."""
    from app.models.models import TournamentShift, TournamentTrack

    other = TournamentTrack(
        tournament_id=td_tournament.id, name="Day 2", is_primary=True,
        start_date=date.today(), end_date=date.today() + timedelta(days=1),
        location="Elsewhere", division=["B"],
    )
    db.add(other)
    db.flush()
    mine = _make_shift(db, td_tournament.id, "Morning", day=1)
    theirs = TournamentShift(
        tournament_id=td_tournament.id, track_id=other.id, label="Day 2 morning",
        start=datetime(2026, 3, 3, 15, 0, tzinfo=timezone.utc),
        end=datetime(2026, 3, 3, 19, 0, tzinfo=timezone.utc),
    )
    db.add(theirs)
    db.commit()

    login(client, "td@test.com", "tdpass")
    base = f"/tournaments/{td_tournament.id}/members/me/availability"
    client.put(f"{base}/{other.id}/", json={"shift_ids": [theirs.id]})
    client.put(f"{base}/{primary_track_id(db, td_tournament.id)}/", json={"shift_ids": [mine.id]})

    # Clearing track one leaves track two's shift standing.
    remaining = client.put(
        f"{base}/{primary_track_id(db, td_tournament.id)}/", json={"shift_ids": []},
    )
    assert [row["shift_id"] for row in remaining.json()] == [theirs.id]


def test_put_my_availability_rejects_a_shift_from_another_track(
    client, td_user, td_tournament, other_tournament, db,
):
    foreign = _make_shift(db, other_tournament.id, "Elsewhere")
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/members/me/availability/{primary_track_id(db, td_tournament.id)}/",
        json={"shift_ids": [foreign.id]},
    )
    assert response.status_code == 422


def test_not_available_clears_shifts_and_declines_in_one_call(client, td_user, td_tournament, db):
    """The "Not available" control is one action, so it is one request — a
    member can never be left declined with shifts still selected."""
    shift = _make_shift(db, td_tournament.id, "Morning", day=1)
    track_id = primary_track_id(db, td_tournament.id)
    login(client, "td@test.com", "tdpass")
    base = f"/tournaments/{td_tournament.id}/members/me/availability/{track_id}/"

    client.put(base, json={"shift_ids": [shift.id]})
    response = client.put(base, json={"shift_ids": [], "status": "declined"})
    assert response.status_code == 200
    assert response.json() == []

    statuses = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()["track_statuses"]
    assert next(s for s in statuses if s["track_id"] == track_id)["status"] == "declined"


def test_picking_a_group_again_re_opts_in(client, td_user, td_tournament, db):
    """Un-declining is exactly what form write-through refuses, and exactly
    what the member's own page has to allow."""
    shift = _make_shift(db, td_tournament.id, "Morning", day=1)
    track_id = primary_track_id(db, td_tournament.id)
    login(client, "td@test.com", "tdpass")
    base = f"/tournaments/{td_tournament.id}/members/me/availability/{track_id}/"

    client.put(base, json={"shift_ids": [], "status": "declined"})
    response = client.put(base, json={"shift_ids": [shift.id], "status": "interested"})
    assert response.status_code == 200

    statuses = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()["track_statuses"]
    assert next(s for s in statuses if s["track_id"] == track_id)["status"] == "interested"


# ---------------------------------------------------------------------------
# Self-service: the options catalog
# ---------------------------------------------------------------------------

def test_my_options_groups_questions_by_track(client, td_user, td_tournament, db):
    track_id = primary_track_id(db, td_tournament.id)
    writing = _make_track(db, td_tournament.id, "Test Writing")
    _lunch_field(
        db, td_user, td_tournament, track_id, "protein",
        options=[{"option_id": "opt_chicken", "value": "chicken", "label": "Chicken"}],
    )
    login(client, "td@test.com", "tdpass")

    body = client.get(f"/tournaments/{td_tournament.id}/members/me/options/").json()
    by_name = {t["track_name"]: t for t in body["tracks"]}
    assert set(by_name) == {"Main", "Test Writing"}
    assert [f["field_key"] for f in by_name["Main"]["lunch"]] == [f"lunch_{track_id}_protein"]
    # A track with no questions still appears — its status is always the
    # member's to set.
    assert by_name["Test Writing"]["lunch"] == []
    assert by_name["Test Writing"]["availability"] == []
    assert by_name["Test Writing"]["allow_confirm"] is False


def test_my_options_excludes_draft_and_archived_questions(client, td_user, td_tournament, db):
    """A member may not newly pick an option no published question offers —
    stricter than the read builders, which do consult archived fields so an
    old answer still renders."""
    from app.models.models import Form, FormField

    track_id = primary_track_id(db, td_tournament.id)
    draft = Form(
        name="draft", title="Draft", owner_type="tournament",
        tournament_id=td_tournament.id, status="draft", created_by=td_user.id,
    )
    published = Form(
        name="pub", title="Pub", owner_type="tournament",
        tournament_id=td_tournament.id, status="published", created_by=td_user.id,
    )
    db.add_all([draft, published])
    db.flush()
    db.add_all([
        FormField(form_id=draft.id, order=0, label="Drink", question_type="short_text",
                  field_key=f"lunch_{track_id}_drink", config={"required": False}),
        FormField(form_id=published.id, order=0, label="Dessert", question_type="short_text",
                  field_key=f"lunch_{track_id}_dessert", config={"required": False},
                  is_archived=True),
    ])
    db.commit()

    login(client, "td@test.com", "tdpass")
    body = client.get(f"/tournaments/{td_tournament.id}/members/me/options/").json()
    main = next(t for t in body["tracks"] if t["track_name"] == "Main")
    assert main["lunch"] == []


def test_my_options_carries_current_answers(client, td_user, td_tournament, db):
    shift = _make_shift(db, td_tournament.id, "Morning", day=1)
    track_id = primary_track_id(db, td_tournament.id)
    login(client, "td@test.com", "tdpass")
    client.put(
        f"/tournaments/{td_tournament.id}/members/me/availability/{track_id}/",
        json={"shift_ids": [shift.id], "status": "interested"},
    )

    body = client.get(f"/tournaments/{td_tournament.id}/members/me/options/").json()
    main = next(t for t in body["tracks"] if t["track_id"] == track_id)
    assert main["selected_shift_ids"] == [shift.id]
    assert main["status"] == "interested"


# ---------------------------------------------------------------------------
# Self-service: lunch
# ---------------------------------------------------------------------------

def test_put_my_lunch_stores_the_option_label(client, td_user, td_tournament, db):
    track_id = primary_track_id(db, td_tournament.id)
    _lunch_field(
        db, td_user, td_tournament, track_id, "protein",
        options=[
            {"option_id": "opt_chicken", "value": "chicken", "label": "Chicken"},
            {"option_id": "opt_tofu", "value": "tofu", "label": "Tofu"},
        ],
    )
    login(client, "td@test.com", "tdpass")

    response = client.put(
        f"/tournaments/{td_tournament.id}/members/me/lunch/{track_id}/protein/",
        json={"option_ids": ["opt_tofu"]},
    )
    assert response.status_code == 200
    assert [row["value"] for row in response.json()] == ["tofu"]


def test_put_my_lunch_leaves_other_categories_alone(client, td_user, td_tournament, db):
    track_id = primary_track_id(db, td_tournament.id)
    _lunch_field(db, td_user, td_tournament, track_id, "protein",
                 options=[{"option_id": "opt_chicken", "value": "chicken", "label": "Chicken"}])
    _lunch_field(db, td_user, td_tournament, track_id, "drink",
                 options=[{"option_id": "opt_water", "value": "water", "label": "Water"}])
    login(client, "td@test.com", "tdpass")
    base = f"/tournaments/{td_tournament.id}/members/me/lunch/{track_id}"

    client.put(f"{base}/protein/", json={"option_ids": ["opt_chicken"]})
    body = client.put(f"{base}/drink/", json={"option_ids": ["opt_water"]}).json()
    assert {row["category"] for row in body} == {"protein", "drink"}

    cleared = client.put(f"{base}/protein/", json={"option_ids": []}).json()
    assert [row["category"] for row in cleared] == ["drink"]


def test_put_my_lunch_free_text(client, td_user, td_tournament, db):
    track_id = primary_track_id(db, td_tournament.id)
    _lunch_field(db, td_user, td_tournament, track_id, "notes", question_type="short_text")
    login(client, "td@test.com", "tdpass")

    body = client.put(
        f"/tournaments/{td_tournament.id}/members/me/lunch/{track_id}/notes/",
        json={"text": "no nuts please"},
    ).json()
    assert [row["value"] for row in body] == ["no nuts please"]


def test_put_my_lunch_rejects_the_wrong_answer_shape(client, td_user, td_tournament, db):
    track_id = primary_track_id(db, td_tournament.id)
    _lunch_field(db, td_user, td_tournament, track_id, "notes", question_type="short_text")
    _lunch_field(db, td_user, td_tournament, track_id, "protein",
                 options=[{"option_id": "opt_chicken", "value": "chicken", "label": "Chicken"}])
    login(client, "td@test.com", "tdpass")
    base = f"/tournaments/{td_tournament.id}/members/me/lunch/{track_id}"

    assert client.put(f"{base}/notes/", json={"option_ids": ["opt_x"]}).status_code == 422
    assert client.put(f"{base}/protein/", json={"text": "chicken"}).status_code == 422


def test_put_my_lunch_rejects_unknown_option_and_missing_question(client, td_user, td_tournament, db):
    track_id = primary_track_id(db, td_tournament.id)
    _lunch_field(db, td_user, td_tournament, track_id, "protein",
                 options=[{"option_id": "opt_chicken", "value": "chicken", "label": "Chicken"}])
    login(client, "td@test.com", "tdpass")
    base = f"/tournaments/{td_tournament.id}/members/me/lunch/{track_id}"

    assert client.put(f"{base}/protein/", json={"option_ids": ["opt_nope"]}).status_code == 422
    assert client.put(f"{base}/dessert/", json={"option_ids": []}).status_code == 404


# ---------------------------------------------------------------------------
# Self-service: event preferences
# ---------------------------------------------------------------------------

def _two_events(db, td_tournament):
    from app.models.models import TournamentEvent

    one = TournamentEvent(tournament_id=td_tournament.id, name="Anatomy", division="C")
    two = TournamentEvent(tournament_id=td_tournament.id, name="Astronomy", division="C")
    db.add_all([one, two])
    db.commit()
    return one, two


def test_put_my_event_preferences_ranked(client, td_user, td_tournament, db):
    one, two = _two_events(db, td_tournament)
    track_id = primary_track_id(db, td_tournament.id)
    _pref_field(db, td_user, td_tournament, track_id, [
        {"option_id": "opt_1", "value": [one.id], "label": "Anatomy"},
        {"option_id": "opt_2", "value": [two.id], "label": "Astronomy"},
    ])
    login(client, "td@test.com", "tdpass")

    response = client.put(
        f"/tournaments/{td_tournament.id}/members/me/event-preferences/{track_id}/",
        json={"selections": [
            {"option_id": "opt_2", "rank": 1},
            {"option_id": "opt_1", "rank": 2},
        ]},
    )
    assert response.status_code == 200
    group = next(g for g in response.json() if g["track_id"] == track_id)
    assert [o["label"] for o in group["options"]] == ["Astronomy", "Anatomy"]


def test_put_my_event_preferences_rejects_non_contiguous_ranks(client, td_user, td_tournament, db):
    one, two = _two_events(db, td_tournament)
    track_id = primary_track_id(db, td_tournament.id)
    _pref_field(db, td_user, td_tournament, track_id, [
        {"option_id": "opt_1", "value": [one.id], "label": "Anatomy"},
        {"option_id": "opt_2", "value": [two.id], "label": "Astronomy"},
    ])
    login(client, "td@test.com", "tdpass")
    url = f"/tournaments/{td_tournament.id}/members/me/event-preferences/{track_id}/"

    assert client.put(url, json={"selections": [
        {"option_id": "opt_1", "rank": 1}, {"option_id": "opt_2", "rank": 3},
    ]}).status_code == 422
    assert client.put(url, json={"selections": [
        {"option_id": "opt_1", "rank": 1}, {"option_id": "opt_2", "rank": 1},
    ]}).status_code == 422
    assert client.put(url, json={"selections": [
        {"option_id": "opt_1"},
    ]}).status_code == 422


def test_put_my_event_preferences_replaces_the_whole_track(client, td_user, td_tournament, db):
    one, two = _two_events(db, td_tournament)
    track_id = primary_track_id(db, td_tournament.id)
    _pref_field(db, td_user, td_tournament, track_id, [
        {"option_id": "opt_1", "value": [one.id], "label": "Anatomy"},
        {"option_id": "opt_2", "value": [two.id], "label": "Astronomy"},
    ])
    login(client, "td@test.com", "tdpass")
    url = f"/tournaments/{td_tournament.id}/members/me/event-preferences/{track_id}/"

    client.put(url, json={"selections": [{"option_id": "opt_1", "rank": 1}]})
    body = client.put(url, json={"selections": [{"option_id": "opt_2", "rank": 1}]}).json()
    group = next(g for g in body if g["track_id"] == track_id)
    assert [o["label"] for o in group["options"]] == ["Astronomy"]

    assert client.put(url, json={"selections": []}).json() == []


def test_self_service_writes_reject_a_pending_delete_track(client, td_user, td_tournament, db):
    """A track on its way out is not something to invite an answer to."""
    track = _make_track(db, td_tournament.id, "Retired")
    track.is_archived = True
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.put(
        f"/tournaments/{td_tournament.id}/members/me/availability/{track.id}/",
        json={"shift_ids": []},
    ).status_code == 409
    assert client.put(
        f"/tournaments/{td_tournament.id}/members/me/track-statuses/{track.id}/",
        json={"status": "declined"},
    ).status_code == 409


def test_put_my_track_status_declines_without_allow_confirm(client, td_user, td_tournament, db):
    """Opting out is the member's own call on any track."""
    track = _make_track(db, td_tournament.id)
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/members/me/track-statuses/{track.id}/",
        json={"status": "declined"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "declined"


def test_put_my_track_status_undeclines_to_interested(client, td_user, td_tournament, db):
    """With allow_confirm off, interested is the way back in — and it's a
    move write-through itself refuses (see can_set_track_status)."""
    track = _make_track(db, td_tournament.id)
    login(client, "td@test.com", "tdpass")
    url = f"/tournaments/{td_tournament.id}/members/me/track-statuses/{track.id}/"
    client.put(url, json={"status": "declined"})
    response = client.put(url, json={"status": "interested"})
    assert response.status_code == 200
    assert response.json()["status"] == "interested"


def test_put_my_track_status_cannot_self_confirm_by_default(client, td_user, td_tournament, db):
    track = _make_track(db, td_tournament.id)
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/members/me/track-statuses/{track.id}/",
        json={"status": "confirmed"},
    )
    assert response.status_code == 403


def test_put_my_track_status_self_confirms_when_allowed(client, td_user, td_tournament, db):
    """With allow_confirm on, declined goes straight to confirmed."""
    track = _make_track(db, td_tournament.id, allow_confirm=True)
    login(client, "td@test.com", "tdpass")
    url = f"/tournaments/{td_tournament.id}/members/me/track-statuses/{track.id}/"
    client.put(url, json={"status": "declined"})
    response = client.put(url, json={"status": "confirmed"})
    assert response.status_code == 200
    assert response.json()["status"] == "confirmed"


def test_put_my_track_status_rejects_interested_when_confirm_allowed(
    client, td_user, td_tournament, db,
):
    """No step to nowhere: a member who can confirm themselves has no use for
    the middle state."""
    track = _make_track(db, td_tournament.id, allow_confirm=True)
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/members/me/track-statuses/{track.id}/",
        json={"status": "interested"},
    )
    assert response.status_code == 422


def test_put_my_track_status_rejects_unknown_status(client, td_user, td_tournament, db):
    track = _make_track(db, td_tournament.id)
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/members/me/track-statuses/{track.id}/",
        json={"status": "maybe"},
    )
    assert response.status_code == 422


def test_put_my_track_status_rejects_archived_track(client, td_user, td_tournament, db):
    track = _make_track(db, td_tournament.id)
    track.is_archived = True
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/members/me/track-statuses/{track.id}/",
        json={"status": "declined"},
    )
    assert response.status_code == 409


def test_put_my_track_status_scoped_to_the_tournament(
    client, td_user, td_tournament, other_tournament, db,
):
    foreign = _make_track(db, other_tournament.id, "Elsewhere")
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/members/me/track-statuses/{foreign.id}/",
        json={"status": "declined"},
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_membership(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    assert client.delete(
        f"/tournaments/{td_tournament.id}/members/{m.id}/"
    ).status_code == 204


def test_delete_membership_deletes_form_responses(client, td_user, td_tournament, db):
    """A removed member's answers to this tournament's forms go with them —
    FormResponse is keyed by user, not membership, so nothing cascades."""
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    form = _make_form(db, td_user, td_tournament.id)
    field = _make_field(db, form)
    _make_answer(db, u["id"], form, field, "blue")

    login(client, "td@test.com", "tdpass")
    assert client.delete(
        f"/tournaments/{td_tournament.id}/members/{m.id}/"
    ).status_code == 204

    assert db.query(FormResponse).filter_by(user_id=u["id"]).count() == 0
    # Answers ride the response's FK cascade, which a bulk delete relies on.
    assert db.query(FormAnswer).filter_by(field_id=field.id).count() == 0


def test_delete_membership_keeps_other_tournaments_responses(
    client, td_user, td_tournament, other_tournament, db,
):
    """Scoped to the tournament being left — the same user's answers to a
    different tournament's form are none of this removal's business."""
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    other_form = _make_form(db, td_user, other_tournament.id)
    other_field = _make_field(db, other_form)
    _make_answer(db, u["id"], other_form, other_field, "green")

    login(client, "td@test.com", "tdpass")
    assert client.delete(
        f"/tournaments/{td_tournament.id}/members/{m.id}/"
    ).status_code == 204

    assert db.query(FormResponse).filter_by(form_id=other_form.id, user_id=u["id"]).count() == 1


def test_delete_membership_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(
        f"/tournaments/{td_tournament.id}/members/9999/"
    ).status_code == 404


def test_delete_membership_requires_manage_members(client, td_user, other_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, other_tournament.id, u["id"])
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.delete(
        f"/tournaments/{other_tournament.id}/members/{m.id}/"
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Rank-bound target protection (validate_member_target) — regression coverage
# for a low-rank MANAGE_MEMBERS holder being able to remove/edit the
# tournament owner or a strictly-senior member. See validate_member_target
# in app/core/tournament/roles.py.
# ---------------------------------------------------------------------------

def _make_low_rank_role(db, tournament, label="Weak Staff", rank=90):
    """A MANAGE_MEMBERS-holding role ranked well below the fixture's default
    tiers (rank <= 40) — the actor here is authorized to touch member data
    but should still never be allowed to reach the owner or someone senior."""
    role = TournamentRole(tournament_id=tournament.id, label=label, rank=rank, permissions=[MANAGE_MEMBERS])
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def _owner_membership(db, tournament) -> TournamentMembership:
    return (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == tournament.id,
            TournamentMembership.user_id == tournament.owner_id,
        )
        .first()
    )


def test_delete_membership_owner_target_forbidden(client, td_user, other_tournament, db):
    """The bug this guards against: other_tournament's owner already holds
    the Tournament Director role (top rank) via the fixture, so a weak
    MANAGE_MEMBERS holder trying to delete them fails the ordinary rank
    comparison too — but this confirms it's actually blocked end to end."""
    owner_membership = _owner_membership(db, other_tournament)
    _make_low_rank_role(db, other_tournament, "Weak Staff", rank=90)
    grant_role(db, other_tournament, td_user, "Weak Staff")
    login(client, "td@test.com", "tdpass")

    response = client.delete(
        f"/tournaments/{other_tournament.id}/members/{owner_membership.id}/"
    )
    assert response.status_code == 403


def test_delete_membership_owner_target_forbidden_even_when_owner_has_no_role(client, td_user, other_tournament, db):
    """Rank is opt-in — an owner who holds no TournamentRole has no
    get_highest_rank result at all, so the plain rank comparison alone
    (`target_rank is not None and target_rank < actor_rank`) would silently
    pass and let them be deleted. validate_member_target's explicit
    owner check is what actually stops this."""
    owner_membership = _owner_membership(db, other_tournament)
    db.query(TournamentMembershipRole).filter(
        TournamentMembershipRole.membership_id == owner_membership.id
    ).delete()
    db.commit()

    _make_low_rank_role(db, other_tournament, "Weak Staff", rank=90)
    grant_role(db, other_tournament, td_user, "Weak Staff")
    login(client, "td@test.com", "tdpass")

    response = client.delete(
        f"/tournaments/{other_tournament.id}/members/{owner_membership.id}/"
    )
    assert response.status_code == 403
    assert db.query(TournamentMembership).filter(TournamentMembership.id == owner_membership.id).first() is not None


def test_delete_membership_target_outranks_actor_forbidden(client, td_user, other_tournament, db):
    """A non-owner target who's strictly senior to the actor is protected too."""
    senior_role = _make_low_rank_role(db, other_tournament, "Senior Staff", rank=5)
    u = _make_user(db)
    target_membership = _make_membership(db, other_tournament.id, u["id"])
    db.add(TournamentMembershipRole(membership_id=target_membership.id, role_id=senior_role.id))
    db.commit()

    _make_low_rank_role(db, other_tournament, "Weak Staff", rank=90)
    grant_role(db, other_tournament, td_user, "Weak Staff")
    login(client, "td@test.com", "tdpass")

    response = client.delete(
        f"/tournaments/{other_tournament.id}/members/{target_membership.id}/"
    )
    assert response.status_code == 403


def test_delete_membership_tied_rank_target_allowed(client, td_user, other_tournament, db):
    """Peers at the same rank can still act on each other — only strictly
    senior targets (or the owner) are protected."""
    peer_role = _make_low_rank_role(db, other_tournament, "Peer Staff", rank=40)
    u = _make_user(db)
    target_membership = _make_membership(db, other_tournament.id, u["id"])
    db.add(TournamentMembershipRole(membership_id=target_membership.id, role_id=peer_role.id))
    db.commit()

    grant_role(db, other_tournament, td_user, "Peer Staff")
    login(client, "td@test.com", "tdpass")

    response = client.delete(
        f"/tournaments/{other_tournament.id}/members/{target_membership.id}/"
    )
    assert response.status_code == 204


def test_update_membership_owner_target_forbidden_even_when_owner_has_no_role(client, td_user, other_tournament, db):
    """Same owner protection applies to the day-of-logistics PATCH, not just delete."""
    owner_membership = _owner_membership(db, other_tournament)
    db.query(TournamentMembershipRole).filter(
        TournamentMembershipRole.membership_id == owner_membership.id
    ).delete()
    db.commit()

    _make_low_rank_role(db, other_tournament, "Weak Staff", rank=90)
    grant_role(db, other_tournament, td_user, "Weak Staff")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/members/{owner_membership.id}/",
        json={"notes": "should not be allowed"},
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# is_over_18 / is_over_21 on the membership detail response
#
# Hybrid properties computed against the tournament's start_date, not stored
# columns. They regressed silently once: the property called .date() on
# start_date (a Date column, so already a datetime.date), and Pydantic's
# from_attributes swallowed the AttributeError and served the field default —
# so the age flags read null for everyone instead of erroring. Assert on
# concrete True/False here, never just "not a 500".
# ---------------------------------------------------------------------------

def _age_flags(client, db, tournament, user, dob):
    """Collection on + consent given by default, so these tests exercise the
    age arithmetic itself — the gating that hides the flags otherwise is
    covered separately below."""
    user.date_of_birth = dob
    tournament.collect_is_over_18 = True
    tournament.collect_is_over_21 = True
    db.commit()
    membership = grant_role(db, tournament, user, "Volunteer")
    membership.age_disclosure = "consented"
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{tournament.id}/members/{membership.id}/")
    assert response.status_code == 200, response.text
    return response.json()


def test_membership_age_flags_null_without_date_of_birth(client, td_user, td_tournament, other_user, db):
    data = _age_flags(client, db, td_tournament, other_user, None)
    assert data["is_over_18"] is None
    assert data["is_over_21"] is None


def test_membership_age_flags_adult_over_21(client, td_user, td_tournament, other_user, db):
    start = td_tournament.first_day
    dob = date(start.year - 30, start.month, start.day)
    data = _age_flags(client, db, td_tournament, other_user, dob)
    assert data["is_over_18"] is True
    assert data["is_over_21"] is True


def test_membership_age_flags_minor(client, td_user, td_tournament, other_user, db):
    start = td_tournament.first_day
    dob = date(start.year - 15, start.month, start.day)
    data = _age_flags(client, db, td_tournament, other_user, dob)
    assert data["is_over_18"] is False
    assert data["is_over_21"] is False


def test_membership_age_flags_between_18_and_21(client, td_user, td_tournament, other_user, db):
    """The two gates are independent — a 19-year-old clears one, not the other."""
    start = td_tournament.first_day
    dob = date(start.year - 19, start.month, start.day)
    data = _age_flags(client, db, td_tournament, other_user, dob)
    assert data["is_over_18"] is True
    assert data["is_over_21"] is False


def test_membership_age_flags_computed_against_start_date_not_today(
    client, td_user, td_tournament, other_user, db
):
    """Turning 18 the day after the tournament starts means not-18 for that
    tournament, even though they're 18 by the time anyone reads the roster."""
    start = td_tournament.first_day
    dob = date(start.year - 18, start.month, start.day) + timedelta(days=1)
    data = _age_flags(client, db, td_tournament, other_user, dob)
    assert data["is_over_18"] is False


# ---------------------------------------------------------------------------
# is_over_18 / is_over_21 gating — omitted entirely unless the tournament
# collects that specific flag AND the membership has consented. Never sent
# as null in the gated-off case, which would read as "under 18" to a
# careless frontend.
# ---------------------------------------------------------------------------

def test_age_flags_omitted_when_tournament_does_not_collect(client, td_user, td_tournament, other_user, db):
    other_user.date_of_birth = date(2000, 1, 1)
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "consented"
    db.commit()
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/{membership.id}/").json()
    assert "is_over_18" not in data
    assert "is_over_21" not in data


def test_age_flags_omitted_when_not_consented(client, td_user, td_tournament, other_user, db):
    other_user.date_of_birth = date(2000, 1, 1)
    td_tournament.collect_is_over_18 = True
    td_tournament.collect_is_over_21 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    # age_disclosure left null — never answered.
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/{membership.id}/").json()
    assert "is_over_18" not in data
    assert "is_over_21" not in data


def test_age_flags_omitted_when_declined(client, td_user, td_tournament, other_user, db):
    other_user.date_of_birth = date(2000, 1, 1)
    td_tournament.collect_is_over_18 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/{membership.id}/").json()
    assert "is_over_18" not in data


def test_age_flags_gated_independently_per_flag(client, td_user, td_tournament, other_user, db):
    """Collecting only is_over_18 shows only is_over_18, even with consent
    covering both — collection is the other half of the gate."""
    other_user.date_of_birth = date(2000, 1, 1)
    td_tournament.collect_is_over_18 = True
    td_tournament.collect_is_over_21 = False
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "consented"
    db.commit()
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/{membership.id}/").json()
    assert "is_over_18" in data
    assert "is_over_21" not in data


def test_age_flags_shown_when_collected_and_consented(client, td_user, td_tournament, other_user, db):
    other_user.date_of_birth = date(2000, 1, 1)
    td_tournament.collect_is_over_18 = True
    td_tournament.collect_is_over_21 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "consented"
    db.commit()
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/{membership.id}/").json()
    assert "is_over_18" in data
    assert "is_over_21" in data


def test_age_flags_gate_applies_to_my_membership_too(client, td_tournament, other_user, db):
    """The same gate applies on GET .../me/ — manage_members isn't required
    to read your own row, but consent still is."""
    other_user.date_of_birth = date(2000, 1, 1)
    td_tournament.collect_is_over_18 = True
    db.commit()
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "other@test.com", "otherpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()
    assert "is_over_18" not in data


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/members/me/ — leave a tournament
# ---------------------------------------------------------------------------

def test_leave_tournament_member_can_leave(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")

    assert client.delete(f"/tournaments/{other_tournament.id}/members/me/").status_code == 204
    assert (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == other_tournament.id,
            TournamentMembership.user_id == td_user.id,
        )
        .first()
        is None
    )


def test_leave_tournament_owner_must_transfer_first(client, td_user, td_tournament):
    """Letting the owner walk would strand the tournament with an owner_id
    pointing at a non-member."""
    login(client, "td@test.com", "tdpass")
    response = client.delete(f"/tournaments/{td_tournament.id}/members/me/")
    assert response.status_code == 400
    assert "transfer ownership" in response.json()["detail"].lower()


def test_leave_tournament_owner_can_leave_after_transfer(
    client, td_user, td_tournament, other_user, db
):
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    client.post(
        f"/tournaments/{td_tournament.id}/transfer-ownership/",
        json={"new_owner_id": other_user.id},
    )

    assert client.delete(f"/tournaments/{td_tournament.id}/members/me/").status_code == 204


def test_leave_tournament_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{other_tournament.id}/members/me/").status_code == 404


def test_leave_tournament_not_found(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.delete("/tournaments/9999/members/me/").status_code == 404


def test_leave_tournament_unauthenticated(client, td_tournament):
    assert client.delete(f"/tournaments/{td_tournament.id}/members/me/").status_code == 401


def test_leave_tournament_drops_role_assignments(client, td_user, other_tournament, db):
    """Cascade check — leaving must not orphan TournamentMembershipRole rows."""
    membership = grant_role(db, other_tournament, td_user, "Volunteer")
    membership_id = membership.id
    login(client, "td@test.com", "tdpass")

    assert client.delete(f"/tournaments/{other_tournament.id}/members/me/").status_code == 204
    assert (
        db.query(TournamentMembershipRole)
        .filter(TournamentMembershipRole.membership_id == membership_id)
        .count()
        == 0
    )
