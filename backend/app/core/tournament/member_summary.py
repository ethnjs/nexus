"""
The roster at a glance — GET /members/summary/, behind the overview page's
members widget. Counts only, never names: the roster route is where people
live, and this exists so the overview doesn't have to load all of them to
add them up.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.form.member_options import member_editable_reserved_fields
from app.core.form.validation import availability_field_track_id, option_shift_ids
from app.core.tournament.memberships import ACTIVE_MEMBERSHIP_CLAUSE
from app.core.tournament.onboarding import onboarding_progress_bulk
from app.models.models import (
    Tournament, TournamentMembership, TournamentMembershipAvailability,
    TournamentMembershipTrackStatus, TournamentShift, TournamentTrack,
)

STATUSES = ("confirmed", "interested", "declined")
# Only a yes is worth a shift count — a declined member's leftover shifts
# aren't availability anyone can staff with.
AVAILABILITY_STATUSES = ("confirmed", "interested")

Option = tuple[str, str, frozenset[int]]


def _availability_options(db: Session, tournament_id: int) -> dict[int, list[Option]]:
    """(option_id, label, shift ids) per track, off its live availability
    questions. Two forms can ask one track the same thing (an interest form
    and a confirmation form), so options grouping identical shifts collapse."""
    by_track: dict[int, list[Option]] = {}
    for field in member_editable_reserved_fields(db, tournament_id):
        track_id = availability_field_track_id(field.field_key)
        if track_id is None:
            continue
        options = by_track.setdefault(track_id, [])
        seen = {shifts for _, _, shifts in options}
        for option in (field.config or {}).get("options", []):
            shifts = frozenset(option_shift_ids(option))
            if option.get("is_archived") or not shifts or shifts in seen:
                continue
            seen.add(shifts)
            options.append((option["option_id"], option["label"], shifts))
    return by_track


def covered_options(options: list[Option], held: set[int]) -> list[str]:
    """The options a member's shifts answer, by option_id.

    Shifts are the source of truth, not the form answer — self-edits write
    shifts only. An option counts when every shift it groups is held (the
    member edit page's rule), and one nested inside another covered option is
    dropped: otherwise an all-day volunteer also counts as morning and
    afternoon.
    """
    covered = [(option_id, shifts) for option_id, _, shifts in options if shifts <= held]
    return [
        option_id for option_id, shifts in covered
        if not any(shifts < other for _, other in covered)
    ]


def build_member_summary(db: Session, tournament: Tournament) -> dict:
    members = (
        db.query(TournamentMembership.id, TournamentMembership.user_id)
        .filter(TournamentMembership.tournament_id == tournament.id, ACTIVE_MEMBERSHIP_CLAUSE)
        .all()
    )
    member_ids = [member.id for member in members]

    status_of: dict[tuple[int, int], str] = {}
    held: dict[tuple[int, int], set[int]] = {}
    if member_ids:
        status_of = {
            (membership_id, track_id): status
            for membership_id, track_id, status in db.query(
                TournamentMembershipTrackStatus.membership_id,
                TournamentMembershipTrackStatus.track_id,
                TournamentMembershipTrackStatus.status,
            ).filter(TournamentMembershipTrackStatus.membership_id.in_(member_ids))
        }
        for membership_id, track_id, shift_id in (
            db.query(TournamentMembershipAvailability.membership_id, TournamentShift.track_id, TournamentShift.id)
            .join(TournamentShift, TournamentMembershipAvailability.tournament_shift_id == TournamentShift.id)
            .filter(TournamentMembershipAvailability.membership_id.in_(member_ids))
        ):
            held.setdefault((membership_id, track_id), set()).add(shift_id)

    options_by_track = _availability_options(db, tournament.id)
    tracks = (
        db.query(TournamentTrack)
        .filter(TournamentTrack.tournament_id == tournament.id, TournamentTrack.is_archived == False)
        .order_by(TournamentTrack.name)
        .all()
    )

    track_entries = []
    for track in tracks:
        options = options_by_track.get(track.id, [])
        counts = {status: 0 for status in STATUSES}
        by_option = {option_id: {status: 0 for status in AVAILABILITY_STATUSES} for option_id, _, _ in options}
        for membership_id in member_ids:
            status = status_of.get((membership_id, track.id))
            if status not in counts:
                continue
            counts[status] += 1
            if status in AVAILABILITY_STATUSES:
                for option_id in covered_options(options, held.get((membership_id, track.id), set())):
                    by_option[option_id][status] += 1
        track_entries.append({
            "track_id": track.id,
            "name": track.name,
            **counts,
            # No row at all — a member who still owes this track an answer.
            "pending": len(member_ids) - sum(counts.values()),
            "availability": [
                {"option_id": option_id, "label": label, **by_option[option_id]}
                for option_id, label, _ in options
            ],
        })

    steps, completed = onboarding_progress_bulk(db, tournament.id, [member.user_id for member in members])
    onboarding = {
        "steps": steps,
        "completed": sum(1 for member in members if completed.get(member.user_id, 0) >= steps),
        "started": sum(1 for member in members if 0 < completed.get(member.user_id, 0) < steps),
    } if steps else None

    return {"member_count": len(members), "onboarding": onboarding, "tracks": track_entries}
