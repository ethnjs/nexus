"""Reads an import's source (a CSV or XLSX upload, or a Google Sheet tab) into one table shape.

Rows are never stored: each dry run or import reads the source again.
"""

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime, time
from zipfile import BadZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException

# Under Vercel's 4.5 MB request limit, since uploads pass through the frontend's proxy.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
MAX_ROWS = 5000
MAX_COLUMNS = 200


class ImportSourceError(ValueError):
    """A source NEXUS can't read. The message is written for the TD."""


@dataclass(frozen=True)
class Cell:
    text: str
    # Set when the source stored a date or time, not text. Naive when the source has no
    # timezone of its own (XLSX); the import reads it in the tournament's timezone.
    when: datetime | None = None


@dataclass(frozen=True)
class SourceTable:
    headers: list[str]
    rows: list[list[Cell]]


def column_letter(index: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA, as spreadsheets name columns."""
    letters = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(ord("A") + remainder) + letters
    return letters


def build_table(raw_rows: list[list[Cell]]) -> SourceTable:
    """Takes the first non-blank row as headers, drops blank rows and trailing blank columns,
    pads ragged rows, and names blank or repeated headers so every column is addressable."""
    rows = [row for row in raw_rows if any(cell.text for cell in row)]
    if not rows:
        raise ImportSourceError("The source has no rows.")
    width = max(
        (i + 1 for row in rows for i, cell in enumerate(row) if cell.text),
        default=0,
    )
    if width > MAX_COLUMNS:
        raise ImportSourceError(f"The source has {width} columns; the limit is {MAX_COLUMNS}.")
    if len(rows) - 1 > MAX_ROWS:
        raise ImportSourceError(f"The source has {len(rows) - 1} rows; the limit is {MAX_ROWS}.")

    padded = [(row + [Cell("")] * width)[:width] for row in rows]
    seen: dict[str, int] = {}
    headers = []
    for i, cell in enumerate(padded[0]):
        name = cell.text or f"Column {column_letter(i)}"
        seen[name] = seen.get(name, 0) + 1
        headers.append(name if seen[name] == 1 else f"{name} ({seen[name]})")
    return SourceTable(headers=headers, rows=padded[1:])


def read_csv(data: bytes) -> SourceTable:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        # Excel on Windows saves "CSV" in the system code page, not UTF-8.
        text = data.decode("cp1252", errors="replace")
    reader = csv.reader(io.StringIO(text, newline=""))
    return build_table([[Cell(value.strip()) for value in row] for row in reader])


def _xlsx_cell(value: object) -> Cell:
    if value is None:
        return Cell("")
    if isinstance(value, datetime):
        return Cell(value.isoformat(sep=" "), when=value)
    if isinstance(value, date):
        return Cell(value.isoformat(), when=datetime.combine(value, time()))
    if isinstance(value, time):
        return Cell(value.isoformat())
    if isinstance(value, bool):
        return Cell("TRUE" if value else "FALSE")
    if isinstance(value, float) and value.is_integer():
        return Cell(str(int(value)))
    return Cell(str(value).strip())


def _open_workbook(data: bytes):
    try:
        return load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except (BadZipFile, InvalidFileException, KeyError, OSError) as e:
        raise ImportSourceError("That file isn't a readable .xlsx workbook.") from e


def xlsx_sheet_names(data: bytes) -> list[str]:
    workbook = _open_workbook(data)
    try:
        return list(workbook.sheetnames)
    finally:
        workbook.close()


def read_xlsx(data: bytes, sheet: str | None = None) -> SourceTable:
    """Reads `sheet`, or the first sheet when none is named."""
    workbook = _open_workbook(data)
    try:
        if sheet is not None and sheet not in workbook.sheetnames:
            raise ImportSourceError(f"The workbook has no sheet named {sheet!r}.")
        worksheet = workbook[sheet] if sheet is not None else workbook.worksheets[0]
        raw_rows = [
            [_xlsx_cell(value) for value in row] for row in worksheet.iter_rows(values_only=True)
        ]
    finally:
        workbook.close()
    return build_table(raw_rows)


def read_upload(filename: str, data: bytes, sheet: str | None = None) -> SourceTable:
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImportSourceError("The file is larger than 4 MB.")
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension == "csv":
        return read_csv(data)
    if extension == "xlsx":
        return read_xlsx(data, sheet)
    raise ImportSourceError("Upload a .csv or .xlsx file.")
