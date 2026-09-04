from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.auth import get_current_user
from app.core.chapters import require_officer_or_lead
from app.core.form import (
    assign_option_ids,
    field_key_taken_in_tournament,
    delete_pending_updates_for_field,
    flag_pending_updates,
    resolve_field_options,
    selected_option_ids,
    slugify,
    snapshot_answer_value,
)
from app.core.form import changes
from app.core.form.branching import duplicate_ranked_choice_field_keys, missing_required_field_keys
from app.core.form.permissions import require_form_manage_access, require_form_view_access
from app.core.form.validation import (
    AVAILABILITY_FIELD_KEY_PATTERN,
    EVENT_PREFERENCE_FIELD_KEY_PATTERN,
    LUNCH_FIELD_KEY_PATTERN,
    FormFieldValidationError,
    availability_field_date,
    collect_active_field_errors,
    option_shift_ids,
    option_track_assignments,
    track_status_enabled,
    validate_availability_options,
    validate_event_preference_options,
    validate_field_config,
    validate_form_for_publish,
    validate_reserved_field_key,
    validate_tournament_preset,
    validate_track_status_options,
)
from app.core.form.write_through import (
    parse_availability_field_key,
    parse_event_preference_field_key,
    parse_lunch_field_key,
    shift_ids_on_dates,
    sync_availability,
    sync_event_preferences,
    sync_lunch,
    sync_track_statuses,
)
from app.core.tournament.form_prerequisites import member_meets_form_prerequisites
from app.core.tournament.memberships import get_membership_by_user
from app.core.tournament.onboarding import next_required_onboarding_form_id
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
    TournamentRole,
    TournamentShift,
    User,
    utcnow,
)
from app.schemas.chapter.membership import ChapterMemberResponse
from app.schemas.form import (
    BulkFieldsUpdate,
    FieldChangeRead,
    FormCreate,
    FormFieldRead,
    FormListRead,
    MemberFormRead,
    FormRead,
    FormResponseCreate,
    FormResponseRead,
    FormUpdate,
    TournamentFormPrerequisitesUpdate,
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
# GET /tournaments/{tournament_id}/forms/me/ — a member's form history and
# current work: every completed form plus every form they may take now.
# ---------------------------------------------------------------------------
@router.get(
    "/tournaments/{tournament_id}/forms/me/",
    response_model=list[MemberFormRead],
    tags=["tournaments"],
)
def list_my_tournament_forms(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = get_membership_by_user(db, tournament_id, current_user.id)
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament membership not found")

    rows = (
        db.query(TournamentForm)
        .join(Form, Form.id == TournamentForm.form_id)
        .filter(TournamentForm.tournament_id == tournament_id)
        .order_by(TournamentForm.is_onboarding.desc(), TournamentForm.order, Form.updated_at.desc())
        .all()
    )
    form_ids = [row.form_id for row in rows]
    completed_ids = {
        form_id
        for (form_id,) in db.query(FormResponse.form_id)
        .filter(FormResponse.user_id == current_user.id, FormResponse.form_id.in_(form_ids))
        .all()
    }
    next_onboarding_form_id = next_required_onboarding_form_id(db, membership)

    result = []
    for tournament_form in rows:
        form = tournament_form.form
        completed = form.id in completed_ids
        if tournament_form.is_onboarding:
            eligible = form.status == "published" and form.id == next_onboarding_form_id
        else:
            eligible = form.status == "published" and member_meets_form_prerequisites(db, membership, tournament_form)
        if completed or eligible:
            result.append(MemberFormRead(
                id=form.id,
                name=form.name,
                title=form.title,
                description=form.description,
                status=form.status,
                is_onboarding=tournament_form.is_onboarding,
                completed=completed,
                eligible=eligible,
            ))
    return result


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/forms/field-keys/ — every field_key in use
# by a live field across this tournament's forms. Lets the builder's field_key
# Combobox show these before Save, rather than only discovering a collision
# via the 409 that PUT .../fields/ would otherwise return.
#
# Archived fields are excluded deliberately: they don't reserve their keys
# (see field_key_taken_in_tournament), so listing them here would make the
# builder block a key the API would happily accept.
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
        .filter(Form.tournament_id == tournament_id, FormField.is_archived == False)
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
        prerequisites=form.prerequisites,
    )


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/forms/{form_id}/prerequisites/ — replaces
# prerequisite configuration for one standard tournament form. This stays
# nested under the tournament so role/shift IDs are unambiguously scoped.
# ---------------------------------------------------------------------------
@router.patch(
    "/tournaments/{tournament_id}/forms/{form_id}/prerequisites/",
    response_model=FormRead,
    tags=["tournaments"],
)
def update_tournament_form_prerequisites(
    tournament_id: int,
    form_id: str,
    payload: TournamentFormPrerequisitesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    form = (
        db.query(Form)
        .filter(
            Form.id == form_id,
            Form.owner_type == "tournament",
            Form.tournament_id == tournament_id,
        )
        .first()
    )
    if form is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form not found")

    tournament_form = db.query(TournamentForm).filter(TournamentForm.form_id == form_id).first()
    if tournament_form is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament form not found")
    if tournament_form.is_onboarding:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Onboarding forms cannot have standard-form prerequisites",
        )

    prerequisites = payload.model_dump(exclude_none=True)
    _validate_prerequisite_ids(db, tournament_id, prerequisites)
    tournament_form.prerequisites = prerequisites
    db.commit()
    db.refresh(form)
    return form


def _validate_prerequisite_ids(db: Session, tournament_id: int, prerequisites: dict) -> None:
    roles = (prerequisites.get("roles") or {}).get("ids", [])
    shifts = (prerequisites.get("availability") or {}).get("shift_ids", [])

    def _require_tournament_ids(ids: list[int], model, label: str) -> None:
        if not ids:
            return
        found = {
            row_id
            for (row_id,) in db.query(model.id)
            .filter(model.tournament_id == tournament_id, model.id.in_(ids))
            .all()
        }
        missing = sorted(set(ids) - found)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{label} do not belong to this tournament: {missing}",
            )

    _require_tournament_ids(roles, TournamentRole, "role IDs")
    _require_tournament_ids(shifts, TournamentShift, "shift IDs")


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
# POST /forms/{form_id}/fields/classify/ — dry run for the builder's save
# confirmation: given a proposed field list, which questions would ask
# previous responders to look again, and why.
#
# Nothing is written. This exists so the confirmation shows the server's own
# verdict rather than a second implementation of the rules living in the
# client — the modal's whole promise is "this is what saving will do", and a
# mirrored rule set can quietly under-report the moment the two drift.
#
# Empty on a form nobody has answered: there's no one to notify, so a save
# there never raises anything.
# ---------------------------------------------------------------------------
@router.post("/forms/{form_id}/fields/classify/", response_model=list[FieldChangeRead])
def classify_field_changes(
    payload: BulkFieldsUpdate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    if not _is_history_preserving(db, form):
        return []

    existing_by_id = {
        f.id: f for f in db.query(FormField).filter(FormField.form_id == form.id).all()
    }

    result = []
    for entry in payload.fields:
        field = existing_by_id.get(entry.id) if entry.id else None
        # A new question has nobody to notify, and an unarchived one comes
        # back exactly as it was left.
        if field is None or field.is_archived:
            continue

        reasons = changes.classify_field_change(
            field,
            new_question_type=entry.question_type,
            # Same fallback as the save path: an omitted key means "leave it".
            new_field_key=slugify(entry.field_key) if entry.field_key else field.field_key,
            # Options the TD just added have no option_id yet; assigning here
            # keeps the diff from tripping over a missing key. The ids differ
            # from the ones the real save will mint, which doesn't matter —
            # either way they're absent from the old config, so they read as
            # added.
            new_config=assign_option_ids(entry.config),
            new_label=entry.label,
            new_description=entry.description,
        )
        if not reasons:
            continue

        optional = reasons - changes.MANDATORY_REASONS
        locked = bool(reasons & changes.MANDATORY_REASONS)
        result.append(FieldChangeRead(
            field_id=field.id,
            label=entry.label,
            reasons=sorted(reasons),
            locked=locked,
            notify_default=locked or any(
                changes.OPTIONAL_REASON_DEFAULTS.get(reason, False) for reason in optional
            ),
        ))
    return result


# ---------------------------------------------------------------------------
# GET /forms/{form_id}/fields/archived/ — questions taken out of use, for the
# builder's archived section. Manage access, and separate from the form read
# above deliberately: that one is what a respondent renders, and archived
# questions are not part of a form anyone fills out.
#
# Config comes back raw (unresolved), like `?raw=true` — an archived field is
# only ever read here to be sent straight back to PUT .../fields/, which
# unarchives it.
# ---------------------------------------------------------------------------
@router.get("/forms/{form_id}/fields/archived/", response_model=list[FormFieldRead])
def list_archived_fields(
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    return (
        db.query(FormField)
        .filter(FormField.form_id == form.id, FormField.is_archived == True)
        .order_by(FormField.updated_at.desc())
        .all()
    )


# ---------------------------------------------------------------------------
# PATCH /forms/{form_id}/ — name/description/status.
# ---------------------------------------------------------------------------
@router.patch("/forms/{form_id}/", response_model=FormRead)
def update_form(
    payload: FormUpdate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    if payload.status == "published" and form.status == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An archived form must be unarchived to draft and reviewed before it can be republished",
        )

    if payload.status in {"draft", "archived"}:
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
    _reject_if_onboarding(db, form)

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
# A never-answered draft applies directly (hard delete/update/insert).
# Published forms — and drafts restored/unpublished after receiving a response
# — archive instead of hard-deleting/losing data: a removed or
# question_type-changed field is archived (and, for a type change, replaced
# by a new field at the same list position inheriting the old field_key); an
# option dropped from an otherwise-unchanged field's config is archived in
# place rather than removed from storage. Either way
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
    is_history_preserving = _is_history_preserving(db, form)

    # Archived fields are addressable here too: naming one in the payload
    # unarchives it. The payload is the target state, and a question the TD
    # wants back is part of that state — it keeps its id, so its answers
    # re-link with no extra work.
    existing_by_id = {
        f.id: f for f in db.query(FormField).filter(FormField.form_id == form.id).all()
    }
    live_by_id = {fid: f for fid, f in existing_by_id.items() if not f.is_archived}

    submitted_ids = {e.id for e in payload.fields if e.id is not None}
    unknown_ids = submitted_ids - set(existing_by_id)
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
                .filter(
                    FormField.form_id == form.id,
                    FormField.field_key == field_key,
                    FormField.is_archived == False,
                )
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
            validate_tournament_preset(field_key, form.tournament_id)
            if AVAILABILITY_FIELD_KEY_PATTERN.match(field_key):
                validate_availability_options(
                    db, form.tournament_id, normalized, availability_field_date(field_key),
                )
            if EVENT_PREFERENCE_FIELD_KEY_PATTERN.match(field_key):
                validate_event_preference_options(db, form.tournament_id, question_type, normalized)
            validate_track_status_options(db, form.tournament_id, field_key, question_type, normalized)
        except FormFieldValidationError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
        return normalized

    # (field, reasons, removed_option_ids) — resolved into rows after the
    # flush, so a rolled-back batch leaves no flags behind.
    pending_flags: list[tuple[FormField, set[str], list[str]]] = []

    order = 1
    for entry in payload.fields:
        if entry.id is not None:
            field = existing_by_id[entry.id]
            # A previously archived field named in the payload is coming back.
            # Nothing is flagged: the question and its answers are exactly as
            # they were left, so there's nothing for a responder to review.
            unarchiving = field.is_archived
            type_changed = entry.question_type != field.question_type
            # entry.field_key is None/blank when the caller isn't renaming
            # this field at all (the common case — most edits touch label/
            # config, not the key) — that means "leave it alone", not "set it
            # to slugify('')", which the model's snake_case validator rejects.
            new_field_key = slugify(entry.field_key) if entry.field_key else field.field_key
            # An archived field doesn't reserve its key, so another question
            # may have taken it meanwhile — coming back needs the same
            # availability check as a rename.
            if new_field_key != field.field_key or unarchiving:
                _check_field_key_available(new_field_key)
            normalized_config = _validate_config(entry.question_type, entry.config, new_field_key)

            # Every edit applies to the field itself — a question_type change
            # included. The field keeps its id, so answers and pending updates
            # stay attached without any lineage bookkeeping; FormAnswer records
            # the question_type/field_key each answer was given under, so past
            # answers remain readable under the old semantics rather than being
            # reinterpreted through the new type. See form-edit-lifecycle.md.
            if is_history_preserving and not unarchiving:
                reasons = changes.classify_field_change(
                    field,
                    new_question_type=entry.question_type,
                    new_field_key=new_field_key,
                    new_config=normalized_config,
                    new_label=entry.label,
                    new_description=entry.description,
                )
                reasons = changes.resolve_reasons(reasons, entry.notify_responders)
                # The submitted option list is authoritative, including its
                # is_archived flags — closing an option means sending it back
                # marked archived, so an option the payload omits was
                # deliberately invalidated and really does leave storage.
                # Whoever picked it is flagged before it goes.
                removed_option_ids = sorted(
                    changes.removed_option_ids(field.config, normalized_config)
                )
                if reasons:
                    pending_flags.append((field, reasons, removed_option_ids))
            field.is_archived = False
            field.order = order
            field.label = entry.label
            field.description = entry.description
            field.question_type = entry.question_type
            field.field_key = new_field_key
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
        if is_history_preserving:
            # Retiring a question raises nothing: a flag on a field that can
            # no longer be answered could never clear. Any open ones go too.
            field.is_archived = True
            delete_pending_updates_for_field(db, field.id)
        else:
            db.delete(field)

    db.flush()

    errors = collect_active_field_errors(db, form)
    if errors:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="; ".join(errors))

    for field, reasons, removed_option_ids in pending_flags:
        flag_pending_updates(db, field, reasons, removed_option_ids)

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


def _is_history_preserving(db: Session, form: Form) -> bool:
    """Whether edits must preserve what's already been answered. An
    unpublish/restore makes a form editable as a draft again, but it must
    never reopen the destructive draft-edit path once answers exist."""
    return form.status == "published" or (
        db.query(FormResponse.id).filter(FormResponse.form_id == form.id).first() is not None
    )


def _require_published(form: Form) -> None:
    if form.status != "published":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Form is '{form.status}', not published — responses aren't accepted",
        )


