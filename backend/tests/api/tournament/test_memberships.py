"""Tests for /tournaments/{tournament_id}/memberships endpoints."""

from datetime import UTC, date, datetime, timedelta

from app.core.tournament.display_config import MEMBERS_PANEL
from app.core.tournament.permissions import MANAGE_MEMBERS
from app.models.models import (
    Form,
    FormAnswer,
    FormField,
    FormResponse,
    TournamentForm,
    TournamentMembership,
    TournamentRole,
    TournamentTrackAssignment,
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
    return client.post(
        f"/tournaments/{tournament_id}/events/",
        json={
            "tournament_id": tournament_id,
            "name": "Boomilever",
            "division": "C",
        },
    ).json()


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


def _make_shift(db, tournament_id, label="Morning", day=1):
    from app.models.models import TournamentShift

    shift = TournamentShift(
        tournament_id=tournament_id,
        track_id=primary_track_id(db, tournament_id),
        label=label,
        start=datetime(2026, 3, day, 15, 0, tzinfo=UTC),
        end=datetime(2026, 3, day, 19, 0, tzinfo=UTC),
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return shift


def _make_track(db, tournament_id, name="Test Writing"):
    from app.models.models import TournamentTrack

    track = TournamentTrack(tournament_id=tournament_id, name=name)
    db.add(track)
    db.commit()
    db.refresh(track)
    return track


def _make_form(db, user, tournament_id, **overrides):
    defaults = dict(
        owner_type="tournament",
        tournament_id=tournament_id,
        chapter_id=None,
        name="Test form",
        title="Test form",
        status="published",
        created_by=user.id,
    )
    defaults.update(overrides)
    form = Form(**defaults)
    db.add(form)
    db.flush()
    return form


def _make_field(
    db,
    form,
    *,
    order=1,
    field_key="favorite_color",
    question_type="single_select_dropdown",
    **overrides,
):
    defaults = dict(
        form_id=form.id,
        order=order,
        label="Favorite color",
        question_type=question_type,
        field_key=field_key,
        config={"required": False, "options": []},
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
    for key in (
        "notes",
        "roles",
        "lunch",
        "availability",
        "track_statuses",
        "event_preferences",
        "custom_responses",
        "source",
        "join_code",
    ):
        assert key not in row, f"{key} should be absent without its group"
    for key in ("shirt_size", "volunteer_experience", "university"):
        assert key not in row["user"]


def test_onboarding_group_lists_the_members_path(client, td_user, td_tournament, db):
    """An archived step stays on the path only if answered; drafts never show."""
    from app.models.models import Form, FormResponse, TournamentForm

    u = _make_user(db, "alice@example.com")
    _make_membership(db, td_tournament.id, u["id"])
    steps = []
    statuses = ("published", "published", "archived", "archived", "draft")
    for order, status in enumerate(statuses, start=1):
        form = Form(
            owner_type="tournament",
            tournament_id=td_tournament.id,
            chapter_id=None,
            name=f"Step {order}",
            status=status,
            created_by=td_user.id,
        )
        db.add(form)
        db.flush()
        db.add(
            TournamentForm(
                form_id=form.id, tournament_id=td_tournament.id, is_onboarding=True, order=order
            )
        )
        steps.append(form)
    db.add_all(
        [
            FormResponse(form_id=steps[0].id, user_id=u["id"]),
            FormResponse(form_id=steps[2].id, user_id=u["id"]),
        ]
    )
    db.commit()
    login(client, "td@test.com", "tdpass")

    def step(form, status, completed):
        return {"form_id": form.id, "name": form.name, "status": status, "completed": completed}

    expected = {
        "completed": 2,
        "total": 3,
        "steps": [
            step(steps[0], "published", True),
            step(steps[1], "published", False),
            step(steps[2], "archived", True),
        ],
    }
    rows = client.get(f"/tournaments/{td_tournament.id}/members/?fields=onboarding").json()
    row = next(r for r in rows if r["user"]["id"] == u["id"])
    assert row["onboarding"] == expected
    detail = client.get(
        f"/tournaments/{td_tournament.id}/members/{row['id']}/?fields=onboarding"
    ).json()
    assert detail["onboarding"] == expected


def test_onboarding_group_is_null_without_live_steps(client, td_user, td_tournament, db):
    """No sequence means no progress to report — not a misleading 0/0."""
    u = _make_user(db, "alice@example.com")
    _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")

    rows = client.get(f"/tournaments/{td_tournament.id}/members/?fields=onboarding").json()
    row = next(r for r in rows if r["user"]["id"] == u["id"])
    assert row["onboarding"] is None


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
        r
        for r in client.get(f"/tournaments/{td_tournament.id}/members/").json()
        if r["user"]["id"] == u["id"]
    )
    for key in (
        "notes",
        "roles",
        "lunch",
        "availability",
        "track_statuses",
        "event_preferences",
        "custom_responses",
        "source",
        "user",
    ):
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

    body = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/?fields=notes").json()
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
    for key in ("lunch", "availability", "track_statuses", "event_preferences", "custom_responses"):
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
    from app.models.models import TournamentMembershipTrackStatus, TournamentTrack

    u = _make_user(db, "alice@example.com")
    m = _make_membership(db, td_tournament.id, u["id"])
    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    db.add(track)
    db.flush()
    db.add(
        TournamentMembershipTrackStatus(membership_id=m.id, track_id=track.id, status="confirmed")
    )
    db.commit()

    login(client, "td@test.com", "tdpass")
    row = next(
        r for r in client.get(f"/tournaments/{td_tournament.id}/members/").json() if r["id"] == m.id
    )
    assert row["track_statuses"] == [
        {
            "track_id": track.id,
            "name": "Test Writing",
            "is_archived": False,
            "status": "confirmed",
            "updated_at": row["track_statuses"][0]["updated_at"],
        }
    ]


def test_list_memberships_applies_the_requested_surface_config(client, td_user, td_tournament, db):
    """The roster renders the members *table* surface, so that's the config it
    honours — the panel's own hidden set is a separate surface now that each
    has its own controls.

    Also pins how `fields` and `surface` compose: the track column is what
    makes the tracks group requested at all, and `hidden` then empties it. A
    present-but-empty list is filtering; an absent key would mean the group
    was never asked for."""
    from app.models.models import TournamentMembershipTrackStatus, TournamentTrack

    u = _make_user(db, "alice@example.com")
    m = _make_membership(db, td_tournament.id, u["id"])
    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    db.add(track)
    db.flush()
    db.add(
        TournamentMembershipTrackStatus(membership_id=m.id, track_id=track.id, status="confirmed")
    )
    set_display_config(
        db,
        td_tournament,
        td_user,
        {
            "members_table": {
                "columns": [f"track:{track.id}"],
                "hidden": [f"track:{track.id}"],
            }
        },
    )

    login(client, "td@test.com", "tdpass")
    url = f"/tournaments/{td_tournament.id}/members/?surface=members_table"
    row = next(r for r in client.get(url).json() if r["id"] == m.id)
    assert row["track_statuses"] == []


def test_list_memberships_without_a_surface_is_unfiltered(client, td_user, td_tournament, db):
    """No surface means no opinion — the caller gets the plain roster rather
    than some surface's filtering applied by default."""
    from app.models.models import TournamentMembershipTrackStatus, TournamentTrack

    u = _make_user(db, "alice@example.com")
    m = _make_membership(db, td_tournament.id, u["id"])
    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    db.add(track)
    db.flush()
    db.add(
        TournamentMembershipTrackStatus(membership_id=m.id, track_id=track.id, status="confirmed")
    )
    set_display_config(
        db, td_tournament, td_user, {"members_table": {"hidden": [f"track:{track.id}"]}}
    )

    login(client, "td@test.com", "tdpass")
    row = next(
        r for r in client.get(f"/tournaments/{td_tournament.id}/members/").json() if r["id"] == m.id
    )
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
    db.add(
        TournamentMembershipLunch(
            membership_id=m.id,
            track_id=primary_track_id(db, td_tournament.id),
            category="entree",
            value="pizza",
            label="Pizza",
        )
    )
    db.commit()
    login(client, "td@test.com", "tdpass")

    url = f"/tournaments/{td_tournament.id}/members/?surface=members_table"
    row = next(r for r in client.get(url).json() if r["id"] == m.id)
    assert "lunch" not in row

    set_display_config(
        db,
        td_tournament,
        td_user,
        {
            "members_table": {
                "columns": [
                    f"lunch:{primary_track_id(db, td_tournament.id)}:entree",
                ]
            }
        },
    )
    row = next(r for r in client.get(url).json() if r["id"] == m.id)
    assert [entry["value"] for entry in row["lunch"]] == ["pizza"]


def test_members_table_carries_email_without_email_column(client, td_user, td_tournament, db):
    """Search matches on email whatever columns are shown, so hiding the email
    column must not drop it from the row."""
    u = _make_user(db, "alice@example.com")
    m = _make_membership(db, td_tournament.id, u["id"])
    set_display_config(db, td_tournament, td_user, {"members_table": {"columns": ["joined"]}})
    login(client, "td@test.com", "tdpass")

    url = f"/tournaments/{td_tournament.id}/members/?surface=members_table"
    row = next(r for r in client.get(url).json() if r["id"] == m.id)
    assert row["user"]["email"] == "alice@example.com"


def test_availability_column_carries_shifts_with_their_local_day(
    client, td_user, td_tournament, db
):
    """The table shows a badge per shift, so the rows carry the shifts
    themselves — each tagged with the tournament-local day its column keys by,
    resolved server-side rather than from the instant in the browser."""
    from app.models.models import TournamentMembershipAvailability, TournamentShift

    u = _make_user(db, "alice@example.com")
    m = _make_membership(db, td_tournament.id, u["id"])
    shift = TournamentShift(
        tournament_id=td_tournament.id,
        track_id=primary_track_id(db, td_tournament.id),
        label="Morning",
        start=datetime(2026, 3, 1, 15, 0, tzinfo=UTC),
        end=datetime(2026, 3, 1, 19, 0, tzinfo=UTC),
    )
    db.add(shift)
    db.flush()
    db.add(TournamentMembershipAvailability(membership_id=m.id, tournament_shift_id=shift.id))
    set_display_config(
        db,
        td_tournament,
        td_user,
        {
            "members_table": {
                "columns": [
                    f"availability_track:{primary_track_id(db, td_tournament.id)}",
                ]
            }
        },
    )

    login(client, "td@test.com", "tdpass")
    url = f"/tournaments/{td_tournament.id}/members/?surface=members_table"
    row = next(r for r in client.get(url).json() if r["id"] == m.id)
    assert row["availability"] == [
        {
            "shift_id": shift.id,
            "track_id": shift.track_id,
            "label": "Morning",
            "day": "2026-03-01",
            "start": "2026-03-01T15:00:00Z",
            "end": "2026-03-01T19:00:00Z",
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


class TestRosterRoleTracks:
    """A roster row's roles carry where each is held (#83) — the cell renders
    one chip per role, with a track pill menu on the ones that aren't
    tournament-wide."""

    def _roles_for(self, client, tournament_id, email):
        res = client.get(f"/tournaments/{tournament_id}/members/")
        assert res.status_code == 200, res.json()
        row = next(r for r in res.json() if r["user"]["email"] == email)
        return {r["label"]: r for r in row["roles"]}

    def test_a_track_scoped_role_lists_its_tracks(self, client, db, td_user, td_tournament):
        from tests.conftest import grant_role

        track = td_tournament.tracks[0]
        alice = _db_user_for_filter(db, "alice@example.com")
        grant_role(db, td_tournament, alice, "Volunteer", track_id=track.id)
        db.commit()

        login(client, "td@test.com", "tdpass")
        role = self._roles_for(client, td_tournament.id, "alice@example.com")["Volunteer"]
        assert role["is_tournament_wide"] is False
        assert role["track_ids"] == [track.id]

    def test_a_tournament_wide_role_lists_no_tracks(self, client, db, td_user, td_tournament):
        """Empty, not every track id: the role applies everywhere, and
        enumerating today's tracks would read as a narrower claim."""
        from tests.conftest import grant_role

        alice = _db_user_for_filter(db, "alice@example.com")
        grant_role(db, td_tournament, alice, "Volunteer")
        db.commit()

        login(client, "td@test.com", "tdpass")
        role = self._roles_for(client, td_tournament.id, "alice@example.com")["Volunteer"]
        assert role["is_tournament_wide"] is True
        assert role["track_ids"] == []

    def test_one_wide_row_makes_the_role_wide(self, client, db, td_user, td_tournament):
        """Holding a role tournament-wide *and* on a track is still wide —
        the per-track row adds nothing the wide one didn't already grant."""
        from tests.conftest import grant_role

        track = td_tournament.tracks[0]
        alice = _db_user_for_filter(db, "alice@example.com")
        grant_role(db, td_tournament, alice, "Volunteer", track_id=track.id)
        grant_role(db, td_tournament, alice, "Volunteer")
        db.commit()

        login(client, "td@test.com", "tdpass")
        role = self._roles_for(client, td_tournament.id, "alice@example.com")["Volunteer"]
        assert role["is_tournament_wide"] is True
        assert role["track_ids"] == []


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
        # roles is the distinct TournamentRole list now, not the join rows.
        role_id = volunteer.roles[0].id
        assert self._roster(client, td_tournament.id, f"?role={role_id}") == {"alice@example.com"}

    def test_role_filter_none_finds_members_without_roles(self, client, db, td_user, td_tournament):
        from tests.conftest import grant_role

        grant_role(db, td_tournament, _db_user_for_filter(db, "alice@example.com"), "Volunteer")
        _make_membership(db, td_tournament.id, _db_user_for_filter(db, "bob@example.com").id)
        db.commit()

        login(client, "td@test.com", "tdpass")
        assert "bob@example.com" in self._roster(client, td_tournament.id, "?role=none")
        assert "alice@example.com" not in self._roster(client, td_tournament.id, "?role=none")

    def test_role_filter_narrows_to_tracks(self, client, db, td_user, td_tournament):
        """ "roleId:trackId" asks who holds that role that day. A tournament-wide
        grant is held on every track, so it answers too."""
        from app.models.models import TournamentTrack
        from tests.conftest import grant_role

        writing = TournamentTrack(tournament_id=td_tournament.id, name="Writing")
        db.add(writing)
        db.flush()
        day_one = td_tournament.tracks[0]

        alice = grant_role(
            db,
            td_tournament,
            _db_user_for_filter(db, "alice@example.com"),
            "Volunteer",
            track_id=day_one.id,
        )
        grant_role(
            db,
            td_tournament,
            _db_user_for_filter(db, "bob@example.com"),
            "Volunteer",
            track_id=writing.id,
        )
        grant_role(db, td_tournament, _db_user_for_filter(db, "carol@example.com"), "Volunteer")
        db.commit()
        role_id = alice.roles[0].id

        login(client, "td@test.com", "tdpass")
        everyone = {"alice@example.com", "bob@example.com", "carol@example.com"}
        assert self._roster(client, td_tournament.id, f"?role={role_id}") == everyone
        assert self._roster(client, td_tournament.id, f"?role={role_id}:__any__") == everyone
        assert self._roster(client, td_tournament.id, f"?role={role_id}:{day_one.id}") == {
            "alice@example.com",
            "carol@example.com",
        }
        # Several tracks on one role OR together, the way every other filter's
        # values do.
        assert (
            self._roster(
                client,
                td_tournament.id,
                f"?role={role_id}:{day_one.id}&role={role_id}:{writing.id}",
            )
            == everyone
        )

    def test_track_filter_pairs_track_with_status(self, client, db, td_user, td_tournament):
        """A member confirmed on one track and declined on another must not
        match "declined on the first" — which is why the pair travels together."""
        from app.models.models import TournamentMembershipTrackStatus, TournamentTrack

        writing = TournamentTrack(tournament_id=td_tournament.id, name="Writing")
        running = TournamentTrack(tournament_id=td_tournament.id, name="Running")
        db.add_all([writing, running])
        db.flush()
        alice = _make_membership(
            db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id
        )
        db.add_all(
            [
                TournamentMembershipTrackStatus(
                    membership_id=alice.id, track_id=writing.id, status="confirmed"
                ),
                TournamentMembershipTrackStatus(
                    membership_id=alice.id, track_id=running.id, status="declined"
                ),
            ]
        )
        db.commit()

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, f"?track={writing.id}:confirmed") == {
            "alice@example.com"
        }
        assert self._roster(client, td_tournament.id, f"?track={writing.id}:declined") == set()

    def test_filters_of_different_kinds_and_together(self, client, db, td_user, td_tournament):
        from app.models.models import (
            TournamentMembershipLunch,
            TournamentMembershipTrackStatus,
            TournamentTrack,
        )

        track = TournamentTrack(tournament_id=td_tournament.id, name="Writing")
        db.add(track)
        db.flush()
        alice = _make_membership(
            db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id
        )
        bob = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "bob@example.com").id)
        db.add_all(
            [
                TournamentMembershipTrackStatus(
                    membership_id=alice.id, track_id=track.id, status="confirmed"
                ),
                TournamentMembershipTrackStatus(
                    membership_id=bob.id, track_id=track.id, status="confirmed"
                ),
                TournamentMembershipLunch(
                    membership_id=alice.id,
                    track_id=primary_track_id(db, td_tournament.id),
                    category="entree",
                    value="pizza",
                    label="Pizza",
                ),
            ]
        )
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
            db.query(UserModel).filter(UserModel.id == user.id).one().date_of_birth = date(
                1980, 1, 1
            )
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

    def test_age_filter_ignores_a_flag_the_tournament_does_not_collect(
        self, client, db, td_user, td_tournament
    ):
        from app.models.models import User as UserModel

        user = _db_user_for_filter(db, "adult@example.com")
        db.query(UserModel).filter(UserModel.id == user.id).one().date_of_birth = date(1980, 1, 1)
        m = _make_membership(db, td_tournament.id, user.id)
        m.age_disclosure = "consented"
        td_tournament.collect_is_over_18 = False
        db.commit()

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, "?age=over_18") == set()

    def test_filter_options_lists_what_the_tournament_holds(
        self, client, db, td_user, td_tournament
    ):
        from app.models.models import TournamentMembershipLunch, TournamentTrack

        db.add(TournamentTrack(tournament_id=td_tournament.id, name="Writing"))
        m = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id)
        db.add(
            TournamentMembershipLunch(
                membership_id=m.id,
                track_id=primary_track_id(db, td_tournament.id),
                category="entree",
                value="pizza",
                label="Pizza",
            )
        )
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

    def test_event_preference_options_name_the_division_without_parentheses(
        self,
        client,
        db,
        td_user,
        td_tournament,
    ):
        """ "Chess C", not "Chess (C)" — the division identifies which of the
        two same-named events a row is, so it reads as part of the name."""
        from app.models.models import (
            TournamentEvent,
            TournamentEventTrack,
            TournamentMembershipEventPreference,
        )

        track_id = primary_track_id(db, td_tournament.id)
        chess_c = TournamentEvent(tournament_id=td_tournament.id, name="Chess", division="C")
        chess_b = TournamentEvent(tournament_id=td_tournament.id, name="Chess", division="B")
        no_division = TournamentEvent(tournament_id=td_tournament.id, name="Anatomy")
        db.add_all([chess_c, chess_b, no_division])
        m = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id)
        db.flush()
        # On the track, since a group only offers that track's events.
        db.add_all(
            [
                TournamentEventTrack(tournament_event_id=e.id, track_id=track_id)
                for e in (chess_c, chess_b, no_division)
            ]
        )
        # A stored answer is what puts the track in event_preferences at all.
        db.add(
            TournamentMembershipEventPreference(
                membership_id=m.id,
                track_id=track_id,
                tournament_event_id=chess_c.id,
                rank=1,
            )
        )
        db.commit()

        login(client, "td@test.com", "tdpass")
        body = client.get(f"/tournaments/{td_tournament.id}/members/filter-options/").json()
        group = next(g for g in body["event_preferences"] if g["value"] == str(track_id))
        labels = [o["label"] for o in group["options"]]
        assert "Chess C" in labels
        # An event with no division is named by itself, with no trailing space.
        assert "Anatomy" in labels
        # Sorted by name then division, so the two Chess rows keep a fixed order.
        assert labels.index("Chess B") < labels.index("Chess C")

    def test_event_preference_options_only_offer_that_tracks_events(
        self,
        client,
        db,
        td_user,
        td_tournament,
    ):
        """A track's group offers that track's events, like the question
        itself — plus anything already ranked there."""
        from app.models.models import (
            TournamentEvent,
            TournamentEventTrack,
            TournamentMembershipEventPreference,
        )

        track_id = primary_track_id(db, td_tournament.id)
        on_track = TournamentEvent(tournament_id=td_tournament.id, name="Anatomy", division="C")
        off_track = TournamentEvent(tournament_id=td_tournament.id, name="Boomilever", division="C")
        ranked = TournamentEvent(tournament_id=td_tournament.id, name="Chess", division="C")
        db.add_all([on_track, off_track, ranked])
        m = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id)
        db.flush()
        db.add(TournamentEventTrack(tournament_event_id=on_track.id, track_id=track_id))
        db.add(
            TournamentMembershipEventPreference(
                membership_id=m.id,
                track_id=track_id,
                tournament_event_id=ranked.id,
                rank=1,
            )
        )
        db.commit()

        login(client, "td@test.com", "tdpass")
        body = client.get(f"/tournaments/{td_tournament.id}/members/filter-options/").json()
        group = next(g for g in body["event_preferences"] if g["value"] == str(track_id))
        labels = [o["label"] for o in group["options"]]
        assert "Anatomy C" in labels
        assert "Chess C" in labels
        assert "Boomilever C" not in labels

    def test_pending_delete_tracks_are_not_filter_groups(
        self,
        client,
        db,
        td_user,
        td_tournament,
    ):
        """A pending-delete track is on its way out — no availability or
        event-preference group for it, even while rows still point at it."""
        from datetime import datetime, timedelta

        from app.models.models import (
            TournamentEvent,
            TournamentMembershipEventPreference,
            TournamentShift,
            TournamentTrack,
        )

        archived = TournamentTrack(tournament_id=td_tournament.id, name="Retired", is_archived=True)
        event = TournamentEvent(tournament_id=td_tournament.id, name="Chess", division="C")
        db.add_all([archived, event])
        m = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id)
        db.flush()
        start = datetime.now(UTC)
        db.add(
            TournamentShift(
                tournament_id=td_tournament.id,
                track_id=archived.id,
                label="Old",
                start=start,
                end=start + timedelta(hours=2),
            )
        )
        db.add(
            TournamentMembershipEventPreference(
                membership_id=m.id,
                track_id=archived.id,
                tournament_event_id=event.id,
                rank=1,
            )
        )
        db.commit()

        login(client, "td@test.com", "tdpass")
        body = client.get(f"/tournaments/{td_tournament.id}/members/filter-options/").json()
        assert str(archived.id) not in [g["value"] for g in body["shift_days"]]
        assert str(archived.id) not in [g["value"] for g in body["event_preferences"]]

    def test_lunch_options_come_from_the_question_not_the_answers(
        self, client, db, td_user, td_tournament
    ):
        """A choice nobody picked is still offerable — that's how a TD finds
        who didn't pick it."""
        from app.models.models import Form, FormField

        form = Form(
            owner_type="tournament",
            tournament_id=td_tournament.id,
            name="Signup",
            created_by=td_user.id,
        )
        db.add(form)
        db.flush()
        db.add(
            FormField(
                form_id=form.id,
                order=0,
                label="Protein",
                field_key=f"lunch_{primary_track_id(db, td_tournament.id)}_protein",
                question_type="single_select_radio",
                config={
                    "options": [
                        {"option_id": "opt_1", "value": "Sofritas", "label": "Sofritas"},
                        {
                            "option_id": "opt_2",
                            "value": "Chicken",
                            "label": "Chicken",
                            "is_archived": True,
                        },
                    ]
                },
            )
        )
        db.commit()

        login(client, "td@test.com", "tdpass")
        body = client.get(f"/tournaments/{td_tournament.id}/members/filter-options/").json()
        protein = next(g for g in body["lunch_categories"] if g["value"] == "protein")
        assert [o["value"] for o in protein["options"]] == ["Sofritas"]

    def test_lunch_any_and_unanswered_split_on_a_stored_row(
        self, client, db, td_user, td_tournament
    ):
        """ "Answered" and "not answered" are the whole point of the sentinels:
        a free-text lunch question has no options to name."""
        from app.models.models import TournamentMembershipLunch

        alice = _make_membership(
            db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id
        )
        _make_membership(db, td_tournament.id, _db_user_for_filter(db, "bob@example.com").id)
        db.add(
            TournamentMembershipLunch(
                membership_id=alice.id,
                track_id=primary_track_id(db, td_tournament.id),
                category="dietary",
                value="none",
                label="none",
            )
        )
        db.commit()

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, "?lunch=dietary:__any__") == {
            "alice@example.com"
        }
        assert self._roster(client, td_tournament.id, "?lunch=dietary:__unanswered__") == {
            "bob@example.com",
            "td@test.com",
        }
        # "none" is an answer; a missing row is not the same as answering none.
        assert self._roster(client, td_tournament.id, "?lunch=dietary:__none__") == {
            "alice@example.com"
        }
        assert self._roster(client, td_tournament.id, "?lunch=dietary:__not_none__") == set()

    def test_event_preference_rank_condition(self, client, db, td_user, td_tournament):
        """The rank is checked on the same row as the event: Alice ranked
        Chess 3rd, which must not let her Anatomy pass "Anatomy = 3"."""
        from app.models.models import TournamentEvent, TournamentMembershipEventPreference

        track_id = primary_track_id(db, td_tournament.id)
        anatomy = TournamentEvent(tournament_id=td_tournament.id, name="Anatomy")
        chess = TournamentEvent(tournament_id=td_tournament.id, name="Chess")
        db.add_all([anatomy, chess])
        alice = _make_membership(
            db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id
        )
        bob = _make_membership(db, td_tournament.id, _db_user_for_filter(db, "bob@example.com").id)
        carol = _make_membership(
            db, td_tournament.id, _db_user_for_filter(db, "carol@example.com").id
        )
        db.flush()
        db.add_all(
            [
                TournamentMembershipEventPreference(
                    membership_id=alice.id,
                    track_id=track_id,
                    tournament_event_id=anatomy.id,
                    rank=1,
                ),
                TournamentMembershipEventPreference(
                    membership_id=alice.id, track_id=track_id, tournament_event_id=chess.id, rank=3
                ),
                TournamentMembershipEventPreference(
                    membership_id=bob.id, track_id=track_id, tournament_event_id=anatomy.id, rank=3
                ),
                # A checkbox question stores no rank.
                TournamentMembershipEventPreference(
                    membership_id=carol.id,
                    track_id=track_id,
                    tournament_event_id=anatomy.id,
                    rank=None,
                ),
            ]
        )
        db.commit()

        login(client, "td@test.com", "tdpass")
        anatomy_pref = f"event_pref={track_id}:{anatomy.id}"
        roster = lambda rank: self._roster(  # noqa: E731
            client, td_tournament.id, f"?{anatomy_pref}&event_pref={track_id}:rank:{rank}"
        )
        assert roster("le:2") == {"alice@example.com"}
        assert roster("eq:3") == {"bob@example.com"}
        assert roster("gt:1") == {"bob@example.com"}
        # An unranked row fails every comparison.
        assert roster("ge:1") == {"alice@example.com", "bob@example.com"}
        # No events picked: any event at that rank.
        assert self._roster(client, td_tournament.id, f"?event_pref={track_id}:rank:eq:3") == {
            "alice@example.com",
            "bob@example.com",
        }
        # A malformed condition is ignored, like any bad filter value.
        assert self._roster(
            client, td_tournament.id, f"?{anatomy_pref}&event_pref={track_id}:rank:near:2"
        ) == {
            "alice@example.com",
            "bob@example.com",
            "carol@example.com",
        }

    def test_track_any_status_matches_any_answer(self, client, db, td_user, td_tournament):
        from app.models.models import TournamentMembershipTrackStatus, TournamentTrack

        track = TournamentTrack(tournament_id=td_tournament.id, name="Writing")
        db.add(track)
        db.flush()
        alice = _make_membership(
            db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id
        )
        db.add(
            TournamentMembershipTrackStatus(
                membership_id=alice.id, track_id=track.id, status="declined"
            )
        )
        db.commit()

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, f"?track={track.id}:__any__") == {
            "alice@example.com"
        }

    def test_shift_filter_takes_a_track_or_one_shift(self, client, db, td_user, td_tournament):
        """A track-level value resolves to every shift on that track. Was
        day-level, which couldn't separate two sites running the same day."""
        from datetime import datetime

        from app.models.models import TournamentMembershipAvailability, TournamentShift

        track_id = primary_track_id(db, td_tournament.id)
        morning = TournamentShift(
            tournament_id=td_tournament.id,
            track_id=track_id,
            label="Impound",
            start=datetime(2026, 5, 21, 15, 0, tzinfo=UTC),
            end=datetime(2026, 5, 21, 17, 0, tzinfo=UTC),
        )
        db.add(morning)
        db.flush()
        alice = _make_membership(
            db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id
        )
        _make_membership(db, td_tournament.id, _db_user_for_filter(db, "bob@example.com").id)
        db.add(
            TournamentMembershipAvailability(membership_id=alice.id, tournament_shift_id=morning.id)
        )
        db.commit()

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, f"?shift={track_id}:{morning.id}") == {
            "alice@example.com"
        }
        assert self._roster(client, td_tournament.id, f"?shift={track_id}:__any__") == {
            "alice@example.com"
        }

    def _profiled_members(self, db, tournament_id):
        """Undergrads at UCLA, a grad student with no school, and non-students
        working at UCLA, spelled their own way."""
        from app.models.models import University

        ucla = University(name="University of California, Los Angeles", abbreviation="UCLA")
        db.add(ucla)
        db.flush()
        profiles = {
            "frosh@example.com": {
                "student_status": "Undergraduate",
                "university_id": ucla.id,
                "year_level": 1,
            },
            "super@example.com": {
                "student_status": "Undergraduate",
                "university_id": ucla.id,
                "year_level": 6,
            },
            "grad@example.com": {"student_status": "Graduate", "university_id": None},
            "staff@example.com": {"student_status": "Non-Student", "employer": "UCLA"},
            "staff2@example.com": {"student_status": "Non-Student", "employer": " ucla "},
            # A school left over from before they graduated is not an affiliation.
            "alum@example.com": {
                "student_status": "Non-Student",
                "university_id": ucla.id,
                "employer": "Acme",
            },
        }
        for email, fields in profiles.items():
            user = _db_user_for_filter(db, email)
            for name, value in fields.items():
                setattr(user, name, value)
            _make_membership(db, tournament_id, user.id)
        db.commit()

    def test_affiliation_filter_matches_school_and_employer_alike(
        self, client, db, td_user, td_tournament
    ):
        """One value covers students at the school (by its short name) and
        anyone employed there, whatever the case or spacing."""
        self._profiled_members(db, td_tournament.id)

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, "?affiliation=ucla") == {
            "frosh@example.com",
            "super@example.com",
            "staff@example.com",
            "staff2@example.com",
        }
        assert self._roster(client, td_tournament.id, "?affiliation=UCLA&affiliation=Acme") == {
            "frosh@example.com",
            "super@example.com",
            "staff@example.com",
            "staff2@example.com",
            "alum@example.com",
        }

    def test_year_level_filter(self, client, db, td_user, td_tournament):
        self._profiled_members(db, td_tournament.id)

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, "?year_level=1") == {"frosh@example.com"}
        # 5 is "5th Year+", so it takes anything past it.
        assert self._roster(client, td_tournament.id, "?year_level=5") == {"super@example.com"}
        assert self._roster(
            client, td_tournament.id, "?year_level=graduate&year_level=non_student"
        ) == {
            "grad@example.com",
            "staff@example.com",
            "staff2@example.com",
            "alum@example.com",
        }

    def test_affiliation_filter_combines_with_name_search(self, client, db, td_user, td_tournament):
        """The search joins User into the outer query; the filter's EXISTS must
        still check each member's own profile."""
        self._profiled_members(db, td_tournament.id)

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, "?q=frosh&affiliation=UCLA") == {
            "frosh@example.com"
        }
        assert self._roster(client, td_tournament.id, "?q=frosh&affiliation=Acme") == set()

    def test_affiliation_filter_options(self, client, db, td_user, td_tournament):
        """The school and the employers spelled like it are one option, under
        the school's spelling."""
        self._profiled_members(db, td_tournament.id)

        login(client, "td@test.com", "tdpass")
        body = client.get(f"/tournaments/{td_tournament.id}/members/filter-options/").json()
        assert body["affiliations"] == [
            {"value": "Acme", "label": "Acme"},
            {"value": "UCLA", "label": "UCLA"},
        ]

    def test_onboarding_filter(self, client, db, td_user, td_tournament):
        from app.models.models import FormResponse

        steps = []
        for order in (1, 2):
            form = _make_form(db, td_user, td_tournament.id, name=f"Step {order}")
            db.add(
                TournamentForm(
                    form_id=form.id, tournament_id=td_tournament.id, is_onboarding=True, order=order
                )
            )
            steps.append(form)
        answered = {"alice@example.com": 0, "bob@example.com": 1, "carol@example.com": 2}
        for email, count in answered.items():
            user = _db_user_for_filter(db, email)
            _make_membership(db, td_tournament.id, user.id)
            db.add_all(FormResponse(form_id=form.id, user_id=user.id) for form in steps[:count])
        db.commit()

        login(client, "td@test.com", "tdpass")
        # The TD's path has the same two steps, neither answered.
        assert self._roster(client, td_tournament.id, "?onboarding=not_started") == {
            "alice@example.com",
            "td@test.com",
        }
        assert self._roster(client, td_tournament.id, "?onboarding=in_progress") == {
            "bob@example.com"
        }
        assert self._roster(
            client, td_tournament.id, "?onboarding=in_progress&onboarding=complete"
        ) == {"bob@example.com", "carol@example.com"}
        body = client.get(f"/tournaments/{td_tournament.id}/members/filter-options/").json()
        assert body["has_onboarding"] is True

    def test_onboarding_filter_without_steps_matches_nobody(
        self, client, db, td_user, td_tournament
    ):
        """No steps is no state, not "not started"."""
        _make_membership(db, td_tournament.id, _db_user_for_filter(db, "alice@example.com").id)

        login(client, "td@test.com", "tdpass")
        assert self._roster(client, td_tournament.id, "?onboarding=not_started") == set()
        body = client.get(f"/tournaments/{td_tournament.id}/members/filter-options/").json()
        assert body["has_onboarding"] is False


