from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from app.models.models import Form, FormAnswer, FormField, FormResponsePendingUpdate, TournamentEvent, TournamentShift

import re
import secrets


def slugify(text: str, max_len: int = 64) -> str:
    """Convert a TD-typed label into a snake_case field_key candidate."""
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug[:max_len]


# Types whose answer value references option_id(s) and so can be snapshotted
# at submission time (see snapshot_answer_value). `availability` is
# deliberately excluded even though it's currently multi_select_checkbox —
# its answer still submits a raw TournamentShift id, not an option_id,
# until the shift-grouping work lands.
OPTION_BEARING_TYPES = {"single_select_radio", "single_select_dropdown", "multi_select_checkbox", "ranked_choice"}


def _snapshot_option(options_by_id: dict, option_id) -> dict:
    if not isinstance(option_id, str):
        return option_id
    option = options_by_id.get(option_id)
    if option is None:
        # Doesn't resolve against current config (stale/malformed submission)
        # — fall back to echoing the id as its own value/label rather than
        # dropping information.
        return {"option_id": option_id, "value": option_id, "label": option_id}
    return {"option_id": option["option_id"], "value": option["value"], "label": option["label"]}


def snapshot_answer_value(field: FormField, value):
    """Freezes a submitted select-type answer's value/label at the moment
    of submission, alongside its option_id — so a later edit to an
    option's `value`/`label` (TD-editable text, unlike option_id) doesn't
    retroactively change what a past answer displays as. See the Edit
    Lifecycle issue: FormResponsePendingUpdate flags that something
    changed, but the old answer itself should still read exactly as the
    respondent originally saw it.

    Falls back to returning `value` unchanged for anything that doesn't
    match the expected shape for `field.question_type` — answer value is
    unvalidated user input, not something to raise on here."""
    if field.field_key == "availability" or field.question_type not in OPTION_BEARING_TYPES or value is None:
        return value

    options_by_id = {o["option_id"]: o for o in (field.config or {}).get("options", [])}

    if field.question_type == "multi_select_checkbox":
        return [_snapshot_option(options_by_id, v) for v in value] if isinstance(value, list) else value
    if field.question_type == "ranked_choice":
        return {k: _snapshot_option(options_by_id, v) for k, v in value.items()} if isinstance(value, dict) else value
    return _snapshot_option(options_by_id, value) if isinstance(value, str) else value


def selected_option_ids(field: FormField, value) -> set:
    """Inverse-ish of snapshot_answer_value: pulls the set of option_ids a
    stored (already-snapshotted) or raw answer references, regardless of
    whether each item is a snapshot dict or a bare option_id string. Used
    to check a stored answer against a set of newly-archived option_ids."""
    if value is None:
        return set()
    if field.question_type == "ranked_choice":
        items = value.values() if isinstance(value, dict) else []
    elif isinstance(value, list):
        items = value
    else:
        items = [value]
    return {item.get("option_id") if isinstance(item, dict) else item for item in items}


def assign_option_ids(config: dict | None) -> dict | None:
    """The backend is the sole generator of option_id — the durable
    per-option identifier used for edit-lifecycle archiving, write-through,
    and branching match (see PlainOption/BranchingOption). Run on a
    field's raw submitted config before validate_field_config: an option
    that already carries a non-empty option_id (echoing what a prior GET
    returned for an option the TD kept) keeps it; an option with none
    (freshly added in this edit) gets a fresh one assigned here. No-op for
    configs without an `options` key."""
    if not config or "options" not in config:
        return config
    options = []
    for option in config["options"]:
        option = dict(option)
        if not option.get("option_id"):
            option["option_id"] = f"opt_{secrets.token_hex(5)}"
        options.append(option)
    return {**config, "options": options}


def field_key_taken_in_tournament(db: Session, tournament_id: int, field_key: str) -> bool:
    """True if `field_key` is already used by any FormField — archived
    included, an archived key isn't released for reuse — belonging to any
    Form owned by `tournament_id`. field_key is the TD-visible dashboard
    lookup key, so it's unique tournament-wide, not just per form."""
    return (
        db.query(FormField)
        .join(Form, Form.id == FormField.form_id)
        .filter(Form.tournament_id == tournament_id, FormField.field_key == field_key)
        .first()
        is not None
    )


