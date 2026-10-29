import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import update
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.orm.attributes import flag_modified

from app.core.auth import get_current_user
from app.core.chapters import require_officer_or_lead
from app.core.form import (
    assign_option_ids,
    resolve_field_options,
    selected_option_ids,
    slugify,
    snapshot_answer_value,
)
from app.core.form.branching import (
    duplicate_ranked_choice_field_keys,
    invalid_other_answer_field_keys,
    missing_required_field_keys,
)
from app.core.form.permissions import (
    require_form_editable,
    require_form_manage_access,
    require_form_not_archived,
    require_form_view_access,
)
from app.core.form.validation import (
    AVAILABILITY_FIELD_KEY_PATTERN,
    EVENT_PREFERENCE_FIELD_KEY_PATTERN,
    LUNCH_FIELD_KEY_PATTERN,
    FormFieldValidationError,
    availability_field_track_id,
    collect_active_field_errors,
    option_shift_ids,
    option_track_assignments,
    track_status_enabled,
    validate_availability_options,
    validate_event_preference_options,
    validate_field_config,
    validate_form_for_publish,
    validate_other_option,
    validate_reserved_field_key,
    validate_tournament_preset,
    validate_track_status_options,
)
from app.core.form.write_through import (
    event_preference_items_from_answer,
    lunch_values_from_answer,
    parse_availability_field_key,
    parse_event_preference_field_key,
    parse_lunch_field_key,
    shift_ids_on_tracks,
    sync_availability,
    sync_event_preferences,
    sync_lunch,
    sync_track_statuses,
)
from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.audit import FORM_RESPONSE_DELETED, log_action
from app.core.tournament.form_flow import member_form_flow
from app.core.tournament.form_prerequisites import (
    meets_prerequisites,
    member_meets_form_prerequisites,
)
from app.core.tournament.memberships import get_membership_by_user, resolve_person_refs
from app.core.tournament.onboarding import (
    exempt_from_onboarding,
    next_required_onboarding_form_id,
    recompute_onboarding,
)
from app.core.tournament.permissions import MANAGE_FORMS, get_user_permissions, require_permission
from app.db.session import get_db
from app.models.models import (
    ChapterMembership,
    Form,
    FormAnswer,
    FormField,
    FormResponse,
    TournamentForm,
    TournamentMembership,
    TournamentRole,
    TournamentTrackAssignment,
    User,
    utcnow,
)
from app.schemas.form import (
    BulkFieldsUpdate,
    FieldKeyFormRef,
    FieldKeyUsageRead,
    FlowStepRead,
    FormCreate,
    FormFieldRead,
    FormListRead,
    FormRead,
    FormRespondentRead,
    FormResponseCreate,
    FormResponseManagerRead,
    FormResponseRead,
    FormUpdate,
    MemberFormFlowRead,
    MemberFormRead,
    TournamentFormPrerequisites,
)
from app.schemas.person import PersonRefResponse, PersonRoleRead

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
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="owner_type must be 'tournament' and tournament_id must match the path",
        )
    require_not_archived(get_tournament(tournament_id, db))

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
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
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
        .options(selectinload(Form.tournament_form))
        .filter(Form.tournament_id == tournament_id, Form.owner_type == "tournament")
        .order_by(Form.updated_at.desc())
        .all()
    )
    creators = resolve_person_refs(db, tournament_id, {f.created_by for f in forms})
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tournament membership not found"
        )

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
    held_to_onboarding = next_onboarding_form_id is not None and not exempt_from_onboarding(
        membership, get_user_permissions(current_user, tournament_id, db)
    )

    result = []
    for tournament_form in rows:
        form = tournament_form.form
        completed = form.id in completed_ids
        if tournament_form.is_onboarding:
            eligible = form.status == "published" and form.id == next_onboarding_form_id
        else:
            eligible = (
                form.status == "published"
                and not held_to_onboarding
                and member_meets_form_prerequisites(db, membership, tournament_form)
            )
        if completed or eligible:
            result.append(
                MemberFormRead(
                    id=form.id,
                    name=form.name,
                    title=form.title,
                    description=form.description,
                    status=form.status,
                    is_onboarding=tournament_form.is_onboarding,
                    completed=completed,
                    eligible=eligible,
                    allow_response_edits=form.allow_response_edits,
                )
            )
    return result


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/forms/flow/?membership_id= — one member's
# onboarding steps and other forms as a manager previews them, drafts included.
# ---------------------------------------------------------------------------
@router.get(
    "/tournaments/{tournament_id}/forms/flow/",
    response_model=MemberFormFlowRead,
    tags=["tournaments"],
)
def get_member_form_flow(
    tournament_id: int,
    membership_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    membership = get_scoped_or_404(
        db, TournamentMembership, membership_id, tournament_id, "Membership"
    )
    flow = member_form_flow(db, membership)
    return MemberFormFlowRead(
        exempt_from_onboarding=flow.exempt_from_onboarding,
        held_to_onboarding=flow.held_to_onboarding,
        onboarding=[FlowStepRead(**vars(step)) for step in flow.onboarding],
        forms=[FlowStepRead(**vars(step)) for step in flow.forms],
    )


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/forms/field-keys/ — every field_key on a
# live field of this tournament's forms, with the forms using it, so the
# builder can suggest reusing one.
# ---------------------------------------------------------------------------
@router.get(
    "/tournaments/{tournament_id}/forms/field-keys/",
    response_model=list[FieldKeyUsageRead],
    tags=["tournaments"],
)
def list_tournament_field_keys(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    forms_by_key: dict[str, dict[str, str]] = {}
    for field_key, form_id, form_name in (
        db.query(FormField.field_key, Form.id, Form.name)
        .join(Form, Form.id == FormField.form_id)
        .filter(Form.tournament_id == tournament_id, FormField.is_archived == False)
        .order_by(FormField.field_key, Form.name)
    ):
        forms_by_key.setdefault(field_key, {})[form_id] = form_name
    return [
        FieldKeyUsageRead(
            field_key=key,
            forms=[FieldKeyFormRef(id=form_id, name=name) for form_id, name in forms.items()],
        )
        for key, forms in forms_by_key.items()
    ]


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
    db: Session,
    chapter_id: int,
    user_ids: set[int | None],
) -> dict[int | None, PersonRefResponse]:
    """The chapter-side twin of resolve_person_refs — same shape out, so a
    form's creator reads identically whoever owns the form.

    A chapter role is a plain string on the membership rather than a row, so
    it becomes a single PersonRoleRead with no id. That still distinguishes
    "a member here, holding this role" from "not a member" (roles None),
    which is the difference CreatorHoverCard renders."""
    memberships = (
        db.query(ChapterMembership)
        .options(selectinload(ChapterMembership.user))
        .filter(ChapterMembership.chapter_id == chapter_id, ChapterMembership.user_id.in_(user_ids))
        .all()
    )
    resolved: dict[int | None, PersonRefResponse] = {
        m.user_id: PersonRefResponse(
            user_id=m.user_id,
            membership_id=m.id,
            first_name=m.user.first_name,
            last_name=m.user.last_name,
            roles=[PersonRoleRead(label=m.role)],
        )
        for m in memberships
    }
    missing_ids = user_ids - resolved.keys()
    if missing_ids:
        users = db.query(User).filter(User.id.in_(missing_ids)).all()
        resolved.update(
            {
                u.id: PersonRefResponse(
                    user_id=u.id, first_name=u.first_name, last_name=u.last_name
                )
                for u in users
            }
        )
    # A null credit FK — the account was deleted. Keyed on None so callers
    # can index by the raw column value without special-casing it.
    if None in user_ids:
        resolved[None] = PersonRefResponse(user_id=None)
    return resolved


def _to_list_read(form: Form, creator: PersonRefResponse) -> FormListRead:
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
        allow_response_edits=form.allow_response_edits,
        created_at=form.created_at,
        updated_at=form.updated_at,
        response_count=form.response_count,
        prerequisites=form.prerequisites,
        onboarding_order=form.onboarding_order,
    )


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/forms/prerequisites/preview/ — the members
# a draft set of prerequisites would let through, before the TD saves it.
# ---------------------------------------------------------------------------
@router.post(
    "/tournaments/{tournament_id}/forms/prerequisites/preview/",
    response_model=list[PersonRefResponse],
    tags=["tournaments"],
)
def preview_tournament_form_prerequisites(
    tournament_id: int,
    payload: TournamentFormPrerequisites,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    prerequisites = payload.model_dump()
    _validate_prerequisite_role_ids(db, tournament_id, prerequisites)

    role_ids_by_user: dict[int, set[int]] = {
        user_id: set()
        for (user_id,) in db.query(TournamentMembership.user_id).filter(
            TournamentMembership.tournament_id == tournament_id
        )
    }
    for user_id, role_id in (
        db.query(TournamentMembership.user_id, TournamentTrackAssignment.role_id)
        .join(TournamentTrackAssignment)
        .filter(TournamentMembership.tournament_id == tournament_id)
    ):
        role_ids_by_user[user_id].add(role_id)

    matching = {
        user_id
        for user_id, role_ids in role_ids_by_user.items()
        if meets_prerequisites(prerequisites, role_ids)
    }
    refs = resolve_person_refs(db, tournament_id, set(matching))
    return sorted(
        (refs[user_id] for user_id in matching),
        key=lambda ref: ((ref.first_name or "").lower(), (ref.last_name or "").lower()),
    )


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/forms/{form_id}/prerequisites/ — replaces
# one tournament form's prerequisites, onboarding steps included. Nested under
# the tournament so role IDs are unambiguously scoped.
# ---------------------------------------------------------------------------
@router.patch(
    "/tournaments/{tournament_id}/forms/{form_id}/prerequisites/",
    response_model=FormRead,
    tags=["tournaments"],
)
def update_tournament_form_prerequisites(
    tournament_id: int,
    form_id: str,
    payload: TournamentFormPrerequisites,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_FORMS)),
):
    require_not_archived(get_tournament(tournament_id, db))
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tournament form not found"
        )

    prerequisites = payload.model_dump()
    _validate_prerequisite_role_ids(db, tournament_id, prerequisites)
    tournament_form.prerequisites = prerequisites
    db.commit()
    db.refresh(form)
    return form


