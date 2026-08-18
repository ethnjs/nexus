from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.chapters import require_officer_or_lead
from app.core.form import (
    remove_form_field,
    reorder_field,
    replace_field_type,
    resolve_field_options,
    set_field_config,
    update_field_text,
)
from app.core.form.permissions import require_form_manage_access, require_form_view_access
from app.core.tournament.permissions import MANAGE_FORMS, require_permission
from app.db.session import get_db
from app.models.models import Form, FormAnswer, FormField, FormResponse, User, utcnow
from app.schemas.form import (
    FormCreate,
    FormFieldCreate,
    FormFieldRead,
    FormFieldUpdate,
    FormRead,
    FormResponseCreate,
    FormResponseRead,
    FormUpdate,
)

router = APIRouter(tags=["forms"])


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/forms/ — MANAGE_FORMS on the tournament.
# ---------------------------------------------------------------------------
@router.post(
    "/tournaments/{tournament_id}/forms/",
    response_model=FormRead,
    status_code=status.HTTP_201_CREATED,
    tags=["tournaments"],
)
def create_tournament_form(
    tournament_id: int,
    form_in: FormCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    if form_in.owner_type != "tournament" or form_in.tournament_id != tournament_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="owner_type must be 'tournament' and tournament_id must match the path",
        )

    form = Form(
        name=form_in.name,
        description=form_in.description,
        owner_type="tournament",
        tournament_id=tournament_id,
        chapter_id=None,
        creates_membership_on_submit=form_in.creates_membership_on_submit,
        created_by=current_user.id,
    )
    db.add(form)
    db.commit()
    db.refresh(form)
    return form


# ---------------------------------------------------------------------------
# POST /chapters/{chapter_id}/forms/ — lead/officer on the chapter.
# ---------------------------------------------------------------------------
@router.post(
    "/chapters/{chapter_id}/forms/",
    response_model=FormRead,
    status_code=status.HTTP_201_CREATED,
    tags=["chapters"],
)
def create_chapter_form(
    chapter_id: int,
    form_in: FormCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_officer_or_lead(chapter_id, db, current_user)

    if form_in.owner_type != "chapter" or form_in.chapter_id != chapter_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="owner_type must be 'chapter' and chapter_id must match the path",
        )

    form = Form(
        name=form_in.name,
        description=form_in.description,
        owner_type="chapter",
        tournament_id=None,
        chapter_id=chapter_id,
        creates_membership_on_submit=form_in.creates_membership_on_submit,
        created_by=current_user.id,
    )
    db.add(form)
    db.commit()
    db.refresh(form)
    return form


# ---------------------------------------------------------------------------
# GET /forms/{form_id}/ — view/render. Any member of a linked
# tournament/chapter can view (not just managers) — this is what the form
# renderer for people filling it out calls.
# ---------------------------------------------------------------------------
@router.get("/forms/{form_id}/", response_model=FormRead)
def get_form_for_rendering(
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_view_access),
):
    active_fields = (
        db.query(FormField)
        .filter(FormField.form_id == form.id, FormField.is_archived == False)
        .order_by(FormField.order)
        .all()
    )

    for field in active_fields:
        resolved_options = resolve_field_options(db, field)
        if resolved_options:
            config = dict(field.config or {})
            config["options"] = resolved_options
            field.config = config

    form.fields = active_fields
    return form


