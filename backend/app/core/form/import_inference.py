"""Proposes an import form's questions from a source table, and from the Google Form behind it
when there is one. The TD then adjusts them in the form builder."""

import re
import secrets
from dataclasses import dataclass
from typing import Any

from app.core.form import slugify
from app.core.form.import_mapping import PICK_SEPARATOR, normalize
from app.core.form.import_sources import SourceTable, column_letter
from app.schemas.form_import import ImportColumn, ImportIdentity, ImportMapping
from app.services.google_import import GoogleForm, GoogleQuestion

# A column with this many distinct answers or fewer, some repeated, reads as a choice.
MAX_INFERRED_OPTIONS = 12
LONG_TEXT_LENGTH = 200
DEFAULT_MAX_LENGTH = 500
OTHER_LABEL = "Other"

_GRID_HEADER = re.compile(r"^(.*\S)\s*\[(.+)\]$")


@dataclass
class InferredField:
    label: str
    question_type: str
    config: dict[str, Any]
    import_mapping: ImportMapping
    description: str | None = None


@dataclass
class InferredImport:
    """`identity` is None when no column looks like an email; the TD then picks one."""

    identity: ImportIdentity | None
    fields: list[InferredField]


def _choice(label: str, **extra: Any) -> dict[str, Any]:
    return {"option_id": secrets.token_hex(5), "value": label, "label": label, **extra}


def _choices(labels: list[str]) -> list[dict[str, Any]]:
    return [_choice(label) for label in dict.fromkeys(labels)]


def infer_identity(headers: list[str]) -> ImportIdentity | None:
    def find(test) -> str | None:
        return next((h for h in headers if test(normalize(h))), None)

    email = find(lambda h: "email" in h)
    if email is None:
        return None
    first = find(lambda h: "first name" in h)
    last = find(lambda h: "last name" in h)
    return ImportIdentity(
        email=email,
        first_name=first,
        last_name=last,
        full_name=None
        if first or last
        else find(lambda h: h in ("name", "full name", "your name", "first and last name")),
        phone=find(lambda h: "phone" in h),
        timestamp=find(lambda h: h == "timestamp"),
    )


def _identity_headers(identity: ImportIdentity | None) -> set[str]:
    if identity is None:
        return set()
    return {h for h in identity.model_dump().values() if h}


# ---------------------------------------------------------------------------
# From a Google Form
# ---------------------------------------------------------------------------

_KIND_TYPES = {
    "short_text": "short_text",
    "long_text": "long_text",
    "date": "short_text",
    "time": "short_text",
    "radio": "single_select_radio",
    "scale": "single_select_radio",
    "dropdown": "single_select_dropdown",
    "checkbox": "multi_select_checkbox",
    "grid_radio": "grid_single",
    "grid_checkbox": "grid_multiple",
}


def _from_question(question: GoogleQuestion, headers: set[str]) -> InferredField | None:
    """None when the sheet has no column for the question."""
    title = question.title.strip()
    question_type = _KIND_TYPES[question.kind]
    if question_type in ("grid_single", "grid_multiple"):
        rows = _choices([r.strip() for r in question.rows])
        columns = [
            ImportColumn(header=f"{title} [{row['label']}]", option_id=row["option_id"])
            for row in rows
            if f"{title} [{row['label']}]" in headers
        ]
        if not columns:
            return None
        return InferredField(
            label=title,
            question_type=question_type,
            description=question.description,
            config={
                "required": False,
                "rows": rows,
                "columns": _choices([c.strip() for c in question.options]),
            },
            import_mapping=ImportMapping(shape="grid", columns=columns),
        )

    if title not in headers:
        return None
    config: dict[str, Any] = {"required": False}
    if question_type in ("short_text", "long_text"):
        config["max_length"] = DEFAULT_MAX_LENGTH
    else:
        config["options"] = _choices([o.strip() for o in question.options])
        if question.has_other:
            config["options"].append(_choice(OTHER_LABEL, is_other=True))
    return InferredField(
        label=title,
        question_type=question_type,
        description=question.description,
        config=config,
        import_mapping=ImportMapping(shape="column", columns=[ImportColumn(header=title)]),
    )


# ---------------------------------------------------------------------------
# From the columns alone
# ---------------------------------------------------------------------------


