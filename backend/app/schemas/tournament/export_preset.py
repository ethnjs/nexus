from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.tournament.display_config import (
    KNOWN_EVENT_FILTER_KEYS, KNOWN_FILTER_KEYS, KNOWN_SORT_DIRECTIONS,
)
from app.core.tournament.export_presets import COLUMN_MODES, ROW_TYPES, is_known_export_column


class ExportPresetColumn(BaseModel):
    """One column, in export order. An object rather than a bare key so a
    column can carry its own options."""
    model_config = ConfigDict(extra="forbid")

    key: str
    # Shift-like columns only: "names" or "times". Null = the column's default.
    mode: str | None = None

    @field_validator("key")
    @classmethod
    def _check_key(cls, value: str) -> str:
        if not is_known_export_column(value):
            raise ValueError(f"Unknown column '{value}'")
        return value

    @field_validator("mode")
    @classmethod
    def _check_mode(cls, value: str | None) -> str | None:
        if value is not None and value not in COLUMN_MODES:
            raise ValueError(f"Invalid mode '{value}'. Must be one of: {sorted(COLUMN_MODES)}")
        return value


class ExportPresetSort(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    direction: str = "asc"

    @field_validator("direction")
    @classmethod
    def _check_direction(cls, value: str) -> str:
        if value not in KNOWN_SORT_DIRECTIONS:
            raise ValueError(f"Invalid direction '{value}'")
        return value


def _validate_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("name must not be blank")
    return value


def _validate_row_type(value: str) -> str:
    if value not in ROW_TYPES:
        raise ValueError(f"Invalid row_type '{value}'. Must be one of: {sorted(ROW_TYPES)}")
    return value


def _validate_columns(value: list[ExportPresetColumn]) -> list[ExportPresetColumn]:
    keys = [column.key for column in value]
    if len(keys) != len(set(keys)):
        raise ValueError("columns must not repeat a key")
    return value


def _validate_filters(value: dict[str, list[str]], known: frozenset[str]) -> dict[str, list[str]]:
    unknown = sorted(set(value) - known)
    if unknown:
        raise ValueError(f"Unknown filter(s): {', '.join(unknown)}")
    return value


def validate_sorts_against_columns(sorts: list[ExportPresetSort], columns: list[ExportPresetColumn]) -> None:
    """A preset sorts by its own columns only. Called by the routes once a
    PATCH has been merged, since either half can arrive alone."""
    keys = {column.key for column in columns}
    missing = sorted({sort.field for sort in sorts} - keys)
    if missing:
        raise ValueError(f"Sort field(s) not among the columns: {', '.join(missing)}")


class ExportPresetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=255)
    row_type: str
    columns: list[ExportPresetColumn] = []
    member_filters: dict[str, list[str]] = {}
    event_filters: dict[str, list[str]] = {}
    sorts: list[ExportPresetSort] = []
    include_header: bool = True

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _validate_name(value)

    @field_validator("row_type")
    @classmethod
    def _check_row_type(cls, value: str) -> str:
        return _validate_row_type(value)

    @field_validator("columns")
    @classmethod
    def _check_columns(cls, value: list[ExportPresetColumn]) -> list[ExportPresetColumn]:
        return _validate_columns(value)

    @field_validator("member_filters")
    @classmethod
    def _check_member_filters(cls, value: dict[str, list[str]]) -> dict[str, list[str]]:
        return _validate_filters(value, KNOWN_FILTER_KEYS)

    @field_validator("event_filters")
    @classmethod
    def _check_event_filters(cls, value: dict[str, list[str]]) -> dict[str, list[str]]:
        return _validate_filters(value, KNOWN_EVENT_FILTER_KEYS)


class ExportPresetUpdate(BaseModel):
    """Partial update. Lists and dicts are whole-value: sending one replaces it."""
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=255)
    row_type: str | None = None
    columns: list[ExportPresetColumn] | None = None
    member_filters: dict[str, list[str]] | None = None
    event_filters: dict[str, list[str]] | None = None
    sorts: list[ExportPresetSort] | None = None
    include_header: bool | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str | None) -> str | None:
        return None if value is None else _validate_name(value)

    @field_validator("row_type")
    @classmethod
    def _check_row_type(cls, value: str | None) -> str | None:
        return None if value is None else _validate_row_type(value)

    @field_validator("columns")
    @classmethod
    def _check_columns(cls, value: list[ExportPresetColumn] | None) -> list[ExportPresetColumn] | None:
        return None if value is None else _validate_columns(value)

    @field_validator("member_filters")
    @classmethod
    def _check_member_filters(cls, value: dict[str, list[str]] | None) -> dict[str, list[str]] | None:
        return None if value is None else _validate_filters(value, KNOWN_FILTER_KEYS)

    @field_validator("event_filters")
    @classmethod
    def _check_event_filters(cls, value: dict[str, list[str]] | None) -> dict[str, list[str]] | None:
        return None if value is None else _validate_filters(value, KNOWN_EVENT_FILTER_KEYS)


class ExportPresetRead(BaseModel):
    """Read leniently: no validators, so a stored preset whose columns or
    filters have since gone stale still loads."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    tournament_id: int
    name: str
    row_type: str
    # Plain dicts: the write schemas' validators must not run on stored rows.
    columns: list[dict]
    member_filters: dict[str, list[str]]
    event_filters: dict[str, list[str]]
    sorts: list[dict]
    include_header: bool
    created_by: int | None
    created_at: datetime
    updated_at: datetime
