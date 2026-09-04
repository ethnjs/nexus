from datetime import date, timedelta

from tests.conftest import grant_role, login


from app.models.models import (
    Form,
    FormField,
    TournamentMembership,
    TournamentMembershipTrackStatus,
    TournamentTrack,
)


def _create_track(client, tournament_id: int, name: str, **fields):
    return client.post(f"/tournaments/{tournament_id}/tracks/", json={"name": name, **fields})


def _primary_fields(**overrides):
    """The four a primary track must carry."""
    return {
        "is_primary": True,
        "start_date": str(date.today() + timedelta(days=30)),
        "end_date": str(date.today() + timedelta(days=31)),
        "location": "Somewhere",
        "division": ["B"],
        **overrides,
    }


def _track_form_field(db, td_user, tournament_id: int, track_id: int) -> None:
    """A track_status field naming `track_id` — the TD-authored reference that
    blocks a delete."""
    form = Form(
        owner_type="tournament",
        tournament_id=tournament_id,
        chapter_id=None,
        name="Track form",
        created_by=td_user.id,
    )
    db.add(form)
    db.flush()
    db.add(FormField(
        form_id=form.id,
        order=1,
        field_key="track_status_interest",
        label="Track status",
        question_type="single_select_radio",
        config={
            "required": True,
            "options": [{
                "option_id": "interested", "label": "Interested",
                "value": [{"id": track_id, "status": "interested"}],
            }],
        },
    ))
    db.commit()


