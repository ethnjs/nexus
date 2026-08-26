from tests.conftest import grant_role, login

from app.models.models import Form, FormField, TournamentTrack


def _create_track(client, tournament_id: int, name: str):
    return client.post(f"/tournaments/{tournament_id}/tracks/", json={"name": name})


def test_manage_tournament_can_create_list_update_and_archive_tracks(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")

    created = _create_track(client, td_tournament.id, "  Test Writing  ")
    assert created.status_code == 201
    track = created.json()
    assert track["name"] == "Test Writing"
    assert track["is_archived"] is False

    listed = client.get(f"/tournaments/{td_tournament.id}/tracks/")
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [track["id"]]

    updated = client.patch(
        f"/tournaments/{td_tournament.id}/tracks/{track['id']}/",
        json={"name": "Question Writing", "is_archived": True},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Question Writing"
    assert updated.json()["is_archived"] is True

    restored = client.patch(
        f"/tournaments/{td_tournament.id}/tracks/{track['id']}/",
        json={"is_archived": False},
    )
    assert restored.status_code == 200
    assert restored.json()["is_archived"] is False


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


def test_track_is_scoped_to_its_tournament(client, db, td_user, td_tournament, other_tournament):
    other_track = TournamentTrack(tournament_id=other_tournament.id, name="Other tournament track")
    db.add(other_track)
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.patch(
        f"/tournaments/{td_tournament.id}/tracks/{other_track.id}/",
        json={"name": "Nope"},
    ).status_code == 404


def test_unused_track_can_be_deleted_but_referenced_track_cannot(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    unused = _create_track(client, td_tournament.id, "Unused").json()
    assert client.delete(f"/tournaments/{td_tournament.id}/tracks/{unused['id']}/").status_code == 204

    referenced = _create_track(client, td_tournament.id, "Referenced").json()
    form = Form(
        owner_type="tournament",
        tournament_id=td_tournament.id,
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
                "option_id": "interested", "value": "interested", "label": "Interested",
                "track_statuses": [{"track_id": referenced["id"], "status": "interested"}],
            }],
        },
    ))
    db.commit()

    blocked = client.delete(f"/tournaments/{td_tournament.id}/tracks/{referenced['id']}/")
    assert blocked.status_code == 409
