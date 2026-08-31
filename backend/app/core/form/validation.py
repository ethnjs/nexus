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

from datetime import datetime

from app.models.models import Form, FormField, TournamentEvent, TournamentShift, TournamentTrack
from app.schemas.form import QUESTION_TYPE_CONFIG_SCHEMAS

BRANCHING_QUESTION_TYPES = {"single_select_radio", "single_select_dropdown"}

# availability_{date}[_{suffix}], e.g. "availability_20260315" or
# "availability_20260315_judges" — every matching field on a tournament
# writes into the same centralized TournamentMembershipAvailability pool
# (see write_through.sync_availability and forms.py's
# _write_through_reserved_fields), so neither the date nor the suffix scopes
# storage. The date still pins which day's shifts a given field's
# write-through may touch (see validate_availability_options). The suffix is
# optional and purely for field_key uniqueness — it's what lets two different
# forms each ask about the same date (e.g. a general form and a judges-only
# form both covering March 15) without colliding on field_key, which must be
# unique per tournament across every form.
AVAILABILITY_FIELD_KEY_PATTERN = re.compile(r"^availability_(\d{8})(?:_([a-z0-9_]+))?$")
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

# track_status_{suffix}, e.g. "track_status_volunteer_interest". The suffix
# makes the question's stable field key independent of a catalog track, so
# one answer can affect several tracks.
TRACK_STATUS_FIELD_KEY_PATTERN = re.compile(r"^track_status_([a-z0-9_]+)$")
TRACK_STATUS_QUESTION_TYPES = {"single_select_radio", "multi_select_checkbox"}

# Reserved field_key patterns (lunch excluded — it's checked separately
# since it also needs to strip the date/category before matching), each
# paired with the question_types it may be combined with.
RESERVED_FIELD_KEY_PATTERNS = (
    (AVAILABILITY_FIELD_KEY_PATTERN, AVAILABILITY_QUESTION_TYPES),
    (EVENT_PREFERENCE_FIELD_KEY_PATTERN, EVENT_PREFERENCE_QUESTION_TYPES),
    (TRACK_STATUS_FIELD_KEY_PATTERN, TRACK_STATUS_QUESTION_TYPES),
)