def test_manage_tournament_can_create_list_and_update_tracks(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")

    created = _create_track(client, td_tournament.id, "  Test Writing  ")
    assert created.status_code == 201
    track = created.json()
    assert track["name"] == "Test Writing"
    assert track["is_primary"] is False
    assert track["is_archived"] is False

    listed = client.get(f"/tournaments/{td_tournament.id}/tracks/")
    assert listed.status_code == 200
    # The conftest tournament already has its "Main" primary track.
    assert {row["name"] for row in listed.json()} == {"Main", "Test Writing"}

    updated = client.patch(
        f"/tournaments/{td_tournament.id}/tracks/{track['id']}/",
        json={"name": "Question Writing"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Question Writing"


def test_track_is_archived_is_not_patchable(client, td_user, td_tournament):
    """Pending-delete is set by DELETE and cleared by /restore/. A TD toggling
    it as a field would let them hide a track without the lifecycle ever
    checking what still references it."""
    login(client, "td@test.com", "tdpass")
    track = _create_track(client, td_tournament.id, "Test Writing").json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/tracks/{track['id']}/",
        json={"is_archived": True},
    )
    assert response.status_code == 422


def test_track_names_are_unique_per_tournament(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert _create_track(client, td_tournament.id, "Day 1").status_code == 201

    duplicate = _create_track(client, td_tournament.id, "Day 1")
    assert duplicate.status_code == 409


def test_track_routes_require_manage_tournament(client, db, td_tournament, other_user):
    grant_role(db, td_tournament, other_user, "Runner")
    login(client, "other@test.com", "otherpass")

    assert _create_track(client, td_tournament.id, "Day 1").status_code == 403
    assert client.get(f"/tournaments/{td_tournament.id}/tracks/").status_code == 403


def test_list_tracks_public_readable_by_plain_member(client, db, td_tournament, other_user):
    """Same shape as the staff read for now — a member needs the catalog to
    know which tracks exist and which of them they may confirm on."""
    grant_role(db, td_tournament, other_user, "Runner")
    login(client, "other@test.com", "otherpass")
    response = client.get(f"/tournaments/{td_tournament.id}/tracks/?public=true")
    assert response.status_code == 200


def test_list_tracks_public_still_requires_membership(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/tracks/?public=true").status_code == 404


def test_track_is_scoped_to_its_tournament(client, db, td_user, td_tournament, other_tournament):
    other_track = TournamentTrack(tournament_id=other_tournament.id, name="Other tournament track")
    db.add(other_track)
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.patch(
        f"/tournaments/{td_tournament.id}/tracks/{other_track.id}/",
        json={"name": "Nope"},
    ).status_code == 404


# ---------------------------------------------------------------------------
# The primary/cosmetic invariant
# ---------------------------------------------------------------------------

def test_primary_track_requires_schedule_and_venue(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    for missing in ("start_date", "end_date", "division", "location"):
        fields = _primary_fields()
        fields.pop(missing)
        response = _create_track(client, td_tournament.id, f"Missing {missing}", **fields)
        assert response.status_code == 422, missing


def test_cosmetic_track_cannot_carry_a_venue(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _create_track(client, td_tournament.id, "Test Writing", location="Somewhere")
    assert response.status_code == 422


def test_patch_is_validated_against_the_stored_row(client, td_user, td_tournament, db):
    """A PATCH sending only `is_primary` can't be judged by the payload alone
    — the invariant is checked after the merge, against the track's existing
    (empty) dates."""
    login(client, "td@test.com", "tdpass")
    track = _create_track(client, td_tournament.id, "Test Writing").json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/tracks/{track['id']}/", json={"is_primary": True},
    )
    assert response.status_code == 422


def test_cannot_demote_the_last_primary_track(client, td_user, td_tournament, db):
    login(client, "td@test.com", "tdpass")
    main = next(t for t in td_tournament.tracks if t.is_primary)
    response = client.patch(
        f"/tournaments/{td_tournament.id}/tracks/{main.id}/",
        json={"is_primary": False, "start_date": None, "end_date": None,
              "location": None, "division": None},
    )
    assert response.status_code == 409


def test_cannot_delete_the_last_primary_track(client, td_user, td_tournament, db):
    login(client, "td@test.com", "tdpass")
    main = next(t for t in td_tournament.tracks if t.is_primary)
    assert client.delete(f"/tournaments/{td_tournament.id}/tracks/{main.id}/").status_code == 409


def test_demoting_is_allowed_once_another_primary_exists(client, td_user, td_tournament, db):
    login(client, "td@test.com", "tdpass")
    assert _create_track(
        client, td_tournament.id, "Day 2", **_primary_fields(),
    ).status_code == 201

    main = next(t for t in td_tournament.tracks if t.name == "Main")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/tracks/{main.id}/",
        json={"is_primary": False, "start_date": None, "end_date": None,
              "location": None, "division": None},
    )
    assert response.status_code == 200
    assert response.json()["is_primary"] is False


# ---------------------------------------------------------------------------
# Delete lifecycle
# ---------------------------------------------------------------------------

def test_unreferenced_track_is_purged_immediately(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    unused = _create_track(client, td_tournament.id, "Unused").json()

    response = client.delete(f"/tournaments/{td_tournament.id}/tracks/{unused['id']}/")
    assert response.status_code == 200
    assert response.json() == {"purged": True, "blocked_by": [], "member_rows_deleted": 0}
    assert db.query(TournamentTrack).filter(TournamentTrack.id == unused["id"]).count() == 0


def test_referenced_track_is_marked_pending_not_deleted(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    referenced = _create_track(client, td_tournament.id, "Referenced").json()
    _track_form_field(db, td_user, td_tournament.id, referenced["id"])

    response = client.delete(f"/tournaments/{td_tournament.id}/tracks/{referenced['id']}/")
    assert response.status_code == 200
    body = response.json()
    assert body["purged"] is False
    assert body["blocked_by"] == ["a form field"]

    row = db.query(TournamentTrack).filter(TournamentTrack.id == referenced["id"]).one()
    db.refresh(row)
    assert row.is_archived is True


def test_delete_reports_the_member_rows_it_will_destroy(client, db, td_user, td_tournament):
    """The cost of the delete is stated before the fact, whether it happens
    now or once the blocker clears."""
    login(client, "td@test.com", "tdpass")
    track = _create_track(client, td_tournament.id, "Day 1").json()
    membership = _td_membership(db, td_user, td_tournament)
    _set_status(db, membership.id, track["id"], "confirmed")

    response = client.delete(f"/tournaments/{td_tournament.id}/tracks/{track['id']}/")
    assert response.json()["member_rows_deleted"] == 1


def test_pending_track_can_be_restored(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    referenced = _create_track(client, td_tournament.id, "Referenced").json()
    _track_form_field(db, td_user, td_tournament.id, referenced["id"])
    client.delete(f"/tournaments/{td_tournament.id}/tracks/{referenced['id']}/")

    restored = client.post(f"/tournaments/{td_tournament.id}/tracks/{referenced['id']}/restore/")
    assert restored.status_code == 200
    assert restored.json()["is_archived"] is False


def test_restoring_a_live_track_is_a_conflict(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _create_track(client, td_tournament.id, "Day 1").json()
    assert client.post(
        f"/tournaments/{td_tournament.id}/tracks/{track['id']}/restore/"
    ).status_code == 409


def test_pending_track_is_hidden_from_the_member_catalog(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    referenced = _create_track(client, td_tournament.id, "Referenced").json()
    _track_form_field(db, td_user, td_tournament.id, referenced["id"])
    client.delete(f"/tournaments/{td_tournament.id}/tracks/{referenced['id']}/")

    public = client.get(f"/tournaments/{td_tournament.id}/tracks/?public=true").json()
    assert referenced["id"] not in [row["id"] for row in public]

    # Settings still sees it, so the TD can restore a mistake.
    staff = client.get(f"/tournaments/{td_tournament.id}/tracks/").json()
    assert referenced["id"] in [row["id"] for row in staff]


def test_deleting_a_track_takes_its_member_statuses_with_it(client, db, td_user, td_tournament):
    """No form references it, so the TD is removing it for good — leaving
    orphaned statuses would let a re-created track of the same name inherit
    them."""
    login(client, "td@test.com", "tdpass")
    track = _create_track(client, td_tournament.id, "Day 1").json()
    membership = _td_membership(db, td_user, td_tournament)
    _set_status(db, membership.id, track["id"], "confirmed")

    assert client.delete(f"/tournaments/{td_tournament.id}/tracks/{track['id']}/").status_code == 200
    assert db.query(TournamentMembershipTrackStatus).filter(
        TournamentMembershipTrackStatus.track_id == track["id"]
    ).count() == 0


# ---------------------------------------------------------------------------
# Member-facing status reads
# ---------------------------------------------------------------------------

def _set_status(db, membership_id, track_id, status):
    db.add(TournamentMembershipTrackStatus(
        membership_id=membership_id, track_id=track_id, status=status,
    ))
    db.commit()


def _td_membership(db, td_user, td_tournament):
    return (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == td_user.id,
            TournamentMembership.tournament_id == td_tournament.id,
        )
        .one()
    )


def test_member_reads_their_own_track_statuses(client, db, td_user, td_tournament):
    """members/me/ carries them so a member sees their own without
    manage_tournament, and with the track name resolved."""
    login(client, "td@test.com", "tdpass")
    track = _create_track(client, td_tournament.id, "Test Writing").json()
    membership = _td_membership(db, td_user, td_tournament)
    _set_status(db, membership.id, track["id"], "confirmed")

    res = client.get(f"/tournaments/{td_tournament.id}/members/me/")
    assert res.status_code == 200
    entry = next(s for s in res.json()["track_statuses"] if s["track_id"] == track["id"])
    assert entry == {
        "track_id": track["id"], "name": "Test Writing", "is_archived": False,
        "status": "confirmed", "allow_confirm": False, "updated_at": entry["updated_at"],
    }


def test_member_detail_carries_track_statuses(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    track = _create_track(client, td_tournament.id, "Day 1").json()
    membership = _td_membership(db, td_user, td_tournament)
    _set_status(db, membership.id, track["id"], "interested")

    res = client.get(f"/tournaments/{td_tournament.id}/members/{membership.id}/")
    assert res.status_code == 200
    statuses = {(s["name"], s["status"]) for s in res.json()["track_statuses"]}
    # The unanswered "Main" track pads in as pending — absence would be
    # ambiguous with "this track doesn't exist".
    assert statuses == {("Day 1", "interested"), ("Main", "pending")}


def test_pending_delete_track_drops_out_of_member_statuses(client, db, td_user, td_tournament):
    """A track on its way out isn't something to show a member a status on —
    the row is about to be cascaded away regardless."""
    login(client, "td@test.com", "tdpass")
    track = _create_track(client, td_tournament.id, "Retired").json()
    membership = _td_membership(db, td_user, td_tournament)
    _set_status(db, membership.id, track["id"], "confirmed")
    _track_form_field(db, td_user, td_tournament.id, track["id"])
    client.delete(f"/tournaments/{td_tournament.id}/tracks/{track['id']}/")

    res = client.get(f"/tournaments/{td_tournament.id}/members/me/")
    assert res.status_code == 200
    assert track["id"] not in [s["track_id"] for s in res.json()["track_statuses"]]
