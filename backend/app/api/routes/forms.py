from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.form import remove_form_field, update_field_text, replace_field_type, add_option, change_option_label, remove_option_from_field, resolve_field_options
from app.db.session import get_db
from app.models.models import User, Form, FormField, FormAnswer, FormResponse
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


@router.post("/tournaments/{tournament_id}/forms/", response_model=FormRead, status_code=status.HTTP_201_CREATED)
def create_tournament_form(
    tournament_id: int,
    form_in: FormCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create Tournament Form. MANAGE_FORMS permission required."""
    if not has_permission(tournament_id, "MANAGE_FORMS", db):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authorized to perform this action")

    form = Form(
        **form_in.model_dump(),
        tournament_id=tournament_id,
        chapter_id=None,
    )
    db.add(form)
    db.commit()
    db.refresh(form)
    return form


@router.patch("/forms/{form_id}/fields/{field_id}/", response_model=FormFieldRead)
def edit_form_field(
    form_id: int,
    field_id: int,
    field_in: FormFieldUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a form field. MANAGE_FORMS permission required"""
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

    field = db.query(FormField).filter(FormField.id == field_id, FormField.form_id == form_id).first()

    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")

    was_archived = remove_form_field(db=db, field=field)

    return {
        "success": True,
        "action": "archived" if was_archived else "deleted",
        "field_id": field_id
    }