from app.core.form.import_inference import field_keys, infer_fields, infer_identity
from app.core.form.import_sources import Cell, SourceTable
from app.services.google_import import GoogleForm, GoogleQuestion


def _table(headers, *rows):
    return SourceTable(headers=headers, rows=[[Cell(v) for v in row] for row in rows])


def test_infer_identity():
    identity = infer_identity(["Timestamp", "Email Address", "Name", "Phone number", "Shirt"])
    assert identity is not None
    assert (identity.email, identity.full_name, identity.phone, identity.timestamp) == (
        "Email Address",
        "Name",
        "Phone number",
        "Timestamp",
    )
    assert infer_identity(["Name"]) is None


def test_columns_without_a_form():
    table = _table(
        ["Email", "Shirt", "Events", "Notes", "Avail [Sat]", "Avail [Sun]"],
        ["a@x.com", "M", "Anatomy, Forensics", "Happy to help", "AM", "PM"],
        ["b@x.com", "m", "Anatomy", "Parking?", "PM", ""],
    )
    inferred = infer_fields(table)
    assert [(f.label, f.question_type) for f in inferred.fields] == [
        ("Shirt", "single_select_dropdown"),
        ("Events", "multi_select_checkbox"),
        ("Notes", "short_text"),
        ("Avail", "grid_single"),
    ]
    shirt, events, _, grid = inferred.fields
    # "M" and "m" are one option, matched the way cells are.
    assert [o["label"] for o in shirt.config["options"]] == ["M"]
    assert [o["label"] for o in events.config["options"]] == ["Anatomy", "Forensics"]
    assert [r["label"] for r in grid.config["rows"]] == ["Sat", "Sun"]
    assert [c["label"] for c in grid.config["columns"]] == ["AM", "PM"]
    assert [c.header for c in grid.import_mapping.columns] == ["Avail [Sat]", "Avail [Sun]"]


def test_form_questions_come_first_and_trim_titles():
    form = GoogleForm(
        title="Interest",
        questions=[
            GoogleQuestion(title="Email (school preferred) ", kind="short_text"),
            GoogleQuestion(
                title="Rank ", kind="grid_radio", options=["1st", "2nd"], rows=["A", "B"]
            ),
            GoogleQuestion(title="Shirt", kind="radio", options=["S", "M"], has_other=True),
            GoogleQuestion(title="Not in the sheet", kind="short_text"),
        ],
    )
    table = _table(
        ["Timestamp", "Email (school preferred)", "Extra", "Shirt", "Rank [A]", "Rank [B]"],
        ["1/1/2026", "a@x.com", "x", "S", "1st", "2nd"],
    )
    inferred = infer_fields(table, form)
    assert inferred.identity is not None and inferred.identity.email == "Email (school preferred)"
    assert [(f.label, f.question_type) for f in inferred.fields] == [
        ("Rank", "grid_single"),
        ("Shirt", "single_select_radio"),
        ("Extra", "short_text"),
    ]
    shirt = inferred.fields[1]
    assert [o["label"] for o in shirt.config["options"]] == ["S", "M", "Other"]
    assert shirt.config["options"][-1]["is_other"] is True


def test_field_keys_are_unique():
    table = _table(["Email", "Shirt size", "Shirt-size", "!!!"], ["a@x.com", "", "", ""])
    assert field_keys(infer_fields(table).fields) == ["shirt_size", "shirt_size_2", "column_c"]