TOURNAMENT_PRESET_FIELD_KEY_PATTERNS = (
    AVAILABILITY_FIELD_KEY_PATTERN,
    EVENT_PREFERENCE_FIELD_KEY_PATTERN,
    LUNCH_FIELD_KEY_PATTERN,
    TRACK_STATUS_FIELD_KEY_PATTERN,
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

    normalized = parsed.model_dump()
    # These fields were added for track statuses after forms already existed.
    # Keep an omitted opt-in/mapping omitted instead of rewriting every
    # unrelated form field the next time its form is saved.
    source = config or {}
    if "track_status_enabled" not in source:
        normalized.pop("track_status_enabled", None)
    return normalized


def validate_reserved_field_key(field_key: str, question_type: str) -> None:
    """Reserved field_keys (availability_*, event_preference_*, lunch_*,
    track_status_*) reuse
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


def validate_tournament_preset(field_key: str, tournament_id: int | None) -> None:
    """Reserved presets are currently available only to tournament forms."""
    if any(pattern.match(field_key) for pattern in TOURNAMENT_PRESET_FIELD_KEY_PATTERNS):
        _require(tournament_id is not None, f"field_key '{field_key}' requires a tournament-owned form")


def track_status_enabled(field_key: str, config: dict) -> bool:
    """Whether this field is allowed to carry per-option track statuses."""
    return bool(TRACK_STATUS_FIELD_KEY_PATTERN.match(field_key)) or (
        bool(AVAILABILITY_FIELD_KEY_PATTERN.match(field_key))
        and bool(config.get("track_status_enabled"))
    )


def _is_assignment(item: object) -> bool:
    """An option's `value` can legally be a list of two different things —
    entity ids (list[int], for availability/event_preference) or track
    assignments (list[TrackStatusAssignment]). Discriminate on the element,
    not the container: treating every list as assignments makes a plain
    event_preference field look like it carries track statuses."""
    return isinstance(item, dict) and "id" in item and "status" in item


def option_track_assignments(option: dict) -> list[dict]:
    """The track assignments one option carries, whichever shape holds them —
    `value` *is* the list on a track_status_* field, or `value.track_statuses`
    on an opted-in availability field. The single place that knows how to dig
    them out; callers that hand-roll it get the value shapes wrong (see
    _is_assignment)."""
    value = option.get("value")
    if isinstance(value, list):
        return [item for item in value if _is_assignment(item)]
    if isinstance(value, dict):
        return [item for item in (value.get("track_statuses") or []) if _is_assignment(item)]
    return []


def option_shift_ids(option: dict) -> list[int]:
    """The TournamentShift ids one availability option groups. `value` is that
    list directly, or sits under `shift_ids` once the option also carries track
    statuses — read it through here rather than off `value`, or the opted-in
    shape yields the dict's keys instead of ids."""
    value = option.get("value")
    if isinstance(value, dict):
        value = value.get("shift_ids")
    return [item for item in (value or []) if isinstance(item, int)]


def track_status_assignments(config: dict) -> list[dict]:
    """Every track assignment carried by a field's options."""
    return [
        assignment
        for option in config.get("options") or []
        for assignment in option_track_assignments(option)
    ]


def validate_track_status_options(
    db: Session,
    tournament_id: int | None,
    field_key: str,
    question_type: str,
    config: dict,
) -> None:
    """Validate option-level track statuses for Track Status and opted-in
    Availability fields. Track mappings are tournament-only and catalog IDs
    remain valid after archival so historical fields can still be read."""
    assignments = track_status_assignments(config)
    enabled = track_status_enabled(field_key, config)

    _require(
        enabled or (not assignments and not config.get("track_status_enabled")),
        "track_statuses are only allowed on a track_status_* field or an opted-in availability field",
    )
    if not enabled:
        return

    _require(tournament_id is not None, "track status fields require a tournament-owned form")
    if TRACK_STATUS_FIELD_KEY_PATTERN.match(field_key):
        _require(config.get("required") is True, "track status fields must be required")

    track_ids = {assignment["id"] for assignment in assignments}
    valid_ids = {
        track_id
        for (track_id,) in db.query(TournamentTrack.id)
        .filter(TournamentTrack.tournament_id == tournament_id, TournamentTrack.id.in_(track_ids))
        .all()
    } if track_ids else set()
    missing_ids = track_ids - valid_ids
    _require(not missing_ids, f"track id(s) do not belong to this tournament: {sorted(missing_ids)}")

    if question_type == "multi_select_checkbox":
        statuses_by_track: dict[int, set[str]] = {}
        for assignment in assignments:
            statuses_by_track.setdefault(assignment["id"], set()).add(assignment["status"])
        conflicting = sorted(track_id for track_id, statuses in statuses_by_track.items() if len(statuses) > 1)
        _require(
            not conflicting,
            f"checkbox options assign conflicting statuses for track id(s): {conflicting}",
        )


def validate_branching_options(
    db: Session,
    form_id: str,
    question_type: str,
    config: dict,
    field_id: str | None = None,
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

    # FormField.id is a String(12) column — an int (or other non-str)
    # next_field_id can never match, and Postgres (unlike SQLite) errors on
    # an id_in() with mixed types instead of just finding no rows. Skip the
    # query for those and let them fall straight into `missing` below.
    string_ids = {fid for fid in next_field_ids if isinstance(fid, str)}
    valid_ids = set()
    if string_ids:
        valid_ids = {
            fid
            for (fid,) in db.query(FormField.id)
            .filter(FormField.form_id == form_id, FormField.id.in_(string_ids), FormField.is_archived == False)
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
            lambda: validate_tournament_preset(field.field_key, form.tournament_id),
            lambda: validate_track_status_options(
                db, form.tournament_id, field.field_key, field.question_type, normalized_config
            ),
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
                validate_availability_options(
                    db, form.tournament_id, normalized_config,
                    availability_field_date(field.field_key),
                )
            except FormFieldValidationError as e:
                errors.append(f"field '{field.field_key}': {e}")

        if EVENT_PREFERENCE_FIELD_KEY_PATTERN.match(field.field_key):
            try:
                validate_event_preference_options(db, form.tournament_id, field.question_type, normalized_config)
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


def availability_field_date(field_key: str):
    """The day an `availability_{YYYYMMDD}` question covers, or None if the
    key isn't one."""
    match = AVAILABILITY_FIELD_KEY_PATTERN.match(field_key)
    return datetime.strptime(match.group(1), "%Y%m%d").date() if match else None


def validate_availability_options(
    db: Session, tournament_id: int | None, config: dict, field_date=None
) -> None:
    """A field with field_key matching AVAILABILITY_FIELD_KEY_PATTERN
    (single_select_radio or multi_select_checkbox) must have every option's
    `value` be a non-empty
    list[int] of real TournamentShift ids belonging to the field's own
    tournament — one option groups one or more shifts under a single
    TD-labeled choice (e.g. "All Day" -> [1, 2, 3]). Validated strictly
    since a bad value directly corrupts MembershipAvailability write-through.

    `field_date` additionally pins every referenced shift to the day in the
    field_key; see the check itself for why a stray shift from another day is
    not merely untidy.

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
        if config.get("track_status_enabled"):
            _require(
                isinstance(value, dict) and isinstance(value.get("shift_ids"), list),
                f"availability option value '{value}' must contain shift_ids and track_statuses when track status is enabled",
            )
            value = value["shift_ids"]
        _require(
            isinstance(value, list) and len(value) > 0 and all(isinstance(v, int) for v in value),
            f"availability option value '{value}' must be a non-empty list of TournamentShift ids",
        )
        shift_ids.update(value)

    rows = (
        db.query(TournamentShift.id, TournamentShift.start)
        .filter(TournamentShift.tournament_id == tournament_id, TournamentShift.id.in_(shift_ids))
        .all()
    )
    missing = shift_ids - {shift_id for shift_id, _ in rows}
    _require(
        not missing,
        f"availability option value(s) do not reference a real TournamentShift on this tournament: {sorted(missing)}",
    )

    # An availability question owns its day: write-through may add or remove
    # exactly the shifts falling on the date in its field_key, so a shift from
    # another day listed here would be added by this question and then removed
    # by that day's own question, or the reverse, depending on submission
    # order. Reject it rather than let the two fight.
    if field_date is not None:
        wrong_day = sorted(shift_id for shift_id, start in rows if start.date() != field_date)
        _require(
            not wrong_day,
            f"availability option value(s) reference shifts outside this question's date "
            f"({field_date.isoformat()}): {wrong_day}",
        )


def validate_event_preference_options(
    db: Session, tournament_id: int | None, question_type: str, config: dict
) -> None:
    """A field with field_key matching EVENT_PREFERENCE_FIELD_KEY_PATTERN must
    have every option's `value` be a non-empty list[int] of real
    TournamentEvent ids belonging to the field's own tournament — one option
    groups one or more events under a single TD-labeled choice.

    Unlike availability (where a shift may appear in multiple options), an
    event may not appear in more than one option: write-through expands each
    selected option into rows keyed by event id, so an event split across
    options would make "which option did they pick" ambiguous.

    A ranked_choice event_preference field must also have
    `allow_duplicates: false` — ranking the same event at two ranks is never
    meaningful, and it's what lets the write-through table use a plain
    (membership, key, event) unique constraint with no rank in it. Options are
    already guaranteed mutually exclusive by the check above, so this is
    enforced at answer time too (see duplicate_ranked_choice_field_keys) —
    this is just the config-time half of the same rule.

    Chapter-owned forms have no tournament event catalog to validate against,
    so this is a no-op there, same as availability."""
    if tournament_id is None:
        return

    if question_type == "ranked_choice":
        _require(
            not config.get("allow_duplicates"),
            "event_preference ranked_choice fields must have allow_duplicates set to false",
        )

    options = config.get("options") or []
    if not options:
        return

    event_ids: set[int] = set()
    seen_ids: set[int] = set()
    duplicated: set[int] = set()
    for option in options:
        value = option.get("value")
        _require(
            isinstance(value, list) and len(value) > 0 and all(isinstance(v, int) for v in value),
            f"event_preference option value '{value}' must be a non-empty list of TournamentEvent ids",
        )
        duplicated |= seen_ids & set(value)
        seen_ids |= set(value)
        event_ids.update(value)

    _require(
        not duplicated,
        f"event_preference option value(s) reference the same event in more than one option: {sorted(duplicated)}",
    )

    valid_ids = {
        event_id
        for (event_id,) in db.query(TournamentEvent.id)
        .filter(TournamentEvent.tournament_id == tournament_id, TournamentEvent.id.in_(event_ids))
        .all()
    }
    missing = event_ids - valid_ids
    _require(
        not missing,
        f"event_preference option value(s) do not reference a real TournamentEvent on this tournament: {sorted(missing)}",
    )