def _active_fields(db: Session, form: Form) -> list[FormField]:
    # Ordered because track status write-through resolves two fields naming
    # the same track by document order — see _write_through_reserved_fields.
    return (
        db.query(FormField)
        .filter(FormField.form_id == form.id, FormField.is_archived == False)
        .order_by(FormField.order)
        .all()
    )


def _stored_answer_option_ids(db: Session, response: FormResponse, active_fields: list[FormField]) -> dict:
    """The response's answers as option_id lists, in the shape write-through
    expects. A submitted payload carries bare option_ids, but most stored
    answers hold {option_id, value, label} snapshots instead — so replaying
    from storage has to unwrap them first.

    ranked_choice is the one exception: it's flattened to a rank -> option_id
    dict (matching the shape a submitted payload carries) instead of the
    unordered option_id list every other type gets, since event_preference
    write-through needs each option's rank, not just whether it was picked —
    unlike track status, the only other reserved consumer of ranked_choice
    answers, which only cares which options were selected."""
    stored = {
        answer.field_id: answer.value
        for answer in db.query(FormAnswer).filter(FormAnswer.response_id == response.id).all()
    }
    result = {}
    for field in active_fields:
        if field.id not in stored:
            continue
        value = stored[field.id]
        if field.question_type == "ranked_choice" and isinstance(value, dict):
            result[field.id] = {
                rank: (item.get("option_id") if isinstance(item, dict) else item)
                for rank, item in value.items()
            }
        else:
            result[field.id] = sorted(selected_option_ids(field, value))
    return result