def _validate_prerequisite_role_ids(db: Session, tournament_id: int, prerequisites: dict) -> None:
    ids = {role_id for condition in prerequisites["roles"] for role_id in condition["ids"]}
    if not ids:
        return
    found = {
        role_id
        for (role_id,) in db.query(TournamentRole.id).filter(
            TournamentRole.tournament_id == tournament_id, TournamentRole.id.in_(ids)
        )
    }
    missing = sorted(ids - found)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"role IDs do not belong to this tournament: {missing}",
        )


# ---------------------------------------------------------------------------
# GET /forms/{form_id}/ — view/render. Any member of a linked
# tournament/chapter can view (not just managers) — this is what the form
# renderer for people filling it out calls. Archived questions come back too,
# in their slot, so a past response renders in order; anything that renders
# the fillable form skips them.
#
# raw=true skips resolve_field_options' respondent-facing hydration
# (availability/event_preference option `value` normally becomes
# [{id, label, start, end}, ...] instead of the plain ids it's actually
# stored/submitted as) — the builder needs exactly the round-trippable
# config it's about to PUT back, not a rendering of it. raw also keeps
# archived options. It's the builder's shape, so it takes manage access
# instead of view access: a member gets 403 even on a draft, which view access
# would 404 for them.
# ---------------------------------------------------------------------------
@router.get("/forms/{form_id}/", response_model=FormRead)
def get_form_for_rendering(
    form_id: str,
    raw: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    access = require_form_manage_access if raw else require_form_view_access
    form = access(form_id, db, current_user)

    fields = (
        db.query(FormField)
        .filter(FormField.form_id == form.id)
        .order_by(FormField.order, FormField.is_archived)
        .all()
    )

    for field in fields:
        if raw:
            continue
        resolved_options = resolve_field_options(db, field)
        if resolved_options:
            config = dict(field.config or {})
            config["options"] = resolved_options
            field.config = config

    form.fields = fields
    return form


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
# PATCH /forms/{form_id}/ — name/description/status/allow_response_edits.
# ---------------------------------------------------------------------------
@router.patch("/forms/{form_id}/", response_model=FormRead)
def update_form(
    payload: FormUpdate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    require_form_not_archived(form)
    if payload.model_fields_set - {"status"}:
        require_form_editable(form)
    if payload.status == "published" and form.status == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An archived form must be unarchived to draft and reviewed before it can be republished",
        )

    if payload.status == "published":
        try:
            validate_form_for_publish(db, form)
        except FormFieldValidationError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(e)
            ) from e

    if payload.name is not None:
        form.name = payload.name
    if payload.title is not None:
        form.title = payload.title
    if payload.description is not None:
        form.description = payload.description
    if payload.allow_response_edits is not None:
        form.allow_response_edits = payload.allow_response_edits
    status_changed = payload.status is not None and payload.status != form.status
    if payload.status is not None:
        form.status = payload.status
    # An onboarding step going in or out of "published" changes what
    # onboarded means — skipped steps don't count.
    if status_changed and form.tournament_form is not None and form.tournament_form.is_onboarding:
        recompute_onboarding(db, form.tournament_form.tournament_id)

    db.commit()
    db.refresh(form)
    return form