def test_list_memberships_requires_manage_members(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/members/").status_code == 403


def test_list_memberships_no_membership_in_tournament(client, td_user):
    """Membership existence check fires before permission — 404, not 403, so
    a tournament the user isn't in never leaks its existence."""
    login(client, "td@test.com", "tdpass")
    assert client.get("/tournaments/9999/members/").status_code == 404


def test_list_memberships_includes_roles(client, td_user, td_tournament, db):
    """Roles are unwrapped from TournamentTrackAssignment to RoleRead in the slim response too."""
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
    from app.models.models import TournamentMembershipTrackStatus, TournamentTrack

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
            db.add(
                TournamentMembershipTrackStatus(
                    membership_id=m.id,
                    track_id=track.id,
                    status="confirmed",
                )
            )
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

    td_role = (
        db.query(TournamentRole)
        .filter(
            TournamentRole.tournament_id == td_tournament.id,
            TournamentRole.label == "Tournament Director",
        )
        .one()
    )

    peer = (
        db.query(UserModel).filter(UserModel.id == _make_user(db, "peer@example.com")["id"]).first()
    )
    _make_low_rank_role(db, td_tournament, "Peer Staff", rank=50)
    grant_role(db, td_tournament, peer, "Peer Staff")

    junior = (
        db.query(UserModel)
        .filter(UserModel.id == _make_user(db, "junior@example.com")["id"])
        .first()
    )
    _make_low_rank_role(db, td_tournament, "Junior Staff", rank=90)
    grant_role(db, td_tournament, junior, "Junior Staff")

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/?max_rank=50")
    assert response.status_code == 200
    emails = [m["user"]["email"] for m in response.json()]

    assert "junior@example.com" in emails  # rank 90, less authority — actionable
    assert "peer@example.com" not in emails  # rank 50, exact tie — excluded
    assert "td@test.com" not in emails  # rank 10, outranks — excluded
    assert td_role.rank < 50


def test_search_memberships_max_rank_keeps_roleless_members(client, td_user, td_tournament, db):
    """A member with no roles has no authority at all, so they always pass the
    max_rank filter — the NOT IN subquery only matches members that hold roles."""
    roleless = _make_user(db, "roleless@example.com")
    _make_membership(db, td_tournament.id, roleless["id"])

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/?max_rank=50")
    assert response.status_code == 200
    assert "roleless@example.com" in [m["user"]["email"] for m in response.json()]


def test_search_memberships_requires_manage_members(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/members/").status_code == 403


def test_search_memberships_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/members/").status_code == 404


# ---------------------------------------------------------------------------
# Get single
# ---------------------------------------------------------------------------


def test_get_membership(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"], notes="Allergic to nuts")
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == m.id
    assert data["notes"] == "Allergic to nuts"
    assert data["user"]["email"] == u["email"]


def test_get_membership_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{td_tournament.id}/members/9999/").status_code == 404


def test_get_membership_wrong_tournament(client, td_user, td_tournament, other_tournament, db):
    """A real membership ID from a different tournament still 404s — no cross-tournament leak."""
    u = _make_user(db)
    m = _make_membership(db, other_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/").status_code == 404


def test_get_membership_rejects_a_member_reading_their_own_row(
    client, td_user, other_tournament, db
):
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
    assert client.get(f"/tournaments/{other_tournament.id}/members/{m.id}/").status_code == 403

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
        tournament_id=tournament.id,
        created_by=creator_user.id,
        code=f"JC{creator_user.id:03d}{member_user.id:03d}"[:8],
        label="Staff",
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
            tournament_id=tournament.id,
            user_id=member_user.id,
            source="join_code",
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
    creator = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/").json()["join_code"][
        "creator"
    ]
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
    assert client.get(f"/tournaments/{other_tournament.id}/members/{m.id}/").status_code == 403


def test_get_membership_requires_manage_members(client, td_user, other_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, other_tournament.id, u["id"])
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/members/{m.id}/").status_code == 403


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
        TournamentMembershipAvailability,
        TournamentMembershipLunch,
        TournamentShift,
    )

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])

    shift = TournamentShift(
        tournament_id=td_tournament.id,
        track_id=primary_track_id(db, td_tournament.id),
        label="Morning",
        start=datetime(2026, 5, 21, 8, 0),
        end=datetime(2026, 5, 21, 12, 0),
    )
    db.add(shift)
    db.flush()
    db.add(TournamentMembershipAvailability(membership_id=m.id, tournament_shift_id=shift.id))
    db.add(
        TournamentMembershipLunch(
            membership_id=m.id,
            track_id=primary_track_id(db, td_tournament.id),
            category="entree",
            value="pizza",
            label="Pizza",
        )
    )
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
        "track_id": primary_track_id(db, td_tournament.id),
        "track_name": "Main",
        "category": "entree",
        "value": "pizza",
        "question_type": None,
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
    assert custom == [
        {
            "form_title": "Volunteer interest",
            "field_label": "Favorite color",
            "field_key": "favorite_color",
            "question_type": "single_select_dropdown",
            "value": "opt_1",
        }
    ]