def _store_answers(db: Session, response: FormResponse, fields_by_id: dict, answers: list) -> None:
    for answer_in in answers:
        field = fields_by_id[answer_in.field_id]
        # question_type/field_key record the semantics this answer was given
        # under — `value`'s shape is a function of both, so storing them keeps
        # the answer readable after the field is edited rather than
        # reinterpreting it through whatever the field looks like later.
        db.add(FormAnswer(
            response_id=response.id,
            field_id=field.id,
            value=snapshot_answer_value(field, answer_in.value),
            question_type=field.question_type,
            field_key=field.field_key,
        ))


# ---------------------------------------------------------------------------
# POST /forms/{form_id}/responses/ — first submission only. One row per
# (form, user); a second POST is a 409, not a resubmit. Editing an existing
# response goes through PATCH below, which only accepts the questions a TD
# flagged — an unrestricted rewrite of an old response re-fires write-through
# for fields the respondent never touched, overwriting state a newer form may
# have set (see form-edit-lifecycle.md). View access, not manage — this is
# what the person filling the form out calls.
# ---------------------------------------------------------------------------
@router.post("/forms/{form_id}/responses/", response_model=FormResponseRead)
def submit_form_response(
    payload: FormResponseCreate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_view_access),
    current_user: User = Depends(get_current_user),
):
    _require_published(form)

    existing = (
        db.query(FormResponse)
        .filter(FormResponse.form_id == form.id, FormResponse.user_id == current_user.id)
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already responded to this form — use PATCH to update flagged questions",
        )

    active_fields = _active_fields(db, form)
    invalid_field_ids = {a.field_id for a in payload.answers} - {f.id for f in active_fields}
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

    duplicate_ranks = duplicate_ranked_choice_field_keys(active_fields, answers_by_field)
    if duplicate_ranks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Duplicate option selected at multiple ranks: {sorted(duplicate_ranks)}",
        )

    response = FormResponse(form_id=form.id, user_id=current_user.id)
    db.add(response)
    db.flush()

    _store_answers(db, response, {f.id: f for f in active_fields}, payload.answers)

    if form.owner_type == "tournament":
        # No track scope — a first submission answers the whole form, so every
        # field is legitimately writing for the first time.
        _write_through_reserved_fields(db, form, active_fields, answers_by_field, current_user, response)

    db.commit()
    db.refresh(response)
    return response