# ---------------------------------------------------------------------------
# One deliberate exception to Onboarding never being referenced by Forms
# (Onboarding depends on Forms, never the reverse — see the TournamentForm
# model docstring): a form still flagged is_onboarding can't be deleted out
# from under the sequence it's part of. Archiving is fine: members who answered
# the step keep it on their path, and nobody else is asked for it.
# ---------------------------------------------------------------------------
def _reject_if_onboarding(db: Session, form: Form) -> None:
    tf = db.query(TournamentForm).filter(TournamentForm.form_id == form.id).first()
    if tf is not None and tf.is_onboarding:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This form is part of the onboarding sequence — remove it from onboarding before deleting",
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
    require_form_not_archived(form)
    has_responses = (
        db.query(FormResponse).filter(FormResponse.form_id == form.id).first() is not None
    )
    if has_responses:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Form has existing responses — archive it instead of deleting",
        )
    _reject_if_onboarding(db, form)

    db.delete(form)
    db.commit()


# ---------------------------------------------------------------------------
# PUT /forms/{form_id}/fields/ — replaces the field list wholesale. An entry
# with `id` updates that field, one without creates it, and a live field
# missing from the payload is removed: deleted on a never-answered draft,
# archived once the form is history-preserving. Submitted answers are never
# touched. Archived fields are renumbered with the rest and stay right after
# the field they used to follow. The batch is validated as a whole after a
# flush and rolled back if anything fails.
# ---------------------------------------------------------------------------
@router.put("/forms/{form_id}/fields/", response_model=list[FormFieldRead])
def bulk_update_fields(
    payload: BulkFieldsUpdate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    require_form_not_archived(form)
    require_form_editable(form)
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

    def _key_taken(field_key: str) -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"field_key '{field_key}' is used twice on this form",
        )

    # Keys are checked against the state this save produces, not the rows as
    # they stand: a key one question gives up in this save is free for another
    # to take in the same save. A blank key on an existing field means "unchanged".
    final_keys = [
        slugify(entry.field_key)
        if entry.field_key
        else (existing_by_id[entry.id].field_key if entry.id is not None else "")
        for entry in payload.fields
    ]
    seen_keys: set[str] = set()
    for key in final_keys:
        if key and key in seen_keys:
            raise _key_taken(key)
        seen_keys.add(key)

    def _validate_config(question_type: str, config: dict | None, field_key: str) -> dict:
        # Only structural/self-contained checks run here, before the batch
        # is flushed — next_field_id resolution needs every field (including
        # ones this same request creates) to have a real id first, so that's
        # deferred to the collect_active_field_errors pass below.
        config = assign_option_ids(config)
        try:
            normalized = validate_field_config(question_type, config)
            validate_reserved_field_key(field_key, question_type)
            validate_other_option(field_key, normalized)
            validate_tournament_preset(field_key, form.tournament_id)
            if AVAILABILITY_FIELD_KEY_PATTERN.match(field_key):
                validate_availability_options(
                    db,
                    form.tournament_id,
                    normalized,
                    availability_field_track_id(field_key),
                )
            if EVENT_PREFERENCE_FIELD_KEY_PATTERN.match(field_key):
                validate_event_preference_options(db, form.tournament_id, question_type, normalized)
            validate_track_status_options(
                db, form.tournament_id, field_key, question_type, normalized
            )
        except FormFieldValidationError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(e)
            ) from e
        return normalized

    removed_fields = [f for fid, f in live_by_id.items() if fid not in submitted_ids]
    followers = _followers_by_anchor(
        existing_by_id.values(),
        submitted_ids,
        drop=set() if is_history_preserving else {f.id for f in removed_fields},
    )
    for field in removed_fields:
        if is_history_preserving:
            field.is_archived = True
        else:
            db.delete(field)

    # Free every key this save gives up before any field takes one. The
    # live-key unique index can't be deferred, and the flush writes rows in its
    # own order, not the payload's, so a key moving between questions (or two
    # swapping) would otherwise collide mid-flush. The placeholder skips the
    # ORM so each field object keeps its old key for the comparisons below.
    for entry, final_key in zip(payload.fields, final_keys, strict=True):
        field = existing_by_id[entry.id] if entry.id is not None else None
        if field is not None and not field.is_archived and final_key != field.field_key:
            db.execute(
                update(FormField)
                .where(FormField.id == field.id)
                .values(field_key=f"pending_{secrets.token_hex(6)}")
                .execution_options(synchronize_session=False)
            )
    db.flush()

    order = 1
    for follower in followers.get(None, []):
        follower.order = order
        order += 1
    for entry in payload.fields:
        if entry.id is not None:
            field = existing_by_id[entry.id]
            # entry.field_key is None/blank when the caller isn't renaming
            # this field at all (the common case — most edits touch label/
            # config, not the key) — that means "leave it alone", not "set it
            # to slugify('')", which the model's snake_case validator rejects.
            new_field_key = slugify(entry.field_key) if entry.field_key else field.field_key
            normalized_config = _validate_config(entry.question_type, entry.config, new_field_key)

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
        for follower in followers.get(entry.id, []):
            follower.order = order
            order += 1

    db.flush()

    errors = collect_active_field_errors(db, form)
    if errors:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="; ".join(errors)
        )

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


