"""S3: prompt_versions + projects.active_prompt_version_id

Revision ID: e1b5c0d3f7a4
Revises: 80840f9d0efa
Create Date: 2026-04-29 00:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'e1b5c0d3f7a4'
down_revision: Union[str, None] = '80840f9d0efa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'prompt_versions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('project_id', sa.String(length=36), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('prompt_text', sa.Text(), nullable=False),
        sa.Column('summary', sa.String(length=200), nullable=False, server_default=''),
        sa.Column('created_by', sa.String(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'version', name='uq_prompt_versions_project_version'),
    )
    with op.batch_alter_table('prompt_versions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_prompt_versions_project_id'), ['project_id'], unique=False)

    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('active_prompt_version_id', sa.String(length=36), nullable=True),
        )
        batch_op.create_foreign_key(
            'fk_projects_active_prompt_version_id',
            'prompt_versions', ['active_prompt_version_id'], ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_constraint('fk_projects_active_prompt_version_id', type_='foreignkey')
        batch_op.drop_column('active_prompt_version_id')
    with op.batch_alter_table('prompt_versions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_prompt_versions_project_id'))
    op.drop_table('prompt_versions')
