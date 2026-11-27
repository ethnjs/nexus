from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

from app.core.form.import_mapping import (
    parse_answer,
    parse_person,
    parse_timestamp,
    split_picks,
    validate_import_mapping,
)
from app.core.form.import_sources import Cell
from app.core.form.validation import FormFieldValidationError
from app.schemas.form_import import ImportColumn, ImportIdentity, ImportMapping


def _options(*labels, other=False):
    options = [
        {"option_id": f"o{i}", "value": label, "label": label} for i, label in enumerate(labels)
    ]
    if other:
        options.append({"option_id": "other", "value": "Other", "label": "Other", "is_other": True})
    return options


def _column(header="Q"):
    return ImportMapping(shape="column", columns=[ImportColumn(header=header)])


def _parse(question_type, config, mapping, **cells):
    row = {header: Cell(text) for header, text in cells.items()}
    return parse_answer(question_type, config, "Q", mapping, row)


def test_split_picks_prefers_labels_that_contain_the_separator():
    labels = {"red, white": "rw", "red": "r", "blue": "b"}
    assert split_picks("Red, White, Blue", labels) == (["rw", "b"], None)
    assert split_picks("blue, Purple, haze", labels) == (["b"], "Purple, haze")


@pytest.mark.parametrize(
    ("question_type", "config", "text", "value", "problems"),
    [
        ("short_text", {"max_length": 5}, "hello", "hello", 0),
        ("short_text", {"max_length": 4}, "hello", None, 1),
        ("acknowledgment", {}, "Yes", True, 0),
        ("single_select_radio", {"options": _options("Yes", "No")}, "  yes ", "o0", 0),
        ("single_select_radio", {"options": _options("Yes")}, "Maybe", None, 1),
        (
            "single_select_dropdown",
            {"options": _options("Yes", other=True)},
            "Maybe",
            {"option_id": "other", "text": "Maybe"},
            0,
        ),
        (
            "multi_select_checkbox",
            {"options": _options("A", "B", other=True)},
            "B, A, write-in",
            ["o1", "o0", {"option_id": "other", "text": "write-in"}],
            0,
        ),
        ("multi_select_checkbox", {"options": _options("A")}, "A, Z", ["o0"], 1),
    ],
)
def test_column_cells(question_type, config, text, value, problems):
    parsed = _parse(question_type, config, _column(), Q=text)
    assert (parsed.value, len(parsed.problems)) == (value, problems)


def test_blank_cell_is_no_answer():
    parsed = _parse("single_select_radio", {"options": _options("Yes")}, _column(), Q="")
    assert (parsed.value, parsed.problems) == (None, [])


def _grid(**config):
    return {
        "rows": [
            {"option_id": "sat", "value": "Sat", "label": "Sat"},
            {"option_id": "sun", "value": "Sun", "label": "Sun"},
        ],
        "columns": _options("AM", "PM"),
        **config,
    }


_GRID_MAPPING = ImportMapping(
    shape="grid",
    columns=[
        ImportColumn(header="Q [Sat]", option_id="sat"),
        ImportColumn(header="Q [Sun]", option_id="sun"),
    ],
)


def test_grid_drops_only_the_bad_row():
    parsed = _parse("grid_single", _grid(), _GRID_MAPPING, **{"Q [Sat]": "am", "Q [Sun]": "Noon"})
    assert parsed.value == {"sat": "o0"}
    assert len(parsed.problems) == 1


def test_grid_multiple_and_one_per_column():
    multiple = _parse("grid_multiple", _grid(), _GRID_MAPPING, **{"Q [Sat]": "AM, PM"})
    assert multiple.value == {"sat": ["o0", "o1"]}
    ranked = _parse(
        "grid_single",
        _grid(one_per_column=True),
        _GRID_MAPPING,
        **{"Q [Sat]": "AM", "Q [Sun]": "AM"},
    )
    assert ranked.value == {"sat": "o0"}
    assert len(ranked.problems) == 1