def _followers_by_anchor(
    fields, submitted_ids: set[str], drop: set[str]
) -> dict[str | None, list[FormField]]:
    """Fields missing from the payload, keyed by the submitted field they
    currently follow (None for the start of the form), so renumbering can put
    each back right after it. `drop` names fields about to be deleted."""
    followers: dict[str | None, list[FormField]] = {}
    anchor: str | None = None
    for field in sorted(fields, key=lambda f: (f.order, f.is_archived)):
        if field.id in submitted_ids:
            anchor = field.id
        elif field.id not in drop:
            followers.setdefault(anchor, []).append(field)
    return followers


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


def _stored_answer_option_ids(
    db: Session, response: FormResponse, active_fields: list[FormField]
) -> dict:
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


def _unwrap_snapshot(item):
    if not isinstance(item, dict) or "option_id" not in item:
        return item
    if "text" in item:
        return {"option_id": item["option_id"], "text": item["text"]}
    return item["option_id"]


def _stored_answers_as_submitted(db: Session, response: FormResponse) -> dict:
    """The response's stored answers in the shape a client submits them —
    bare option_ids where storage holds {option_id, value, label} snapshots —
    so they can be merged with a PATCH payload and replayed through branching
    validation, which matches answers against option_ids."""
    result = {}
    for answer in db.query(FormAnswer).filter(FormAnswer.response_id == response.id):
        value = answer.value
        if isinstance(value, list):
            value = [_unwrap_snapshot(item) for item in value]
        elif isinstance(value, dict) and "option_id" not in value:
            value = {rank: _unwrap_snapshot(item) for rank, item in value.items()}  # ranked_choice
        else:
            value = _unwrap_snapshot(value)
        result[answer.field_id] = value
    return result