# ---------------------------------------------------------------------------
# PATCH /forms/{form_id}/ — name/description/status only. Adding/removing
# tournament or chapter links isn't handled here yet.
# ---------------------------------------------------------------------------
@router.patch("/forms/{form_id}/", response_model=FormRead)
def update_form(
    form_in: FormUpdate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    if form_in.name is not None:
        form.name = form_in.name
    if form_in.description is not None:
        form.description = form_in.description
    if form_in.status is not None:
        form.status = form_in.status

    db.commit()
    db.refresh(form)
    return form


# ---------------------------------------------------------------------------
# POST /forms/{form_id}/archive/ — soft delete via status="archived".
# Responses and fields are left in place.
# ---------------------------------------------------------------------------
@router.post("/forms/{form_id}/archive/", response_model=FormRead)
def archive_form(
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    form.status = "archived"
    db.commit()
    db.refresh(form)
    return form


# ---------------------------------------------------------------------------
# DELETE /forms/{form_id}/ — hard delete. Blocked if any responses exist
# (use the archive route above instead — hard delete would cascade away
# submitted response data). Cascades to fields and the tournament/chapter
# links otherwise.
# ---------------------------------------------------------------------------
@router.delete("/forms/{form_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_form(
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    has_responses = db.query(FormResponse).filter(FormResponse.form_id == form.id).first() is not None
    if has_responses:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Form has existing responses — archive it instead of deleting",
        )

    db.delete(form)
    db.commit()


# ---------------------------------------------------------------------------
# POST /forms/{form_id}/fields/ — MANAGE_FORMS on any linked tournament, or
# lead/officer on any linked chapter (the form already exists and is
# already linked, so the "any one" rule applies here, unlike form creation).
# ---------------------------------------------------------------------------
@router.post("/forms/{form_id}/fields/", response_model=FormFieldRead, status_code=status.HTTP_201_CREATED)
def create_form_field(
    field_in: FormFieldCreate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    if field_in.field_key is not None:
        existing = (
            db.query(FormField)
            .filter(FormField.form_id == form.id, FormField.field_key == field_in.field_key)
            .first()
        )
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="field_key already in use on this form")

    order = field_in.order
    if order is None:
        max_order = db.query(func.max(FormField.order)).filter(FormField.form_id == form.id).scalar()
        order = (max_order or 0) + 1

    field = FormField(
        form_id=form.id,
        order=order,
        label=field_in.label,
        description=field_in.description,
        question_type=field_in.question_type,
        field_key=field_in.field_key,
        config=field_in.config,
        is_archived=False,
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return field


# ---------------------------------------------------------------------------
# PATCH /forms/{form_id}/fields/{field_id}/
# ---------------------------------------------------------------------------
@router.patch("/forms/{form_id}/fields/{field_id}/", response_model=FormFieldRead)
def edit_form_field(
    field_id: int,
    field_in: FormFieldUpdate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    field = db.query(FormField).filter(FormField.id == field_id, FormField.form_id == form.id).first()
    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")

    if field_in.question_type is not None and field_in.question_type != field.question_type:
        field = replace_field_type(db, field, field_in.question_type)

    if field_in.label is not None or field_in.description is not None:
        field = update_field_text(db, field, field_in.label, field_in.description)

    if field_in.order is not None:
        field = reorder_field(db, field, field_in.order)

    if field_in.config is not None:
        field = set_field_config(db, field, field_in.config)

    return field


# ---------------------------------------------------------------------------
# DELETE /forms/{form_id}/fields/{field_id}/
# Archives a form field if responses exist. Hard deletes if responses do
# not exist.
# ---------------------------------------------------------------------------
@router.delete("/forms/{form_id}/fields/{field_id}/")
def delete_or_archive_form_field(
    field_id: int,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    field = db.query(FormField).filter(FormField.id == field_id, FormField.form_id == form.id).first()
    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")

    was_archived = remove_form_field(db=db, field=field)

    return {
        "success": True,
        "action": "archived" if was_archived else "deleted",
        "field_id": field_id,
    }


# ---------------------------------------------------------------------------
# POST /forms/{form_id}/responses/ — submit or resubmit. One row per
# (form, user); resubmitting replaces all of that user's answers in place
# (no submission history). View access, not manage — this is what the
# person filling the form out calls.
# ---------------------------------------------------------------------------
@router.post("/forms/{form_id}/responses/", response_model=FormResponseRead)
def submit_form_response(
    response_in: FormResponseCreate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_view_access),
    current_user: User = Depends(get_current_user),
):
    field_ids = [answer_in.field_id for answer_in in response_in.answers]
    if field_ids:
        valid_field_ids = {
            field_id
            for (field_id,) in db.query(FormField.id).filter(
                FormField.id.in_(field_ids),
                FormField.form_id == form.id,
                FormField.is_archived == False,
            ).all()
        }
        invalid_field_ids = set(field_ids) - valid_field_ids
        if invalid_field_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid field_id(s) for this form: {sorted(invalid_field_ids)}",
            )

    response = (
        db.query(FormResponse)
        .filter(FormResponse.form_id == form.id, FormResponse.user_id == current_user.id)
        .first()
    )
    if response is None:
        response = FormResponse(form_id=form.id, user_id=current_user.id)
        db.add(response)
        db.flush()
    else:
        db.query(FormAnswer).filter(FormAnswer.response_id == response.id).delete()
        response.updated_at = utcnow()

    for answer_in in response_in.answers:
        db.add(FormAnswer(response_id=response.id, field_id=answer_in.field_id, value=answer_in.value))

    db.commit()
    db.refresh(response)
    return response


# ---------------------------------------------------------------------------
# GET /forms/{form_id}/responses/ — all responses to a form. Manage access
# only — this is roster data, not something every member should see.
# ---------------------------------------------------------------------------
@router.get("/forms/{form_id}/responses/", response_model=list[FormResponseRead])
def list_form_responses(
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    return (
        db.query(FormResponse)
        .filter(FormResponse.form_id == form.id)
        .order_by(FormResponse.id)
        .all()
    )


# ---------------------------------------------------------------------------
# GET /forms/{form_id}/responses/me/ — the current user's own response.
# ---------------------------------------------------------------------------
@router.get("/forms/{form_id}/responses/me/", response_model=FormResponseRead)
def get_my_form_response(
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_view_access),
    current_user: User = Depends(get_current_user),
):
    response = (
        db.query(FormResponse)
        .filter(FormResponse.form_id == form.id, FormResponse.user_id == current_user.id)
        .first()
    )
    if not response:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No response found")
    return response
