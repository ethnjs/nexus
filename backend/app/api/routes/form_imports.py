from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.form import slugify
from app.core.form.import_inference import field_keys, infer_fields
from app.core.form.import_sources import (
    MAX_UPLOAD_BYTES,
    ImportSourceError,
    SourceTable,
    read_upload,
    xlsx_sheet_names,
)
from app.core.form.permissions import (
    require_form_editable,
    require_form_manage_access,
    require_form_not_archived,
)
from app.core.form.validation import FormFieldValidationError, validate_field_config
from app.core.tournament import get_tournament, require_not_archived
from app.core.tournament.permissions import (
    MANAGE_FORMS,
    MANAGE_MEMBERS,
    has_permission,
    require_all_permissions,
)
from app.db.session import get_db
from app.models.models import Form as FormModel
from app.models.models import FormField, TournamentForm, User
from app.schemas.form import FormRead
from app.schemas.form_import import (
    ImportSettingsRead,
    ImportSettingsUpdate,
    ImportSource,
)
from app.services.google_import import (
    GoogleImportClient,
    parse_form_url,
    parse_spreadsheet_url,
    service_account_email,
)

router = APIRouter(tags=["imports"])

require_import_access = require_all_permissions(MANAGE_FORMS, MANAGE_MEMBERS)


def get_google_client() -> GoogleImportClient:
    return GoogleImportClient()


def _unprocessable(e: ImportSourceError | FormFieldValidationError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(e))


def read_upload_bytes(file: UploadFile) -> bytes:
    # One byte past the cap is enough to know it's over, without reading a huge file.
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImportSourceError("The file is larger than 4 MB.")
    return data


def read_sheet(
    google: GoogleImportClient, sheet_url: str, tab: str | None
) -> tuple[str, str, SourceTable]:
    """The spreadsheet id, the tab read (the named one, else the one the link points at, else
    the first) and its table."""
    spreadsheet_id, gid = parse_spreadsheet_url(sheet_url)
    tabs = google.sheet_tabs(spreadsheet_id)
    if not tabs:
        raise ImportSourceError("That spreadsheet has no tabs.")
    if tab is None:
        tab = next((t.title for t in tabs if t.gid == gid), tabs[0].title)
    elif tab not in {t.title for t in tabs}:
        raise ImportSourceError(f"The spreadsheet has no tab named {tab!r}.")
    return spreadsheet_id, tab, google.sheet_table(spreadsheet_id, tab)


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/imports/service-account/
# ---------------------------------------------------------------------------


class ServiceAccountRead(BaseModel):
    email: str


@router.get(
    "/tournaments/{tournament_id}/imports/service-account/",
    response_model=ServiceAccountRead,
    tags=["tournaments"],
    responses={422: {"description": "Google imports aren't set up on this server"}},
)
def get_import_service_account(_: User = Depends(require_import_access)):
    """The address to share a Google Sheet and Form with before importing from them."""
    try:
        return ServiceAccountRead(email=service_account_email())
    except ImportSourceError as e:
        raise _unprocessable(e) from e


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/imports/tabs/
# ---------------------------------------------------------------------------


class ImportTabsRead(BaseModel):
    tabs: list[str]
    # The tab a Google Sheets link points at, or the first one.
    selected: str | None = None


@router.post(
    "/tournaments/{tournament_id}/imports/tabs/",
    response_model=ImportTabsRead,
    tags=["tournaments"],
    responses={422: {"description": "The source can't be read"}},
)
def list_import_tabs(
    file: Annotated[UploadFile | None, File()] = None,
    sheet_url: Annotated[str | None, Form()] = None,
    google: GoogleImportClient = Depends(get_google_client),
    _: User = Depends(require_import_access),
):
    """The tabs of a Google Sheet or the sheets of an XLSX upload, to pick which to import. A CSV
    has none."""
    try:
        if file is not None:
            if not (file.filename or "").lower().endswith(".xlsx"):
                return ImportTabsRead(tabs=[])
            names = xlsx_sheet_names(read_upload_bytes(file))
            return ImportTabsRead(tabs=names, selected=names[0] if names else None)
        if sheet_url is None:
            raise ImportSourceError("Send a file or a Google Sheets link.")
        spreadsheet_id, gid = parse_spreadsheet_url(sheet_url)
        tabs = google.sheet_tabs(spreadsheet_id)
        selected = next((t.title for t in tabs if t.gid == gid), tabs[0].title if tabs else None)
        return ImportTabsRead(tabs=[t.title for t in tabs], selected=selected)
    except ImportSourceError as e:
        raise _unprocessable(e) from e


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/forms/imports/
# ---------------------------------------------------------------------------


