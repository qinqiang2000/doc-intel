"""One-off cleanup: collapse duplicate PREDICT rows down to the latest one
per (document_id, processor_key), regardless of prompt_hash.

Use case: prompt was iterated over time, leaving old runs behind. After the
S6 migration the dedup key is (document_id, processor_key, prompt_hash), so
those iterations remain as separate rows. This script soft-deletes everything
but the most recent live PREDICT row per (document_id, processor_key).

The unique index on (document_id, processor_key, prompt_hash) is kept — new
runs still upsert correctly. This is a one-time historical cleanup, not a
schema change.

Usage:
    DATABASE_URL=sqlite+aiosqlite:///./data/doc_intel.db \
        uv run python scripts/dedup_processing_results_per_processor.py [--dry-run]

Always backup the DB first.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Allow `python scripts/...` from the backend dir
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402


async def main(dry_run: bool) -> None:
    select_sql = text("""
        SELECT document_id, processor_key, COUNT(*) AS n
          FROM processing_results
         WHERE source = 'PREDICT' AND deleted_at IS NULL
         GROUP BY document_id, processor_key
        HAVING n > 1
    """)
    pick_obsolete_sql = text("""
        SELECT id FROM processing_results
         WHERE source = 'PREDICT'
           AND deleted_at IS NULL
           AND document_id = :doc
           AND processor_key = :pk
         ORDER BY updated_at DESC, created_at DESC, id DESC
    """)
    soft_delete_sql = text("""
        UPDATE processing_results
           SET deleted_at = CURRENT_TIMESTAMP
         WHERE id = :id
    """)

    async with AsyncSessionLocal() as db:
        groups = (await db.execute(select_sql)).all()
        if not groups:
            print("Nothing to merge — every (document, processor) already has at most one live row.")
            return

        total_kept = 0
        total_deleted = 0
        for doc_id, processor_key, n in groups:
            ids = [r[0] for r in (await db.execute(
                pick_obsolete_sql, {"doc": doc_id, "pk": processor_key}
            )).all()]
            keep_id, *drop_ids = ids
            total_kept += 1
            total_deleted += len(drop_ids)
            print(
                f"doc={doc_id} processor={processor_key}: "
                f"keep {keep_id[:8]}…, drop {len(drop_ids)} older "
                f"({', '.join(d[:8] + '…' for d in drop_ids)})"
            )
            if not dry_run:
                for d in drop_ids:
                    await db.execute(soft_delete_sql, {"id": d})

        if dry_run:
            print(f"\n[dry-run] would keep {total_kept} rows, soft-delete {total_deleted}.")
        else:
            await db.commit()
            print(f"\nDone. Kept {total_kept}, soft-deleted {total_deleted}.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Preview without writing.")
    args = ap.parse_args()
    asyncio.run(main(args.dry_run))
