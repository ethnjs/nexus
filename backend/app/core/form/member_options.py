"""
What a member is allowed to change about themselves, and what they currently
have — the catalog behind GET /members/me/options/ and the member edit page.

Two rules shape this module:

**Only live questions offer options.** A member may not newly pick something
no published question asks about. That is deliberately stricter than the read
builders (`build_lunch`, `build_event_preferences`), which *do* consult
archived fields so an answer given before a question was reworked still
renders. Reading history and offering a choice are different permissions.

**Everything is grouped by track**, because that is how the member's own page
is laid out: one section per track, holding whatever that track actually asks
— status, availability, lunch, event preferences. A track with no questions at
all still appears, since its status is always the member's to set.

The fields come back in the same shape `get_form_for_rendering` produces, with
`config["options"]` resolved to real entities. That is what lets the page reuse
the form renderer instead of growing a second set of answer widgets.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.form import resolve_field_options
from app.core.form.validation import (
    AVAILABILITY_FIELD_KEY_PATTERN,
    EVENT_PREFERENCE_FIELD_KEY_PATTERN,
    LUNCH_FIELD_KEY_PATTERN,
    availability_field_track_id,
    event_preference_field_track_id,
    lunch_field_track_id,
)
from app.core.form.write_through import parse_lunch_field_key
from app.models.models import (
    Form, FormField, TournamentMembership, TournamentMembershipEventPreference,
    TournamentMembershipLunch, TournamentShift, TournamentTrack,
)


def member_editable_reserved_fields(db: Session, tournament_id: int) -> list[FormField]:
    """Every live reserved field a member could answer for themselves.

    Live fields on published, tournament-owned forms only. A draft form is
    still being written and an archived field has been retired — neither is
    something to invite an answer to.
    """
    fields = (
        db.query(FormField)
        .join(Form, FormField.form_id == Form.id)
        .filter(
            Form.owner_type == "tournament",
            Form.tournament_id == tournament_id,
            Form.status == "published",
            FormField.is_archived == False,
        )
        .order_by(FormField.form_id, FormField.order)
        .all()
    )
    return [
        field for field in fields
        if AVAILABILITY_FIELD_KEY_PATTERN.match(field.field_key)
        or LUNCH_FIELD_KEY_PATTERN.match(field.field_key)
        or EVENT_PREFERENCE_FIELD_KEY_PATTERN.match(field.field_key)
    ]


def _rendered(db: Session, field: FormField) -> dict:
    """One field in the shape the form renderer already understands."""
    config = dict(field.config or {})
    config["options"] = resolve_field_options(db, field)
    return {
        "id": field.id,
        "form_id": field.form_id,
        "field_key": field.field_key,
        "order": field.order,
        "label": field.label,
        "description": field.description,
        "question_type": field.question_type,
        "is_archived": field.is_archived,
        "config": config,
        "created_at": field.created_at,
        "updated_at": field.updated_at,
    }


def member_track_options(
    db: Session, tournament_id: int, membership: TournamentMembership,
) -> list[dict]:
    """One entry per live track: what it asks, and what this member answered.

    Ordered by track name — a member reads "Day 1", "Test Writing", not
    creation order.
    """
    tracks = (
        db.query(TournamentTrack)
        .filter(
            TournamentTrack.tournament_id == tournament_id,
            TournamentTrack.is_archived == False,
        )
        .order_by(TournamentTrack.name)
        .all()
    )
    fields = member_editable_reserved_fields(db, tournament_id)

    availability_by_track: dict[int, list[dict]] = {}
    lunch_by_track: dict[int, list[dict]] = {}
    prefs_by_track: dict[int, dict] = {}
    for field in fields:
        rendered = _rendered(db, field)
        track_id = availability_field_track_id(field.field_key)
        if track_id is not None:
            availability_by_track.setdefault(track_id, []).append(rendered)
            continue
        track_id = lunch_field_track_id(field.field_key)
        if track_id is not None:
            _, category = parse_lunch_field_key(field.field_key)
            lunch_by_track.setdefault(track_id, []).append({**rendered, "category": category})
            continue
        track_id = event_preference_field_track_id(field.field_key)
        if track_id is not None:
            # Exactly one per track by construction, so the last one wins
            # rather than accumulating — two would be a validation failure.
            prefs_by_track[track_id] = rendered

    selected_shift_ids = {row.tournament_shift_id for row in membership.availability_shifts}
    shift_tracks = dict(
        db.query(TournamentShift.id, TournamentShift.track_id)
        .filter(TournamentShift.tournament_id == tournament_id)
        .all()
    )
    lunch_rows = (
        db.query(TournamentMembershipLunch)
        .filter(TournamentMembershipLunch.membership_id == membership.id)
        .all()
    )
    pref_rows = (
        db.query(TournamentMembershipEventPreference)
        .filter(TournamentMembershipEventPreference.membership_id == membership.id)
        .all()
    )
    status_by_track = {row.track_id: row.status for row in membership.track_statuses}

    entries: list[dict] = []
    for track in tracks:
        entries.append({
            "track_id": track.id,
            "track_name": track.name,
            "is_primary": track.is_primary,
            "allow_confirm": track.allow_confirm,
            "status": status_by_track.get(track.id),
            "availability": availability_by_track.get(track.id, []),
            # The member's current shifts *on this track* — the whole-set a
            # PUT to this track replaces, so the page never has to work out
            # which of their shifts belong where.
            "selected_shift_ids": sorted(
                shift_id for shift_id in selected_shift_ids
                if shift_tracks.get(shift_id) == track.id
            ),
            "lunch": lunch_by_track.get(track.id, []),
            "lunch_selections": [
                {"category": row.category, "value": row.value, "label": row.label}
                for row in lunch_rows if row.track_id == track.id
            ],
            "event_preferences": prefs_by_track.get(track.id),
            "event_preference_selections": [
                {"tournament_event_id": row.tournament_event_id, "rank": row.rank}
                for row in pref_rows if row.track_id == track.id
            ],
        })
    return entries
