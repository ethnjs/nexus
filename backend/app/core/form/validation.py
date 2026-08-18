"""Per-question_type config/options validation for FormField — see
backend/form-question-types-reference.md for the shapes enforced here."""

from sqlalchemy.orm import Session

from app.models.models import TournamentShift


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