def test_custom_responses_keep_the_latest_answer_per_key(client, td_user, td_tournament, db):
    """Forms may share a key with any question type; the latest answer wins
    whichever form it came from, on the roster and the detail route alike."""
    from datetime import UTC, datetime

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    newer_form = _make_form(db, td_user, td_tournament.id, title="Newer")
    older_form = _make_form(db, td_user, td_tournament.id, title="Older")
    newer = _make_answer(
        db,
        u["id"],
        newer_form,
        _make_field(db, newer_form, field_key="shirt_size", question_type="short_text"),
        "M",
    )
    older = _make_answer(
        db, u["id"], older_form, _make_field(db, older_form, field_key="shirt_size"), "opt_s"
    )
    newer.answered_at = datetime(2026, 2, 1, tzinfo=UTC)
    older.answered_at = datetime(2026, 1, 1, tzinfo=UTC)
    db.commit()
    login(client, "td@test.com", "tdpass")

    detail = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/").json()
    rows = client.get(f"/tournaments/{td_tournament.id}/members/?fields=custom").json()
    row = next(r for r in rows if r["user"]["id"] == u["id"])

    for custom in (detail["custom_responses"], row["custom_responses"]):
        assert [(a["form_title"], a["value"]) for a in custom] == [("Newer", "M")]


