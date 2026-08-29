from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.routes.forms import _to_list_read
from app.core.auth import get_current_user
from app.core.tournament import get_tournament, require_not_archived
from app.core.tournament.memberships import get_membership_by_user, is_declined, resolve_memberships_or_users
from app.core.tournament.onboarding import advance_onboarding_progress
from app.core.tournament.permissions import MANAGE_FORMS, require_permission
from app.db.session import get_db
from app.models.models import TournamentForm, TournamentMembership, User
from app.schemas.tournament.onboarding import (
    OnboardingFormAdd,
    OnboardingFormRead,
    OnboardingFormReorder,
    OnboardingProgressRead,
)

# Routes are nested: /tournaments/{tournament_id}/onboarding-forms/...
router = APIRouter(prefix="/tournaments/{tournament_id}/onboarding-forms", tags=["tournaments"])
member_router = APIRouter(prefix="/tournaments/{tournament_id}/onboarding", tags=["tournaments"])


def _read(tf: TournamentForm, creator) -> OnboardingFormRead:
    base = _to_list_read(tf.form, creator)
    return OnboardingFormRead(**base.model_dump(), order=tf.order)


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/onboarding/progress/ — member-facing
# progression after a successful form submission. It finds the next required
# published form and snapshots onboarded_at the first time none remain.
# ---------------------------------------------------------------------------
@member_router.post("/progress/", response_model=OnboardingProgressRead)
def advance_member_onboarding(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    membership = get_membership_by_user(db, tournament_id, current_user.id)
    if membership is None or is_declined(membership):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament membership not found")

    progress = advance_onboarding_progress(db, membership)
    db.commit()
    db.refresh(membership)
    return OnboardingProgressRead(
        next_form_id=progress.next_form_id,
        onboarded_at=membership.onboarded_at,
    )


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/onboarding-forms/ — the onboarding config
# page's list, in order. manage_forms-gated, same as the standalone forms
# list — this isn't the member-facing "what do I need to fill out" view.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[OnboardingFormRead])
def list_onboarding_forms(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    rows = (
        db.query(TournamentForm)
        .filter(TournamentForm.tournament_id == tournament_id, TournamentForm.is_onboarding == True)
        .order_by(TournamentForm.order)
        .all()
    )
    creators = resolve_memberships_or_users(db, tournament_id, {r.form.created_by for r in rows})
    return [_read(r, creators[r.form.created_by]) for r in rows]


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/onboarding-forms/ — flips an existing
# TournamentForm row's is_onboarding to True and appends it to the order.
# Every tournament-scoped Form already has a TournamentForm row (created
# alongside the Form itself, see create_tournament_form in forms.py) — this
# never inserts a new row, only flips one.
#
# Clears onboarded_at tournament-wide: adding a new onboarding form expands
# what "onboarded" requires, so anyone already past the old bar goes back to
# pending until they clear the new one too. See TournamentMembership.onboarded_at.
# ---------------------------------------------------------------------------
@router.post("/", response_model=OnboardingFormRead, status_code=status.HTTP_201_CREATED)
def add_onboarding_form(
    tournament_id: int,
    payload: OnboardingFormAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    tf = (
        db.query(TournamentForm)
        .filter(TournamentForm.form_id == payload.form_id, TournamentForm.tournament_id == tournament_id)
        .first()
    )
    if tf is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form not found")
    if tf.is_onboarding:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This form is already part of onboarding")
    # An onboarding step must be immediately answerable. In particular,
    # accepting a draft here would invalidate existing completions before the
    # new requirement could actually be satisfied.
    if tf.form.status != "published":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only published forms can be added to onboarding",
        )

    max_order = (
        db.query(TournamentForm.order)
        .filter(TournamentForm.tournament_id == tournament_id, TournamentForm.is_onboarding == True)
        .order_by(TournamentForm.order.desc())
        .first()
    )
    tf.is_onboarding = True
    tf.order = (max_order[0] if max_order else 0) + 1

    db.query(TournamentMembership).filter(
        TournamentMembership.tournament_id == tournament_id,
        TournamentMembership.onboarded_at.isnot(None),
    ).update({TournamentMembership.onboarded_at: None})

    db.commit()
    db.refresh(tf)
    creators = resolve_memberships_or_users(db, tournament_id, {tf.form.created_by})
    return _read(tf, creators[tf.form.created_by])


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/onboarding-forms/reorder/ — final order
# values computed client-side (drag-and-drop preview); this validates the
# submitted set matches the current onboarding forms and applies them
# atomically. Registered before "/{form_id}/" so the literal path wins.
# Mirrors PATCH /roles/reorder-bulk/'s shape (RoleBulkReorder).
# ---------------------------------------------------------------------------
@router.patch("/reorder/", response_model=list[OnboardingFormRead])
def reorder_onboarding_forms(
    tournament_id: int,
    payload: OnboardingFormReorder,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    rows = (
        db.query(TournamentForm)
        .filter(TournamentForm.tournament_id == tournament_id, TournamentForm.is_onboarding == True)
        .all()
    )
    rows_by_form_id = {r.form_id: r for r in rows}

    submitted_ids = [item.form_id for item in payload.forms]
    expected_ids = set(rows_by_form_id)
    if len(submitted_ids) != len(set(submitted_ids)) or set(submitted_ids) != expected_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="forms must cover exactly the current onboarding forms, no more and no fewer",
        )

    submitted_orders = [item.order for item in payload.forms]
    expected_orders = set(range(1, len(rows) + 1))
    if set(submitted_orders) != expected_orders:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="orders must be a unique, contiguous sequence from 1 through the number of onboarding forms",
        )

    for item in payload.forms:
        rows_by_form_id[item.form_id].order = item.order

    db.commit()
    creators = resolve_memberships_or_users(db, tournament_id, {r.form.created_by for r in rows})
    ordered = sorted(rows_by_form_id.values(), key=lambda r: r.order)
    return [_read(r, creators[r.form.created_by]) for r in ordered]


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/onboarding-forms/{form_id}/ — "remove
# from onboarding": flips is_onboarding back to False and clears order. The
# TournamentForm row itself is never deleted (see model docstring) — the
# underlying Form is untouched and can be archived separately afterward.
#
# No onboarded_at reset here — a shrinking requirement can only complete
# stragglers waiting on this form, never un-onboard someone already done.
# Remaining onboarding rows are renumbered contiguously.
# ---------------------------------------------------------------------------
@router.delete("/{form_id}/", status_code=status.HTTP_204_NO_CONTENT)
def remove_onboarding_form(
    tournament_id: int,
    form_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    tf = (
        db.query(TournamentForm)
        .filter(TournamentForm.form_id == form_id, TournamentForm.tournament_id == tournament_id)
        .first()
    )
    if tf is None or not tf.is_onboarding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form is not part of onboarding")

    tf.is_onboarding = False
    tf.order = None
    db.flush()

    remaining = (
        db.query(TournamentForm)
        .filter(TournamentForm.tournament_id == tournament_id, TournamentForm.is_onboarding == True)
        .order_by(TournamentForm.order)
        .all()
    )
    for index, row in enumerate(remaining, start=1):
        row.order = index

    db.commit()