# ---------------------------------------------------------------------------
# PATCH /forms/{form_id}/responses/me/ — edit a submitted response, limited to
# the questions carrying a pending update. A respondent can't freely revise an
# old response: replaying answers that didn't change can overwrite state a
# newer form already set (see the track status ordering note in
# form-edit-lifecycle.md). The gate is enforced here, not in the UI.
#
# Only the patched fields are replaced, validated, written through, and
# cleared; the rest of the response is untouched.
# ---------------------------------------------------------------------------
@router.patch("/forms/{form_id}/responses/me/", response_model=FormResponseRead)
def patch_form_response(
    payload: FormResponseCreate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_view_access),
    current_user: User = Depends(get_current_user),
):
    _require_published(form)

    response = (
        db.query(FormResponse)
        .filter(FormResponse.form_id == form.id, FormResponse.user_id == current_user.id)
        .first()
    )
    if response is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No response to update — submit the form first",
        )

    patched_ids = {answer_in.field_id for answer_in in payload.answers}
    if not patched_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No answers to update")

    flagged_ids = {
        field_id
        for (field_id,) in db.query(FormResponsePendingUpdate.field_id).filter(
            FormResponsePendingUpdate.response_id == response.id
        )
    }
    ungated = patched_ids - flagged_ids
    if ungated:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"These questions aren't open for editing: {sorted(ungated)}",
        )

    fields_by_id = {f.id: f for f in _active_fields(db, form) if f.id in patched_ids}
    # A flag should only ever point at a live field; anything missing here
    # means one was archived without its flags being cleaned up.
    missing = patched_ids - set(fields_by_id)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid field_id(s) for this form: {sorted(missing)}",
        )

    answers_by_field = {answer_in.field_id: answer_in.value for answer_in in payload.answers}
    # Only over what's being patched — the rest of the response already
    # satisfied required validation when it was submitted.
    missing_required = missing_required_field_keys(list(fields_by_id.values()), answers_by_field)
    if missing_required:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required field(s): {sorted(missing_required)}",
        )

    duplicate_ranks = duplicate_ranked_choice_field_keys(list(fields_by_id.values()), answers_by_field)
    if duplicate_ranks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Duplicate option selected at multiple ranks: {sorted(duplicate_ranks)}",
        )

    db.query(FormAnswer).filter(
        FormAnswer.response_id == response.id, FormAnswer.field_id.in_(patched_ids)
    ).delete(synchronize_session=False)
    _store_answers(db, response, fields_by_id, payload.answers)

    db.query(FormResponsePendingUpdate).filter(
        FormResponsePendingUpdate.response_id == response.id,
        FormResponsePendingUpdate.field_id.in_(patched_ids),
    ).delete(synchronize_session=False)

    response.updated_at = utcnow()

    if form.owner_type == "tournament":
        # Availability is recomputed from the *whole* response, not just the
        # patched fields: it's a union across every availability_* field,
        # diffed against the membership's whole set, so handing it a subset
        # would delete the shifts the unpatched fields contribute. That's safe
        # because the diff is idempotent — unpatched fields resolve to the same
        # ids they already produced.
        #
        # Track status is last-write-wins with no such diff, so it *is* scoped
        # to the patched fields. Replaying an unpatched field would re-fire a
        # write the respondent didn't make here, and the transition rule only
        # blocks demotions — a stale "confirmed" would still land.
        db.flush()
        active_fields = _active_fields(db, form)
        _write_through_reserved_fields(
            db, form, active_fields, _stored_answer_option_ids(db, response, active_fields), current_user,
            response, track_scope_field_ids=patched_ids,
        )

    db.commit()
    db.refresh(response)
    return response


