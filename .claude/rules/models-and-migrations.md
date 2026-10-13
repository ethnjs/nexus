---
paths:
  - "backend/app/models/**"
  - "backend/alembic/**"
  - "backend/tests/test_migrations.py"
---

# Models and migrations

## Models

All models are in `app/models/models.py`, in SQLAlchemy 2 typed style:

```python
name: Mapped[str] = mapped_column(String(255))
notes: Mapped[str | None] = mapped_column(Text)
created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
owner: Mapped["User | None"] = relationship("User", back_populates="tournaments", foreign_keys=[owner_id])
tracks: Mapped[list["TournamentTrack"]] = relationship(
    "TournamentTrack", back_populates="tournament", cascade="all, delete-orphan"
)
```

- Always pass the SQL type to `mapped_column`, even when the annotation implies it, for consistency.
- `| None` in the annotation makes a column nullable. Pass `nullable=` only when it must differ from the annotation, such as a `Mapped[Any]` JSON column.
- Datetimes are `DateTime(timezone=True)`. A timestamp the ORM sets (`default=utcnow`) is `Mapped[datetime]`, not nullable; `| None` is for one that's null until something happens, like `revoked_at`.
- Type JSON columns precisely (`dict[str, Any]`, `list[str]`); a bare `dict` has no default mapping.
- Relationship annotations must match the real cardinality. A wrong `list[...]` vs. scalar annotation silently changes `uselist`. A many-to-one is `"X | None"` unless all its foreign key columns are NOT NULL.
- Read a model's comments before adding a field; many record invariants.

## Migrations

- Every model change needs a migration in the same PR: `uv run alembic revision --autogenerate -m "description"`.
- Read and fix the generated file. Autogenerate misses server defaults, some type changes and renames (which it emits as drop + add, losing data). Hand-write data migrations.
- Generated files are run through Ruff by `post_write_hooks` in `alembic.ini`.
- **Never edit, re-parent or delete a revision that has been pushed.** Railway preview environments deploy branches and may already be on it, and a missing revision crashes their startup. Fix forward with a new revision. When `main` and a branch both added revisions, add an `alembic merge` revision rather than rewriting `down_revision`.
- `tests/test_migrations.py` builds a database from the migrations alone and compares it to the models. It's slow, so run it only as a final check, in the background (see root CLAUDE.md). `uv run alembic check` against an up-to-date dev database is a quick local check that the models and migrations agree.
- Production runs `alembic upgrade head` from the `Procfile` before starting; development and preview run it at app startup.
