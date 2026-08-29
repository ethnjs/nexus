"""Diff-sync for the structural tables that a form response's reserved-key
answers (`availability`, `lunch_{date}_{category}`, `track_status_{suffix}`)
write through to on tournament-owned forms — see
form-question-types-reference.md. Each function diffs the submitted values
against what's already stored and applies only the delta (insert new, delete
removed) rather than replace-all, so an untouched row (e.g. a different lunch
date/category) is never disturbed.

Track status is the exception to "diff": it only ever upserts, and a write can
be refused outright by the transition rule. See sync_track_statuses.

Callers commit — these only add/delete/flush, so the write-through and the
FormAnswer rows it's derived from land in the same transaction."""

from datetime import date as date_type, datetime

from sqlalchemy.orm import Session

from app.core.form.validation import (
    AVAILABILITY_FIELD_KEY_PATTERN,
    EVENT_PREFERENCE_FIELD_KEY_PATTERN,
    LUNCH_FIELD_KEY_PATTERN,
)
from app.models.models import (
    TournamentMembershipAvailability,
    TournamentMembershipEventPreference,
    TournamentMembershipLunch,
    TournamentMembershipTrackStatus,
    TournamentShift,
)


def parse_lunch_field_key(field_key: str) -> tuple[date_type, str]:
    """Splits a `lunch_{date}_{category}` field_key (already known to match
    LUNCH_FIELD_KEY_PATTERN) into its date and category parts."""
    match = LUNCH_FIELD_KEY_PATTERN.match(field_key)
    date_str, category = match.group(1), match.group(2)
    return datetime.strptime(date_str, "%Y%m%d").date(), category


def parse_availability_field_key(field_key: str) -> date_type:
    """The date an `availability_{YYYYMMDD}` field covers (already known to
    match AVAILABILITY_FIELD_KEY_PATTERN)."""
    match = AVAILABILITY_FIELD_KEY_PATTERN.match(field_key)
    return datetime.strptime(match.group(1), "%Y%m%d").date()


def parse_event_preference_field_key(field_key: str) -> str:
    """The suffix an `event_preference_{suffix}` field carries (already known
    to match EVENT_PREFERENCE_FIELD_KEY_PATTERN)."""
    return EVENT_PREFERENCE_FIELD_KEY_PATTERN.match(field_key).group(1)


def shift_ids_on_dates(db: Session, tournament_id: int, dates: set[date_type]) -> set[int]:
    """Every shift the given tournament days contain — the set an
    availability question for those days is answering about, whether or not
    its options currently reference each one."""
    if not dates:
        return set()
    return {
        shift_id
        for shift_id, start in db.query(TournamentShift.id, TournamentShift.start)
        .filter(TournamentShift.tournament_id == tournament_id)
        .all()
        if start.date() in dates
    }


def sync_availability(
    db: Session, membership_id: int, selected_shift_ids: set[int], owned_shift_ids: set[int]
) -> None:
    """Applies one availability answer as a delta over the shifts it governs.

    `owned_shift_ids` is every shift on the day(s) the answered question(s)
    cover — not just the ones its options happen to group right now. Shifts
    outside that set belong to a different day's question, possibly on a
    different form, and are left exactly as they are.

    Scoping by day rather than by the options' current contents matters: if a
    TD regroups an option so it no longer mentions some shift, that shift is
    still part of the day being answered about, so a member who drops it must
    actually lose it instead of keeping it forever as an orphan."""
    existing_ids = {
        shift_id
        for (shift_id,) in db.query(TournamentMembershipAvailability.tournament_shift_id)
        .filter(TournamentMembershipAvailability.membership_id == membership_id)
        .all()
    }

    to_remove = (existing_ids & owned_shift_ids) - selected_shift_ids
    if to_remove:
        db.query(TournamentMembershipAvailability).filter(
            TournamentMembershipAvailability.membership_id == membership_id,
            TournamentMembershipAvailability.tournament_shift_id.in_(to_remove),
        ).delete(synchronize_session=False)

    for shift_id in selected_shift_ids - existing_ids:
        db.add(TournamentMembershipAvailability(membership_id=membership_id, tournament_shift_id=shift_id))

    db.flush()


def sync_lunch(
    db: Session,
    membership_id: int,
    date: date_type,
    category: str,
    values: list[dict],
) -> None:
    """Diffs `values` (each `{"value": ..., "label": ...}`) against this
    membership's existing TournamentMembershipLunch rows for this
    (date, category) only — rows for any other date or category on the
    same membership are never touched."""
    existing_rows = (
        db.query(TournamentMembershipLunch)
        .filter(
            TournamentMembershipLunch.membership_id == membership_id,
            TournamentMembershipLunch.date == date,
            TournamentMembershipLunch.category == category,
        )
        .all()
    )
    existing_by_value = {row.value: row for row in existing_rows}
    incoming_by_value = {str(item["value"]): item for item in values}

    for value, row in existing_by_value.items():
        if value not in incoming_by_value:
            db.delete(row)

    for value in set(incoming_by_value) - set(existing_by_value):
        item = incoming_by_value[value]
        db.add(
            TournamentMembershipLunch(
                membership_id=membership_id,
                date=date,
                category=category,
                value=value,
                label=item["label"],
            )
        )

    db.flush()