def test_get_membership_custom_responses_excludes_reserved_field_keys(
    client, td_user, td_tournament, db
):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    form = _make_form(db, td_user, td_tournament.id)
    reserved = _make_field(
        db,
        form,
        field_key="track_status_writer",
        question_type="single_select_radio",
    )
    _make_answer(db, u["id"], form, reserved, "confirmed")

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/")
    assert response.status_code == 200
    assert response.json()["custom_responses"] == []


def test_get_membership_custom_responses_excludes_unpublished_forms(
    client, td_user, td_tournament, db
):
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
    from app.models.models import TournamentMembershipTrackStatus, TournamentTrack

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    db.add(track)
    db.flush()
    db.add(
        TournamentMembershipTrackStatus(membership_id=m.id, track_id=track.id, status="confirmed")
    )
    db.commit()
    _set_display_config(db, td_tournament, td_user, MEMBERS_PANEL, [f"track:{track.id}"])

    login(client, "td@test.com", "tdpass")
    response = client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/?surface={MEMBERS_PANEL}"
    )
    assert response.status_code == 200
    # Only the hidden track drops; the tournament's own primary track still
    # pads in as pending.
    assert [t["name"] for t in response.json()["track_statuses"]] == ["Main"]


def test_get_membership_surface_hides_lunch_category(client, td_user, td_tournament, db):
    from app.models.models import TournamentMembershipLunch

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    db.add(
        TournamentMembershipLunch(
            membership_id=m.id,
            track_id=primary_track_id(db, td_tournament.id),
            category="entree",
            value="veggie",
            label="Veggie wrap",
        )
    )
    db.commit()
    _set_display_config(
        db,
        td_tournament,
        td_user,
        MEMBERS_PANEL,
        [
            f"lunch:{primary_track_id(db, td_tournament.id)}:entree",
        ],
    )

    login(client, "td@test.com", "tdpass")
    response = client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/?surface={MEMBERS_PANEL}"
    )
    assert response.status_code == 200
    assert response.json()["lunch"] == []


