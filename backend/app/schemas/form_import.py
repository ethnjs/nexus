from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

MappingShape = Literal["column", "grid", "grid_column", "ranked_rows", "ranked_cells"]


class ImportColumn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    header: str = Field(min_length=1)
    # The field's option (or grid row) this column fills; unset where the column is the
    # whole question, or a rank in order.
    option_id: str | None = None


class ImportMapping(BaseModel):
    """How one question on an import form reads the source. Stored on FormField.import_mapping.

    - column: one column, read by the question's own type.
    - grid: one column per grid row (option_id is the row); a cell names the picked column(s).
    - grid_column: one column per option; the option is picked when its cell includes `match`.
      A source grid column, say Saturday, becomes a question over the grid's rows.
    - ranked_rows: one column per option; a cell names the option's rank from `rank_labels`.
    - ranked_cells: one column per rank, in rank order; a cell names the option at that rank.
    """

    model_config = ConfigDict(extra="forbid")
    shape: MappingShape
    columns: list[ImportColumn] = Field(min_length=1)
    match: str | None = None
    # Cell text for rank 1, 2, 3...
    rank_labels: list[str] | None = None

    @model_validator(mode="after")
    def _shape_fields(self) -> Self:
        per_option = self.shape in ("grid", "grid_column", "ranked_rows")
        if per_option and any(c.option_id is None for c in self.columns):
            raise ValueError(f"every column of a {self.shape} mapping names an option")
        if not per_option and any(c.option_id is not None for c in self.columns):
            raise ValueError(f"a {self.shape} mapping's columns name no option")
        if self.shape == "column" and len(self.columns) != 1:
            raise ValueError("a column mapping reads exactly one column")
        if (self.match is not None) != (self.shape == "grid_column"):
            raise ValueError("match is set on a grid_column mapping and nowhere else")
        if (self.rank_labels is not None) != (self.shape == "ranked_rows"):
            raise ValueError("rank_labels is set on a ranked_rows mapping and nowhere else")
        return self


class ImportIdentity(BaseModel):
    """Source columns that identify each row's person. Never stored as form answers: email
    matches an account, and the rest fill in only the invited Users an import creates."""

    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=1)
    first_name: str | None = None
    last_name: str | None = None
    # Used when there's no first/last pair; split at the first space.
    full_name: str | None = None
    phone: str | None = None
    # Becomes the response's submitted_at, and picks the latest row among duplicate emails.
    timestamp: str | None = None


class ImportSource(BaseModel):
    """Where an import form's rows come from. Stored on Form.import_source."""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["upload", "google_sheet"]
    file_type: Literal["csv", "xlsx"] | None = None
    spreadsheet_id: str | None = None
    sheet_tab: str | None = None
    # Set when the questions came from a Google Form, whose option labels are then locked.
    google_form_id: str | None = None
    identity: ImportIdentity

    @model_validator(mode="after")
    def _kind_fields(self) -> Self:
        if self.kind == "upload" and (self.file_type is None or self.spreadsheet_id is not None):
            raise ValueError("an upload source has a file_type and no spreadsheet")
        if self.kind == "google_sheet" and (
            self.spreadsheet_id is None or self.sheet_tab is None or self.file_type is not None
        ):
            raise ValueError("a google_sheet source has a spreadsheet_id and sheet_tab")
        return self