def sync_event_preferences(
    db: Session,
    membership_id: int,
    key: str,
    items: list[dict],
) -> None:
    """Diffs `items` (each `{"tournament_event_id": ..., "rank": ...}`)
    against this membership's existing TournamentMembershipEventPreference
    rows for this `key` only — rows for any other suffix on the same
    membership are never touched. A suffix is one field's exclusive key
    (unlike availability's shared day pool), so this can safely delete
    outright rather than needing an owned-scope parameter.

    Unlike sync_lunch, an existing row whose event stays selected but whose
    rank changed (a ranked-choice re-ranking) is updated in place rather than
    deleted and re-inserted — lunch's value/label have no equivalent
    "same selection, different detail" case."""
    existing_rows = (
        db.query(TournamentMembershipEventPreference)
        .filter(
            TournamentMembershipEventPreference.membership_id == membership_id,
            TournamentMembershipEventPreference.key == key,
        )
        .all()
    )
    existing_by_event = {row.tournament_event_id: row for row in existing_rows}
    incoming_by_event = {item["tournament_event_id"]: item for item in items}

    for event_id, row in existing_by_event.items():
        if event_id not in incoming_by_event:
            db.delete(row)
        elif row.rank != incoming_by_event[event_id]["rank"]:
            row.rank = incoming_by_event[event_id]["rank"]

    for event_id in set(incoming_by_event) - set(existing_by_event):
        item = incoming_by_event[event_id]
        db.add(
            TournamentMembershipEventPreference(
                membership_id=membership_id,
                key=key,
                tournament_event_id=event_id,
                rank=item["rank"],
            )
        )

    db.flush()


TRACK_STATUSES = ("interested", "confirmed", "declined")


def can_set_track_status(current: str | None, incoming: str) -> bool:
    """Whether a write may move a track from `current` to `incoming`.

    The whole rule: **a track never falls back to `interested` once it's moved
    past it.** Everything else is permitted — interested→confirmed, either→
    declined, declined→confirmed for someone who changes their mind, and any
    status re-written as itself.

    This is what keeps track statuses ordered, in place of comparing submission
    times. Write-through is forward-only, but a TD can still raise a pending
    update on a track question in an *older* form, and that patch would
    otherwise demote a track a newer form already confirmed. Since the only
    damage an out-of-order write can do is a demotion, refusing demotions
    closes it without any notion of "which response is newer".

    The cost is that no form can walk a mistaken `confirmed` back down to
    `interested` — that needs a path that bypasses this guard."""
    return incoming != "interested" or current in (None, "interested")


def sync_track_statuses(
    db: Session,
    membership_id: int,
    intended: dict[int, dict],
    response_id: str | None = None,
) -> None:
    """Upserts one submission's track statuses.

    `intended` maps track_id -> {"status": ..., "field_id": ...}, already
    resolved to a single status per track by the caller (see
    _write_through_reserved_fields — later fields in document order win).

    **Never deletes.** Every track_status_* question across every form writes
    into these rows, so no field owns one and none can withdraw its
    contribution after the fact — a member who stops selecting an option keeps
    the status it granted. Same reasoning as availability, minus availability's
    day boundary: there's no equivalent scope that would make a removal safe.

    A write the transition rule refuses is skipped silently rather than
    raising. It's a legitimate outcome of the rules — a respondent answering
    what they were asked — not a client error worth failing the submission
    over."""
    if not intended:
        return

    existing_by_track = {
        row.track_id: row
        for row in db.query(TournamentMembershipTrackStatus).filter(
            TournamentMembershipTrackStatus.membership_id == membership_id,
            TournamentMembershipTrackStatus.track_id.in_(intended),
        )
    }

    for track_id, write in intended.items():
        status = write["status"]
        row = existing_by_track.get(track_id)
        if not can_set_track_status(row.status if row else None, status):
            continue

        if row is None:
            db.add(
                TournamentMembershipTrackStatus(
                    membership_id=membership_id,
                    track_id=track_id,
                    status=status,
                    source_response_id=response_id,
                    source_field_id=write.get("field_id"),
                )
            )
        else:
            row.status = status
            row.source_response_id = response_id
            row.source_field_id = write.get("field_id")

    db.flush()
