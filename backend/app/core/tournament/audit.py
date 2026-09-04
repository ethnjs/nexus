"""
Per-tournament audit log — records who did what, to what, when. Not
cross-tournament, not chapter-wide (tournaments don't live inside chapters).
"""
from __future__ import annotations
from sqlalchemy.orm import Session

from app.models.models import AuditLogEntry

# ---------------------------------------------------------------------------
# Action constants
# ---------------------------------------------------------------------------
ROLE_CREATED = "role_created"
ROLE_UPDATED = "role_updated"
ROLE_DELETED = "role_deleted"
JOIN_CODE_CREATED = "join_code_created"
JOIN_CODE_UPDATED = "join_code_updated"
JOIN_CODE_DEACTIVATED = "join_code_deactivated"
STAFF_INVITE_SENT = "staff_invite_sent"
TOURNAMENT_VERIFIED = "tournament_verified"
TOURNAMENT_ARCHIVED = "tournament_archived"
TOURNAMENT_UNARCHIVED = "tournament_unarchived"
OWNERSHIP_TRANSFERRED = "ownership_transferred"
# Track deletion is two-phase when shifts or form fields still point at the
# track: it's marked pending, then purged once the last one is repointed.
# Both transitions are logged because the second one happens as a side effect
# of an unrelated edit, with no TD action naming the track at all.
TRACK_DELETE_PENDING = "track_delete_pending"
TRACK_DELETE_CANCELLED = "track_delete_cancelled"
TRACK_PURGED = "track_purged"

ALL_ACTIONS: list[str] = [
    ROLE_CREATED, ROLE_UPDATED, ROLE_DELETED,
    JOIN_CODE_CREATED, JOIN_CODE_UPDATED, JOIN_CODE_DEACTIVATED, STAFF_INVITE_SENT,
    TOURNAMENT_VERIFIED, TOURNAMENT_ARCHIVED, TOURNAMENT_UNARCHIVED, OWNERSHIP_TRANSFERRED,
    TRACK_DELETE_PENDING, TRACK_DELETE_CANCELLED, TRACK_PURGED,
]


def log_action(
    db: Session,
    tournament_id: int,
    actor_id: int,
    action: str,
    target_type: str | None = None,
    target_id: int | None = None,
    extra_data: dict | None = None,
) -> AuditLogEntry:
    """
    Record an audit log entry. Does not commit — call this before the
    route's own db.commit() so the log entry lands in the same transaction
    as the action it describes.
    """
    entry = AuditLogEntry(
        tournament_id=tournament_id,
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        extra_data=extra_data,
    )
    db.add(entry)
    return entry
