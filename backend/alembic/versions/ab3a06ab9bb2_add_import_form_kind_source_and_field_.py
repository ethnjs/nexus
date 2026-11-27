"""add import form kind, source and field mapping

Revision ID: ab3a06ab9bb2
Revises: c5d1e9a7f3b2
Create Date: 2026-11-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ab3a06ab9bb2"
down_revision: str | Sequence[str] | None = "c5d1e9a7f3b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("form_fields", sa.Column("import_mapping", sa.JSON(), nullable=True))
    op.add_column(
        "forms", sa.Column("kind", sa.String(length=16), server_default="standard", nullable=False)
    )
    op.add_column("forms", sa.Column("import_source", sa.JSON(), nullable=True))
    op.create_check_constraint(
        "ck_form_import_tournament", "forms", "kind = 'standard' OR owner_type = 'tournament'"
    )


def downgrade() -> None:
    op.drop_constraint("ck_form_import_tournament", "forms", type_="check")
    op.drop_column("forms", "import_source")
    op.drop_column("forms", "kind")
    op.drop_column("form_fields", "import_mapping")