def test_get_membership_surface_hides_event_preference(client, td_user, td_tournament, db):
    from app.models.models import TournamentMembershipEventPreference

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id)
    db.add(
        TournamentMembershipEventPreference(
            membership_id=m.id,
            tournament_event_id=event["id"],
            track_id=primary_track_id(db, td_tournament.id),
            rank=1,
        )
    )
    db.commit()
    _set_display_config(
        db,
        td_tournament,
        td_user,
        MEMBERS_PANEL,
        [
            f"event_pref:{primary_track_id(db, td_tournament.id)}",
        ],
    )

    response = client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/?surface={MEMBERS_PANEL}"
    )
    assert response.status_code == 200
    assert response.json()["event_preferences"] == []


def test_get_membership_surface_hides_custom_response(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    form = _make_form(db, td_user, td_tournament.id, title="Volunteer interest")
    field = _make_field(db, form, field_key="favorite_color", label="Favorite color")
    _make_answer(db, u["id"], form, field, "opt_1")
    _set_display_config(db, td_tournament, td_user, MEMBERS_PANEL, ["field_key:favorite_color"])

    login(client, "td@test.com", "tdpass")
    response = client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/?surface={MEMBERS_PANEL}"
    )
    assert response.status_code == 200
    assert response.json()["custom_responses"] == []