def _require_valid_other_answers(fields: list[FormField], answers: dict) -> None:
    invalid = invalid_other_answer_field_keys(fields, answers)
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Fill in the Other answer for field(s): {sorted(invalid)}",
        )


def _store_answers(db: Session, response: FormResponse, fields_by_id: dict, answers: list) -> None:
    for answer_in in answers:
        field = fields_by_id[answer_in.field_id]
        # question_type/field_key record the semantics this answer was given
        # under — `value`'s shape is a function of both, so storing them keeps
        # the answer readable after the field is edited rather than
        # reinterpreting it through whatever the field looks like later.
        db.add(
            FormAnswer(
                response_id=response.id,
                field_id=field.id,
                value=snapshot_answer_value(field, answer_in.value),
                question_type=field.question_type,
                field_key=field.field_key,
            )
        )


# ---------------------------------------------------------------------------
# POST /forms/{form_id}/responses/ — first submission only; a second POST is a
# 409. Editing goes through PATCH below.
# ---------------------------------------------------------------------------
@router.post("/forms/{form_id}/responses/", response_model=FormResponseRead)
def submit_form_response(
    payload: FormResponseCreate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_view_access),
    current_user: User = Depends(get_current_user),
):
    require_form_not_archived(form)
    _require_published(form)

    existing = (
        db.query(FormResponse)
        .filter(FormResponse.form_id == form.id, FormResponse.user_id == current_user.id)
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already responded to this form",
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
    _require_valid_other_answers(active_fields, answers_by_field)

    response = FormResponse(form_id=form.id, user_id=current_user.id)
    db.add(response)
    db.flush()

    _store_answers(db, response, {f.id: f for f in active_fields}, payload.answers)

    if form.owner_type == "tournament":
        # No track scope — a first submission answers the whole form, so every
        # field is legitimately writing for the first time.
        _write_through_reserved_fields(
            db, form, active_fields, answers_by_field, current_user, response
        )

    db.commit()
    db.refresh(response)
    return response


# ---------------------------------------------------------------------------
# PATCH /forms/{form_id}/responses/me/ — edit a submitted response, only on a
# form with allow_response_edits. The client sends only what changed: a
# replayed answer would re-fire its write-through and can overwrite state a
# newer form already set (see backend/docs/form-edit-lifecycle.md). Required
# and branching validation runs over the merged response, since a changed
# branching answer can make an unanswered required question reachable.
# ---------------------------------------------------------------------------
@router.patch("/forms/{form_id}/responses/me/", response_model=FormResponseRead)
def patch_form_response(
    payload: FormResponseCreate,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_view_access),
    current_user: User = Depends(get_current_user),
):
    require_form_not_archived(form)
    _require_published(form)
    if not form.allow_response_edits:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This form doesn't allow editing responses",
        )

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

    active_fields = _active_fields(db, form)
    fields_by_id = {f.id: f for f in active_fields if f.id in patched_ids}
    missing = patched_ids - set(fields_by_id)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid field_id(s) for this form: {sorted(missing)}",
        )

    answers_by_field = {answer_in.field_id: answer_in.value for answer_in in payload.answers}
    merged = {**_stored_answers_as_submitted(db, response), **answers_by_field}
    missing_required = missing_required_field_keys(active_fields, merged)
    if missing_required:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required field(s): {sorted(missing_required)}",
        )

    duplicate_ranks = duplicate_ranked_choice_field_keys(
        list(fields_by_id.values()), answers_by_field
    )
    if duplicate_ranks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Duplicate option selected at multiple ranks: {sorted(duplicate_ranks)}",
        )
    _require_valid_other_answers(list(fields_by_id.values()), answers_by_field)

    db.query(FormAnswer).filter(
        FormAnswer.response_id == response.id, FormAnswer.field_id.in_(patched_ids)
    ).delete(synchronize_session=False)
    _store_answers(db, response, fields_by_id, payload.answers)

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
            db,
            form,
            active_fields,
            _stored_answer_option_ids(db, response, active_fields),
            current_user,
            response,
            track_scope_field_ids=patched_ids,
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
    tournament-owned forms only (see backend/docs/form-question-types-reference.md). Runs
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
    availability_track_ids: set[int] = set()
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
                        "status": assignment["status"],
                        "field_id": field.id,
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
            # The track is what this question governs, independent of which
            # shifts its options currently name — so regrouping an option
            # can't strand a shift the member should have lost.
            availability_track_ids.add(parse_availability_field_key(field.field_key))
            continue

        if LUNCH_FIELD_KEY_PATTERN.match(field.field_key):
            lunch_track_id, category = parse_lunch_field_key(field.field_key)
            sync_lunch(
                db,
                membership.id,
                lunch_track_id,
                category,
                lunch_values_from_answer(field, value),
            )
            continue

        if EVENT_PREFERENCE_FIELD_KEY_PATTERN.match(field.field_key):
            # A track has exactly one preference question (unlike
            # availability's shared per-track pool), so this can sync straight
            # from this field's answer with no cross-field union needed.
            sync_event_preferences(
                db,
                membership.id,
                parse_event_preference_field_key(field.field_key),
                event_preference_items_from_answer(field, value),
            )
            continue

    if availability_track_ids:
        sync_availability(
            db,
            membership.id,
            availability_shift_ids,
            shift_ids_on_tracks(db, membership.tournament_id, availability_track_ids),
        )

    sync_track_statuses(db, membership.id, intended_track_statuses, response.id)


