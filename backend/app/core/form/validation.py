"""FormField config/options validation — see
backend/form-question-types-reference.md for the shapes enforced here.

Structural shape (required keys, types, per-option uniqueness, ranks <=
options, branching mutual-exclusivity/type-restriction) lives in the
pydantic schemas at app/schemas/form.py (QUESTION_TYPE_CONFIG_SCHEMAS) —
validate_field_config below just dispatches to them. Everything here is
what a stateless schema can't check: DB-backed lookups (next_field_id
resolving to a real field, availability options resolving to a real
TournamentShift) and reserved field_key pairing."""

import re

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models.models import Form, FormField, TournamentShift
from app.schemas.form import QUESTION_TYPE_CONFIG_SCHEMAS

BRANCHING_QUESTION_TYPES = {"single_select_radio", "single_select_dropdown"}

# field_key values with a system-defined meaning.
RESERVED_FIELD_KEY_QUESTION_TYPES = {
    "availability": {"multi_select_checkbox"},
    "event_preference": {"ranked_choice", "multi_select_checkbox", "single_select_dropdown"},
}

# lunch_{date}_{category}, e.g. "lunch_20270213_protein" — date is baked
# into the key, so per-tournament field_key uniqueness already covers
# per-(date, category) uniqueness with no separate check needed.
LUNCH_FIELD_KEY_PATTERN = re.compile(r"^lunch_\d{8}_[a-z0-9_]+$")
LUNCH_QUESTION_TYPES = {"single_select_radio", "multi_select_checkbox"}


class FormFieldValidationError(ValueError):
    """Raised when a FormField's question_type/config/options don't match
    the shape form-question-types-reference.md requires."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise FormFieldValidationError(message)


def validate_field_config(question_type: str, config: dict | None) -> dict:
    """Validate `config` against question_type's pydantic schema and
    return the normalized dict (unknown keys stripped, values coerced).
    Raises FormFieldValidationError on any mismatch."""
    schema_cls = QUESTION_TYPE_CONFIG_SCHEMAS.get(question_type)
    _require(schema_cls is not None, f"unknown question_type '{question_type}'")

    try:
        parsed = schema_cls.model_validate(config or {})
    except ValidationError as e:
        raise FormFieldValidationError(str(e))

    return parsed.model_dump()


def validate_reserved_field_key(field_key: str, question_type: str) -> None:
    """Reserved field_keys (availability, event_preference, lunch_*) reuse an
    existing structural question_type rather than introducing their own —
    reject a reserved key paired with a question_type it doesn't allow.
    Applies identically regardless of owner_type (tournament vs. chapter);
    only write-through, not validation, differs by ownership."""
    if LUNCH_FIELD_KEY_PATTERN.match(field_key):
        _require(
            question_type in LUNCH_QUESTION_TYPES,
            f"field_key '{field_key}' requires question_type in {sorted(LUNCH_QUESTION_TYPES)}, got '{question_type}'",
        )
        return

    allowed_types = RESERVED_FIELD_KEY_QUESTION_TYPES.get(field_key)
    if allowed_types is None:
        return
    _require(
        question_type in allowed_types,
        f"field_key '{field_key}' requires question_type in {sorted(allowed_types)}, got '{question_type}'",
    )


def validate_branching_options(
    db: Session,
    form_id: int,
    question_type: str,
    config: dict,
    field_id: int | None = None,
) -> None:
    """`next_field_id` must reference an existing, non-archived field in the
    same form and can't equal the field the option belongs to. (Mutual
    exclusivity with `action` and the single_select-only restriction are
    already enforced by the config's pydantic schema — see
    QUESTION_TYPE_CONFIG_SCHEMAS — so this only covers what needs the DB.)
    `field_id` is the field being edited (None on create — a new field has
    no id yet for an option to self-reference)."""
    if question_type not in BRANCHING_QUESTION_TYPES:
        return

    options = config.get("options") or []
    next_field_ids = set()
    for option in options:
        next_field_id = option.get("next_field_id")
        if next_field_id is None:
            continue
        _require(next_field_id != field_id, "an option cannot jump to the field it belongs to")
        next_field_ids.add(next_field_id)

    if not next_field_ids:
        return

    valid_ids = {
        fid
        for (fid,) in db.query(FormField.id)
        .filter(FormField.form_id == form_id, FormField.id.in_(next_field_ids), FormField.is_archived == False)
        .all()
    }
    missing = next_field_ids - valid_ids
    _require(
        not missing,
        f"next_field_id(s) do not reference an existing, non-archived field in this form: {sorted(missing)}",
    )


def validate_form_for_publish(db: Session, form: Form) -> None:
    """Aggregate pass run on every draft->published transition and every
    explicit republish while already published. Per-field validation on
    create/update can't catch problems that only exist in aggregate — a
    form with zero fields, or a next_field_id left dangling after some
    other field got archived later — so this re-runs every check across
    the whole active field set. Collects every problem found instead of
    stopping at the first, so a TD sees the full list in one pass."""
    fields = (
        db.query(FormField)
        .filter(FormField.form_id == form.id, FormField.is_archived == False)
        .all()
    )

    errors: list[str] = []
    if not fields:
        errors.append("form has no fields")

    for field in fields:
        try:
            normalized_config = validate_field_config(field.question_type, field.config)
        except FormFieldValidationError as e:
            errors.append(f"field '{field.field_key}': {e}")
            continue

        for check in (
            lambda: validate_reserved_field_key(field.field_key, field.question_type),
            lambda: validate_branching_options(
                db, form.id, field.question_type, normalized_config, field_id=field.id
            ),
        ):
            try:
                check()
            except FormFieldValidationError as e:
                errors.append(f"field '{field.field_key}': {e}")

        if field.field_key == "availability" and field.question_type == "multi_select_checkbox":
            try:
                validate_availability_options(db, form.tournament_id, normalized_config)
            except FormFieldValidationError as e:
                errors.append(f"field '{field.field_key}': {e}")

    _require(not errors, "; ".join(errors))


def validate_availability_options(db: Session, tournament_id: int | None, config: dict) -> None:
    """A `multi_select_checkbox` field with field_key = "availability" must
    have every option's `value` reference a real TournamentShift belonging
    to the field's own tournament — validated strictly since a bad value
    directly corrupts MembershipAvailability write-through.

    Chapter-owned forms have no tournament shift catalog to validate
    against, so this is a no-op there (a chapter-owned availability field
    is valid but never write-throughs — see form-question-types-reference.md)."""
    if tournament_id is None:
        return

    options = config.get("options") or []
    if not options:
        return

    shift_ids = set()
    for option in options:
        value = option.get("value")
        _require(
            value is not None and str(value).isdigit(),
            f"availability option value '{value}' must be a TournamentShift id",
        )
        shift_ids.add(int(value))

    valid_ids = {
        shift_id
        for (shift_id,) in db.query(TournamentShift.id)
        .filter(TournamentShift.tournament_id == tournament_id, TournamentShift.id.in_(shift_ids))
        .all()
    }
    missing = shift_ids - valid_ids
    _require(
        not missing,
        f"availability option value(s) do not reference a real TournamentShift on this tournament: {sorted(missing)}",
    )