def test_get_membership_surface_hides_availability_track(client, td_user, td_tournament, db):
    """Hiding a track's availability drops its rows from the detail read."""
    from app.models.models import TournamentMembershipAvailability

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    shift = _make_shift(db, td_tournament.id, "Morning", day=1)
    db.add(TournamentMembershipAvailability(membership_id=m.id, tournament_shift_id=shift.id))
    db.commit()
    _set_display_config(
        db,
        td_tournament,
        td_user,
        MEMBERS_PANEL,
        [
            f"availability_track:{primary_track_id(db, td_tournament.id)}",
        ],
    )

    login(client, "td@test.com", "tdpass")
    response = client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/?surface={MEMBERS_PANEL}"
    )
    assert response.status_code == 200
    assert response.json()["availability"] == []


def test_get_membership_no_surface_is_unfiltered(client, td_user, td_tournament, db):
    """No `surface` query param at all is a no-op — existing callers with no
    opinion on filtering keep getting the full payload even if display_config
    has hidden items configured for some other surface."""
    from app.models.models import TournamentMembershipTrackStatus, TournamentTrack

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    db.add(track)
    db.flush()
    db.add(
        TournamentMembershipTrackStatus(membership_id=m.id, track_id=track.id, status="confirmed")
    )
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
    _set_display_config(
        db,
        td_tournament,
        td_user,
        MEMBERS_PANEL,
        [
            "track:1",
            f"lunch:{track_id}:entree",
            f"event_pref:{track_id}",
        ],
    )

    login(client, "td@test.com", "tdpass")
    response = client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/?surface={MEMBERS_PANEL}"
    )
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