def _write_through_reserved_fields(
    db: Session,
    form: Form,
    active_fields: list[FormField],
    answers_by_field: dict[str, object],
    current_user: User,
    response: FormResponse,
    track_scope_field_ids: set[str] | None = None,
) -> None:
    """Syncs `availability_{date}`/`lunch_{date}_{category}`/`track_status_*`/
    `event_preference_{suffix}` answers into their structural tables —
    tournament-owned forms only (see form-question-types-reference.md). Runs
    over every active field, not just answered ones, so a reserved field left
    blank clears any previously-synced rows rather than leaving them stale.

    Availability write-through is scoped by *day*, not by form or field. Every
    `availability_*` field across every form feeds one centralized
    TournamentMembershipAvailability pool, so a submission may only touch the
    shifts belonging to the days it actually asked about — otherwise answering
    a Sunday form would wipe the Saturday availability a different form
    collected. The days covered here are unioned and handed to
    sync_availability as the boundary of what it may change; everything
    outside is left alone.

    Fields are unioned before that single call rather than synced one at a
    time: two questions covering the same day would otherwise have the second
    call's removal undo the first call's addition.

    `track_scope_field_ids` limits which fields may write track statuses; None
    means all of them. PATCH passes only the fields it patched, because track
    status is last-write-wins with no idempotent diff to fall back on —
    replaying an untouched field would re-fire a write the respondent didn't
    make on this request. Availability deliberately has no such limit: its diff
    is idempotent, and narrowing it would delete the shifts the unpatched
    fields contribute."""
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
    availability_dates: set[date] = set()
    # track_id -> {"status", "field_id"}. Later fields overwrite earlier ones,
    # so document order decides which question wins when two name the same
    # track — hence _active_fields' order_by. Whether that intent actually
    # lands is then up to sync_track_statuses' transition rule.
    intended_track_statuses: dict[int, dict] = {}

    for field in active_fields:
        value = answers_by_field.get(field.id)
        selected = value if isinstance(value, list) else ([value] if value else [])
        options_by_id = {opt["option_id"]: opt for opt in (field.config or {}).get("options", [])}

        # Not an elif with the branches below: an availability field can opt
        # into track statuses, so it feeds both this and the shift pool.
        in_track_scope = track_scope_field_ids is None or field.id in track_scope_field_ids
        if in_track_scope and track_status_enabled(field.field_key, field.config or {}):
            for option_id in selected:
                for assignment in option_track_assignments(options_by_id.get(option_id) or {}):
                    intended_track_statuses[assignment["id"]] = {
                        "status": assignment["status"], "field_id": field.id,
                    }

        if AVAILABILITY_FIELD_KEY_PATTERN.match(field.field_key):
            # `selected` is the chosen option_id(s) — each option groups real
            # TournamentShift ids (see validate_availability_options); expand
            # and flatten before diffing, so overlapping shifts across multiple
            # selected options (within or across fields) naturally dedupe
            # via set union. Read through option_shift_ids, not off `value`:
            # once the option also carries track statuses the ids move under
            # a `shift_ids` key.
            for option_id in selected:
                availability_shift_ids.update(option_shift_ids(options_by_id.get(option_id) or {}))
            # The day is what this question governs, independent of which
            # shifts its options currently name — so regrouping an option
            # can't strand a shift the member should have lost.
            availability_dates.add(parse_availability_field_key(field.field_key))
            continue

        if LUNCH_FIELD_KEY_PATTERN.match(field.field_key):
            lunch_date, category = parse_lunch_field_key(field.field_key)
            # `selected` is now option_id(s) (see branching.py's matching and
            # PlainOption/BranchingOption's option_id) — resolve each back to
            # its stored value/label snapshot before write-through.
            values = [
                {"value": options_by_id[v]["value"], "label": options_by_id[v]["label"]}
                for v in selected
                if v in options_by_id
            ]
            sync_lunch(db, membership.id, lunch_date, category, values)
            continue

        if EVENT_PREFERENCE_FIELD_KEY_PATTERN.match(field.field_key):
            suffix = parse_event_preference_field_key(field.field_key)
            items: list[dict] = []
            if field.question_type == "ranked_choice":
                # `value` here is a rank -> option_id dict (see the raw
                # payload shape and _stored_answer_option_ids' ranked_choice
                # exception), not the flattened `selected` list every other
                # branch reads — ranked_choice never matches any other
                # reserved pattern, so this is the only place it needs one.
                for rank, option_id in (value if isinstance(value, dict) else {}).items():
                    option = options_by_id.get(option_id)
                    if option is None:
                        continue
                    for event_id in option.get("value") or []:
                        items.append({"tournament_event_id": event_id, "rank": int(rank)})
            else:
                # single_select_dropdown: one option at rank 1.
                # multi_select_checkbox: every selected option, unranked —
                # options are mutually exclusive by event (see
                # validate_event_preference_options), so no event can
                # collide across two selected options here.
                rank = 1 if field.question_type == "single_select_dropdown" else None
                for option_id in selected:
                    option = options_by_id.get(option_id)
                    if option is None:
                        continue
                    for event_id in option.get("value") or []:
                        items.append({"tournament_event_id": event_id, "rank": rank})
            # A suffix is one field's exclusive key (unlike availability's
            # shared day pool), so this can sync straight from this field's
            # answer with no cross-field union needed.
            sync_event_preferences(db, membership.id, suffix, items)
            continue

    if availability_dates:
        sync_availability(
            db,
            membership.id,
            availability_shift_ids,
            shift_ids_on_dates(db, form.tournament_id, availability_dates),
        )

    sync_track_statuses(db, membership.id, intended_track_statuses, response.id)


