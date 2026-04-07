"""add_timezone_to_datetime_columns

Revision ID: ffc1c5a0d62f
Revises: e975e198a8e1
Create Date: 2026-03-30 18:10:32.385166

Changes DateTime columns to use timezone support (TIMESTAMPTZ on PostgreSQL):
  - tournaments: start_date, end_date, created_at, updated_at
  - users: created_at, updated_at
  - memberships: created_at, updated_at
  - sheet_configs: last_synced_at, created_at, updated_at
  - events: created_at, updated_at

Note: SQLite doesn't natively support TIMESTAMPTZ, so migrations on SQLite are 
no-ops. PostgreSQL will properly store timezone info with TIMESTAMPTZ. All backend
code already uses timezone-aware UTC datetimes from app.models.utcnow().
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ffc1c5a0d62f'
down_revision: Union[str, None] = 'e975e198a8e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NOTE: SQLite doesn't support TIMESTAMPTZ natively, so these operations
    # only affect PostgreSQL. The models already specify datetime.timezone=True,
    # and the backend uses timezone-aware UTC datetimes, so this migration
    # ensures the production database properly stores and returns timezone info.
    
    # tournaments
    with op.batch_alter_table('tournaments', schema=None) as batch_op:
        batch_op.alter_column('start_date',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                existing_nullable=True)
        batch_op.alter_column('end_date',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                existing_nullable=True)
        batch_op.alter_column('created_at',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                nullable=False)
        batch_op.alter_column('updated_at',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                nullable=False)

    # users
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('created_at',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                nullable=False)
        batch_op.alter_column('updated_at',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                nullable=False)

    # memberships
    with op.batch_alter_table('memberships', schema=None) as batch_op:
        batch_op.alter_column('created_at',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                nullable=False)
        batch_op.alter_column('updated_at',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                nullable=False)

    # sheet_configs
    with op.batch_alter_table('sheet_configs', schema=None) as batch_op:
        batch_op.alter_column('last_synced_at',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                existing_nullable=True)
        batch_op.alter_column('created_at',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                nullable=False)
        batch_op.alter_column('updated_at',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                nullable=False)

    # events
    with op.batch_alter_table('events', schema=None) as batch_op:
        batch_op.alter_column('created_at',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                nullable=False)
        batch_op.alter_column('updated_at',
                existing_type=sa.DateTime(),
                type_=sa.DateTime(timezone=True),
                nullable=False)


def downgrade() -> None:
    # events
    with op.batch_alter_table('events', schema=None) as batch_op:
        batch_op.alter_column('updated_at',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                nullable=False)
        batch_op.alter_column('created_at',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                nullable=False)

    # sheet_configs
    with op.batch_alter_table('sheet_configs', schema=None) as batch_op:
        batch_op.alter_column('updated_at',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                nullable=False)
        batch_op.alter_column('created_at',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                nullable=False)
        batch_op.alter_column('last_synced_at',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                existing_nullable=True)

    # memberships
    with op.batch_alter_table('memberships', schema=None) as batch_op:
        batch_op.alter_column('updated_at',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                nullable=False)
        batch_op.alter_column('created_at',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                nullable=False)

    # users
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('updated_at',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                nullable=False)
        batch_op.alter_column('created_at',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                nullable=False)

    # tournaments
    with op.batch_alter_table('tournaments', schema=None) as batch_op:
        batch_op.alter_column('updated_at',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                nullable=False)
        batch_op.alter_column('created_at',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                nullable=False)
        batch_op.alter_column('end_date',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                existing_nullable=True)
        batch_op.alter_column('start_date',
                existing_type=sa.DateTime(timezone=True),
                type_=sa.DateTime(),
                existing_nullable=True)