def _distinct(values: list[str]) -> list[str]:
    """First-seen order, matched as cells are: ignoring case and spacing."""
    seen: dict[str, str] = {}
    for value in values:
        seen.setdefault(normalize(value), value)
    return list(seen.values())


def _pieces(values: list[str]) -> list[str]:
    return [p.strip() for v in values for p in v.split(PICK_SEPARATOR) if p.strip()]


def _from_column(header: str, values: list[str]) -> InferredField:
    mapping = ImportMapping(shape="column", columns=[ImportColumn(header=header)])
    pieces = _distinct(_pieces(values))
    if any(PICK_SEPARATOR in v for v in values) and len(pieces) <= MAX_INFERRED_OPTIONS:
        return InferredField(
            label=header,
            question_type="multi_select_checkbox",
            config={"required": False, "options": _choices(pieces)},
            import_mapping=mapping,
        )
    distinct = _distinct(values)
    if values and len(distinct) <= MAX_INFERRED_OPTIONS and len(distinct) < len(values):
        return InferredField(
            label=header,
            question_type="single_select_dropdown",
            config={"required": False, "options": _choices(distinct)},
            import_mapping=mapping,
        )
    longest = max((len(v) for v in values), default=0)
    return InferredField(
        label=header,
        question_type="long_text" if longest > LONG_TEXT_LENGTH else "short_text",
        config={"required": False, "max_length": max(DEFAULT_MAX_LENGTH, longest)},
        import_mapping=mapping,
    )


def _from_grid_columns(
    title: str, columns: list[tuple[str, str]], cells: list[str]
) -> InferredField:
    """`columns` pairs each header with its row label, as Google names a grid's columns."""
    multiple = any(PICK_SEPARATOR in c for c in cells)
    rows = _choices([row for _, row in columns])
    row_ids = {row["label"]: row["option_id"] for row in rows}
    return InferredField(
        label=title,
        question_type="grid_multiple" if multiple else "grid_single",
        config={
            "required": False,
            "rows": rows,
            "columns": _choices(_distinct(_pieces(cells) if multiple else cells)),
        },
        import_mapping=ImportMapping(
            shape="grid",
            columns=[ImportColumn(header=h, option_id=row_ids[row]) for h, row in columns],
        ),
    )


def infer_fields(table: SourceTable, form: GoogleForm | None = None) -> InferredImport:
    """Questions in the Google Form's order first, then any column the form didn't cover, in
    column order. Identity columns become no question."""
    identity = infer_identity(table.headers)
    remaining = [h for h in table.headers if h not in _identity_headers(identity)]
    fields: list[InferredField] = []

    if form is not None:
        available = set(remaining)
        for question in form.questions:
            inferred = _from_question(question, available)
            if inferred is not None:
                fields.append(inferred)
                used = {c.header for c in inferred.import_mapping.columns}
                remaining = [h for h in remaining if h not in used]
                available -= used

    values = {
        h: [row[i].text for row in table.rows if row[i].text] for i, h in enumerate(table.headers)
    }
    grids: dict[str, list[tuple[str, str]]] = {}
    for header in remaining:
        match = _GRID_HEADER.match(header)
        if match:
            grids.setdefault(match.group(1), []).append((header, match.group(2).strip()))

    done: set[str] = set()
    for header in remaining:
        if header in done:
            continue
        match = _GRID_HEADER.match(header)
        title = match.group(1) if match else None
        group = grids[title] if title is not None else []
        if title is not None and len(group) > 1:
            cells = [v for h, _ in group for v in values[h]]
            if len(_distinct(_pieces(cells))) <= MAX_INFERRED_OPTIONS:
                fields.append(_from_grid_columns(title, group, cells))
                done.update(h for h, _ in group)
                continue
        fields.append(_from_column(header, values[header]))
        done.add(header)
    for f in fields:
        f.label = f.label[:255]  # FormField.label's length; the mapping keeps the full header
    return InferredImport(identity=identity, fields=fields)


def field_keys(fields: list[InferredField]) -> list[str]:
    """A unique key per field, slugified from its label."""
    keys: list[str] = []
    for i, f in enumerate(fields):
        base = slugify(f.label) or f"column_{column_letter(i).lower()}"
        key, n = base, 2
        while key in keys:
            suffix = f"_{n}"
            key, n = base[: 64 - len(suffix)] + suffix, n + 1
        keys.append(key)
    return keys
