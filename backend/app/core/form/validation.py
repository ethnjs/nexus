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

# availability_{date}, e.g. "availability_20260315" — one question per date,
# but every matching field on a tournament writes into the same centralized
# TournamentMembershipAvailability pool (see write_through.sync_availability
# and forms.py's _write_through_reserved_fields), so the date isn't used to
# scope storage, only to keep field_keys distinct per question.
AVAILABILITY_FIELD_KEY_PATTERN = re.compile(r"^availability_(\d{8})$")
AVAILABILITY_QUESTION_TYPES = {"single_select_radio", "multi_select_checkbox"}

# event_preference_{suffix}, e.g. "event_preference_morning" — locked prefix,
# TD-chosen suffix. No write-through yet: whether multiple suffixes merge
# into one preference list or stay tracked separately is an open product
# question (see form-question-types-reference.md).
EVENT_PREFERENCE_FIELD_KEY_PATTERN = re.compile(r"^event_preference_([a-z0-9_]+)$")
EVENT_PREFERENCE_QUESTION_TYPES = {"ranked_choice", "multi_select_checkbox", "single_select_dropdown"}

# lunch_{date}_{category}, e.g. "lunch_20270213_protein" — date is baked
# into the key, so per-tournament field_key uniqueness already covers
# per-(date, category) uniqueness with no separate check needed.
LUNCH_FIELD_KEY_PATTERN = re.compile(r"^lunch_(\d{8})_([a-z0-9_]+)$")
LUNCH_QUESTION_TYPES = {"single_select_radio", "multi_select_checkbox"}

# Reserved field_key patterns (lunch excluded — it's checked separately
# since it also needs to strip the date/category before matching), each
# paired with the question_types it may be combined with.
RESERVED_FIELD_KEY_PATTERNS = (
    (AVAILABILITY_FIELD_KEY_PATTERN, AVAILABILITY_QUESTION_TYPES),
    (EVENT_PREFERENCE_FIELD_KEY_PATTERN, EVENT_PREFERENCE_QUESTION_TYPES),
)


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
    """Reserved field_keys (availability_*, event_preference_*, lunch_*) reuse
    an existing structural question_type rather than introducing their own —
    reject a reserved key paired with a question_type it doesn't allow. A
    bare "availability"/"event_preference" (no date/suffix) is not a valid
    reserved key — every such question must be disambiguated. Applies
    identically regardless of owner_type (tournament vs. chapter); only
    write-through, not validation, differs by ownership."""
    if LUNCH_FIELD_KEY_PATTERN.match(field_key):
        _require(
            question_type in LUNCH_QUESTION_TYPES,
            f"field_key '{field_key}' requires question_type in {sorted(LUNCH_QUESTION_TYPES)}, got '{question_type}'",
        )
        return

    for pattern, allowed_types in RESERVED_FIELD_KEY_PATTERNS:
        if pattern.match(field_key):
            _require(
                question_type in allowed_types,
                f"field_key '{field_key}' requires question_type in {sorted(allowed_types)}, got '{question_type}'",
            )
            return


def validate_branching_options(
    db: Session,
    form_id: str,
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


def collect_active_field_errors(db: Session, form: Form) -> list[str]:
    """Aggregate, non-raising pass over every non-archived field on `form`,
    re-run in full rather than per-field: per-field validation on create/
    update can't catch problems that only exist in aggregate (e.g. a
    next_field_id left dangling after some other field got archived/
    replaced later). Used both by the publish-transition gate (below,
    which additionally requires >=1 field) and by the bulk field-replace
    route in api/routes/forms.py (which runs this straight after flushing
    a proposed field set, so newly-created fields already have real ids to
    validate next_field_id against). Collects every problem instead of
    stopping at the first, so a TD sees the full list in one pass."""
    fields = (
        db.query(FormField)
        .filter(FormField.form_id == form.id, FormField.is_archived == False)
        .all()
    )

    errors: list[str] = []
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

        if AVAILABILITY_FIELD_KEY_PATTERN.match(field.field_key):
            try:
                validate_availability_options(db, form.tournament_id, normalized_config)
            except FormFieldValidationError as e:
                errors.append(f"field '{field.field_key}': {e}")

    return errors


def validate_form_for_publish(db: Session, form: Form) -> None:
    """Run on every draft->published transition and every explicit
    republish while already published — same as collect_active_field_errors
    plus the publish-only "must have at least one field" requirement."""
    has_fields = (
        db.query(FormField)
        .filter(FormField.form_id == form.id, FormField.is_archived == False)
        .first()
        is not None
    )

    errors: list[str] = [] if has_fields else ["form has no fields"]
    errors += collect_active_field_errors(db, form)

    _require(not errors, "; ".join(errors))


def validate_availability_options(db: Session, tournament_id: int | None, config: dict) -> None:
    """A field with field_key matching AVAILABILITY_FIELD_KEY_PATTERN
    (single_select_radio or multi_select_checkbox) must have every option's
    `value` be a non-empty
    list[int] of real TournamentShift ids belonging to the field's own
    tournament — one option groups one or more shifts under a single
    TD-labeled choice (e.g. "All Day" -> [1, 2, 3]). Validated strictly
    since a bad value directly corrupts MembershipAvailability write-through.

    Chapter-owned forms have no tournament shift catalog to validate
    against, so this is a no-op there (a chapter-owned availability field
    is valid but never write-throughs — see form-question-types-reference.md)."""
    if tournament_id is None:
        return

    options = config.get("options") or []
    if not options:
        return

    shift_ids: set[int] = set()
    for option in options:
        value = option.get("value")
        _require(
            isinstance(value, list) and len(value) > 0 and all(isinstance(v, int) for v in value),
            f"availability option value '{value}' must be a non-empty list of TournamentShift ids",
        )
        shift_ids.update(value)

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