def test_get_my_membership_needs_onboarding_until_steps_are_answered(
    client, db, td_user, td_tournament, other_user
):
    grant_role(db, td_tournament, other_user, "Volunteer")
    step = Form(
        owner_type="tournament",
        tournament_id=td_tournament.id,
        name="Step 1",
        status="published",
        created_by=td_user.id,
    )
    db.add(step)
    db.flush()
    db.add(
        TournamentForm(form_id=step.id, tournament_id=td_tournament.id, is_onboarding=True, order=1)
    )
    db.commit()
    login(client, "other@test.com", "otherpass")
    url = f"/tournaments/{td_tournament.id}/members/me/?fields=roles"

    assert client.get(url).json()["needs_onboarding"] is True
    db.add(FormResponse(form_id=step.id, user_id=other_user.id))
    db.commit()
    assert client.get(url).json()["needs_onboarding"] is False


def test_get_my_membership_permission_holder_never_needs_onboarding(
    client, db, td_user, td_tournament, other_user
):
    grant_role(db, td_tournament, other_user, "Runner")
    db.query(TournamentRole).filter(
        TournamentRole.tournament_id == td_tournament.id, TournamentRole.label == "Runner"
    ).one().permissions = [MANAGE_MEMBERS]
    step = Form(
        owner_type="tournament",
        tournament_id=td_tournament.id,
        name="Step 1",
        status="published",
        created_by=td_user.id,
    )
    db.add(step)
    db.flush()
    db.add(
        TournamentForm(form_id=step.id, tournament_id=td_tournament.id, is_onboarding=True, order=1)
    )
    db.commit()
    login(client, "other@test.com", "otherpass")

    me = client.get(f"/tournaments/{td_tournament.id}/members/me/?fields=roles").json()
    assert me["needs_onboarding"] is False


def test_get_my_membership_includes_enrichment(client, td_tournament, db):
    """/me/ carries the same enrichment MembershipFullResponse gives
    manage_members about someone else — a plain member with no special
    permission still reads their own availability/lunch/custom answers/age
    flags."""
    from datetime import datetime

    from app.core.auth import hash_password
    from app.models.models import (
        TournamentMembershipAvailability,
        TournamentMembershipLunch,
        TournamentShift,
    )
    from app.models.models import (
        User as UserModel,
    )

    u = _make_user(db, "volunteer2@example.com")
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    user.hashed_password = hash_password("volpass")
    db.commit()
    membership = grant_role(db, td_tournament, user, "Volunteer")

    shift = TournamentShift(
        tournament_id=td_tournament.id,
        track_id=primary_track_id(db, td_tournament.id),
        label="Morning",
        start=datetime(2026, 5, 21, 8, 0),
        end=datetime(2026, 5, 21, 12, 0),
    )
    db.add(shift)
    db.flush()
    db.add(
        TournamentMembershipAvailability(membership_id=membership.id, tournament_shift_id=shift.id)
    )
    db.add(
        TournamentMembershipLunch(
            membership_id=membership.id,
            track_id=primary_track_id(db, td_tournament.id),
            category="entree",
            value="pizza",
            label="Pizza",
        )
    )
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
    """A track the member has never answered comes back as "pending"."""
    track = _make_track(db, td_tournament.id, "Test Writing")
    login(client, "td@test.com", "tdpass")
    statuses = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()["track_statuses"]
    entry = next(t for t in statuses if t["track_id"] == track.id)
    assert entry["status"] == "pending"


def test_build_lunch_prefers_the_live_field_over_an_archived_one(
    client, td_user, td_tournament, db
):
    """An archived field doesn't reserve its key, so a live and an archived
    lunch question can share one — question_type decides free-text vs badge
    rendering, so the live one has to win rather than whichever came back
    first."""
    from app.models.models import TournamentMembershipLunch

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    form = _make_form(db, td_user, td_tournament.id)
    _make_field(
        db,
        form,
        order=1,
        field_key=f"lunch_{primary_track_id(db, td_tournament.id)}_entree",
        question_type="short_text",
        is_archived=True,
    )
    _make_field(
        db,
        form,
        order=2,
        field_key=f"lunch_{primary_track_id(db, td_tournament.id)}_entree",
        question_type="single_select_radio",
    )
    db.add(
        TournamentMembershipLunch(
            membership_id=m.id,
            track_id=primary_track_id(db, td_tournament.id),
            category="entree",
            value="pizza",
            label="Pizza",
        )
    )
    db.commit()

    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/").json()
    assert data["lunch"][0]["question_type"] == "single_select_radio"


def test_get_my_membership_needs_age_consent_when_collected_and_unanswered(
    client, td_tournament, other_user, db
):
    td_tournament.collect_is_over_18 = True
    db.commit()
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "other@test.com", "otherpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()
    assert data["needs_age_consent"] is True


def test_get_my_membership_needs_age_consent_false_once_answered(
    client, td_tournament, other_user, db
):
    td_tournament.collect_is_over_18 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "consented"
    db.commit()
    login(client, "other@test.com", "otherpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()
    assert data["needs_age_consent"] is False


def test_get_my_membership_needs_age_consent_false_when_not_collected(
    client, td_tournament, other_user, db
):
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "other@test.com", "otherpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()
    assert data["needs_age_consent"] is False


def test_get_my_membership_owner_never_needs_age_consent(client, td_user, td_tournament, db):
    td_tournament.collect_is_over_18 = True
    db.commit()
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()
    assert data["needs_age_consent"] is False


def test_get_my_membership_needs_age_consent_with_permissions(
    client, td_tournament, other_user, db
):
    td_tournament.collect_is_over_18 = True
    db.commit()
    grant_role(db, td_tournament, other_user, "Tournament Director")
    login(client, "other@test.com", "otherpass")
    data = client.get(f"/tournaments/{td_tournament.id}/members/me/").json()
    assert data["permissions"]
    assert data["needs_age_consent"] is True


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
    """No membership at all in the tournament — 200 with id=None, same shape
    as the site-admin-without-a-row case."""
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{other_tournament.id}/members/me/")
    assert response.status_code == 200
    assert response.json()["id"] is None


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
        f"/tournaments/{td_tournament.id}/members/me/age-disclosure/",
        json={"consent": True},
    )
    assert response.status_code == 200
    assert response.json()["needs_age_consent"] is False

    db.refresh(membership)
    assert membership.age_disclosure == "consented"
    assert membership.age_disclosure_at is not None


def test_age_disclosure_decline_removes_membership(client, td_user, td_tournament, other_user, db):
    from app.models.models import TournamentMembership, TournamentMembershipLunch

    td_tournament.collect_is_over_21 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership_id = membership.id
    db.add(
        TournamentMembershipLunch(
            membership_id=membership_id,
            track_id=primary_track_id(db, td_tournament.id),
            category="entree",
            value="pizza",
            label="Pizza",
        )
    )
    form = _make_form(db, td_user, td_tournament.id)
    _make_answer(db, other_user.id, form, _make_field(db, form), "blue")

    login(client, "other@test.com", "otherpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/members/me/age-disclosure/",
        json={"consent": False},
    )
    assert response.status_code == 200
    assert response.json()["id"] is None

    db.expire_all()
    assert db.get(TournamentMembership, membership_id) is None
    assert db.query(TournamentMembershipLunch).filter_by(membership_id=membership_id).count() == 0
    assert db.query(FormResponse).filter_by(user_id=other_user.id).count() == 0
    assert td_tournament.id not in {t["id"] for t in client.get("/tournaments/me/").json()}


