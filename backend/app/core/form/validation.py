"""Per-question_type config/options validation for FormField — see
backend/form-question-types-reference.md for the shapes enforced here."""

from sqlalchemy.orm import Session

from app.models.models import FormField, TournamentShift


class FormFieldValidationError(ValueError):
    """Raised when a FormField's question_type/config/options don't match
    the shape form-question-types-reference.md requires."""


QUESTION_TYPES_WITH_OPTIONS = {
    "single_select_radio",
    "single_select_dropdown",
    "multi_select_checkbox",
    "ranked_choice",
}

ALL_QUESTION_TYPES = QUESTION_TYPES_WITH_OPTIONS | {
    "acknowledgment",
    "short_text",
    "long_text",
}

BRANCHING_QUESTION_TYPES = {"single_select_radio", "single_select_dropdown"}

# field_key values with a system-defined meaning. `lunch_{custom}` is also
# reserved (any key starting with "lunch_") but its config shape isn't
# designed yet, so it isn't enforced here — see form-question-types-reference.md.
RESERVED_FIELD_KEY_QUESTION_TYPES = {
    "availability": {"multi_select_checkbox"},
    "event_preference": {"ranked_choice", "multi_select_checkbox", "single_select_dropdown"},
}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise FormFieldValidationError(message)


def _validate_options_list(config: dict) -> list[dict]:
    options = config.get("options")
    _require(isinstance(options, list), "config.options must be a list")

    seen_values = set()
    for option in options:
        _require(isinstance(option, dict), "each option must be an object")
        value = option.get("value")
        label = option.get("label")
        _require(isinstance(value, str) and value != "", "each option needs a non-empty string 'value'")
        _require(isinstance(label, str) and label != "", "each option needs a non-empty string 'label'")
        _require(value not in seen_values, f"duplicate option value '{value}'")
        seen_values.add(value)

    return options


def validate_field_config(question_type: str, config: dict | None) -> None:
    """Validate that `config` matches the shape `question_type` requires.
    Raises FormFieldValidationError on any mismatch."""
    _require(question_type in ALL_QUESTION_TYPES, f"unknown question_type '{question_type}'")

    config = config or {}
    _require(isinstance(config, dict), "config must be an object")
    _require(isinstance(config.get("required"), bool), "config.required must be a boolean")

    if question_type == "acknowledgment":
        confirm_label = config.get("confirm_label")
        _require(
            isinstance(confirm_label, str) and confirm_label != "",
            "config.confirm_label must be a non-empty string",
        )

    elif question_type in ("single_select_radio", "single_select_dropdown", "multi_select_checkbox"):
        _validate_options_list(config)

    elif question_type == "ranked_choice":
        ranks = config.get("ranks")
        _require(
            isinstance(ranks, int) and not isinstance(ranks, bool) and ranks > 0,
            "config.ranks must be a positive integer",
        )
        _require(isinstance(config.get("allow_duplicates"), bool), "config.allow_duplicates must be a boolean")
        options = _validate_options_list(config)
        _require(ranks <= len(options), "config.ranks cannot exceed the number of options")

    elif question_type in ("short_text", "long_text"):
        max_length = config.get("max_length")
        _require(
            isinstance(max_length, int) and not isinstance(max_length, bool) and max_length > 0,
            "config.max_length must be a positive integer",
        )


def validate_reserved_field_key(field_key: str, question_type: str) -> None:
    """Reserved field_keys (availability, event_preference) reuse an
    existing structural question_type rather than introducing their own —
    reject a reserved key paired with a question_type it doesn't allow.
    Applies identically regardless of owner_type (tournament vs. chapter);
    only write-through, not validation, differs by ownership."""
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
    """`next_field_id`/`action` on an option are only valid on
    single_select_radio/single_select_dropdown fields. `field_id` is the
    field being edited (None on create, since a new field has no id yet
    for an option to self-reference)."""
    options = config.get("options") or []

    if question_type not in BRANCHING_QUESTION_TYPES:
        for option in options:
            _require(
                "next_field_id" not in option and "action" not in option,
                "next_field_id/action are only valid on single_select_radio/single_select_dropdown options",
            )
        return

    next_field_ids = set()
    for option in options:
        next_field_id = option.get("next_field_id")
        action = option.get("action")
        _require(
            next_field_id is None or action is None,
            "an option cannot have both next_field_id and action",
        )
        if action is not None:
            _require(action == "submit_form", f"unknown option action '{action}'")
        if next_field_id is not None:
            _require(
                isinstance(next_field_id, int) and not isinstance(next_field_id, bool),
                "next_field_id must be an integer",
            )
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
