"""Diff-sync for the structural tables that a form response's reserved-key
answers (`availability`, `lunch_{date}_{category}`) write through to on
tournament-owned forms — see form-question-types-reference.md. Each function
diffs the submitted values against what's already stored and applies only
the delta (insert new, delete removed) rather than replace-all, so an
untouched row (e.g. a different lunch date/category) is never disturbed.

Callers commit — these only add/delete/flush, so the write-through and the
FormAnswer rows it's derived from land in the same transaction."""

from datetime import date as date_type, datetime

from sqlalchemy.orm import Session

from app.core.form.validation import AVAILABILITY_FIELD_KEY_PATTERN, LUNCH_FIELD_KEY_PATTERN
from app.models.models import (
    TournamentMembershipAvailability,
    TournamentMembershipLunch,
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
