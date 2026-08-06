"""
Setup-wizard checklist. Status is computed live, not stored — cheap indexed
lookups, not a hot path.
"""
from __future__ import annotations
from sqlalchemy.orm import Session

from app.core.tournament.audit import STAFF_INVITE_SENT
from app.models.models import AuditLogEntry, Tournament, TournamentRole


def get_checklist(db: Session, tournament: Tournament) -> dict:
    has_dates = tournament.start_date is not None and tournament.end_date is not None
    has_location = tournament.location is not None or tournament.university_id is not None

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
        {"item_key": "dates", "label": "Set Tournament Dates",
         "status": "complete" if has_dates else "not_started"},
        {"item_key": "location", "label": "Set Location",
         "status": "complete" if has_location else "not_started"},
        {"item_key": "roles", "label": "Set Up Roles",
         "status": "complete" if has_roles else "not_started"},
        {"item_key": "invite_staff", "label": "Invite Staff",
         "status": "complete" if has_invite else "not_started"},
        # No tables exist yet for these — hardcoded until each is built.
        {"item_key": "onboarding", "label": "Customize Onboarding", "status": "not_started"},
        {"item_key": "events", "label": "Set Up Events", "status": "not_started"},
        {"item_key": "shifts", "label": "Set Up Shifts", "status": "not_started"},
        {"item_key": "buildings", "label": "Set Up Buildings", "status": "not_started"},
    ]
    completed = sum(1 for i in items if i["status"] == "complete")
    return {"items": items, "completed_count": completed, "total_count": len(items)}