def shift_referenced_by_live_field(db: Session, tournament_id: int, shift_id: int) -> bool:
    """True if `shift_id` appears inside any non-archived availability
    field's option `value` (the list of grouped TournamentShift ids) on
    any form owned by `tournament_id` — used by the shift deletion guard
    so a shift can't be pulled out from under a live option's grouping,
    independent of whether anyone's answered yet (that's the separate,
    pre-existing MembershipAvailability guard). `FormField.config` is a
    plain JSON column (not JSONB) and tests run on SQLite, which has no
    JSON operators at all, so this is a Python-side scan rather than a
    DB-side containment query — same reasoning as the pending-updates scan
    over FormAnswer.value."""
    fields = (
        db.query(FormField)
        .join(Form, Form.id == FormField.form_id)
        .filter(
            Form.tournament_id == tournament_id,
            FormField.field_key == "availability",
            FormField.is_archived == False,
        )
        .all()
    )
    for field in fields:
        for option in (field.config or {}).get("options", []):
            if not option.get("is_archived") and shift_id in (option.get("value") or []):
                return True
    return False


def field_has_answers(db: Session, field_id: int) -> bool:
    """True if any FormAnswer exists for this field — locks it against
    edit (see forms.py's edit_form_field) and hard delete (below)."""
    return db.query(FormAnswer).filter(FormAnswer.field_id == field_id).first() is not None


def remove_form_field(
        db: Session,
        field: FormField
) -> bool:

    if field_has_answers(db, field.id):
        field.is_archived = True
        db.commit()
        return True
    else:
        db.delete(field)
        db.commit()
        return False

def update_field_text(
        db: Session,
        field: FormField,
        label: str | None,
        description: str | None
) -> FormField:

    if label is not None:
        field.label = label
    if description is not None:
        field.description = description

    db.commit()
    db.refresh(field)
    return field

def set_field_config(
        db: Session,
        field: FormField,
        config: dict,
) -> FormField:
    field.config = config
    flag_modified(field, "config")
    db.commit()
    db.refresh(field)
    return field


def reorder_field(
        db: Session,
        field: FormField,
        order: int,
) -> FormField:
    field.order = order
    db.commit()
    db.refresh(field)
    return field


def replace_field_type(
        db: Session,
        field: FormField,
        new_type: str
) -> FormField:
    
    field.is_archived = True

    old_key = field.field_key
    field.field_key = f"{old_key}_archived_{field.id}"

    new_field = FormField(
        form_id=field.form_id,
        order=field.order,
        label=field.label,
        description=field.description,
        question_type=new_type,
        field_key=old_key,
        is_archived=False,
    )

    db.add(new_field)
    db.commit()
    db.refresh(new_field)
    return new_field

def apply_option_archiving(old_config: dict | None, new_config: dict) -> tuple[dict, list[str]]:
    """For an in-place field update on a published form: an option_id
    present in the old config but absent from the submitted config is kept
    in storage with `is_archived: true` added, rather than dropped — a
    response referencing it must keep resolving. Returns the merged config
    and the option_ids newly archived by this call (empty if none, or if
    `old_config`/`new_config` isn't an options-bearing shape) — the caller
    uses that list to flag affected responses (see
    flag_pending_updates_for_archived_options)."""
    old_options = (old_config or {}).get("options")
    if old_options is None or "options" not in new_config:
        return new_config, []

    new_ids = {o["option_id"] for o in new_config["options"]}
    newly_archived_ids: list[str] = []
    archived_options: list[dict] = []
    for option in old_options:
        if option["option_id"] not in new_ids:
            archived_options.append({**option, "is_archived": True})
            if not option.get("is_archived"):
                newly_archived_ids.append(option["option_id"])

    merged = dict(new_config)
    merged["options"] = [*new_config["options"], *archived_options]
    return merged, newly_archived_ids


def _upsert_pending_update(db: Session, response_id: int, field_key: str, reason: str) -> None:
    existing = (
        db.query(FormResponsePendingUpdate)
        .filter(
            FormResponsePendingUpdate.response_id == response_id,
            FormResponsePendingUpdate.field_key == field_key,
        )
        .first()
    )
    if existing is None:
        db.add(FormResponsePendingUpdate(response_id=response_id, field_key=field_key, reason=reason))
    elif existing.reason == "option_archived" and reason == "field_replaced":
        # Escalate only in this direction — see FormResponsePendingUpdate.
        existing.reason = "field_replaced"


