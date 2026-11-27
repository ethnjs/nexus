"""Turns a source row's cells into form answers and a person, following each question's
ImportMapping. Answers come out in the shape a respondent submits (option ids), so an
import can run them through the same storing and write-through as a submission."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from email_validator import EmailNotValidError, validate_email

from app.core.form.import_sources import Cell
from app.core.form.validation import FormFieldValidationError
from app.schemas.form import GRID_QUESTION_TYPES
from app.schemas.form_import import ImportIdentity, ImportMapping

# Google Forms writes multiple picks into one cell joined by this.
PICK_SEPARATOR = ", "

SHAPE_QUESTION_TYPES: dict[str, set[str]] = {
    "column": {
        "short_text",
        "long_text",
        "acknowledgment",
        "single_select_radio",
        "single_select_dropdown",
        "multi_select_checkbox",
    },
    "grid": GRID_QUESTION_TYPES,
    "grid_column": {"multi_select_checkbox", "single_select_radio"},
    "ranked_rows": {"ranked_choice"},
    "ranked_cells": {"ranked_choice"},
}


def normalize(text: str) -> str:
    """How cell text compares with an option label: case and runs of whitespace ignored."""
    return " ".join(text.split()).casefold()


def _live(choices: list[dict]) -> list[dict]:
    return [c for c in choices if not c.get("is_archived")]


def validate_import_mapping(question_type: str, config: dict, mapping: ImportMapping) -> None:
    """The mapping suits the question: its shape fits the type, and every option it names is
    one of the question's live options (a grid's rows)."""
    if question_type not in SHAPE_QUESTION_TYPES[mapping.shape]:
        raise FormFieldValidationError(
            f"a {mapping.shape} mapping can't fill a {question_type} question"
        )
    targets = config.get("rows" if mapping.shape == "grid" else "options") or []
    live_ids = {c["option_id"] for c in _live(targets)}
    named = [c.option_id for c in mapping.columns if c.option_id is not None]
    unknown = sorted(set(named) - live_ids)
    if unknown:
        raise FormFieldValidationError(f"the mapping names options the question lacks: {unknown}")
    if len(named) != len(set(named)):
        raise FormFieldValidationError("the mapping names an option twice")


# ---------------------------------------------------------------------------
# Cells to answers
# ---------------------------------------------------------------------------


@dataclass
class ParsedAnswer:
    """`value` is None when nothing was answered or every cell failed; `problems` says what
    was dropped and why."""

    value: Any = None
    problems: list[str] = field(default_factory=list)


def _by_label(choices: list[dict]) -> dict[str, str]:
    return {normalize(c["label"]): c["option_id"] for c in _live(choices) if not c.get("is_other")}


def _other_id(choices: list[dict]) -> str | None:
    return next((c["option_id"] for c in _live(choices) if c.get("is_other")), None)


def split_picks(text: str, labels: dict[str, str]) -> tuple[list[str], str | None]:
    """Splits a multi-pick cell into option ids. Labels may themselves contain the separator,
    so the longest run of pieces that names an option wins. Returns the ids and whatever text
    named no option (Google Forms puts a typed Other answer last)."""
    pieces = text.split(PICK_SEPARATOR)
    picked: list[str] = []
    i = 0
    while i < len(pieces):
        for j in range(len(pieces), i, -1):
            option_id = labels.get(normalize(PICK_SEPARATOR.join(pieces[i:j])))
            if option_id is not None:
                if option_id not in picked:
                    picked.append(option_id)
                i = j
                break
        else:
            return picked, PICK_SEPARATOR.join(pieces[i:]).strip()
    return picked, None


def _not_an_option(label: str, text: str) -> str:
    return f"{label}: {text!r} isn't an option"


def _column(question_type: str, config: dict, label: str, text: str) -> ParsedAnswer:
    if question_type in ("short_text", "long_text"):
        max_length = config.get("max_length", 500)
        if len(text) > max_length:
            return ParsedAnswer(problems=[f"{label}: longer than {max_length} characters"])
        return ParsedAnswer(text)
    if question_type == "acknowledgment":
        return ParsedAnswer(True)

    options = config.get("options") or []
    labels, other_id = _by_label(options), _other_id(options)
    if question_type == "multi_select_checkbox":
        picked, leftover = split_picks(text, labels)
        value: list[Any] = list(picked)
        if leftover and other_id:
            value.append({"option_id": other_id, "text": leftover})
        elif leftover:
            return ParsedAnswer(
                value or None, [_not_an_option(label, leftover.split(PICK_SEPARATOR)[0])]
            )
        return ParsedAnswer(value)

    option_id = labels.get(normalize(text))
    if option_id is not None:
        return ParsedAnswer(option_id)
    if other_id:
        return ParsedAnswer({"option_id": other_id, "text": text})
    return ParsedAnswer(problems=[_not_an_option(label, text)])


def parse_answer(
    question_type: str, config: dict, label: str, mapping: ImportMapping, row: dict[str, Cell]
) -> ParsedAnswer:
    """One question's answer from a row, keyed by header. A blank cell is no answer, not a
    problem. A cell that can't be read drops only its own part of the answer."""

    def cell(header: str) -> str:
        found = row.get(header)
        return found.text if found is not None else ""

    if mapping.shape == "column":
        text = cell(mapping.columns[0].header)
        return _column(question_type, config, label, text) if text else ParsedAnswer()

    problems: list[str] = []
    if mapping.shape == "grid":
        columns = _by_label(config.get("columns") or [])
        rows_by_id = {r["option_id"]: r["label"] for r in config.get("rows") or []}
        grid: dict[str, Any] = {}
        for column in mapping.columns:
            text = cell(column.header)
            if not text:
                continue
            assert column.option_id is not None
            where = f"{label} [{rows_by_id.get(column.option_id, column.option_id)}]"
            if question_type == "grid_multiple":
                picked, leftover = split_picks(text, columns)
                if leftover:
                    problems.append(_not_an_option(where, leftover.split(PICK_SEPARATOR)[0]))
                if picked:
                    grid[column.option_id] = picked
            elif (column_id := columns.get(normalize(text))) is not None:
                grid[column.option_id] = column_id
            else:
                problems.append(_not_an_option(where, text))
        if config.get("one_per_column"):
            seen: set[str] = set()
            for row_id, column_id in list(grid.items()):
                if column_id in seen:
                    del grid[row_id]
                    problems.append(f"{label}: a column is picked in more than one row")
                seen.add(column_id)
        return ParsedAnswer(grid or None, problems)

    if mapping.shape == "grid_column":
        assert mapping.match is not None
        wanted = normalize(mapping.match)
        picked = [
            column.option_id
            for column in mapping.columns
            if column.option_id is not None
            and wanted in {normalize(p) for p in cell(column.header).split(PICK_SEPARATOR)}
        ]
        if question_type == "single_select_radio":
            if len(picked) > 1:
                return ParsedAnswer(
                    problems=[f"{label}: more than one row picks {mapping.match!r}"]
                )
            return ParsedAnswer(picked[0] if picked else None)
        return ParsedAnswer(picked or None)

    # ranked_rows and ranked_cells
    ranks: dict[str, str] = {}
    if mapping.shape == "ranked_rows":
        assert mapping.rank_labels is not None
        rank_of = {normalize(r): str(i + 1) for i, r in enumerate(mapping.rank_labels)}
        for column in mapping.columns:
            text = cell(column.header)
            if not text:
                continue
            assert column.option_id is not None
            rank = rank_of.get(normalize(text))
            if rank is None:
                problems.append(f"{label}: {text!r} isn't a rank")
            elif rank in ranks:
                problems.append(f"{label}: two options are ranked {text!r}")
            else:
                ranks[rank] = column.option_id
    else:
        options = _by_label(config.get("options") or [])
        for i, column in enumerate(mapping.columns):
            text = cell(column.header)
            if not text:
                continue
            option_id = options.get(normalize(text))
            if option_id is None:
                problems.append(_not_an_option(label, text))
            elif not config.get("allow_duplicates") and option_id in ranks.values():
                problems.append(f"{label}: {text!r} is ranked twice")
            else:
                ranks[str(i + 1)] = option_id
    return ParsedAnswer(ranks or None, problems)


