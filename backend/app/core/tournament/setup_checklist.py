"""
Setup-wizard checklist — computes each item's status live off other tables
plus Tournament.setup_progress for the handful of items with no other
derivable signal (currently just "visibility").

Adding a new item once its feature is built: replace its hardcoded
"not_started" entry below with real derived status logic. The response shape
doesn't change — item_key/label/status only, no route/action/buildable
fields; the frontend owns display config (which cards are clickable, where
they navigate).
"""
from __future__ import annotations
from sqlalchemy.orm import Session

from app.core.tournament.audit import STAFF_INVITE_SENT
from app.models.models import AuditLogEntry, Tournament, TournamentRole


def get_checklist(db: Session, tournament: Tournament) -> dict:
    has_roles = (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament.id)
        .first()
        is not None
    )

    has_invite = (
        db.query(AuditLogEntry)
        .filter(
            AuditLogEntry.tournament_id == tournament.id,
            AuditLogEntry.action == STAFF_INVITE_SENT,
        )
        .first()
        is not None
    )

    items = [
        {"item_key": "roles", "label": "Set Up Roles",
         "status": "complete" if has_roles else "not_started"},
        {"item_key": "invite_staff", "label": "Invite Staff",
         "status": "complete" if has_invite else "not_started"},
        {"item_key": "visibility", "label": "Set Visibility",
         "status": "complete" if "visibility" in (tournament.setup_progress or {}) else "not_started"},
        # No tables exist yet for these — hardcoded until each is actually
        # built. When built, add real status logic above; response shape
        # doesn't change.
        {"item_key": "onboarding", "label": "Customize Onboarding", "status": "not_started"},
        {"item_key": "events", "label": "Set Up Events", "status": "not_started"},
        {"item_key": "shifts", "label": "Set Up Shifts", "status": "not_started"},
        {"item_key": "buildings", "label": "Set Up Buildings", "status": "not_started"},
    ]
    completed = sum(1 for i in items if i["status"] == "complete")
    return {"items": items, "completed_count": completed, "total_count": len(items)}