@router.post(
    "/tournaments/{tournament_id}/forms/imports/",
    response_model=FormRead,
    status_code=status.HTTP_201_CREATED,
    tags=["tournaments"],
    responses={422: {"description": "The source can't be read, or has no email column"}},
)
def create_import_form(
    tournament_id: int,
    name: Annotated[str, Form(min_length=1, max_length=255)],
    file: Annotated[UploadFile | None, File()] = None,
    sheet_url: Annotated[str | None, Form()] = None,
    tab: Annotated[str | None, Form()] = None,
    form_url: Annotated[str | None, Form()] = None,
    email_column: Annotated[str | None, Form()] = None,
    db: Session = Depends(get_db),
    google: GoogleImportClient = Depends(get_google_client),
    current_user: User = Depends(require_import_access),
):
    """Creates a draft import form whose questions are proposed from a file upload or a Google
    Sheet tab, and from the Google Form behind it when `form_url` (its edit link) is given.
    Nothing is imported yet."""
    require_not_archived(get_tournament(tournament_id, db))
    if (file is None) == (sheet_url is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Send either a file or a Google Sheets link",
        )

    try:
        if file is not None:
            filename = file.filename or ""
            table = read_upload(filename, read_upload_bytes(file), tab)
            source: dict = {"kind": "upload", "file_type": filename.rsplit(".", 1)[-1].lower()}
            if tab is not None:
                source["sheet_tab"] = tab
        else:
            assert sheet_url is not None
            spreadsheet_id, tab, table = read_sheet(google, sheet_url, tab)
            source = {"kind": "google_sheet", "spreadsheet_id": spreadsheet_id, "sheet_tab": tab}
        google_form = None
        if form_url:
            source["google_form_id"] = parse_form_url(form_url)
            google_form = google.form(source["google_form_id"])
    except ImportSourceError as e:
        raise _unprocessable(e) from e

    if email_column is not None and email_column not in table.headers:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"The source has no column named {email_column!r}",
        )
    inferred = infer_fields(table, google_form, email_column)
    if inferred.identity is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="No column looks like an email address. Pick the email column.",
        )

    form = FormModel(
        name=name,
        title=name,
        owner_type="tournament",
        tournament_id=tournament_id,
        kind="import",
        import_source=ImportSource.model_validate(
            {**source, "identity": inferred.identity}
        ).model_dump(exclude_none=True),
        created_by=current_user.id,
    )
    db.add(form)
    db.flush()
    db.add(TournamentForm(tournament_id=tournament_id, form_id=form.id))
    for order, (inferred_field, key) in enumerate(
        zip(inferred.fields, field_keys(inferred.fields), strict=True), start=1
    ):
        try:
            config = validate_field_config(inferred_field.question_type, inferred_field.config)
        except FormFieldValidationError as e:
            raise _unprocessable(e) from e
        db.add(
            FormField(
                form_id=form.id,
                order=order,
                label=inferred_field.label,
                description=inferred_field.description,
                question_type=inferred_field.question_type,
                field_key=slugify(key),
                config=config,
                import_mapping=inferred_field.import_mapping.model_dump(exclude_none=True),
            )
        )
    db.commit()
    db.refresh(form)
    return form


# ---------------------------------------------------------------------------
# GET / PATCH /forms/{form_id}/import/
# ---------------------------------------------------------------------------


def require_import_form(
    form: FormModel = Depends(require_form_manage_access),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FormModel:
    """An import form, for someone who may also manage members."""
    if form.kind != "import":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import form not found")
    assert form.tournament_id is not None
    if not has_permission(current_user, form.tournament_id, MANAGE_MEMBERS, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
        )
    return form


def _settings(db: Session, form: FormModel) -> ImportSettingsRead:
    fields = (
        db.query(FormField)
        .filter(FormField.form_id == form.id, FormField.is_archived == False)  # noqa: E712
        .all()
    )
    return ImportSettingsRead.model_validate(
        {
            "source": form.import_source,
            "mappings": {f.id: f.import_mapping for f in fields if f.import_mapping},
        }
    )


@router.get("/forms/{form_id}/import/", response_model=ImportSettingsRead)
def get_import_settings(
    db: Session = Depends(get_db), form: FormModel = Depends(require_import_form)
):
    return _settings(db, form)


@router.patch("/forms/{form_id}/import/", response_model=ImportSettingsRead)
def update_import_settings(
    payload: ImportSettingsUpdate,
    db: Session = Depends(get_db),
    form: FormModel = Depends(require_import_form),
):
    """Changes which columns identify each person, or which tab or sheet is read. Columns are
    checked against the source when the import runs, since rows aren't stored."""
    require_form_not_archived(form)
    require_form_editable(form)
    assert form.import_source is not None
    if payload.sheet_tab is not None and form.import_source.get("file_type") == "csv":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A CSV has no sheets"
        )
    merged = {**form.import_source, **payload.model_dump(exclude_unset=True, exclude_none=True)}
    form.import_source = ImportSource.model_validate(merged).model_dump(exclude_none=True)
    db.commit()
    return _settings(db, form)
