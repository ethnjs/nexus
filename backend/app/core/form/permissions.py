from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.chapters import require_officer_or_lead
from app.core.tournament import require_not_archived
from app.core.tournament.form_prerequisites import member_meets_form_prerequisites
from app.core.tournament.memberships import get_membership_by_user, has_any_membership
from app.core.tournament.onboarding import (
    needs_tournament_onboarding,
    next_required_onboarding_form_id,
)
from app.core.tournament.permissions import MANAGE_FORMS, get_user_permissions, has_permission
from app.db.session import get_db
from app.models.models import ChapterMembership, Form, FormResponse, User

# ---------------------------------------------------------------------------
# Form access control. A Form is owned by exactly one tournament or one
# chapter (owner_type), so access is a single check dispatched on that
# owner_type — not an "any one of several links" check.
# ---------------------------------------------------------------------------


def _load_form_or_404(form_id: str, db: Session) -> Form:
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise _form_not_found()
    return form


def require_form_not_archived(form: Form) -> None:
    """Call in every form write route, after the access dependency. Not baked
    into the dependencies because they also gate reads, and an archived
    tournament's forms stay readable. Chapter forms have nothing to freeze with."""
    if form.owner_type == "tournament":
        assert form.tournament is not None
        require_not_archived(form.tournament)


def require_form_editable(form: Form) -> None:
    """Call in routes that change a form's content. An archived form is
    read-only until it's restored to draft."""
    if form.status == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This form is archived — restore it to draft to edit it",
        )


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
        assert form.tournament_id is not None
        if not has_any_membership(current_user, form.tournament_id, db):
            # 404 to avoid leaking tournament existence, matching require_permission()
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form not found")
        if not has_permission(current_user, form.tournament_id, MANAGE_FORMS, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
            )
    else:
        assert form.chapter_id is not None
        require_officer_or_lead(form.chapter_id, db, current_user)

    return form


def _form_not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form not found")


def _prerequisites_not_met() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not meet this form's prerequisites",
    )


def _onboarding_required(tournament_id: int, is_onboarding: bool) -> HTTPException:
    """The frontend can't load the form, so the detail says whose sequence to
    send the member into and whether to come back after: a step of that
    sequence is reached along the way."""
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": "onboarding_required",
            "message": "Finish this tournament's onboarding first.",
            "tournament_id": tournament_id,
            "is_onboarding": is_onboarding,
        },
    )


def require_form_view_access(
    form_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Form:
    """Dependency — loads the Form and requires either manage access, or
    plain membership in the owning tournament/chapter (for the people
    filling the form out, not just the people managing it). A tournament
    respondent gets 404 for a draft, or an archived form they never answered."""
    form = _load_form_or_404(form_id, db)

    if form.owner_type == "tournament":
        assert form.tournament_id is not None
        # Respondents get the same 404 as a missing form for anything they
        # can't open at all, so a link never reveals that a form exists.
        if not has_any_membership(current_user, form.tournament_id, db):
            raise _form_not_found()
        permissions = get_user_permissions(current_user, form.tournament_id, db)
        if MANAGE_FORMS in permissions:
            return form

        membership = get_membership_by_user(db, form.tournament_id, current_user.id)
        # Only a site admin can pass has_any_membership without a row; admins
        # already pass MANAGE_FORMS above, so this remains a defensive guard.
        if membership is None:
            raise _form_not_found()
        responded = (
            db.query(FormResponse.id)
            .filter(FormResponse.form_id == form.id, FormResponse.user_id == current_user.id)
            .first()
            is not None
        )
        if form.status == "draft" or (form.status == "archived" and not responded):
            raise _form_not_found()
        # A response to an archived form stays readable whatever the gates
        # below now say; _require_published still rejects every write.
        if form.status == "archived":
            return form

        tournament_form = form.tournament_form
        if tournament_form is None:
            raise _form_not_found()
        if tournament_form.is_onboarding:
            # Their current step, or one they already completed — a finished
            # step stays reachable so its response can be read and revised
            # (flagged updates, allow_response_edits). A step their roles keep
            # off their path is a plain no; sending them into the sequence
            # would find nothing for them there.
            if not responded:
                if not member_meets_form_prerequisites(db, membership, tournament_form):
                    raise _prerequisites_not_met()
                if next_required_onboarding_form_id(db, membership) != form.id:
                    raise _onboarding_required(form.tournament_id, is_onboarding=True)
        elif needs_tournament_onboarding(db, membership, permissions):
            raise _onboarding_required(form.tournament_id, is_onboarding=False)
        elif not member_meets_form_prerequisites(db, membership, tournament_form):
            raise _prerequisites_not_met()
    else:
        if (
            current_user.role != "admin"
            and not db.query(ChapterMembership)
            .filter(
                ChapterMembership.user_id == current_user.id,
                ChapterMembership.chapter_id == form.chapter_id,
            )
            .first()
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
            )

    return form