# ---------------------------------------------------------------------------
# DELETE /forms/{form_id}/fields/{field_id}/ — invalidate a question: delete it
# and its answers. Its own route rather than part of the bulk update, so a
# client bug in the field list can't reach the one irreversible action. Rows
# its answers wrote through stay; see backend/docs/form-edit-lifecycle.md.
# ---------------------------------------------------------------------------
@router.delete("/forms/{form_id}/fields/{field_id}/", status_code=status.HTTP_204_NO_CONTENT)
def invalidate_form_field(
    field_id: str,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    require_form_not_archived(form)
    require_form_editable(form)
    field = (
        db.query(FormField).filter(FormField.form_id == form.id, FormField.id == field_id).first()
    )
    if field is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Field not found on this form"
        )

    # FormAnswer's FK has no ON DELETE, so its rows go first.
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


# ---------------------------------------------------------------------------
# GET /forms/{form_id}/responses/ — all responses to a form, with who gave
# each. Manage access only — this is roster data, not something every member
# should see. Search is client-side; a form's responses are a bounded list.
# ---------------------------------------------------------------------------
@router.get("/forms/{form_id}/responses/", response_model=list[FormResponseManagerRead])
def list_form_responses(
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
):
    responses = (
        db.query(FormResponse)
        .options(
            selectinload(FormResponse.user),
            selectinload(FormResponse.answers),
        )
        .filter(FormResponse.form_id == form.id)
        .order_by(FormResponse.submitted_at)
        .all()
    )

    membership_ids: dict[int, int] = {}
    if form.owner_type == "tournament":
        membership_ids = dict(
            db.query(TournamentMembership.user_id, TournamentMembership.id).filter(
                TournamentMembership.tournament_id == form.tournament_id,
                TournamentMembership.user_id.in_([r.user_id for r in responses]),
            )
        )

    return [
        FormResponseManagerRead(
            **FormResponseRead.model_validate(response).model_dump(),
            respondent=FormRespondentRead(
                user_id=response.user_id,
                membership_id=membership_ids.get(response.user_id),
                first_name=response.user.first_name,
                last_name=response.user.last_name,
                email=response.user.email,
            ),
        )
        for response in responses
    ]


