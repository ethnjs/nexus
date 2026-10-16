"""
Per-tournament audit log — records who did what, to what, when. Not
cross-tournament, not chapter-wide (tournaments don't live inside chapters).
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.models import AuditLogEntry, User

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
FORM_RESPONSE_DELETED = "form_response_deleted"
DISCORD_SERVER_LINKED = "discord_server_linked"
DISCORD_SERVER_UNLINKED = "discord_server_unlinked"
DISCORD_SETTINGS_UPDATED = "discord_settings_updated"
DATA_EXPORTED = "data_exported"

ALL_ACTIONS: list[str] = [
    ROLE_CREATED,
    ROLE_UPDATED,
    ROLE_DELETED,
    JOIN_CODE_CREATED,
    JOIN_CODE_UPDATED,
    JOIN_CODE_DEACTIVATED,
    STAFF_INVITE_SENT,
    TOURNAMENT_VERIFIED,
    TOURNAMENT_ARCHIVED,
    TOURNAMENT_UNARCHIVED,
    OWNERSHIP_TRANSFERRED,
    TRACK_DELETE_PENDING,
    TRACK_DELETE_CANCELLED,
    TRACK_PURGED,
    FORM_RESPONSE_DELETED,
    DISCORD_SERVER_LINKED,
    DISCORD_SERVER_UNLINKED,
    DISCORD_SETTINGS_UPDATED,
    DATA_EXPORTED,
]


def log_action(
    db: Session,
    tournament_id: int,
    actor_id: int | None,
    action: str,
    target_type: str | None = None,
    target_id: int | None = None,
    extra_data: dict | None = None,
) -> AuditLogEntry:
    """Records an audit log entry, copying the actor's current name and email
    onto it. Does not commit."""
    actor = db.get(User, actor_id) if actor_id is not None else None
    actor_name = f"{actor.first_name or ''} {actor.last_name or ''}".strip() if actor else ""
    entry = AuditLogEntry(
        tournament_id=tournament_id,
        actor_id=actor_id,
        actor_name=actor_name or None,
        actor_email=actor.email if actor else None,
        action=action,
        target_type=target_type,
        target_id=target_id,
        extra_data=extra_data,
    )
    db.add(entry)
    return entry
