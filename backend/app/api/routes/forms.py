from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.auth import get_current_user
from app.core.chapters import require_officer_or_lead
from app.core.form import (
    apply_option_archiving,
    assign_option_ids,
    field_key_taken_in_tournament,
    flag_pending_updates_for_archived_options,
    flag_pending_updates_for_field,
    resolve_field_options,
    slugify,
)
from app.core.form.branching import missing_required_field_keys
from app.core.form.permissions import require_form_manage_access, require_form_view_access
from app.core.form.validation import (
    LUNCH_FIELD_KEY_PATTERN,
    FormFieldValidationError,
    collect_active_field_errors,
    validate_availability_options,
    validate_field_config,
    validate_form_for_publish,
    validate_reserved_field_key,
)
from app.core.form.write_through import parse_lunch_field_key, sync_availability, sync_lunch
from app.core.tournament.permissions import MANAGE_FORMS, require_permission
from app.db.session import get_db
from app.models.models import (
    Form,
    FormAnswer,
    FormField,
    FormResponse,
    FormResponsePendingUpdate,
    TournamentMembership,
    User,
    utcnow,
)
from app.schemas.form import (
    BulkFieldsUpdate,
    FormCreate,
    FormFieldRead,
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
    payload: FormCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    if payload.owner_type != "tournament" or payload.tournament_id != tournament_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="owner_type must be 'tournament' and tournament_id must match the path",
        )

    form = Form(
        name=payload.name,
        description=payload.description,
        owner_type="tournament",
        tournament_id=tournament_id,
        chapter_id=None,
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
    payload: FormCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_officer_or_lead(chapter_id, db, current_user)

    if payload.owner_type != "chapter" or payload.chapter_id != chapter_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="owner_type must be 'chapter' and chapter_id must match the path",
        )

    form = Form(
        name=payload.name,
        description=payload.description,
        owner_type="chapter",
        tournament_id=None,
        chapter_id=chapter_id,
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
# PATCH /forms/{form_id}/ — name/description/status.
# ---------------------------------------------------------------------------
@router.patch("/forms/{form_id}/", response_model=FormRead)
def update_form(
    payload: FormUpdate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    if payload.status == "published":
        try:
            validate_form_for_publish(db, form)
        except FormFieldValidationError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

    if payload.name is not None:
        form.name = payload.name
    if payload.description is not None:
        form.description = payload.description
    if payload.status is not None:
        form.status = payload.status

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
# PUT /forms/{form_id}/fields/ — replaces the field list wholesale. Supersedes
# the old per-field POST/PATCH/DELETE routes: the client owns in-progress
# edits locally (no server-side draft/staging), and this request is the
# "go live" action. An entry with `id` updates that field; an entry with no
# `id` creates one; a currently-live field whose `id` is absent from the
# payload is removed.
#
# draft-status forms apply directly (hard delete/update/insert) — nothing
# on a draft form has ever been answerable, so there's no history to
# protect. published-status forms archive instead of hard-deleting/losing
# data: a removed or question_type-changed field is archived (and, for a
# type change, replaced by a new field at the same list position inheriting
# the old field_key); an option dropped from an otherwise-unchanged field's
# config is archived in place rather than removed from storage. Either way
# the whole batch is applied inside one transaction, flushed (so newly
# created fields get real ids), validated as a whole via
# collect_active_field_errors, and only committed if that validation
# passes — an invalid next_field_id (including one that would've pointed
# at a field this same request removes) rolls the whole request back.
# ---------------------------------------------------------------------------
@router.put("/forms/{form_id}/fields/", response_model=list[FormFieldRead])
def bulk_update_fields(
    payload: BulkFieldsUpdate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    is_published = form.status == "published"

    live_fields = (
        db.query(FormField)
        .filter(FormField.form_id == form.id, FormField.is_archived == False)
        .all()
    )
    live_by_id = {f.id: f for f in live_fields}

    submitted_ids = {e.id for e in payload.fields if e.id is not None}
    unknown_ids = submitted_ids - set(live_by_id)
    if unknown_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"field id(s) not found on this form: {sorted(unknown_ids)}",
        )

    new_entries = [e for e in payload.fields if e.id is None]
    new_keys = [slugify(e.field_key or "") for e in new_entries]
    if len(new_keys) != len(set(new_keys)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="duplicate field_key among the fields being created in this request",
        )

    def _check_field_key_available(field_key: str) -> None:
        if form.owner_type == "tournament":
            taken = field_key_taken_in_tournament(db, form.tournament_id, field_key)
        else:
            taken = (
                db.query(FormField)
                .filter(FormField.form_id == form.id, FormField.field_key == field_key)
                .first()
                is not None
            )
        if taken:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"field_key '{field_key}' is already in use — pick a more distinct label",
            )

    def _validate_config(question_type: str, config: dict | None, field_key: str) -> dict:
        # Only structural/self-contained checks run here, before the batch
        # is flushed — next_field_id resolution needs every field (including
        # ones this same request creates) to have a real id first, so that's
        # deferred to the collect_active_field_errors pass below.
        config = assign_option_ids(config)
        try:
            normalized = validate_field_config(question_type, config)
            validate_reserved_field_key(field_key, question_type)
            if field_key == "availability" and question_type == "multi_select_checkbox":
                validate_availability_options(db, form.tournament_id, normalized)
        except FormFieldValidationError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
        return normalized

    pending_flags: list[tuple[str, str, int | None, list[str]]] = []
    # (field_key, reason, field_id_for_answer_lookup, archived_option_ids)

    order = 1
    for entry in payload.fields:
        if entry.id is not None:
            field = live_by_id[entry.id]
            normalized_config = _validate_config(entry.question_type, entry.config, field.field_key)
            type_changed = entry.question_type != field.question_type

            if type_changed and is_published:
                field.is_archived = True
                old_key = field.field_key
                field.field_key = f"{old_key}_archived_{field.id}"
                pending_flags.append((old_key, "field_replaced", field.id, []))

                new_field = FormField(
                    form_id=form.id,
                    order=order,
                    label=entry.label,
                    description=entry.description,
                    question_type=entry.question_type,
                    field_key=old_key,
                    config=normalized_config,
                    is_archived=False,
                )
                db.add(new_field)
            else:
                if is_published:
                    normalized_config, archived_option_ids = apply_option_archiving(field.config, normalized_config)
                    if archived_option_ids:
                        pending_flags.append((field.field_key, "option_archived", field.id, archived_option_ids))
                field.order = order
                field.label = entry.label
                field.description = entry.description
                field.question_type = entry.question_type
                field.config = normalized_config
                flag_modified(field, "config")
        else:
            field_key = slugify(entry.field_key or "")
            _check_field_key_available(field_key)
            normalized_config = _validate_config(entry.question_type, entry.config, field_key)
            new_field = FormField(
                form_id=form.id,
                order=order,
                label=entry.label,
                description=entry.description,
                question_type=entry.question_type,
                field_key=field_key,
                config=normalized_config,
                is_archived=False,
            )
            db.add(new_field)
        order += 1

    removed_fields = [f for fid, f in live_by_id.items() if fid not in submitted_ids]
    for field in removed_fields:
        if is_published:
            field.is_archived = True
            pending_flags.append((field.field_key, "field_replaced", field.id, []))
        else:
            db.delete(field)

    db.flush()

    errors = collect_active_field_errors(db, form)
    if errors:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="; ".join(errors))

    for field_key, reason, field_id, archived_option_ids in pending_flags:
        if reason == "field_replaced":
            flag_pending_updates_for_field(db, field_id, field_key, "field_replaced")
        else:
            flag_pending_updates_for_archived_options(db, live_by_id[field_id], archived_option_ids)

    db.commit()

    return (
        db.query(FormField)
        .filter(FormField.form_id == form.id, FormField.is_archived == False)
        .order_by(FormField.order)
        .all()
    )


