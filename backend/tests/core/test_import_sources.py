import io
from datetime import datetime

import pytest
from openpyxl import Workbook

from app.core.form import import_sources
from app.core.form.import_sources import (
    ImportSourceError,
    column_letter,
    read_csv,
    read_upload,
    read_xlsx,
    xlsx_sheet_names,
)


def _texts(table):
    return [[cell.text for cell in row] for row in table.rows]


def test_csv_reads_bom_utf8_and_names_blank_and_repeated_headers():
    data = "﻿Email,,Phone,Phone\n a@x.com ,x,1,2\n,,,\nb@x.com\n".encode()
    table = read_csv(data)
    assert table.headers == ["Email", "Column B", "Phone", "Phone (2)"]
    # The blank row is dropped and the short one padded.
    assert _texts(table) == [["a@x.com", "x", "1", "2"], ["b@x.com", "", "", ""]]


def test_csv_falls_back_to_windows_encoding():
    table = read_csv("Name\nJosé\n".encode("cp1252"))
    assert _texts(table) == [["José"]]


def test_trailing_blank_columns_are_dropped():
    table = read_csv(b"Email,Name,,\na@x.com,Ann,,\n")
    assert table.headers == ["Email", "Name"]


@pytest.mark.parametrize(("index", "letter"), [(0, "A"), (25, "Z"), (26, "AA"), (701, "ZZ")])
def test_column_letter(index, letter):
    assert column_letter(index) == letter


def test_limits(monkeypatch):
    monkeypatch.setattr(import_sources, "MAX_ROWS", 2)
    monkeypatch.setattr(import_sources, "MAX_COLUMNS", 2)
    with pytest.raises(ImportSourceError, match="rows"):
        read_csv(b"A\n1\n2\n3\n")
    with pytest.raises(ImportSourceError, match="columns"):
        read_csv(b"A,B,C\n1,2,3\n")
    with pytest.raises(ImportSourceError, match="no rows"):
        read_csv(b"\n,,\n")


def _workbook(**sheets) -> bytes:
    workbook = Workbook()
    workbook.remove(workbook.active)
    for title, rows in sheets.items():
        sheet = workbook.create_sheet(title)
        for row in rows:
            sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_xlsx_reads_values_and_keeps_dates():
    stamp = datetime(2026, 11, 13, 14, 2, 33)
    data = _workbook(
        Responses=[["Timestamp", "Age", "Share?"], [stamp, 17.0, True]],
        Other=[["Ignored"]],
    )
    assert xlsx_sheet_names(data) == ["Responses", "Other"]
    row = read_xlsx(data).rows[0]
    assert [cell.text for cell in row] == ["2026-11-13 14:02:33", "17", "TRUE"]
    assert row[0].when == stamp
    assert read_xlsx(data, "Other").headers == ["Ignored"]
    with pytest.raises(ImportSourceError, match="no sheet"):
        read_xlsx(data, "Missing")


def test_upload_dispatch_and_rejections(monkeypatch):
    assert read_upload("people.CSV", b"Email\na@x.com\n").headers == ["Email"]
    with pytest.raises(ImportSourceError, match="readable"):
        read_upload("people.xlsx", b"not a zip")
    with pytest.raises(ImportSourceError, match=".csv or .xlsx"):
        read_upload("people.numbers", b"")
    monkeypatch.setattr(import_sources, "MAX_UPLOAD_BYTES", 3)
    with pytest.raises(ImportSourceError, match="5 MB"):
        read_upload("people.csv", b"Email\n")
