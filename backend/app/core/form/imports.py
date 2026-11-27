"""Runs an import: each source row becomes a response to the import form from the person its
email names. A dry run does every write and rolls them back, so it reports exactly what the
real run would do."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.core.form import snapshot_answer_value
from app.core.form.import_mapping import RowPerson, parse_answer, parse_person
from app.core.form.import_sources import Cell, ImportSourceError, SourceTable
from app.core.form.write_through import write_through_reserved_fields
from app.models.models import (
    Form,
    FormAnswer,
    FormField,
    FormResponse,
    TournamentMembership,
    User,
    utcnow,
)
from app.schemas.form_import import (
    ImportMapping,
    ImportProblem,
    ImportReport,
    ImportSource,
)

# An email whose account is in these states attaches; anything else is skipped.
ATTACHABLE_STATUSES = ("active", "invited")


@dataclass
class _Row:
    number: int
    person: RowPerson
    answers: dict[str, Any]


@dataclass
class ImportResult:
    """The report, plus what the real run created, for the audit entry and invite emails."""

    report: ImportReport
    invited_user_ids: list[int] = field(default_factory=list)
    invited_emails: list[str] = field(default_factory=list)
    membership_ids: list[int] = field(default_factory=list)
    response_ids: list[str] = field(default_factory=list)
    overwritten_response_ids: list[str] = field(default_factory=list)


def _missing_columns(source: ImportSource, fields: list[FormField], headers: set[str]):
    missing_identity = [h for h in source.identity.model_dump().values() if h and h not in headers]
    if missing_identity:
        raise ImportSourceError(
            f"The source has no column named {', '.join(repr(h) for h in missing_identity)}."
        )
    problems = []
    for f in fields:
        assert f.import_mapping is not None
        absent = [c["header"] for c in f.import_mapping["columns"] if c["header"] not in headers]
        if absent:
            problems.append(
                ImportProblem(
                    row=None,
                    message=f"{f.label}: the source has no column {absent[0]!r}, so its answers "
                    "are left out where it would be read",
                )
            )
    return problems


def _parse_rows(
    table: SourceTable, source: ImportSource, fields: list[FormField], timezone: str
) -> tuple[list[_Row], list[ImportProblem]]:
    mappings = {f.id: ImportMapping.model_validate(f.import_mapping) for f in fields}
    rows: list[_Row] = []
    problems: list[ImportProblem] = []
    for index, cells in enumerate(table.rows):
        number = index + 2
        by_header: dict[str, Cell] = dict(zip(table.headers, cells, strict=True))
        person = parse_person(source.identity, by_header, timezone)
        if person.email is None:
            # The email problem comes first; nothing else matters for a row that won't import.
            problems.append(ImportProblem(row=number, message=person.problems[0], skipped=True))
            continue
        problems += [
            ImportProblem(row=number, email=person.email, message=m) for m in person.problems
        ]
        answers = {}
        for f in fields:
            parsed = parse_answer(
                f.question_type, f.config or {}, f.label, mappings[f.id], by_header
            )
            problems += [
                ImportProblem(row=number, email=person.email, message=m) for m in parsed.problems
            ]
            if parsed.value is not None:
                answers[f.id] = parsed.value
        rows.append(_Row(number, person, answers))
    return rows, problems


def _latest_per_email(rows: list[_Row]) -> tuple[list[_Row], list[ImportProblem]]:
    """The newest row for each email by timestamp, a missing one counting as oldest; among
    equals, the later row."""

    def newness(row: _Row):
        stamp = row.person.submitted_at
        return (stamp is not None, stamp or datetime.min.replace(tzinfo=UTC), row.number)

    kept: dict[str, _Row] = {}
    for row in rows:
        assert row.person.email is not None
        current = kept.get(row.person.email)
        if current is None or newness(row) > newness(current):
            kept[row.person.email] = row
    winners = {id(r) for r in kept.values()}
    problems = [
        ImportProblem(
            row=row.number,
            email=row.person.email,
            message=f"row {kept[row.person.email].number} has the same email and is newer",
            skipped=True,
        )
        for row in rows
        if id(row) not in winners and row.person.email is not None
    ]
    return list(kept.values()), problems


def run_import(
    db: Session, form: Form, table: SourceTable, timezone: str, dry_run: bool
) -> ImportResult:
    """Writes every row's person, membership, response and write-through. Doesn't commit or
    roll back; the caller does one or the other by `dry_run`."""
    assert form.import_source is not None and form.tournament_id is not None
    source = ImportSource.model_validate(form.import_source)
    fields = (
        db.query(FormField)
        .filter(FormField.form_id == form.id, FormField.is_archived == False)  # noqa: E712
        .order_by(FormField.order)
        .all()
    )
    mapped = [f for f in fields if f.import_mapping]
    problems = _missing_columns(source, mapped, set(table.headers))
    present = [
        f
        for f in mapped
        if f.import_mapping is not None
        and all(c["header"] in table.headers for c in f.import_mapping["columns"])
    ]
    parsed, row_problems = _parse_rows(table, source, present, timezone)
    rows, duplicate_problems = _latest_per_email(parsed)
    problems += row_problems + duplicate_problems

    users = {
        u.email: u
        for u in db.query(User).filter(User.email.in_([r.person.email for r in rows])).all()
    }
    memberships = {
        m.user_id: m
        for m in db.query(TournamentMembership).filter(
            TournamentMembership.tournament_id == form.tournament_id,
            TournamentMembership.user_id.in_([u.id for u in users.values()]),
        )
    }
    result = ImportResult(
        report=ImportReport(
            dry_run=dry_run,
            rows=len(table.rows),
            imported=0,
            invited_users=0,
            existing_users=0,
            new_memberships=0,
            overwritten_responses=0,
            problems=[],
        )
    )
    report = result.report

    for row in sorted(rows, key=lambda r: r.number):
        person = row.person
        assert person.email is not None
        user = users.get(person.email)
        if user is not None and user.status not in ATTACHABLE_STATUSES:
            problems.append(
                ImportProblem(
                    row=row.number,
                    email=person.email,
                    message=f"the account for this email is {user.status}",
                    skipped=True,
                )
            )
            continue
        if user is None:
            user = User(
                email=person.email,
                first_name=person.first_name,
                last_name=person.last_name,
                phone=person.phone,
                status="invited",
            )
            db.add(user)
            db.flush()
            report.invited_users += 1
            result.invited_user_ids.append(user.id)
            result.invited_emails.append(user.email)
        else:
            report.existing_users += 1

        membership = memberships.get(user.id)
        if membership is None:
            membership = TournamentMembership(
                user_id=user.id, tournament_id=form.tournament_id, source="import"
            )
            db.add(membership)
            db.flush()
            report.new_memberships += 1
            result.membership_ids.append(membership.id)

        existing = (
            db.query(FormResponse)
            .filter(FormResponse.form_id == form.id, FormResponse.user_id == user.id)
            .first()
        )
        if existing is not None:
            result.overwritten_response_ids.append(existing.id)
            db.delete(existing)
            db.flush()
            report.overwritten_responses += 1

        submitted_at = person.submitted_at or utcnow()
        response = FormResponse(
            form_id=form.id, user_id=user.id, submitted_at=submitted_at, updated_at=submitted_at
        )
        db.add(response)
        db.flush()
        by_id = {f.id: f for f in present}
        for field_id, value in row.answers.items():
            f = by_id[field_id]
            db.add(
                FormAnswer(
                    response_id=response.id,
                    field_id=f.id,
                    value=snapshot_answer_value(f, value),
                    question_type=f.question_type,
                    field_key=f.field_key,
                    answered_at=submitted_at,
                )
            )
        write_through_reserved_fields(db, membership, present, row.answers, response)
        result.response_ids.append(response.id)
        report.imported += 1

    db.flush()
    report.problems = sorted(problems, key=lambda p: (p.row or 0, p.skipped is False))
    return result