def test_grid_column_picks_rows_whose_cell_names_the_column():
    mapping = ImportMapping(
        shape="grid_column",
        match="Saturday",
        columns=[
            ImportColumn(header="Q [9am]", option_id="o0"),
            ImportColumn(header="Q [1pm]", option_id="o1"),
        ],
    )
    config = {"options": _options("9am", "1pm")}
    parsed = _parse(
        "multi_select_checkbox",
        config,
        mapping,
        **{"Q [9am]": "Saturday, Sunday", "Q [1pm]": "Sunday"},
    )
    assert parsed.value == ["o0"]
    radio = _parse(
        "single_select_radio", config, mapping, **{"Q [9am]": "Saturday", "Q [1pm]": "Saturday"}
    )
    assert radio.value is None and len(radio.problems) == 1


def test_ranked_shapes():
    by_row = ImportMapping(
        shape="ranked_rows",
        rank_labels=["1st", "2nd"],
        columns=[
            ImportColumn(header="Q [A]", option_id="o0"),
            ImportColumn(header="Q [B]", option_id="o1"),
        ],
    )
    config = {"options": _options("A", "B"), "allow_duplicates": False}
    assert _parse("ranked_choice", config, by_row, **{"Q [A]": "2nd", "Q [B]": "1st"}).value == {
        "2": "o0",
        "1": "o1",
    }
    clash = _parse("ranked_choice", config, by_row, **{"Q [A]": "1st", "Q [B]": "1st"})
    assert clash.value == {"1": "o0"} and len(clash.problems) == 1

    by_cell = ImportMapping(
        shape="ranked_cells", columns=[ImportColumn(header="First"), ImportColumn(header="Second")]
    )
    assert _parse("ranked_choice", config, by_cell, First="B", Second="A").value == {
        "1": "o1",
        "2": "o0",
    }
    twice = _parse("ranked_choice", config, by_cell, First="B", Second="B")
    assert twice.value == {"1": "o1"} and len(twice.problems) == 1


def test_mapping_schema_rejects_mismatched_fields():
    with pytest.raises(ValidationError):
        ImportMapping(shape="grid", columns=[ImportColumn(header="Q [Sat]")])
    with pytest.raises(ValidationError):
        ImportMapping(shape="column", columns=[ImportColumn(header="Q")], match="Saturday")
    with pytest.raises(ValidationError):
        ImportMapping(shape="ranked_rows", columns=[ImportColumn(header="Q", option_id="o0")])


def test_validate_import_mapping_against_the_question():
    validate_import_mapping("grid_single", _grid(), _GRID_MAPPING)
    with pytest.raises(FormFieldValidationError, match="can't fill"):
        validate_import_mapping("short_text", {}, _GRID_MAPPING)
    archived = _grid(
        rows=[{"option_id": "sat", "value": "Sat", "label": "Sat", "is_archived": True}]
    )
    with pytest.raises(FormFieldValidationError, match="lacks"):
        validate_import_mapping("grid_single", archived, _GRID_MAPPING)


def test_parse_timestamp():
    la = ZoneInfo("America/Los_Angeles")
    assert parse_timestamp(Cell("11/13/2026 14:02:33"), "America/Los_Angeles") == datetime(
        2026, 11, 13, 14, 2, 33, tzinfo=la
    )
    aware = datetime(2026, 1, 1, tzinfo=ZoneInfo("UTC"))
    assert parse_timestamp(Cell("whatever", when=aware), "America/Los_Angeles") == aware
    assert parse_timestamp(Cell("soon"), "UTC") is None


def test_parse_person():
    identity = ImportIdentity(email="Email", full_name="Name", phone="Phone", timestamp="Time")
    row = {
        "Email": Cell(" Ann@Example.COM "),
        "Name": Cell("Mary Ann Lee"),
        "Phone": Cell("555"),
        "Time": Cell("later"),
    }
    person = parse_person(identity, row, "UTC")
    assert (person.email, person.first_name, person.last_name, person.phone) == (
        "ann@example.com",
        "Mary",
        "Ann Lee",
        "555",
    )
    assert person.submitted_at is None and len(person.problems) == 1

    bad = parse_person(ImportIdentity(email="Email"), {"Email": Cell("not-an-email")}, "UTC")
    assert bad.email is None and len(bad.problems) == 1