def test_age_disclosure_owner_cannot_decline(client, td_user, td_tournament, db):
    td_tournament.collect_is_over_18 = True
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/members/me/age-disclosure/",
        json={"consent": False},
    )
    assert response.status_code == 400
    assert client.get(f"/tournaments/{td_tournament.id}/members/me/").json()["id"] is not None


def test_age_disclosure_not_found_without_membership(client, td_tournament, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id + 9999}/members/me/age-disclosure/",
        json={"consent": True},
    )
    assert response.status_code == 404


def test_age_disclosure_unauthenticated_forbidden(client, td_tournament):
    assert (
        client.post(
            f"/tournaments/{td_tournament.id}/members/me/age-disclosure/",
            json={"consent": True},
        ).status_code
        == 401
    )


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
# Delete
# ---------------------------------------------------------------------------


def test_delete_membership(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/members/{m.id}/").status_code == 204


def test_delete_membership_deletes_form_responses(client, td_user, td_tournament, db):
    """A removed member's answers to this tournament's forms go with them —
    FormResponse is keyed by user, not membership, so nothing cascades."""
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    form = _make_form(db, td_user, td_tournament.id)
    field = _make_field(db, form)
    _make_answer(db, u["id"], form, field, "blue")

    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/members/{m.id}/").status_code == 204

    assert db.query(FormResponse).filter_by(user_id=u["id"]).count() == 0
    # Answers ride the response's FK cascade, which a bulk delete relies on.
    assert db.query(FormAnswer).filter_by(field_id=field.id).count() == 0


def test_delete_membership_keeps_other_tournaments_responses(
    client,
    td_user,
    td_tournament,
    other_tournament,
    db,
):
    """Scoped to the tournament being left — the same user's answers to a
    different tournament's form are none of this removal's business."""
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    other_form = _make_form(db, td_user, other_tournament.id)
    other_field = _make_field(db, other_form)
    _make_answer(db, u["id"], other_form, other_field, "green")

    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/members/{m.id}/").status_code == 204

    assert db.query(FormResponse).filter_by(form_id=other_form.id, user_id=u["id"]).count() == 1


def test_delete_membership_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/members/9999/").status_code == 404


def test_delete_membership_requires_manage_members(client, td_user, other_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, other_tournament.id, u["id"])
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.delete(f"/tournaments/{other_tournament.id}/members/{m.id}/")
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
    role = TournamentRole(
        tournament_id=tournament.id, label=label, rank=rank, permissions=[MANAGE_MEMBERS]
    )
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

    response = client.delete(f"/tournaments/{other_tournament.id}/members/{owner_membership.id}/")
    assert response.status_code == 403


def test_delete_membership_owner_target_forbidden_even_when_owner_has_no_role(
    client, td_user, other_tournament, db
):
    """Rank is opt-in — an owner who holds no TournamentRole has no
    get_highest_rank result at all, so the plain rank comparison alone
    (`target_rank is not None and target_rank < actor_rank`) would silently
    pass and let them be deleted. validate_member_target's explicit
    owner check is what actually stops this."""
    owner_membership = _owner_membership(db, other_tournament)
    db.query(TournamentTrackAssignment).filter(
        TournamentTrackAssignment.membership_id == owner_membership.id
    ).delete()
    db.commit()

    _make_low_rank_role(db, other_tournament, "Weak Staff", rank=90)
    grant_role(db, other_tournament, td_user, "Weak Staff")
    login(client, "td@test.com", "tdpass")

    response = client.delete(f"/tournaments/{other_tournament.id}/members/{owner_membership.id}/")
    assert response.status_code == 403
    assert (
        db.query(TournamentMembership)
        .filter(TournamentMembership.id == owner_membership.id)
        .first()
        is not None
    )


def test_delete_membership_target_outranks_actor_forbidden(client, td_user, other_tournament, db):
    """A non-owner target who's strictly senior to the actor is protected too."""
    senior_role = _make_low_rank_role(db, other_tournament, "Senior Staff", rank=5)
    u = _make_user(db)
    target_membership = _make_membership(db, other_tournament.id, u["id"])
    db.add(
        TournamentTrackAssignment(
            membership_id=target_membership.id, role_id=senior_role.id, is_tournament_wide=True
        )
    )
    db.commit()

    _make_low_rank_role(db, other_tournament, "Weak Staff", rank=90)
    grant_role(db, other_tournament, td_user, "Weak Staff")
    login(client, "td@test.com", "tdpass")

    response = client.delete(f"/tournaments/{other_tournament.id}/members/{target_membership.id}/")
    assert response.status_code == 403


def test_delete_membership_tied_rank_target_allowed(client, td_user, other_tournament, db):
    """Peers at the same rank can still act on each other — only strictly
    senior targets (or the owner) are protected."""
    peer_role = _make_low_rank_role(db, other_tournament, "Peer Staff", rank=40)
    u = _make_user(db)
    target_membership = _make_membership(db, other_tournament.id, u["id"])
    db.add(
        TournamentTrackAssignment(
            membership_id=target_membership.id, role_id=peer_role.id, is_tournament_wide=True
        )
    )
    db.commit()

    grant_role(db, other_tournament, td_user, "Peer Staff")
    login(client, "td@test.com", "tdpass")

    response = client.delete(f"/tournaments/{other_tournament.id}/members/{target_membership.id}/")
    assert response.status_code == 204


def test_update_membership_owner_target_forbidden_even_when_owner_has_no_role(
    client, td_user, other_tournament, db
):
    """Same owner protection applies to the day-of-logistics PATCH, not just delete."""
    owner_membership = _owner_membership(db, other_tournament)
    db.query(TournamentTrackAssignment).filter(
        TournamentTrackAssignment.membership_id == owner_membership.id
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


def test_membership_age_flags_null_without_date_of_birth(
    client, td_user, td_tournament, other_user, db
):
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


def test_membership_age_flags_fall_back_to_today_when_dates_are_tbd(
    client, td_user, td_tournament, other_user, db
):
    """No dated primary track means no first day — age is judged as of today
    rather than reported unknown for every member."""
    for track in td_tournament.primary_tracks:
        track.start_date = None
        track.end_date = None
    db.commit()
    today = date.today()
    dob = date(today.year - 19, 1, 1)
    data = _age_flags(client, db, td_tournament, other_user, dob)
    assert data["is_over_18"] is True
    assert data["is_over_21"] is False


# ---------------------------------------------------------------------------
# is_over_18 / is_over_21 gating — omitted entirely unless the tournament
# collects that specific flag AND the membership has consented. Never sent
# as null in the gated-off case, which would read as "under 18" to a
# careless frontend.
# ---------------------------------------------------------------------------


def test_age_flags_omitted_when_tournament_does_not_collect(
    client, td_user, td_tournament, other_user, db
):
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


def test_age_flags_shown_when_collected_and_consented(
    client, td_user, td_tournament, other_user, db
):
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


def test_leave_tournament_rejected_on_archived_tournament(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    other_tournament.is_archived = True
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.delete(f"/tournaments/{other_tournament.id}/members/me/").status_code == 403


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
    """Cascade check — leaving must not orphan TournamentTrackAssignment rows."""
    membership = grant_role(db, other_tournament, td_user, "Volunteer")
    membership_id = membership.id
    login(client, "td@test.com", "tdpass")

    assert client.delete(f"/tournaments/{other_tournament.id}/members/me/").status_code == 204
    assert (
        db.query(TournamentTrackAssignment)
        .filter(TournamentTrackAssignment.membership_id == membership_id)
        .count()
        == 0
    )
