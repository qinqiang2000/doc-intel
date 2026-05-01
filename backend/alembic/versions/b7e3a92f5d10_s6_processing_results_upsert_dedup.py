"""S6: processing_results upsert dedup (drop version, add prompt_hash unique)

Revision ID: b7e3a92f5d10
Revises: a3c7d9e2b4f5
Create Date: 2026-05-01 00:00:00.000000

Schema change:
- Add prompt_hash CHAR(64) — sha256(prompt_used).
- Backfill prompt_hash for all existing rows.
- Soft-delete duplicate PREDICT rows so each
  (document_id, processor_key, prompt_hash) keeps only the most recent.
- Drop the version column (no longer needed; predict is upsert-by-key).
- Add a partial unique index that enforces one live PREDICT row per
  (document_id, processor_key, prompt_hash). MANUAL_EDIT rows are exempt.
"""
from __future__ import annotations

import hashlib
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'b7e3a92f5d10'
down_revision: Union[str, None] = 'a3c7d9e2b4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    with op.batch_alter_table('processing_results', schema=None) as batch_op:
        batch_op.add_column(sa.Column('prompt_hash', sa.String(length=64), nullable=True))

    rows = bind.execute(
        sa.text("SELECT id, prompt_used FROM processing_results")
    ).fetchall()
    for row in rows:
        h = hashlib.sha256((row.prompt_used or "").encode("utf-8")).hexdigest()
        bind.execute(
            sa.text("UPDATE processing_results SET prompt_hash = :h WHERE id = :id"),
            {"h": h, "id": row.id},
        )

    bind.execute(sa.text("""
        UPDATE processing_results
           SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)
         WHERE source = 'PREDICT'
           AND deleted_at IS NULL
           AND id NOT IN (
               SELECT id FROM (
                   SELECT id,
                          ROW_NUMBER() OVER (
                              PARTITION BY document_id, processor_key, prompt_hash
                              ORDER BY created_at DESC, id DESC
                          ) AS rn
                     FROM processing_results
                    WHERE source = 'PREDICT'
                      AND deleted_at IS NULL
               ) t
               WHERE t.rn = 1
           )
    """))

    with op.batch_alter_table('processing_results', schema=None) as batch_op:
        batch_op.alter_column('prompt_hash', existing_type=sa.String(length=64), nullable=False)
        batch_op.drop_column('version')

    op.create_index(
        'uq_processing_results_predict_dedup',
        'processing_results',
        ['document_id', 'processor_key', 'prompt_hash'],
        unique=True,
        sqlite_where=sa.text("source = 'PREDICT' AND deleted_at IS NULL"),
        postgresql_where=sa.text("source = 'PREDICT' AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index('uq_processing_results_predict_dedup', table_name='processing_results')

    with op.batch_alter_table('processing_results', schema=None) as batch_op:
        batch_op.add_column(sa.Column('version', sa.Integer(), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, document_id, created_at FROM processing_results "
        "ORDER BY document_id, created_at ASC, id ASC"
    )).fetchall()
    counter: dict[str, int] = {}
    for row in rows:
        counter[row.document_id] = counter.get(row.document_id, 0) + 1
        bind.execute(
            sa.text("UPDATE processing_results SET version = :v WHERE id = :id"),
            {"v": counter[row.document_id], "id": row.id},
        )

    with op.batch_alter_table('processing_results', schema=None) as batch_op:
        batch_op.alter_column('version', existing_type=sa.Integer(), nullable=False)
        batch_op.drop_column('prompt_hash')