# ---------------------------------------------------------------------------
# POST /forms/{form_id}/responses/ — submit or resubmit. One row per
# (form, user); resubmitting replaces all of that user's answers in place
# (no submission history). View access, not manage — this is what the
# person filling the form out calls.
# ---------------------------------------------------------------------------
@router.post("/forms/{form_id}/responses/", response_model=FormResponseRead)
def submit_form_response(
    payload: FormResponseCreate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_view_access),
    current_user: User = Depends(get_current_user),
):
    active_fields = (
        db.query(FormField)
        .filter(FormField.form_id == form.id, FormField.is_archived == False)
        .all()
    )
    valid_field_ids = {field.id for field in active_fields}

    field_ids = [answer_in.field_id for answer_in in payload.answers]
    invalid_field_ids = set(field_ids) - valid_field_ids
    if invalid_field_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid field_id(s) for this form: {sorted(invalid_field_ids)}",
        )

    answers_by_field = {answer_in.field_id: answer_in.value for answer_in in payload.answers}
    missing_required = missing_required_field_keys(active_fields, answers_by_field)
    if missing_required:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required field(s): {sorted(missing_required)}",
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

    for answer_in in payload.answers:
        db.add(FormAnswer(response_id=response.id, field_id=answer_in.field_id, value=answer_in.value))

    # A fresh answer for a field clears any pending-update flag on it — the
    # respondent has now seen and re-confirmed whatever changed. Keyed by
    # field_key (not field_id) since that's what a pending-update row keys
    # on and what survives an archive+replace (see FormResponsePendingUpdate).
    answered_field_keys = {
        field.field_key for field in active_fields if field.id in answers_by_field
    }
    if answered_field_keys:
        db.query(FormResponsePendingUpdate).filter(
            FormResponsePendingUpdate.response_id == response.id,
            FormResponsePendingUpdate.field_key.in_(answered_field_keys),
        ).delete(synchronize_session=False)

    if form.owner_type == "tournament":
        _write_through_reserved_fields(db, form, active_fields, answers_by_field, current_user)

    db.commit()
    db.refresh(response)
    return response


