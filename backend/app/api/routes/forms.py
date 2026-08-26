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
    snapshot_answer_value,
)
from app.core.form.branching import missing_required_field_keys
from app.core.form.permissions import require_form_manage_access, require_form_view_access
from app.core.form.validation import (
    AVAILABILITY_FIELD_KEY_PATTERN,
    LUNCH_FIELD_KEY_PATTERN,
    FormFieldValidationError,
    collect_active_field_errors,
    validate_availability_options,
    validate_field_config,
    validate_form_for_publish,
    validate_reserved_field_key,
)
from app.core.form.write_through import parse_lunch_field_key, sync_availability, sync_lunch
from app.core.tournament.memberships import resolve_memberships_or_users
from app.core.tournament.permissions import MANAGE_FORMS, require_permission
from app.db.session import get_db
from app.models.models import (
    ChapterMembership,
    Form,
    FormAnswer,
    FormField,
    FormResponse,
    FormResponsePendingUpdate,
    TournamentForm,
    TournamentMembership,
    User,
    utcnow,
)
from app.schemas.chapter.membership import ChapterMemberResponse
from app.schemas.form import (
    BulkFieldsUpdate,
    FormCreate,
    FormFieldRead,
    FormListRead,
    FormRead,
    FormResponseCreate,
    FormResponseRead,
    FormUpdate,
)
from app.schemas.tournament.membership import MembershipSlimResponse
from app.schemas.user import UserSlimResponse

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
        title=payload.title or payload.name,
        description=payload.description,
        owner_type="tournament",
        tournament_id=tournament_id,
        chapter_id=None,
        created_by=current_user.id,
    )
    db.add(form)
    db.flush()  # assigns form.id, needed for the companion row's FK below

    # Every tournament-scoped Form gets a TournamentForm companion row —
    # see the model docstring. is_onboarding starts False; the
    # onboarding-forms routes flip it.
    db.add(TournamentForm(tournament_id=tournament_id, form_id=form.id))

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
        title=payload.title or payload.name,
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
# GET /tournaments/{tournament_id}/forms/ — MANAGE_FORMS on the tournament.
# Listing is a manage action (draft forms shouldn't be visible to just any
# member), unlike GET /forms/{form_id}/ below which is view-access.
# ---------------------------------------------------------------------------
@router.get(
    "/tournaments/{tournament_id}/forms/",
    response_model=list[FormListRead],
    tags=["tournaments"],
)
def list_tournament_forms(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    forms = (
        db.query(Form)
        .filter(Form.tournament_id == tournament_id, Form.owner_type == "tournament")
        .order_by(Form.updated_at.desc())
        .all()
    )
    creators = resolve_memberships_or_users(db, tournament_id, {f.created_by for f in forms})
    return [_to_list_read(f, creators[f.created_by]) for f in forms]


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/forms/field-keys/ — every field_key
# already in use across this tournament's forms (archived fields included —
# an archived key isn't released for reuse, see field_key_taken_in_tournament
# in app/core/form). Lets the builder's field_key Combobox show these as
# visible options before Save, rather than only discovering a collision via
# the 409 that PUT .../fields/ would otherwise return.
# ---------------------------------------------------------------------------
@router.get(
    "/tournaments/{tournament_id}/forms/field-keys/",
    response_model=list[str],
    tags=["tournaments"],
)
def list_tournament_field_keys(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    rows = (
        db.query(FormField.field_key)
        .join(Form, Form.id == FormField.form_id)
        .filter(Form.tournament_id == tournament_id)
        .distinct()
        .all()
    )
    return [r[0] for r in rows]


# ---------------------------------------------------------------------------
# GET /chapters/{chapter_id}/forms/ — lead/officer on the chapter.
# ---------------------------------------------------------------------------
@router.get(
    "/chapters/{chapter_id}/forms/",
    response_model=list[FormListRead],
    tags=["chapters"],
)
def list_chapter_forms(
    chapter_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_officer_or_lead(chapter_id, db, current_user)
    forms = (
        db.query(Form)
        .filter(Form.chapter_id == chapter_id, Form.owner_type == "chapter")
        .order_by(Form.updated_at.desc())
        .all()
    )
    creators = _resolve_chapter_creators(db, chapter_id, {f.created_by for f in forms})
    return [_to_list_read(f, creators[f.created_by]) for f in forms]


def _resolve_chapter_creators(
    db: Session, chapter_id: int, user_ids: set[int],
) -> dict[int, ChapterMemberResponse | UserSlimResponse]:
    """Same fallback pattern as resolve_memberships_or_users (tournament side)
    — resolve to the creator's ChapterMembership in this chapter, falling
    back to the bare User for ids with no membership row. No shared helper
    exists for chapters yet (resolve_memberships_or_users is tournament-only),
    so this mirrors it locally rather than generalizing prematurely."""
    memberships = (
        db.query(ChapterMembership)
        .filter(ChapterMembership.chapter_id == chapter_id, ChapterMembership.user_id.in_(user_ids))
        .all()
    )
    resolved: dict[int, ChapterMemberResponse | UserSlimResponse] = {
        m.user_id: ChapterMemberResponse.model_validate(m) for m in memberships
    }
    missing_ids = user_ids - resolved.keys()
    if missing_ids:
        users = db.query(User).filter(User.id.in_(missing_ids)).all()
        resolved.update({u.id: UserSlimResponse.model_validate(u) for u in users})
    return resolved


def _to_list_read(form: Form, creator: MembershipSlimResponse | ChapterMemberResponse | UserSlimResponse) -> FormListRead:
    return FormListRead(
        id=form.id,
        name=form.name,
        title=form.title,
        description=form.description,
        status=form.status,
        owner_type=form.owner_type,
        tournament_id=form.tournament_id,
        chapter_id=form.chapter_id,
        creator=creator,
        created_at=form.created_at,
        updated_at=form.updated_at,
        response_count=form.response_count,
    )


# ---------------------------------------------------------------------------
# GET /forms/{form_id}/ — view/render. Any member of a linked
# tournament/chapter can view (not just managers) — this is what the form
# renderer for people filling it out calls.
#
# raw=true skips resolve_field_options' respondent-facing hydration
# (availability/event_preference option `value` normally becomes
# [{id, label, start, end}, ...] instead of the plain ids it's actually
# stored/submitted as) — the builder needs exactly the round-trippable
# config it's about to PUT back, not a rendering of it. Same view-access
# gate either way; there's nothing sensitive in the raw ids a member with
# view access couldn't already see resolved.
# ---------------------------------------------------------------------------
@router.get("/forms/{form_id}/", response_model=FormRead)
def get_form_for_rendering(
    raw: bool = False,
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
        if raw:
            continue
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
    if payload.status == "draft" and form.status == "published":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A published form cannot be reverted to draft — archive it instead if it should stop accepting responses",
        )

    if payload.status == "published" and form.status == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An archived form must be unarchived to draft and reviewed before it can be republished",
        )

    if payload.status == "archived":
        _reject_if_onboarding(db, form)

    if payload.status == "published":
        try:
            validate_form_for_publish(db, form)
        except FormFieldValidationError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

    if payload.name is not None:
        form.name = payload.name
    if payload.title is not None:
        form.title = payload.title
    if payload.description is not None:
        form.description = payload.description
    if payload.status is not None:
        form.status = payload.status

    db.commit()
    db.refresh(form)
    return form


# ---------------------------------------------------------------------------
# One deliberate exception to Onboarding never being referenced by Forms
# (Onboarding depends on Forms, never the reverse — see the TournamentForm
# model docstring): a form still flagged is_onboarding can't be archived out
# from under the sequence it's part of. Remove it from onboarding first.
# ---------------------------------------------------------------------------
def _reject_if_onboarding(db: Session, form: Form) -> None:
    tf = db.query(TournamentForm).filter(TournamentForm.form_id == form.id).first()
    if tf is not None and tf.is_onboarding:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This form is part of the onboarding sequence — remove it from onboarding before archiving",
        )


# ---------------------------------------------------------------------------
# POST /forms/{form_id}/archive/ — soft delete via status="archived".
# Responses and fields are left in place.
# ---------------------------------------------------------------------------
@router.post("/forms/{form_id}/archive/", response_model=FormRead)
def archive_form(
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    _reject_if_onboarding(db, form)
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
            if AVAILABILITY_FIELD_KEY_PATTERN.match(field_key):
                validate_availability_options(db, form.tournament_id, normalized)
        except FormFieldValidationError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
        return normalized

    pending_flags: list[tuple[str, str, str | None, list[str]]] = []
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
                # field.id is a nanoid and can contain '-', which field_key's
                # snake_case-alphanumeric validator rejects — swap it for
                # '_' so the archived key stays valid regardless of id shape.
                field.field_key = f"{old_key}_archived_{field.id}".replace("-", "_")
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

    # Editing a FormField never touches the Form row itself, so its
    # onupdate=utcnow wouldn't otherwise fire — bump it explicitly so
    # updated_at (and list_tournament_forms' ordering by it) reflects field
    # add/edit/reorder/delete, not just edits to the form's own name/title/etc.
    form.updated_at = utcnow()
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
    if form.status != "published":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Form is '{form.status}', not published — responses aren't accepted",
        )

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

    field_by_id = {field.id: field for field in active_fields}
    for answer_in in payload.answers:
        stored_value = snapshot_answer_value(field_by_id[answer_in.field_id], answer_in.value)
        db.add(FormAnswer(response_id=response.id, field_id=answer_in.field_id, value=stored_value))

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
    answers_by_field: dict[str, object],
    current_user: User,
) -> None:
    """Syncs `availability_{date}`/`lunch_{date}_{category}` answers into
    their structural tables — tournament-owned forms only (see
    form-question-types-reference.md). Runs over every active field, not
    just answered ones, so a reserved field left blank on resubmit clears
    any previously-synced rows rather than leaving them stale.

    A tournament can have multiple `availability_*` fields (one per date),
    but they all write into the same centralized
    TournamentMembershipAvailability pool for this membership — so their
    selected shift ids are unioned across every matching field first, and
    `sync_availability` (which diffs against *all* of the membership's
    existing rows, not per-field) is called exactly once. Calling it once
    per field instead would have each call's diff wipe out the shift ids
    contributed by the previous field's call."""
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

    availability_shift_ids: set[int] = set()

    for field in active_fields:
        value = answers_by_field.get(field.id)
        selected = value if isinstance(value, list) else ([value] if value else [])

        if AVAILABILITY_FIELD_KEY_PATTERN.match(field.field_key):
            # `selected` is the chosen option_id(s) — each option's `value`
            # is the list of real TournamentShift ids it groups together
            # (see validate_availability_options); expand and flatten
            # before diffing, so overlapping shifts across multiple
            # selected options (within or across fields) naturally dedupe
            # via set union.
            options_by_id = {opt["option_id"]: opt for opt in (field.config or {}).get("options", [])}
            for option_id in selected:
                availability_shift_ids.update(options_by_id.get(option_id, {}).get("value") or [])
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

    if any(AVAILABILITY_FIELD_KEY_PATTERN.match(field.field_key) for field in active_fields):
        sync_availability(db, membership.id, list(availability_shift_ids))


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
