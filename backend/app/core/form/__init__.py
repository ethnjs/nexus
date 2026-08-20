from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from app.models.models import Form, FormAnswer, FormField, FormResponsePendingUpdate, TournamentEvent

import re # Regular Expressions for searching, matching, and extracting patterns in text strings


def slugify(text: str, max_len: int = 64) -> str:
    """Convert a TD-typed label into a snake_case field_key candidate."""
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug[:max_len]


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
        value = answer.value
        selected = value if isinstance(value, list) else ([value] if value else [])
        if archived_ids & set(selected):
            _upsert_pending_update(db, answer.response_id, field.field_key, "option_archived")


def resolve_field_options(db: Session, field: FormField) -> list[dict]:
    """
    Resolves option items for a given FormField, filtering out any
    `is_archived: true` option — archived options stay in `config` for
    historical answer/branching resolution but are never shown to a new
    respondent.
    If the field depends on live DB data (e.g. event_preference), queries the database.
    Otherwise, returns options stored in field.config.
    """
    # 1. Dynamic lookup: Tournament Event Preferences
    if field.field_key == "event_preference":
        if not (field.form and field.form.tournament_id):
            return []

        events = (
            db.query(TournamentEvent)
            .filter(TournamentEvent.tournament_id == field.form.tournament_id)
            .order_by(TournamentEvent.id.asc())
            .all()
        )
        return [
            {
                "option_id": f"opt_evt_{event.id}",
                "value": str(event.id),
                "label": event.name,
                "is_archived": False,
            }
            for event in events
        ]

    # 2. Stubbed dynamic lookup: Availability & Lunch
    elif field.field_key in ("availability", "lunch"):
        # TODO(temp): wire up in Step 7
        return []

    # 3. Static fallback: Read options list directly from config
    config = dict(field.config or {})
    return [o for o in config.get("options", []) if not o.get("is_archived")]