# ---------------------------------------------------------------------------
# DELETE /forms/{form_id}/fields/{field_id}/ — invalidate a question: erase it
# and everything it collected.
#
# Deliberately its own route rather than a flag on the bulk update. This is the
# only destructive action in the field lifecycle, and burying it in a target
# field list would mean a client bug could reach it; here it takes a single
# explicit call naming one field.
#
# Use archive (omit the field from the bulk payload) to retire a question and
# keep its history — that stays undoable. Invalidate is for a question that
# should never have been asked, whose answers are not worth keeping, and it
# cannot be undone.
#
# Write-through rows are handled per target: lunch and event preference each
# have a single owning field and can be cleared, while availability and track
# statuses are shared with other questions and are left alone — see
# form-edit-lifecycle.md.
# ---------------------------------------------------------------------------
@router.delete("/forms/{form_id}/fields/{field_id}/", status_code=status.HTTP_204_NO_CONTENT)
def invalidate_form_field(
    field_id: str,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    field = (
        db.query(FormField)
        .filter(FormField.form_id == form.id, FormField.id == field_id)
        .first()
    )
    if field is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found on this form")

    if LUNCH_FIELD_KEY_PATTERN.match(field.field_key) and form.owner_type == "tournament":
        lunch_date, category = parse_lunch_field_key(field.field_key)
        _clear_lunch_write_through(db, form, field, lunch_date, category)

    if EVENT_PREFERENCE_FIELD_KEY_PATTERN.match(field.field_key) and form.owner_type == "tournament":
        _clear_event_preference_write_through(db, form, field)

    # FormAnswer's FK has no ON DELETE, so its rows go first; pending updates
    # cascade with the field.
    db.query(FormAnswer).filter(FormAnswer.field_id == field.id).delete(synchronize_session=False)
    db.delete(field)
    db.flush()

    # Same whole-form pass the bulk update runs. The row is gone, so a live
    # option still branching to it would leave the form unpublishable —
    # reject rather than commit a form nobody can fix without finding it.
    errors = collect_active_field_errors(db, form)
    if errors:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Deleting this field would break the form: {'; '.join(errors)}",
        )

    form.updated_at = utcnow()
    db.commit()


