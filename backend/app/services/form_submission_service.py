# backend/app/services/form_submission_service.py
from typing import Any
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from models import Form, FormAnswer, FormResponse, User, TournamentMembership, ChapterMembership


def _write_through_availability(
    form_response: FormResponse,
    field_id: int,
    raw_value: Any,
    db: Session,
) -> None:
    """Stub for writing availability data directly to structural tables in Step 7."""
    raise NotImplementedError("Availability write-through will be implemented in Step 7.")


def _write_through_lunch(
    form_response: FormResponse,
    field_id: int,
    raw_value: Any,
    db: Session,
) -> None:
    """Stub for writing lunch choices directly to structural tables in Step 7."""
    raise NotImplementedError("Lunch choice write-through will be implemented in Step 7.")


def _get_user_membership(form: Form, user: User, db: Session):
    """Verify that the user holds an active membership for the form's owner context."""
    if form.owner_type in ("tournament", "both") and form.tournament_id:
        membership = (
            db.query(TournamentMembership)
            .filter(
                TournamentMembership.tournament_id == form.tournament_id,
                TournamentMembership.user_id == user.id,
            )
            .first()
        )
        if membership:
            return membership

    if form.owner_type in ("chapter", "both") and form.chapter_id:
        membership = (
            db.query(ChapterMembership)
            .filter(
                ChapterMembership.chapter_id == form.chapter_id,
                ChapterMembership.user_id == user.id,
            )
            .first()
        )
        if membership:
            return membership

    # If form requires membership and none was found
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="User does not have active membership for this form's context.",
    )


def _get_or_create_form_response(
    form_id: int, user_id: int, db: Session
) -> tuple[FormResponse, bool]:
    """Get an existing FormResponse for (form_id, user_id) or instantiate a new one."""
    response = (
        db.query(FormResponse)
        .filter(
            FormResponse.form_id == form_id,
            FormResponse.user_id == user_id,
        )
        .first()
    )

    if response:
        return response, False

    response = FormResponse(form_id=form_id, user_id=user_id)
    db.add(response)
    db.flush()  # Ensures response.id is generated before child FormAnswers are added
    return response, True


def _validate_answers(
    form: Form,
    answers: dict[int, Any],  # {field_id: raw_value}
) -> None:
    """Validate that required fields are submitted and fields belong to the form."""
    form_fields = {field.id: field for field in form.fields}

    # 1. Check for unknown field IDs
    for field_id in answers:
        if field_id not in form_fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Field ID {field_id} does not belong to Form ID {form.id}.",
            )

    # 2. Check for missing required fields
    for field in form.fields:
        if field.is_required:
            val = answers.get(field.id)
            if val is None or (isinstance(val, str) and not val.strip()):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Missing required field: '{field.label}' (ID: {field.id}).",
                )


def submit_form(
    form: Form,
    user: User,
    answers: dict[int, Any],  # {field_id: raw_value}
    db: Session,
) -> FormResponse:
    """Processes a form submission, dispatching special fields and upserting answers."""
    # 1. Verify membership context
    _get_user_membership(form, user, db)

    # 2. Validate input payload against required fields and unknown IDs
    _validate_answers(form, answers)

    # 3. Get existing response or create new parent record
    form_response, _ = _get_or_create_form_response(form.id, user.id, db)

    fields_by_id = {f.id: f for f in form.fields}

    # 4. Dispatch each answer based on field key/type
    for field_id, raw_value in answers.items():
        field = fields_by_id[field_id]
        field_key = getattr(field, "field_key", None) or field.field_type

        if field_key == "availability":
            _write_through_availability(form_response, field_id, raw_value, db)
        elif field_key == "lunch":
            _write_through_lunch(form_response, field_id, raw_value, db)
        else:
            # Upsert FormAnswer for generic non-write-through fields
            answer = (
                db.query(FormAnswer)
                .filter(
                    FormAnswer.response_id == form_response.id,
                    FormAnswer.field_id == field_id,
                )
                .first()
            )
            if answer:
                answer.value = raw_value
            else:
                answer = FormAnswer(
                    response_id=form_response.id,
                    field_id=field_id,
                    value=raw_value,
                )
                db.add(answer)

    # 5. Refresh timestamp and persist changes
    form_response.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(form_response)

    return form_response


