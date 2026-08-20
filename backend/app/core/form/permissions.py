from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.chapters import require_officer_or_lead
from app.core.tournament.memberships import has_any_membership
from app.core.tournament.permissions import MANAGE_FORMS, has_permission
from app.db.session import get_db
from app.models.models import ChapterMembership, Form, User

# ---------------------------------------------------------------------------
# Form access control. A Form is owned by exactly one tournament or one
# chapter (owner_type), so access is a single check dispatched on that
# owner_type — not an "any one of several links" check.
# ---------------------------------------------------------------------------


def _load_form_or_404(form_id: str, db: Session) -> Form:
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form not found")
    return form


def require_form_manage_access(
    form_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Form:
    """Dependency — loads the Form and requires MANAGE_FORMS on the owning
    tournament, or lead/officer on the owning chapter. Returns the Form so
    route handlers don't need a second query."""
    form = _load_form_or_404(form_id, db)

    if form.owner_type == "tournament":
        if not has_any_membership(current_user, form.tournament_id, db):
            # 404 to avoid leaking tournament existence, matching require_permission()
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form not found")
        if not has_permission(current_user, form.tournament_id, MANAGE_FORMS, db):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    else:
        require_officer_or_lead(form.chapter_id, db, current_user)

    return form


def require_form_view_access(
    form_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Form:
    """Dependency — loads the Form and requires either manage access, or
    plain membership in the owning tournament/chapter (for the people
    filling the form out, not just the people managing it)."""
    form = _load_form_or_404(form_id, db)

    if form.owner_type == "tournament":
        if not has_any_membership(current_user, form.tournament_id, db):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    else:
        if current_user.role != "admin" and not db.query(ChapterMembership).filter(
            ChapterMembership.user_id == current_user.id,
            ChapterMembership.chapter_id == form.chapter_id,
        ).first():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    return form