# ---------------------------------------------------------------------------
# Rows to people
# ---------------------------------------------------------------------------

_TIMESTAMP_FORMATS = (
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y/%m/%d %H:%M:%S",
    "%m/%d/%Y",
    "%Y-%m-%d",
)


def parse_timestamp(cell: Cell, timezone: str) -> datetime | None:
    """A cell's moment: its stored date, or its text in a format Google Sheets and Excel export.
    A time without a zone is read in `timezone`, the tournament's."""
    when = cell.when
    if when is None:
        for pattern in _TIMESTAMP_FORMATS:
            try:
                when = datetime.strptime(cell.text, pattern)
                break
            except ValueError:
                continue
    if when is None:
        return None
    return when if when.tzinfo is not None else when.replace(tzinfo=ZoneInfo(timezone))


@dataclass
class RowPerson:
    """Who a row is about. `email` is None when the row has no usable address, and then the row
    can't import; `problems` lists what else couldn't be read."""

    email: str | None
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    submitted_at: datetime | None = None
    problems: list[str] = field(default_factory=list)


def parse_person(identity: ImportIdentity, row: dict[str, Cell], timezone: str) -> RowPerson:
    def text(header: str | None) -> str | None:
        found = row.get(header) if header else None
        return found.text.strip() or None if found is not None else None

    raw_email = text(identity.email)
    person = RowPerson(email=None)
    if raw_email is None:
        person.problems.append("no email")
    else:
        try:
            person.email = validate_email(raw_email, check_deliverability=False).normalized.lower()
        except EmailNotValidError:
            person.problems.append(f"{raw_email!r} isn't an email address")

    person.first_name, person.last_name = text(identity.first_name), text(identity.last_name)
    full = text(identity.full_name)
    if full and not (person.first_name or person.last_name):
        first, _, last = full.partition(" ")
        person.first_name, person.last_name = first, last.strip() or None
    person.phone = text(identity.phone)

    if identity.timestamp:
        stamp = row.get(identity.timestamp)
        person.submitted_at = parse_timestamp(stamp, timezone) if stamp is not None else None
        if person.submitted_at is None:
            person.problems.append("no readable timestamp; using the import time")
    return person
