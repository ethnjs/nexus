from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.form import remove_form_field, update_field_text, replace_field_type, add_option, change_option_label, remove_option_from_field, resolve_field_options, has_form_permission
from app.db.session import get_db
from app.models.models import User, Form, FormField, FormAnswer, FormResponse, Tournament, AlumniChapter
from app.schemas.form import FormCreate, FormRead, FormUpdate, FormFieldCreate, FormFieldRead, FormFieldUpdate
from app.core.tournament.permissions import has_permission

router = APIRouter(tags=["forms"])


@router.get("/forms/{form_id}/", response_model=FormRead)
def get_form_for_rendering(
    form_id: int,
    db: Session = Depends(get_db),
):
    form = db.query(Form).filter(Form.id == form_id).first()

    if not form:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form not found")

    active_fields = db.query(FormField).filter(FormField.form_id == form_id, FormField.is_archived == False).all()

    for field in active_fields:
        resolved_options = resolve_field_options(db, field)
        if resolved_options:
            config = dict(field.config or {})
            config["options"] = resolved_options
            field.config = config

    form.fields = active_fields
    return form


@router.post("/forms/", response_model=FormRead, status_code=status.HTTP_201_CREATED)
def create_form(
    form_in: FormCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create Form. MANAGE_FORMS permission required."""

    has_form_permission(db, form_in.tournament_id, form_in.chapter_id, current_user)

    if form_in.tournament_id:
        tournament_id = db.query(Tournament).filter(Tournament.id == form_in.tournament_id).first()
        if not tournament_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if form_in.chapter_id:
        chapter_id = db.query(AlumniChapter).filter(AlumniChapter.id == form_in.chapter_id).first()
        if not chapter_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found")

    if form_in.tournament_id and form_in.chapter_id:
        owner_type = "global"
    elif form_in.tournament_id:
        owner_type = "tournament"
    else:
        owner_type = "chapter"

    form = Form(
        **form_in.model_dump(),
        owner_type=owner_type
    )
    db.add(form)
    db.commit()
    db.refresh(form)
    return form


@router.post("/forms/{form_id}/fields/{field_id}/", response_model=FormFieldRead, status_code=status.HTTP_201_CREATED)
def create_form_field(
    form_id: int,
    field_in: FormFieldCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a form field. MANAGE_FORMS permission required."""

    form = db.query(Form).filter(Form.id == form_id).first()

    if not form:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form not found")

    has_form_permission(db, form.tournament_id, form.chapter_id, current_user)

    field_data = field_in.model_dump()
    if field_data.get("order") is None:
        max_order = db.query(func.max(FormField.order)).filter(FormField.form_id == form_id).scalar()
        field_data["order"] = (max_order + 1) if max_order is not None else 0

    field = FormField(**field_data, form_id=form_id)
    db.add(field)
    db.commit()
    db.refresh(field)

    return field


@router.patch("/forms/{form_id}/fields/{field_id}/", response_model=FormFieldRead)
def edit_form_field(
    form_id: int,
    field_id: int,
    field_in: FormFieldUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a form field. MANAGE_FORMS permission required"""

    form = db.query(Form).filter(Form.id == form_id).first()

    if not form:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form not found")

    has_form_permission(db, form.tournament_id, form.chapter_id, current_user)

    field = db.query(FormField).filter(FormField.id == field_id, FormField.form_id == form_id).first()

    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")

    if (field_in.question_type and field_in.question_type != field.question_type):
        return replace_field_type(db, field, field_in.question_type)


@router.delete("/forms/{form_id}/fields/{field_id}/")
def delete_or_archive_form_field(
    form_id: int,
    field_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Archives a form field if responses exist.
    Hard Deletes if responses do not exist.
    Requires MANAGE_FORM permissions.
    """

    form = db.query(Form).filter(Form.id == form_id).first()

    if not form:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form not found")

    has_form_permission(db, form.tournament_id, form.chapter_id, current_user)

    field = db.query(FormField).filter(FormField.id == field_id, FormField.form_id == form_id).first()

    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")

    was_archived = remove_form_field(db=db, field=field)

    return {
        "success": True,
        "action": "archived" if was_archived else "deleted",
        "field_id": field_id
    }