def flag_pending_updates_for_field(db: Session, field_id: int, field_key: str, reason: str) -> None:
    """Upserts a pending-update row for every response that answered
    `field_id` — used when that field was archived (removed, or archived
    +replaced by a question_type change). Keyed on `field_key`, not
    `field_id`, since field_key is what a respondent/TD recognizes and
    what survives an archive+replace."""
    response_ids = {
        rid for (rid,) in db.query(FormAnswer.response_id).filter(FormAnswer.field_id == field_id).all()
    }
    for response_id in response_ids:
        _upsert_pending_update(db, response_id, field_key, reason)


def flag_pending_updates_for_archived_options(db: Session, field: FormField, archived_option_ids: list[str]) -> None:
    """Upserts option_archived for every response whose stored answer on
    `field` (still live, unchanged type) selected one of `archived_option_ids`.
    FormAnswer.value is a plain JSON column (not JSONB), so this is a
    Python-side scan rather than a DB-side containment query — same
    reasoning as the TournamentShift deletion guard's scan."""
    if not archived_option_ids:
        return
    archived_ids = set(archived_option_ids)
    answers = db.query(FormAnswer).filter(FormAnswer.field_id == field.id).all()
    for answer in answers:
        if archived_ids & selected_option_ids(field, answer.value):
            _upsert_pending_update(db, answer.response_id, field.field_key, "option_archived")


def _resolve_availability_option(db: Session, option: dict) -> dict:
    """Responder-facing view of one availability option: its label plus the
    combined start/end across every TournamentShift its `value` groups
    together — never the raw shift id list itself. A respondent selects
    "All Day", not the three shifts underneath it; `option_id` is what
    they actually submit back on answer (see write-through, which resolves
    it server-side against the field's stored config, not this rendering)."""
    shift_ids = option.get("value") or []
    rows = (
        db.query(TournamentShift.start, TournamentShift.end)
        .filter(TournamentShift.id.in_(shift_ids))
        .all()
    )
    starts = [start for start, _ in rows]
    ends = [end for _, end in rows]
    return {
        "option_id": option["option_id"],
        "label": option["label"],
        "start": min(starts) if starts else None,
        "end": max(ends) if ends else None,
    }


def _resolve_event_preference_option(db: Session, option: dict) -> dict:
    """Responder-facing view of one event_preference option: its label
    plus the actual TournamentEvents its `value` groups together, instead
    of raw ids — same "resolve, don't expose ids" treatment as availability.
    A `value` that's still a plain string (a single legacy id, per the
    Branching/Config-Validation issue's not-yet-strict event_preference
    validation) passes through unchanged rather than being resolved."""
    value = option.get("value")
    if not isinstance(value, list):
        return option

    events = (
        db.query(TournamentEvent.id, TournamentEvent.name, TournamentEvent.division)
        .filter(TournamentEvent.id.in_(value))
        .all()
    )
    return {
        "option_id": option["option_id"],
        "label": option["label"],
        "events": [
            {"id": event_id, "name": name, "division": division}
            for event_id, name, division in events
        ],
    }


def resolve_field_options(db: Session, field: FormField) -> list[dict]:
    """Options for a given FormField, filtering out any `is_archived: true`
    option — archived options stay in `config` for historical answer/
    branching resolution but are never shown to a new respondent.

    Every option type (including reserved keys like event_preference,
    availability, lunch) is a stored, static list — "auto-load from
    tournament" conveniences (pulling in events/shifts/etc.) are a
    TD-editor-side action that populates this array once, same as any
    manually-authored option list, not a live server-side lookup. See
    form-question-types-reference.md's "Options-storage rule". availability
    and event_preference are the exceptions to "just return config as-is":
    when their `value` groups real entity ids (TournamentShifts,
    TournamentEvents), rendering resolves it into the actual entities
    instead of exposing raw ids."""
    config = dict(field.config or {})
    options = [o for o in config.get("options", []) if not o.get("is_archived")]

    if field.field_key == "availability":
        return [_resolve_availability_option(db, o) for o in options]
    if field.field_key == "event_preference":
        return [_resolve_event_preference_option(db, o) for o in options]

    return options