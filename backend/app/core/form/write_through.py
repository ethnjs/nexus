"""Diff-sync for the structural tables that a form response's reserved-key
answers (`availability`, `lunch_{date}_{category}`) write through to on
tournament-owned forms — see form-question-types-reference.md. Each function
diffs the submitted values against what's already stored and applies only
the delta (insert new, delete removed) rather than replace-all, so an
untouched row (e.g. a different lunch date/category) is never disturbed.

Callers commit — these only add/delete/flush, so the write-through and the
FormAnswer rows it's derived from land in the same transaction."""

from datetime import date as date_type

from sqlalchemy.orm import Session

from app.models.models import TournamentMembershipAvailability, TournamentMembershipLunch


def sync_availability(db: Session, membership_id: int, tournament_shift_ids: list[int]) -> None:
    """Diffs `tournament_shift_ids` against this membership's existing
    TournamentMembershipAvailability rows and applies only the delta."""
    existing_ids = {
        shift_id
        for (shift_id,) in db.query(TournamentMembershipAvailability.tournament_shift_id)
        .filter(TournamentMembershipAvailability.membership_id == membership_id)
        .all()
    }
    incoming_ids = set(tournament_shift_ids)

    to_remove = existing_ids - incoming_ids
    if to_remove:
        db.query(TournamentMembershipAvailability).filter(
            TournamentMembershipAvailability.membership_id == membership_id,
            TournamentMembershipAvailability.tournament_shift_id.in_(to_remove),
        ).delete(synchronize_session=False)

    for shift_id in incoming_ids - existing_ids:
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
