"""add verification_tokens table

Revision ID: 013b9d385bd2
Revises: b92215c62c84
Create Date: 2026-07-27 06:28:19.504543

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '013b9d385bd2'
down_revision: Union[str, None] = 'b92215c62c84'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('verification_tokens',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('token_hash', sa.String(length=255), nullable=False),
    sa.Column('purpose', sa.String(length=32), nullable=False),
    sa.Column('new_email', sa.String(length=255), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_verification_tokens_id'), 'verification_tokens', ['id'], unique=False)
    op.create_index(op.f('ix_verification_tokens_token_hash'), 'verification_tokens', ['token_hash'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_verification_tokens_token_hash'), table_name='verification_tokens')
    op.drop_index(op.f('ix_verification_tokens_id'), table_name='verification_tokens')
    op.drop_table('verification_tokens')
