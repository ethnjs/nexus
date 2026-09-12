"""
Setup-wizard checklist. Status is computed live, not stored — cheap indexed
lookups, not a hot path.

Every item is an existence check: has this tournament got at least one of the
thing. Nothing here tracks "did the TD look at the page", so an item can go
back to not_started if its rows are all deleted, which is the honest answer.
"""
from __future__ import annotations
from sqlalchemy.orm import Session

from app.core.tournament.audit import STAFF_INVITE_SENT
from app.models.models import (
    AuditLogEntry,
    Form,
    Tournament,
    TournamentEvent,
    TournamentForm,
    TournamentRole,
    TournamentShift,
)


def get_checklist(db: Session, tournament: Tournament) -> dict:
    def exists(model) -> bool:
        return db.query(model.id).filter(model.tournament_id == tournament.id).first() is not None

    has_roles = exists(TournamentRole)
    has_events = exists(TournamentEvent)
    has_shifts = exists(TournamentShift)

    has_invite = (
        db.query(AuditLogEntry.id)
        .filter(
            AuditLogEntry.tournament_id == tournament.id,
            AuditLogEntry.action == STAFF_INVITE_SENT,
        )
        .first()
        is not None
    )

    # A form of any kind, in any state — this is the "you've opened the builder
    # and made something" step.
    has_form = (
        db.query(Form.id)
        .filter(Form.owner_type == "tournament", Form.tournament_id == tournament.id)
        .first()
        is not None
    )

    # Onboarding is the stricter one: a form only onboards anybody once it's
    # flagged as an onboarding step *and* published. A draft collects nothing.
    has_onboarding = (
        db.query(TournamentForm.form_id)
        .join(Form, TournamentForm.form_id == Form.id)
        .filter(
            TournamentForm.tournament_id == tournament.id,
            TournamentForm.is_onboarding == True,  # noqa: E712 — SQLAlchemy column comparison
            Form.status == "published",
        )
        .first()
        is not None
    )

    # Ordered by dependency, two per row in the widget: a useful volunteer form
    # needs events and shifts to already exist for its preference and
    # availability questions to point at.
    items = [
        {"item_key": "roles", "label": "Set Up Roles", "complete": has_roles},
        {"item_key": "invite_staff", "label": "Invite Staff", "complete": has_invite},
        {"item_key": "events", "label": "Set Up Events", "complete": has_events},
        {"item_key": "shifts", "label": "Set Up Shifts", "complete": has_shifts},
        {"item_key": "first_form", "label": "Make Your First Form", "complete": has_form},
        {"item_key": "onboarding", "label": "Customize Onboarding", "complete": has_onboarding},
    ]

    items = [
        {"item_key": i["item_key"], "label": i["label"],
         "status": "complete" if i["complete"] else "not_started"}
        for i in items
    ]
    completed = sum(1 for i in items if i["status"] == "complete")
    return {"items": items, "completed_count": completed, "total_count": len(items)}
