"""S4: evaluation_runs + evaluation_field_results

Revision ID: f2a8d4e6c5b1
Revises: e1b5c0d3f7a4
Create Date: 2026-04-29 00:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'f2a8d4e6c5b1'
down_revision: Union[str, None] = 'e1b5c0d3f7a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'evaluation_runs',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('project_id', sa.String(36), nullable=False),
        sa.Column('prompt_version_id', sa.String(36), nullable=True),
        sa.Column('name', sa.String(200), nullable=False, server_default=''),
        sa.Column('num_docs', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('num_fields_evaluated', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('num_matches', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('accuracy_avg', sa.Float(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(20), nullable=False, server_default='completed'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(36), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['prompt_version_id'], ['prompt_versions.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('evaluation_runs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_evaluation_runs_project_id'), ['project_id'], unique=False)

    op.create_table(
        'evaluation_field_results',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('run_id', sa.String(36), nullable=False),
        sa.Column('document_id', sa.String(36), nullable=True),
        sa.Column('document_filename', sa.String(255), nullable=False),
        sa.Column('field_name', sa.String(200), nullable=False),
        sa.Column('predicted_value', sa.Text(), nullable=True),
        sa.Column('expected_value', sa.Text(), nullable=True),
        sa.Column('match_status', sa.String(30), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['run_id'], ['evaluation_runs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('evaluation_field_results', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_evaluation_field_results_run_id'), ['run_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('evaluation_field_results', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_evaluation_field_results_run_id'))
    op.drop_table('evaluation_field_results')
    with op.batch_alter_table('evaluation_runs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_evaluation_runs_project_id'))
    op.drop_table('evaluation_runs')