# ---------------------------------------------------------------------------
# DELETE /forms/{form_id}/responses/{response_id}/ — a manager removes one
# member's response and its answers.
#
# Write-through data (availability, lunch, event preferences, track statuses)
# is deliberately kept: it's the membership's current truth and may have been
# edited since. Resubmitting re-fires write-through as usual.
#
# Blocked on an archived form or tournament — both are read-only history.
# ---------------------------------------------------------------------------
@router.delete("/forms/{form_id}/responses/{response_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_form_response(
    response_id: str,
    db: Session = Depends(get_db),
    form: Form = Depends(require_form_manage_access),
    current_user: User = Depends(get_current_user),
):
    require_form_not_archived(form)
    if form.status == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This form is archived — unarchive it before deleting responses",
        )

    response = (
        db.query(FormResponse)
        .filter(FormResponse.id == response_id, FormResponse.form_id == form.id)
        .first()
    )
    if response is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Response not found")

    if form.owner_type == "tournament":
        assert form.tournament_id is not None
        membership = get_membership_by_user(db, form.tournament_id, response.user_id)
        respondent = response.user
        # Stored by value, like ownership_transferred: the log has to read
        # right even after the member leaves or is deleted.
        respondent_name = (
            f"{respondent.first_name or ''} {respondent.last_name or ''}".strip()
            or respondent.email
        )
        log_action(
            db,
            form.tournament_id,
            current_user.id,
            FORM_RESPONSE_DELETED,
            target_type="membership",
            target_id=membership.id if membership else None,
            extra_data={
                "form_id": form.id,
                "form_name": form.name,
                "respondent_name": respondent_name,
            },
        )

    db.delete(response)

    # An onboarding step losing its response un-onboards that member.
    if form.tournament_form is not None and form.tournament_form.is_onboarding:
        recompute_onboarding(db, form.tournament_form.tournament_id)

    db.commit()


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
