"""reset declined age disclosures to unanswered

Revision ID: fd68532fea68
Revises: 63863039d4f1
Create Date: 2026-10-15 23:26:22.600974

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fd68532fea68"
down_revision: str | Sequence[str] | None = "63863039d4f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Declining now deletes the membership, so a stored "declined" has no meaning.
# Clearing it puts those members back in front of the consent prompt.
def upgrade() -> None:
    op.execute(
        "UPDATE tournament_memberships "
        "SET age_disclosure = NULL, age_disclosure_at = NULL "
        "WHERE age_disclosure = 'declined'"
    )


def downgrade() -> None:
    pass
