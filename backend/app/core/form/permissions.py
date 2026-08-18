from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.tournament.memberships import has_any_membership
from app.core.tournament.permissions import MANAGE_FORMS, has_permission
from app.db.session import get_db
from app.models.models import ChapterMembership, Form, User

# ---------------------------------------------------------------------------
# Form access control.
#
# A Form can be linked to multiple tournaments and/or chapters, so access
# isn't a single require_permission(tournament_id) check like other
# tournament-scoped resources — it's "does the user pass on ANY ONE of the
# form's linked tournaments/chapters."
# ---------------------------------------------------------------------------


def user_manages_any_tournament(user: User, tournament_ids: list[int], db: Session) -> bool:
    return any(has_permission(user, tid, MANAGE_FORMS, db) for tid in tournament_ids)


def user_leads_any_chapter(user: User, chapter_ids: list[int], db: Session) -> bool:
    if not chapter_ids:
        return False
    if user.role == "admin":
        return True
    return (
        db.query(ChapterMembership)
        .filter(
            ChapterMembership.user_id == user.id,
            ChapterMembership.chapter_id.in_(chapter_ids),
            ChapterMembership.role.in_(("lead", "officer")),
        )
        .first()
        is not None
    )


def user_can_manage_form_links(user: User, tournament_ids: list[int], chapter_ids: list[int], db: Session) -> bool:
    """True if `user` holds MANAGE_FORMS on any tournament in tournament_ids,
    or lead/officer on any chapter in chapter_ids.

    For managing an ALREADY-LINKED form only (edit fields, change status,
    etc.) — a co-manager of just one linked tournament can still touch a
    form shared across several. Do NOT use this to authorize creating new
    links (see user_can_link_all) — "any one" is the wrong rule there, since
    it would let someone with MANAGE_FORMS on tournament A link a form to
    tournament B too, despite having no authority over B.
    """
    return user_manages_any_tournament(user, tournament_ids, db) or user_leads_any_chapter(user, chapter_ids, db)


def user_can_link_all(user: User, tournament_ids: list[int], chapter_ids: list[int], db: Session) -> bool:
    """True only if `user` holds MANAGE_FORMS on EVERY tournament in
    tournament_ids, and lead/officer on EVERY chapter in chapter_ids.

    Use this whenever a request is establishing NEW form<->tournament or
    form<->chapter links (currently: form creation only). There's no
    cross-TD request/accept flow yet — a TD who wants to link a form into
    someone else's tournament needs a MANAGE_FORMS-holding role there first
    (existing invite/role machinery). Known gap, not solved here.
    """
    tournaments_ok = all(has_permission(user, tid, MANAGE_FORMS, db) for tid in tournament_ids)
    chapters_ok = all(user_leads_any_chapter(user, [cid], db) for cid in chapter_ids)
    return tournaments_ok and chapters_ok


def _load_form_or_404(form_id: int, db: Session) -> Form:
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form not found")
    return form


def require_form_manage_access(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Form:
    """Dependency — loads the Form and requires manage access (MANAGE_FORMS
    on any linked tournament, or lead/officer on any linked chapter).
    Returns the Form so route handlers don't need a second query."""
    form = _load_form_or_404(form_id, db)
    tournament_ids = [link.tournament_id for link in form.tournament_links]
    chapter_ids = [link.chapter_id for link in form.chapter_links]

    if not user_can_manage_form_links(current_user, tournament_ids, chapter_ids, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    return form


def require_form_view_access(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Form:
    """Dependency — loads the Form and requires either manage access, or
    plain membership in any linked tournament/chapter (for the people
    filling the form out, not just the people managing it)."""
    form = _load_form_or_404(form_id, db)
    tournament_ids = [link.tournament_id for link in form.tournament_links]
    chapter_ids = [link.chapter_id for link in form.chapter_links]

    if user_can_manage_form_links(current_user, tournament_ids, chapter_ids, db):
        return form
    if any(has_any_membership(current_user, tid, db) for tid in tournament_ids):
        return form
    if chapter_ids and db.query(ChapterMembership).filter(
        ChapterMembership.user_id == current_user.id,
        ChapterMembership.chapter_id.in_(chapter_ids),
    ).first():
        return form

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