def _write_through_reserved_fields(
    db: Session,
    form: Form,
    active_fields: list[FormField],
    answers_by_field: dict[int, object],
    current_user: User,
) -> None:
    """Syncs `availability`/`lunch_{date}_{category}` answers into their
    structural tables — tournament-owned forms only (see
    form-question-types-reference.md). Runs over every active field, not
    just answered ones, so a reserved field left blank on resubmit clears
    any previously-synced rows rather than leaving them stale."""
    membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == current_user.id,
            TournamentMembership.tournament_id == form.tournament_id,
        )
        .first()
    )
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No membership found for a tournament-owned form response — require_form_view_access should have guaranteed one",
        )

    for field in active_fields:
        value = answers_by_field.get(field.id)
        selected = value if isinstance(value, list) else ([value] if value else [])

        if field.field_key == "availability":
            sync_availability(db, membership.id, [int(v) for v in selected])
            continue

        if LUNCH_FIELD_KEY_PATTERN.match(field.field_key):
            lunch_date, category = parse_lunch_field_key(field.field_key)
            # `selected` is now option_id(s) (see branching.py's matching and
            # PlainOption/BranchingOption's option_id) — resolve each back to
            # its stored value/label snapshot before write-through.
            options_by_id = {opt["option_id"]: opt for opt in (field.config or {}).get("options", [])}
            values = [
                {"value": options_by_id[v]["value"], "label": options_by_id[v]["label"]}
                for v in selected
                if v in options_by_id
            ]
            sync_lunch(db, membership.id, lunch_date, category, values)


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
