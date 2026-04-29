"""S5: Project api_published_at/api_disabled_at + api_keys

Revision ID: a3c7d9e2b4f5
Revises: f2a8d4e6c5b1
Create Date: 2026-04-29 00:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'a3c7d9e2b4f5'
down_revision: Union[str, None] = 'f2a8d4e6c5b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('api_published_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('api_disabled_at', sa.DateTime(), nullable=True))

    op.create_table(
        'api_keys',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('project_id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(120), nullable=False, server_default=''),
        sa.Column('key_prefix', sa.String(12), nullable=False),
        sa.Column('key_hash', sa.String(80), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.String(36), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('api_keys', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_api_keys_project_id'), ['project_id'], unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table('api_keys', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_api_keys_project_id'))
    op.drop_table('api_keys')
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_column('api_disabled_at')
        batch_op.drop_column('api_published_at')