def _clear_lunch_write_through(db: Session, form: Form, field: FormField, lunch_date, category) -> None:
    """Drops the lunch rows this field produced, for every member who answered
    it. Keyed by (membership, date, category), so no other question can be
    contributing the same rows."""
    user_ids = {
        user_id
        for (user_id,) in db.query(FormResponse.user_id)
        .join(FormAnswer, FormAnswer.response_id == FormResponse.id)
        .filter(FormAnswer.field_id == field.id)
        .all()
    }
    if not user_ids:
        return
    membership_ids = {
        membership_id
        for (membership_id,) in db.query(TournamentMembership.id).filter(
            TournamentMembership.tournament_id == form.tournament_id,
            TournamentMembership.user_id.in_(user_ids),
        )
    }
    for membership_id in membership_ids:
        sync_lunch(db, membership_id, lunch_date, category, [])


def _clear_event_preference_write_through(db: Session, form: Form, field: FormField) -> None:
    """Drops the event preference rows this field produced, for every member
    who answered it. Keyed by (membership, suffix), and a suffix is one
    field's exclusive key, so no other question can be contributing the same
    rows — same reasoning as lunch's (membership, date, category)."""
    user_ids = {
        user_id
        for (user_id,) in db.query(FormResponse.user_id)
        .join(FormAnswer, FormAnswer.response_id == FormResponse.id)
        .filter(FormAnswer.field_id == field.id)
        .all()
    }
    if not user_ids:
        return
    membership_ids = {
        membership_id
        for (membership_id,) in db.query(TournamentMembership.id).filter(
            TournamentMembership.tournament_id == form.tournament_id,
            TournamentMembership.user_id.in_(user_ids),
        )
    }
    suffix = parse_event_preference_field_key(field.field_key)
    for membership_id in membership_ids:
        sync_event_preferences(db, membership_id, suffix, [])


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
