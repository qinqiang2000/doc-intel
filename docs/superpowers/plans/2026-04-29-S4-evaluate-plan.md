# S4 — Evaluate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **TDD is mandatory** — every code unit must have its failing test written first, observed RED, then GREEN.

**Goal:** Compare each project document's predicted `structured_data` against its current annotations, persist a per-run accuracy summary + per-field results, and let users download a 2-sheet Excel for sharing/audit.

**Architecture:** Two new tables (`evaluation_runs` + `evaluation_field_results`) with one alembic migration. Synchronous compute service reads cached `ProcessingResult.structured_data` and current `Annotation` rows, runs `score_field` per (doc, field) pair, persists results in one transaction. 5 REST endpoints (POST/GET list/GET detail/DELETE/Excel). Frontend gets predict-store actions + a new `EvaluatePage` route + a `📊 Evaluate` button on `ProjectDocumentsPage`.

**Tech Stack:** FastAPI async + SQLAlchemy 2.x + alembic + openpyxl (already in pyproject.toml ≥3.1.0) + Vite 8 + React 19 + Zustand + react-router 6.

**Spec:** `docs/superpowers/specs/2026-04-29-S4-evaluate-design.md`
**LS-features cross-spec:** `docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md`
**Repo root:** `/Users/qinqiang02/colab/codespace/ai/doc-intel/`
**Baseline:** tag `s3-complete` (148 backend + 224 frontend = 372 tests).
**Target:** ≥166 backend (+18) + ≥236 frontend (+12) = ≥402 tests.

**Alembic chain:** S0 `d9e2957d1511` → S1 `cc4a010e73f1` → S2a `80840f9d0efa` → S3 `e1b5c0d3f7a4` → **S4 `f2a8d4e6c5b1`** (this plan).

**openpyxl** is already a backend dependency (verified in `backend/pyproject.toml:36 → "openpyxl>=3.1.0"`). No `uv add` needed.

---

## Phase A — Backend models + migration (T1)

### Task 1: EvaluationRun + EvaluationFieldResult models + migration + 4 tests

**Files:**
- Create: `backend/app/models/evaluation_run.py`
- Create: `backend/app/models/evaluation_field_result.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/f2a8d4e6c5b1_s4_evaluations.py`
- Create: `backend/tests/test_evaluation_models.py` (4 tests)

- [ ] **Step 1: Write failing tests (RED)**

Create `backend/tests/test_evaluation_models.py`:

```python
"""S4/T1: EvaluationRun + EvaluationFieldResult model tests."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select


@pytest.mark.asyncio
async def test_evaluation_run_basic_insert(db_session, seed_project, seed_user):
    from app.models.evaluation_run import EvaluationRun

    run = EvaluationRun(
        project_id=seed_project.id,
        prompt_version_id=None,
        name="first run",
        num_docs=2,
        num_fields_evaluated=10,
        num_matches=8,
        accuracy_avg=0.8,
        status="completed",
        created_by=seed_user.id,
    )
    db_session.add(run)
    await db_session.commit()
    out = (await db_session.execute(select(EvaluationRun))).scalar_one()
    assert out.name == "first run"
    assert out.accuracy_avg == 0.8
    assert out.status == "completed"
    assert out.deleted_at is None


@pytest.mark.asyncio
async def test_evaluation_field_result_basic_insert(db_session, seed_project, seed_user):
    from app.models.evaluation_run import EvaluationRun
    from app.models.evaluation_field_result import EvaluationFieldResult

    run = EvaluationRun(
        project_id=seed_project.id, name="r", num_docs=1,
        num_fields_evaluated=1, num_matches=1, accuracy_avg=1.0,
        status="completed", created_by=seed_user.id,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)

    fr = EvaluationFieldResult(
        run_id=run.id, document_id=None, document_filename="x.pdf",
        field_name="invoice_no", predicted_value="INV-1",
        expected_value="INV-1", match_status="exact",
    )
    db_session.add(fr)
    await db_session.commit()
    out = (await db_session.execute(select(EvaluationFieldResult))).scalar_one()
    assert out.match_status == "exact"
    assert out.document_filename == "x.pdf"


@pytest.mark.asyncio
async def test_run_cascade_delete_removes_field_results(db_session, seed_project, seed_user):
    from app.models.evaluation_run import EvaluationRun
    from app.models.evaluation_field_result import EvaluationFieldResult

    run = EvaluationRun(
        project_id=seed_project.id, name="r", num_docs=1,
        num_fields_evaluated=1, num_matches=1, accuracy_avg=1.0,
        status="completed", created_by=seed_user.id,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)

    db_session.add(EvaluationFieldResult(
        run_id=run.id, document_filename="x.pdf",
        field_name="f", predicted_value="a", expected_value="a",
        match_status="exact",
    ))
    await db_session.commit()

    await db_session.delete(run)
    await db_session.commit()

    fr_rows = (await db_session.execute(select(EvaluationFieldResult))).scalars().all()
    assert fr_rows == []


@pytest.mark.asyncio
async def test_evaluation_run_soft_delete_field_set(db_session, seed_project, seed_user):
    from app.models.evaluation_run import EvaluationRun

    run = EvaluationRun(
        project_id=seed_project.id, name="r", num_docs=0,
        num_fields_evaluated=0, num_matches=0, accuracy_avg=0,
        status="completed", created_by=seed_user.id,
    )
    db_session.add(run)
    await db_session.commit()

    run.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    out = (await db_session.execute(select(EvaluationRun))).scalar_one()
    assert out.deleted_at is not None
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_evaluation_models.py -v 2>&1 | tail -15
```

Expected: ImportError for `app.models.evaluation_run`. Capture verbatim.

- [ ] **Step 3: Create alembic migration**

Create `backend/alembic/versions/f2a8d4e6c5b1_s4_evaluations.py`:

```python
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
```

- [ ] **Step 4: Add ORM models**

Create `backend/app/models/evaluation_run.py`:

```python
"""S4: EvaluationRun ORM model — per-run snapshot of a project evaluation."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class EvaluationRun(Base):
    __tablename__ = "evaluation_runs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4()),
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    prompt_version_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("prompt_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    num_docs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    num_fields_evaluated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    num_matches: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    accuracy_avg: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="completed")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

Create `backend/app/models/evaluation_field_result.py`:

```python
"""S4: EvaluationFieldResult ORM model — one row per (doc, field) compared."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class EvaluationFieldResult(Base):
    __tablename__ = "evaluation_field_results"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4()),
    )
    run_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("evaluation_runs.id", ondelete="CASCADE"),
        index=True, nullable=False,
    )
    document_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    document_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    field_name: Mapped[str] = mapped_column(String(200), nullable=False)
    predicted_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    match_status: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False,
    )
```

Modify `backend/app/models/__init__.py` to register both. Add (alongside existing imports):

```python
from app.models.evaluation_run import EvaluationRun  # noqa: F401
from app.models.evaluation_field_result import EvaluationFieldResult  # noqa: F401
```

If the conftest's `db_engine` fixture explicitly imports models for `Base.metadata.create_all`, also add the new modules there. Check:

```bash
grep -n "from app.models" backend/tests/conftest.py | head
```

If imports are listed there for `create_all`, append `from app.models import evaluation_run, evaluation_field_result`.

- [ ] **Step 5: Apply migration locally**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
rm -f data/doc_intel.db data/doc_intel.db-shm data/doc_intel.db-wal
uv run alembic upgrade head 2>&1 | tail -5
```

Expected: log line `Running upgrade e1b5c0d3f7a4 -> f2a8d4e6c5b1, S4: evaluation_runs + evaluation_field_results`.

- [ ] **Step 6: Run (GREEN)**

```bash
uv run pytest tests/test_evaluation_models.py -v 2>&1 | tail -10
```
Expected: 4 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 152 passed (was 148 → +4).

- [ ] **Step 7: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add backend/alembic/versions/f2a8d4e6c5b1_s4_evaluations.py \
        backend/app/models/evaluation_run.py \
        backend/app/models/evaluation_field_result.py \
        backend/app/models/__init__.py \
        backend/tests/test_evaluation_models.py \
        backend/tests/conftest.py  # only if you modified it
git commit -m "S4/Task 1 (TDD): EvaluationRun + EvaluationFieldResult models + migration + 4 tests

- alembic f2a8d4e6c5b1 down_rev e1b5c0d3f7a4
- evaluation_runs: project (CASCADE) + prompt_version (SET NULL) + numeric
  totals + status + soft-delete
- evaluation_field_results: run (CASCADE) + document (SET NULL) + filename
  snapshot + per-field match_status

Backend: 148 -> 152."
```

---

## Phase B — Scoring algorithm (T2)

### Task 2: `engine/scoring.py` score_field + 5 tests

**Files:**
- Create: `backend/app/engine/scoring.py`
- Create: `backend/tests/test_scoring.py` (5 tests)

- [ ] **Step 1: Failing tests (RED)**

Create `backend/tests/test_scoring.py`:

```python
"""S4/T2: scoring.score_field tests."""
from __future__ import annotations

import pytest


def test_score_field_exact_string():
    from app.engine.scoring import score_field
    assert score_field("INV-001", "INV-001") == "exact"


def test_score_field_fuzzy_case_insensitive():
    from app.engine.scoring import score_field
    assert score_field("HELLO", "hello") == "fuzzy"
    assert score_field("hello world", "Hello World") == "fuzzy"


def test_score_field_mismatch_string():
    from app.engine.scoring import score_field
    assert score_field("a", "b") == "mismatch"


def test_score_field_missing_pred_and_expected():
    from app.engine.scoring import score_field
    assert score_field(None, "x") == "missing_pred"
    assert score_field("x", None) == "missing_expected"
    assert score_field(None, None) == "missing_expected"


def test_score_field_number_and_date_and_nested():
    from app.engine.scoring import score_field
    # number: tolerant
    assert score_field("100", "100.0", field_type="number") == "exact"
    assert score_field("100", "200", field_type="number") == "mismatch"
    # date: dateutil parse
    assert score_field("2024-11-27", "2024/11/27", field_type="date") == "exact"
    # nested object: JSON-stringified compare with sort_keys
    assert score_field({"b": 2, "a": 1}, {"a": 1, "b": 2}) == "exact"
    # array: same
    assert score_field([{"q": 1}], [{"q": 1}]) == "exact"
    assert score_field([{"q": 1}], [{"q": 2}]) == "mismatch"
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_scoring.py -v 2>&1 | tail -15
```

Expected: ImportError for `app.engine.scoring`. Capture verbatim.

- [ ] **Step 3: Implement**

Create `backend/app/engine/scoring.py`:

```python
"""S4: pure score_field helper for evaluation comparisons."""
from __future__ import annotations

import json
from typing import Any, Literal

MatchStatus = Literal[
    "exact", "fuzzy", "mismatch", "missing_pred", "missing_expected",
]


def _normalize(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        return json.dumps(v, sort_keys=True, ensure_ascii=False)
    return str(v)


def score_field(
    predicted: Any, expected: Any, field_type: str = "string",
) -> MatchStatus:
    """Compare predicted vs expected value; return match status string.

    See spec §6 for the algorithm spec.
    """
    if predicted is None and expected is None:
        # Both empty: classify as no-signal. Caller excludes from accuracy denom.
        return "missing_expected"
    if predicted is None:
        return "missing_pred"
    if expected is None:
        return "missing_expected"

    p = _normalize(predicted)
    e = _normalize(expected)
    assert p is not None and e is not None  # for type-narrowing

    p_str = p.strip()
    e_str = e.strip()

    if field_type == "number":
        try:
            if abs(float(p_str) - float(e_str)) < 1e-6:
                return "exact"
            return "mismatch"
        except ValueError:
            pass

    if field_type == "date":
        try:
            from dateutil.parser import parse as _dp
            if _dp(p_str) == _dp(e_str):
                return "exact"
            return "mismatch"
        except Exception:
            pass

    if p_str == e_str:
        return "exact"
    if p_str.lower() == e_str.lower():
        return "fuzzy"
    return "mismatch"
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_scoring.py -v 2>&1 | tail -10
```
Expected: 5 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 157 passed (was 152 → +5).

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/scoring.py backend/tests/test_scoring.py
git commit -m "S4/Task 2 (TDD): engine.scoring.score_field + 5 tests

Pure helper:
- exact / fuzzy (case-insensitive) / mismatch for strings
- number: float tolerance 1e-6
- date: dateutil.parser.parse normalized compare
- nested objects/arrays: JSON-stringified with sort_keys
- missing_pred / missing_expected for None on either side

Backend: 152 -> 157."
```

---

## Phase C — Evaluation service (T3)

### Task 3: evaluation_service compute + 4 tests

**Files:**
- Create: `backend/app/services/evaluation_service.py`
- Create: `backend/tests/test_evaluation_service.py` (4 tests)

The service:
- enumerates project's non-deleted documents
- for each: loads latest ProcessingResult and current annotations
- compares top-level structured_data keys vs annotations
- inserts EvaluationRun + EvaluationFieldResult rows in one transaction
- returns the EvaluationRun

- [ ] **Step 1: Failing tests (RED)**

Create `backend/tests/test_evaluation_service.py`:

```python
"""S4/T3: evaluation_service tests."""
from __future__ import annotations

import pytest
from sqlalchemy import select


async def _make_doc_with_predict_and_anns(db, project, user, filename, structured_data, annotations):
    """Helper: create a Document + ProcessingResult + Annotations for tests."""
    from app.models.document import Document
    from app.models.processing_result import ProcessingResult
    from app.models.annotation import Annotation

    doc = Document(
        project_id=project.id, filename=filename, file_path=filename,
        file_size=1, mime_type="application/pdf", uploaded_by=user.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    pr = ProcessingResult(
        document_id=doc.id, version=1, structured_data=structured_data,
        inferred_schema=None, prompt_used="p", processor_key="mock|m",
        source="predict", created_by=user.id,
    )
    db.add(pr)
    for fname, fval, ftype in annotations:
        db.add(Annotation(
            document_id=doc.id, field_name=fname, field_value=fval,
            field_type=ftype or "string", bounding_box=None,
            source="user", confidence=None, is_ground_truth=False,
            created_by=user.id, updated_by_user_id=user.id,
        ))
    await db.commit()
    return doc


@pytest.mark.asyncio
async def test_run_evaluation_basic_match(db_session, seed_project, seed_user):
    from app.services.evaluation_service import run_evaluation
    await _make_doc_with_predict_and_anns(
        db_session, seed_project, seed_user, "a.pdf",
        {"invoice_number": "INV-1", "total": 100},
        [("invoice_number", "INV-1", "string"), ("total", "100", "number")],
    )

    run = await run_evaluation(
        db_session, project_id=seed_project.id, user=seed_user, name="t",
    )
    assert run.status == "completed"
    assert run.num_docs == 1
    assert run.num_fields_evaluated == 2
    assert run.num_matches == 2
    assert run.accuracy_avg == 1.0


@pytest.mark.asyncio
async def test_run_evaluation_mismatch_lowers_accuracy(db_session, seed_project, seed_user):
    from app.services.evaluation_service import run_evaluation
    await _make_doc_with_predict_and_anns(
        db_session, seed_project, seed_user, "a.pdf",
        {"invoice_number": "INV-WRONG", "total": 100},
        [("invoice_number", "INV-1", "string"), ("total", "100", "number")],
    )

    run = await run_evaluation(
        db_session, project_id=seed_project.id, user=seed_user, name="t",
    )
    assert run.num_fields_evaluated == 2
    assert run.num_matches == 1
    assert run.accuracy_avg == 0.5


@pytest.mark.asyncio
async def test_run_evaluation_no_data_project(db_session, seed_project, seed_user):
    """Project with no predicted docs → run completes with zeros."""
    from app.services.evaluation_service import run_evaluation
    run = await run_evaluation(
        db_session, project_id=seed_project.id, user=seed_user, name="empty",
    )
    assert run.status == "completed"
    assert run.num_docs == 0
    assert run.num_fields_evaluated == 0
    assert run.num_matches == 0
    assert run.accuracy_avg == 0.0


@pytest.mark.asyncio
async def test_run_evaluation_persists_field_results(db_session, seed_project, seed_user):
    from app.services.evaluation_service import run_evaluation
    from app.models.evaluation_field_result import EvaluationFieldResult

    await _make_doc_with_predict_and_anns(
        db_session, seed_project, seed_user, "a.pdf",
        {"invoice_number": "INV-1"},
        [("invoice_number", "INV-1", "string")],
    )
    run = await run_evaluation(
        db_session, project_id=seed_project.id, user=seed_user, name="t",
    )
    rows = (await db_session.execute(
        select(EvaluationFieldResult).where(EvaluationFieldResult.run_id == run.id)
    )).scalars().all()
    assert len(rows) == 1
    assert rows[0].field_name == "invoice_number"
    assert rows[0].match_status == "exact"
    assert rows[0].document_filename == "a.pdf"
```

- [ ] **Step 2: Run (RED)**

```bash
uv run pytest tests/test_evaluation_service.py -v 2>&1 | tail -15
```

Expected: ImportError for `app.services.evaluation_service`.

- [ ] **Step 3: Implement**

Create `backend/app/services/evaluation_service.py`:

```python
"""S4: evaluation service — synchronously compute per-field comparisons."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.engine.scoring import score_field
from app.models.annotation import Annotation
from app.models.document import Document
from app.models.evaluation_field_result import EvaluationFieldResult
from app.models.evaluation_run import EvaluationRun
from app.models.processing_result import ProcessingResult
from app.models.project import Project
from app.models.user import User

logger = logging.getLogger(__name__)


def _stringify(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        import json
        return json.dumps(value, sort_keys=True, ensure_ascii=False)
    return str(value)


async def run_evaluation(
    db: AsyncSession,
    *,
    project_id: str,
    user: User,
    name: str = "",
) -> EvaluationRun:
    """Compute per-field match status for all eligible docs in project; persist."""
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None),
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")

    docs_stmt = select(Document).where(
        Document.project_id == project_id, Document.deleted_at.is_(None),
    )
    docs = (await db.execute(docs_stmt)).scalars().all()

    field_results: list[EvaluationFieldResult] = []
    num_docs_evaluated = 0
    num_fields = 0
    num_matches = 0

    try:
        for doc in docs:
            pr_stmt = (
                select(ProcessingResult)
                .where(ProcessingResult.document_id == doc.id)
                .order_by(ProcessingResult.version.desc())
                .limit(1)
            )
            pr = (await db.execute(pr_stmt)).scalar_one_or_none()
            if pr is None:
                continue  # skip un-predicted docs

            ann_stmt = select(Annotation).where(Annotation.document_id == doc.id)
            anns = (await db.execute(ann_stmt)).scalars().all()
            expected_by_field: dict[str, Annotation] = {}
            # Latest write wins by updated_at
            for a in sorted(anns, key=lambda x: x.updated_at):
                expected_by_field[a.field_name] = a

            sd: dict = pr.structured_data or {}
            predicted_by_field: dict[str, Any] = dict(sd) if isinstance(sd, dict) else {}

            all_fields = set(predicted_by_field) | set(expected_by_field)
            doc_evaluated_any = False

            for f in sorted(all_fields):
                predicted = predicted_by_field.get(f)
                ann = expected_by_field.get(f)
                expected = ann.field_value if ann else None
                ftype = (ann.field_type if ann else "string") or "string"
                status = score_field(predicted, expected, ftype)
                if status != "missing_expected" or expected is not None:
                    # missing_expected with both None means no-signal; still record but exclude denom
                    pass
                fr = EvaluationFieldResult(
                    run_id="",  # set after run insert
                    document_id=doc.id,
                    document_filename=doc.filename,
                    field_name=f,
                    predicted_value=_stringify(predicted),
                    expected_value=_stringify(expected),
                    match_status=status,
                )
                field_results.append(fr)

                # Accuracy denom: exclude both-null rows
                if predicted is None and expected is None:
                    continue
                num_fields += 1
                if status in ("exact", "fuzzy"):
                    num_matches += 1
                doc_evaluated_any = True

            if doc_evaluated_any:
                num_docs_evaluated += 1

        accuracy = (num_matches / num_fields) if num_fields else 0.0

        run = EvaluationRun(
            project_id=project_id,
            prompt_version_id=project.active_prompt_version_id,
            name=name,
            num_docs=num_docs_evaluated,
            num_fields_evaluated=num_fields,
            num_matches=num_matches,
            accuracy_avg=accuracy,
            status="completed",
            created_by=user.id,
        )
        db.add(run)
        await db.flush()
        for fr in field_results:
            fr.run_id = run.id
            db.add(fr)
        await db.commit()
        await db.refresh(run)
        return run

    except Exception as e:
        logger.exception("evaluation failed for project %s", project_id)
        await db.rollback()
        run = EvaluationRun(
            project_id=project_id,
            prompt_version_id=project.active_prompt_version_id,
            name=name,
            num_docs=0, num_fields_evaluated=0, num_matches=0,
            accuracy_avg=0.0,
            status="failed",
            error_message=str(e),
            created_by=user.id,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        return run
```

- [ ] **Step 4: Run (GREEN)**

```bash
uv run pytest tests/test_evaluation_service.py -v 2>&1 | tail -15
```
Expected: 4 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 161 passed (was 157 → +4).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/evaluation_service.py backend/tests/test_evaluation_service.py
git commit -m "S4/Task 3 (TDD): evaluation_service.run_evaluation + 4 tests

For each doc with ProcessingResult: enumerate union of structured_data top
keys + annotation field_names; score_field per pair; persist
EvaluationRun + EvaluationFieldResult rows in one tx.

Accuracy denominator excludes rows where both predicted and expected are
None (no signal). missing_pred is in denominator (counts as miss).

Failure path: catch+rollback then insert a status='failed' row with
error_message so run history is never lost.

Backend: 157 -> 161."
```

---

## Phase D — REST endpoints + Excel (T4 + T5)

### Task 4: evaluations router (POST + GET list + GET detail + DELETE) + 4 tests

**Files:**
- Create: `backend/app/api/v1/evaluations.py`
- Create: `backend/app/schemas/evaluation.py`
- Modify: `backend/app/api/v1/router.py`
- Create: `backend/tests/test_evaluations_api.py` (4 tests)

- [ ] **Step 1: Failing tests (RED)**

Create `backend/tests/test_evaluations_api.py`:

```python
"""S4/T4: evaluations router tests."""
from __future__ import annotations

import io
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_with_doc(client, token: str):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-eval"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-eval", "template_key": "custom"},
    )
    pid = r2.json()["id"]
    r3 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
    )
    did = r3.json()["id"]
    # predict via mock so a ProcessingResult exists
    await client.post(
        f"/api/v1/projects/{pid}/documents/{did}/predict", headers=_auth(token),
        json={"processor_key_override": "mock"},
    )
    return pid, did


@pytest.mark.asyncio
async def test_post_evaluation_returns_201_with_run_summary(client, registered_user):
    _, token = registered_user
    pid, _ = await _setup_with_doc(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token),
        json={"name": "first run"},
    )
    assert r.status_code == 201, r.text
    run = r.json()
    assert run["name"] == "first run"
    assert run["status"] == "completed"
    assert "accuracy_avg" in run


@pytest.mark.asyncio
async def test_get_evaluations_list_excludes_soft_deleted(client, registered_user):
    _, token = registered_user
    pid, _ = await _setup_with_doc(client, token)
    r1 = await client.post(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token),
        json={"name": "r1"},
    )
    r2 = await client.post(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token),
        json={"name": "r2"},
    )
    rid1 = r1.json()["id"]
    # soft-delete r1
    await client.delete(f"/api/v1/evaluations/{rid1}", headers=_auth(token))

    r = await client.get(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token),
    )
    assert r.status_code == 200
    items = r.json()
    names = [x["name"] for x in items]
    assert "r2" in names
    assert "r1" not in names


@pytest.mark.asyncio
async def test_get_evaluation_detail_returns_run_and_fields(client, registered_user):
    _, token = registered_user
    pid, _ = await _setup_with_doc(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token), json={},
    )
    rid = r.json()["id"]
    r2 = await client.get(
        f"/api/v1/evaluations/{rid}", headers=_auth(token),
    )
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["run"]["id"] == rid
    assert isinstance(body["fields"], list)


@pytest.mark.asyncio
async def test_delete_evaluation_returns_204(client, registered_user):
    _, token = registered_user
    pid, _ = await _setup_with_doc(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token), json={},
    )
    rid = r.json()["id"]
    r2 = await client.delete(
        f"/api/v1/evaluations/{rid}", headers=_auth(token),
    )
    assert r2.status_code == 204, r2.text
    # Subsequent detail GET should 404
    r3 = await client.get(
        f"/api/v1/evaluations/{rid}", headers=_auth(token),
    )
    assert r3.status_code == 404
```

- [ ] **Step 2: Run (RED)**

```bash
uv run pytest tests/test_evaluations_api.py -v 2>&1 | tail -15
```
Expected: 404 (route doesn't exist).

- [ ] **Step 3: Implement schemas**

Create `backend/app/schemas/evaluation.py`:

```python
"""S4: Evaluation schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class EvaluationRunCreate(BaseModel):
    name: str = Field(default="", max_length=200)


class EvaluationRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    prompt_version_id: str | None
    name: str
    num_docs: int
    num_fields_evaluated: int
    num_matches: int
    accuracy_avg: float
    status: str
    error_message: str | None
    created_by: str
    created_at: datetime


class EvaluationFieldResultRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    run_id: str
    document_id: str | None
    document_filename: str
    field_name: str
    predicted_value: str | None
    expected_value: str | None
    match_status: str
    created_at: datetime


class EvaluationDetailRead(BaseModel):
    run: EvaluationRunRead
    fields: list[EvaluationFieldResultRead]
```

- [ ] **Step 4: Implement router**

Create `backend/app/api/v1/evaluations.py`:

```python
"""Evaluations router under /api/v1."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.evaluation_field_result import EvaluationFieldResult
from app.models.evaluation_run import EvaluationRun
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.schemas.evaluation import (
    EvaluationDetailRead,
    EvaluationFieldResultRead,
    EvaluationRunCreate,
    EvaluationRunRead,
)
from app.services import evaluation_service

# Project-scoped (POST + list)
project_router = APIRouter(prefix="/projects/{project_id}", tags=["evaluations"])

# Run-scoped (detail, delete, excel)
run_router = APIRouter(prefix="/evaluations", tags=["evaluations"])


async def _check_project_access(db, project_id: str, user_id: str) -> Project:
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None),
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")
    mem_stmt = select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == project.workspace_id,
        WorkspaceMember.user_id == user_id,
    )
    if (await db.execute(mem_stmt)).scalar_one_or_none() is None:
        raise AppError(403, "forbidden", "You are not a member of this workspace.")
    return project


async def _load_run_with_access(db, run_id: str, user_id: str) -> EvaluationRun:
    stmt = select(EvaluationRun).where(
        EvaluationRun.id == run_id,
        EvaluationRun.deleted_at.is_(None),
    )
    run = (await db.execute(stmt)).scalar_one_or_none()
    if run is None:
        raise AppError(404, "evaluation_not_found", "Evaluation not found.")
    await _check_project_access(db, run.project_id, user_id)
    return run


@project_router.post(
    "/evaluations",
    response_model=EvaluationRunRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_evaluation(
    project_id: str, body: EvaluationRunCreate,
    db: DbSession, user: CurrentUser,
) -> EvaluationRunRead:
    await _check_project_access(db, project_id, user.id)
    run = await evaluation_service.run_evaluation(
        db, project_id=project_id, user=user, name=body.name,
    )
    return EvaluationRunRead.model_validate(run)


@project_router.get("/evaluations", response_model=list[EvaluationRunRead])
async def list_evaluations(
    project_id: str, db: DbSession, user: CurrentUser,
) -> list[EvaluationRunRead]:
    await _check_project_access(db, project_id, user.id)
    stmt = (
        select(EvaluationRun)
        .where(
            EvaluationRun.project_id == project_id,
            EvaluationRun.deleted_at.is_(None),
        )
        .order_by(EvaluationRun.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [EvaluationRunRead.model_validate(r) for r in rows]


@run_router.get("/{run_id}", response_model=EvaluationDetailRead)
async def get_evaluation_detail(
    run_id: str, db: DbSession, user: CurrentUser,
) -> EvaluationDetailRead:
    run = await _load_run_with_access(db, run_id, user.id)
    fields_stmt = (
        select(EvaluationFieldResult)
        .where(EvaluationFieldResult.run_id == run.id)
        .order_by(
            EvaluationFieldResult.document_filename,
            EvaluationFieldResult.field_name,
        )
    )
    fields = (await db.execute(fields_stmt)).scalars().all()
    return EvaluationDetailRead(
        run=EvaluationRunRead.model_validate(run),
        fields=[EvaluationFieldResultRead.model_validate(f) for f in fields],
    )


@run_router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_evaluation(
    run_id: str, db: DbSession, user: CurrentUser,
) -> None:
    run = await _load_run_with_access(db, run_id, user.id)
    run.deleted_at = datetime.now(timezone.utc)
    await db.commit()
```

Modify `backend/app/api/v1/router.py`. Add:

```python
from app.api.v1 import evaluations as evaluations_module
```

And register both sub-routers (after the existing include_router calls):

```python
v1_router.include_router(evaluations_module.project_router)
v1_router.include_router(evaluations_module.run_router)
```

- [ ] **Step 5: Run (GREEN)**

```bash
uv run pytest tests/test_evaluations_api.py -v 2>&1 | tail -15
```
Expected: 4 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 165 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/evaluations.py \
        backend/app/api/v1/router.py \
        backend/app/schemas/evaluation.py \
        backend/tests/test_evaluations_api.py
git commit -m "S4/Task 4 (TDD): evaluations router (POST + GET list + GET detail + DELETE) + 4 tests

- POST   /api/v1/projects/{pid}/evaluations  → 201 EvaluationRunRead
- GET    /api/v1/projects/{pid}/evaluations  → list DESC, exclude soft-del
- GET    /api/v1/evaluations/{rid}           → {run, fields[]}
- DELETE /api/v1/evaluations/{rid}           → 204 soft-delete

Backend: 161 -> 165."
```

---

### Task 5: Excel route via openpyxl + 1 test

**Files:**
- Create: `backend/app/services/evaluation_excel.py`
- Modify: `backend/app/api/v1/evaluations.py` (add route)
- Modify: `backend/tests/test_evaluations_api.py` (append 1 test)

- [ ] **Step 1: Append failing test (RED)**

In `backend/tests/test_evaluations_api.py`, append:

```python
@pytest.mark.asyncio
async def test_get_evaluation_excel_returns_xlsx_with_two_sheets(client, registered_user):
    from openpyxl import load_workbook
    import io as _io
    _, token = registered_user
    pid, _ = await _setup_with_doc(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token), json={},
    )
    rid = r.json()["id"]

    r2 = await client.get(
        f"/api/v1/evaluations/{rid}/excel", headers=_auth(token),
    )
    assert r2.status_code == 200, r2.text
    assert r2.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    # Inspect via openpyxl
    wb = load_workbook(_io.BytesIO(r2.content))
    assert "Summary" in wb.sheetnames
    assert "Detail" in wb.sheetnames
    # Header row in Summary
    summary = wb["Summary"]
    headers = [cell.value for cell in next(summary.iter_rows(min_row=1, max_row=1))]
    assert "field_name" in headers
    assert "accuracy" in headers
```

- [ ] **Step 2: Run (RED)**

```bash
uv run pytest tests/test_evaluations_api.py::test_get_evaluation_excel_returns_xlsx_with_two_sheets -v 2>&1 | tail -10
```
Expected: 404 (no route yet).

- [ ] **Step 3: Implement Excel renderer**

Create `backend/app/services/evaluation_excel.py`:

```python
"""S4: Excel rendering for an evaluation run."""
from __future__ import annotations

import io
from collections import defaultdict
from typing import Iterable

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from app.models.evaluation_field_result import EvaluationFieldResult
from app.models.evaluation_run import EvaluationRun


_FILL = {
    "exact": PatternFill(fill_type="solid", fgColor="C6EFCE"),
    "fuzzy": PatternFill(fill_type="solid", fgColor="FFEB9C"),
    "mismatch": PatternFill(fill_type="solid", fgColor="FFC7CE"),
    "missing_pred": PatternFill(fill_type="solid", fgColor="D9D9D9"),
    "missing_expected": PatternFill(fill_type="none"),
}


def render_run_xlsx(run: EvaluationRun, fields: Iterable[EvaluationFieldResult]) -> bytes:
    fields = list(fields)
    wb = Workbook()
    summary = wb.active
    summary.title = "Summary"
    detail = wb.create_sheet("Detail")

    bold = Font(bold=True)

    # ===== Summary sheet =====
    summary.append([
        "field_name", "exact", "fuzzy", "mismatch",
        "missing_pred", "missing_expected", "accuracy",
    ])
    for cell in summary[1]:
        cell.font = bold

    counts: dict[str, dict[str, int]] = defaultdict(lambda: {
        "exact": 0, "fuzzy": 0, "mismatch": 0,
        "missing_pred": 0, "missing_expected": 0,
    })
    for fr in fields:
        counts[fr.field_name][fr.match_status] += 1

    total = {"exact": 0, "fuzzy": 0, "mismatch": 0, "missing_pred": 0, "missing_expected": 0}
    for field_name in sorted(counts):
        c = counts[field_name]
        denom = c["exact"] + c["fuzzy"] + c["mismatch"] + c["missing_pred"]
        accuracy = (c["exact"] + c["fuzzy"]) / denom if denom else 0.0
        summary.append([
            field_name, c["exact"], c["fuzzy"], c["mismatch"],
            c["missing_pred"], c["missing_expected"], round(accuracy, 4),
        ])
        for k in total:
            total[k] += c[k]

    total_denom = total["exact"] + total["fuzzy"] + total["mismatch"] + total["missing_pred"]
    total_acc = (total["exact"] + total["fuzzy"]) / total_denom if total_denom else 0.0
    total_row = summary.max_row + 1
    summary.append([
        "TOTAL", total["exact"], total["fuzzy"], total["mismatch"],
        total["missing_pred"], total["missing_expected"], round(total_acc, 4),
    ])
    for cell in summary[total_row]:
        cell.font = bold

    # Column widths
    summary.column_dimensions["A"].width = 30
    for col in "BCDEFG":
        summary.column_dimensions[col].width = 14

    # ===== Detail sheet =====
    detail.append(["filename", "field_name", "predicted", "expected", "status"])
    for cell in detail[1]:
        cell.font = bold
    for fr in sorted(fields, key=lambda x: (x.document_filename, x.field_name)):
        detail.append([
            fr.document_filename, fr.field_name,
            fr.predicted_value or "",
            fr.expected_value or "",
            fr.match_status,
        ])
        status_cell = detail.cell(row=detail.max_row, column=5)
        fill = _FILL.get(fr.match_status)
        if fill is not None:
            status_cell.fill = fill

    detail.column_dimensions["A"].width = 30
    detail.column_dimensions["B"].width = 30
    detail.column_dimensions["C"].width = 40
    detail.column_dimensions["D"].width = 40
    detail.column_dimensions["E"].width = 16

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
```

- [ ] **Step 4: Add Excel route**

In `backend/app/api/v1/evaluations.py`, append:

```python
from fastapi.responses import StreamingResponse
from app.services.evaluation_excel import render_run_xlsx


@run_router.get("/{run_id}/excel")
async def download_evaluation_excel(
    run_id: str, db: DbSession, user: CurrentUser,
) -> StreamingResponse:
    run = await _load_run_with_access(db, run_id, user.id)
    if run.status != "completed":
        raise AppError(409, "evaluation_failed", "Cannot export a failed evaluation.")
    fields_stmt = select(EvaluationFieldResult).where(
        EvaluationFieldResult.run_id == run.id,
    )
    fields = (await db.execute(fields_stmt)).scalars().all()
    xlsx_bytes = render_run_xlsx(run, fields)
    import io as _io
    return StreamingResponse(
        _io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="evaluation-{run.id}.xlsx"',
        },
    )
```

- [ ] **Step 5: Run (GREEN)**

```bash
uv run pytest tests/test_evaluations_api.py -v 2>&1 | tail -10
```
Expected: 5 passed (4 prior + 1 Excel).

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 166 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/evaluation_excel.py \
        backend/app/api/v1/evaluations.py \
        backend/tests/test_evaluations_api.py
git commit -m "S4/Task 5 (TDD): Excel export route + 1 test (openpyxl)

- Summary sheet: per-field accuracy table + TOTAL row (bold)
- Detail sheet: per-(doc, field) rows with status color-coded fills
  exact green / fuzzy yellow / mismatch red / missing_pred gray
- 409 on failed run (no field results to render)

Backend: 165 -> 166. ALL 18 backend tests delivered (target ≥166 hit)."
```

---

## Phase E — Frontend store (T6)

### Task 6: predict-store增量 + 4 frontend tests

**Files:**
- Modify: `frontend/src/stores/predict-store.ts`
- Modify: `frontend/src/stores/__tests__/predict-store.test.ts`

- [ ] **Step 1: Append failing tests (RED)**

In `frontend/src/stores/__tests__/predict-store.test.ts`, append at the bottom of the existing outer describe block (BEFORE its closing `})`):

```ts
  describe("S4 evaluation state", () => {
    it("runEvaluation POSTs and returns the row", async () => {
      mock.onPost("/api/v1/projects/p-1/evaluations").reply(201, {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "first", num_docs: 1, num_fields_evaluated: 5, num_matches: 4,
        accuracy_avg: 0.8, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      });
      const out = await usePredictStore.getState().runEvaluation("p-1", "first");
      expect(out.accuracy_avg).toBe(0.8);
      expect(out.name).toBe("first");
    });

    it("listEvaluations GETs the list", async () => {
      mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, [
        {
          id: "r-1", project_id: "p-1", prompt_version_id: null,
          name: "x", num_docs: 1, num_fields_evaluated: 1, num_matches: 1,
          accuracy_avg: 1, status: "completed", error_message: null,
          created_by: "u-1", created_at: "",
        },
      ]);
      const out = await usePredictStore.getState().listEvaluations("p-1");
      expect(out.length).toBe(1);
      expect(out[0].id).toBe("r-1");
    });

    it("getEvaluationDetail returns {run, fields}", async () => {
      mock.onGet("/api/v1/evaluations/r-1").reply(200, {
        run: {
          id: "r-1", project_id: "p-1", prompt_version_id: null,
          name: "", num_docs: 1, num_fields_evaluated: 1, num_matches: 1,
          accuracy_avg: 1, status: "completed", error_message: null,
          created_by: "u-1", created_at: "",
        },
        fields: [
          {
            id: "fr-1", run_id: "r-1", document_id: "d-1",
            document_filename: "a.pdf", field_name: "invoice_number",
            predicted_value: "INV-1", expected_value: "INV-1",
            match_status: "exact", created_at: "",
          },
        ],
      });
      const out = await usePredictStore.getState().getEvaluationDetail("r-1");
      expect(out.run.id).toBe("r-1");
      expect(out.fields.length).toBe(1);
    });

    it("deleteEvaluation DELETEs", async () => {
      let deleted = false;
      mock.onDelete("/api/v1/evaluations/r-1").reply(() => {
        deleted = true;
        return [204, ""];
      });
      await usePredictStore.getState().deleteEvaluation("r-1");
      expect(deleted).toBe(true);
    });
  });
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run predict-store 2>&1 | tail -15
```
Expected: 4 failures (actions don't exist).

- [ ] **Step 3: Extend predict-store**

In `frontend/src/stores/predict-store.ts`:

**A. Add types** (after the existing `PromptVersion` type):

```ts
export interface EvaluationRun {
  id: string;
  project_id: string;
  prompt_version_id: string | null;
  name: string;
  num_docs: number;
  num_fields_evaluated: number;
  num_matches: number;
  accuracy_avg: number;
  status: "completed" | "failed";
  error_message: string | null;
  created_by: string;
  created_at: string;
}

export interface EvaluationFieldResult {
  id: string;
  run_id: string;
  document_id: string | null;
  document_filename: string;
  field_name: string;
  predicted_value: string | null;
  expected_value: string | null;
  match_status: "exact" | "fuzzy" | "mismatch" | "missing_pred" | "missing_expected";
  created_at: string;
}
```

**B. Extend the `PredictState` interface** by appending these signatures (after S3 fields):

```ts
  runEvaluation: (projectId: string, name?: string) => Promise<EvaluationRun>;
  listEvaluations: (projectId: string) => Promise<EvaluationRun[]>;
  getEvaluationDetail: (runId: string) => Promise<{ run: EvaluationRun; fields: EvaluationFieldResult[] }>;
  deleteEvaluation: (runId: string) => Promise<void>;
  downloadEvaluationExcel: (runId: string) => Promise<void>;
```

**C. Add the actions** in the create body:

```ts
  runEvaluation: async (projectId, name = "") => {
    const r = await api.post<EvaluationRun>(
      `/api/v1/projects/${projectId}/evaluations`,
      { name },
    );
    return r.data;
  },

  listEvaluations: async (projectId) => {
    const r = await api.get<EvaluationRun[]>(
      `/api/v1/projects/${projectId}/evaluations`,
    );
    return r.data;
  },

  getEvaluationDetail: async (runId) => {
    const r = await api.get<{ run: EvaluationRun; fields: EvaluationFieldResult[] }>(
      `/api/v1/evaluations/${runId}`,
    );
    return r.data;
  },

  deleteEvaluation: async (runId) => {
    await api.delete(`/api/v1/evaluations/${runId}`);
  },

  downloadEvaluationExcel: async (runId) => {
    const r = await api.get<Blob>(
      `/api/v1/evaluations/${runId}/excel`,
      { responseType: "blob" },
    );
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evaluation-${runId}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
```

- [ ] **Step 4: Run (GREEN)**

```bash
npm test -- --run predict-store 2>&1 | tail -10
```
Expected: 4 new tests pass.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 228 passed (was 224 → +4).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/stores/predict-store.ts frontend/src/stores/__tests__/predict-store.test.ts
git commit -m "S4/Task 6 (TDD): predict-store evaluation actions + 4 tests

EvaluationRun + EvaluationFieldResult types exported.
Actions:
- runEvaluation / listEvaluations / getEvaluationDetail / deleteEvaluation
- downloadEvaluationExcel: blob fetch -> ObjectURL -> anchor click

Frontend: 224 -> 228."
```

---

## Phase F — EvaluatePage (T7-T9)

### Task 7: EvaluatePage shell + empty state + 2 tests

**Files:**
- Create: `frontend/src/pages/EvaluatePage.tsx`
- Create: `frontend/src/pages/__tests__/EvaluatePage.test.tsx`

- [ ] **Step 1: Failing tests (RED)**

Create `frontend/src/pages/__tests__/EvaluatePage.test.tsx`:

```tsx
import MockAdapter from "axios-mock-adapter";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api-client";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../../stores/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      workspaces: [{ id: "ws-1", name: "Demo", slug: "demo", role: "owner" }],
      currentWorkspaceId: "ws-1",
    }),
}));

import EvaluatePage from "../EvaluatePage";

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  navigateMock.mockReset();
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
});

function renderPage(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/workspaces/:slug/projects/:pid/evaluate"
          element={<EvaluatePage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("EvaluatePage", () => {
  it("renders empty state when no evaluations exist", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, []);
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    expect(await screen.findByText(/Run your first evaluation/i)).toBeInTheDocument();
  });

  it("renders Run Evaluation button + back link", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, []);
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    expect(await screen.findByRole("button", { name: /Run Evaluation/i })).toBeInTheDocument();
    expect(screen.getByText(/Back to Project|◀/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run EvaluatePage 2>&1 | tail -10
```
Expected: `Cannot find module '../EvaluatePage'`.

- [ ] **Step 3: Create page shell**

Create `frontend/src/pages/EvaluatePage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  usePredictStore,
  type EvaluationRun,
  type EvaluationFieldResult,
} from "../stores/predict-store";

export default function EvaluatePage() {
  const { slug, pid } = useParams();
  const navigate = useNavigate();
  const listEvaluations = usePredictStore((s) => s.listEvaluations);
  const runEvaluation = usePredictStore((s) => s.runEvaluation);
  const getEvaluationDetail = usePredictStore((s) => s.getEvaluationDetail);
  const deleteEvaluation = usePredictStore((s) => s.deleteEvaluation);
  const downloadEvaluationExcel = usePredictStore((s) => s.downloadEvaluationExcel);

  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    run: EvaluationRun;
    fields: EvaluationFieldResult[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    void (async () => {
      try {
        const out = await listEvaluations(pid);
        if (!cancelled) {
          setRuns(out);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as { message?: string }).message ?? "Failed to load");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pid, listEvaluations]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const d = await getEvaluationDetail(selectedRunId);
        if (!cancelled) setDetail(d);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, getEvaluationDetail]);

  async function handleRun() {
    if (!pid || running) return;
    setRunning(true);
    try {
      const newRun = await runEvaluation(pid, "");
      const refreshed = await listEvaluations(pid);
      setRuns(refreshed);
      setSelectedRunId(newRun.id);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function handleDelete(rid: string) {
    if (!pid) return;
    if (!confirm("Delete this evaluation run?")) return;
    await deleteEvaluation(rid);
    if (selectedRunId === rid) setSelectedRunId(null);
    const refreshed = await listEvaluations(pid);
    setRuns(refreshed);
  }

  async function handleDownload(rid: string) {
    await downloadEvaluationExcel(rid);
  }

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => slug && pid && navigate(`/workspaces/${slug}/projects/${pid}`)}
          className="text-xs text-[#94a3b8] hover:text-[#e2e8f0]"
        >
          ◀ Back to Project
        </button>
        <h1 className="text-lg font-semibold">📊 Evaluate</h1>
        <div />
      </div>

      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          disabled={running}
          onClick={() => void handleRun()}
          className="bg-[#6366f1] text-white px-3 py-1 rounded text-sm disabled:opacity-50"
        >
          {running ? "Running..." : "Run Evaluation"}
        </button>
        <span className="text-xs text-[#64748b]">
          Edit annotations first for meaningful accuracy.
        </span>
      </div>

      {error && (
        <div className="text-xs text-[#ef4444] bg-[#3f1d1d] border border-[#ef4444] rounded p-2 mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-[#94a3b8]">Loading...</div>
      ) : runs.length === 0 ? (
        <div className="text-xs text-[#64748b] text-center py-8">
          Run your first evaluation to see accuracy metrics.
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <div
              key={r.id}
              className={`bg-[#0f1117] border rounded p-2 cursor-pointer ${
                selectedRunId === r.id ? "border-[#6366f1]" : "border-[#2a2e3d]"
              }`}
              onClick={() => setSelectedRunId(r.id)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-[#818cf8]">
                    {(r.accuracy_avg * 100).toFixed(1)}%
                  </span>
                  <span className="text-xs text-[#94a3b8] ml-2">
                    · {r.num_docs} docs · {r.num_fields_evaluated} fields
                  </span>
                  {r.status === "failed" && (
                    <span className="ml-2 text-[#ef4444]">FAILED</span>
                  )}
                  {r.name && (
                    <span className="ml-2 italic text-[#94a3b8]">{r.name}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleDownload(r.id); }}
                    className="text-xs text-[#6366f1] hover:underline"
                    title="Download Excel"
                  >
                    📥
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleDelete(r.id); }}
                    className="text-xs text-[#ef4444] hover:underline"
                    title="Delete run"
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {detail && <EvaluationDetail detail={detail} />}
    </div>
  );
}

function EvaluationDetail({
  detail,
}: { detail: { run: EvaluationRun; fields: EvaluationFieldResult[] } }) {
  const [showRows, setShowRows] = useState(false);

  // Aggregate per-field
  const buckets = new Map<string, { exact: number; fuzzy: number; mismatch: number; missing_pred: number; missing_expected: number; }>();
  for (const f of detail.fields) {
    const b = buckets.get(f.field_name) ?? { exact: 0, fuzzy: 0, mismatch: 0, missing_pred: 0, missing_expected: 0 };
    b[f.match_status] = b[f.match_status] + 1;
    buckets.set(f.field_name, b);
  }
  const summary = Array.from(buckets.entries()).map(([name, b]) => {
    const denom = b.exact + b.fuzzy + b.mismatch + b.missing_pred;
    const accuracy = denom ? (b.exact + b.fuzzy) / denom : 0;
    return { name, ...b, accuracy };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold mb-2">Per-field summary</h2>
      <table className="text-xs w-full">
        <thead>
          <tr className="text-left text-[#94a3b8]">
            <th className="pr-2">Field</th>
            <th>exact</th><th>fuzzy</th><th>mismatch</th>
            <th>missing</th><th>accuracy</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => (
            <tr key={s.name}>
              <td className="pr-2 font-mono">{s.name}</td>
              <td>{s.exact}</td>
              <td>{s.fuzzy}</td>
              <td>{s.mismatch}</td>
              <td>{s.missing_pred + s.missing_expected}</td>
              <td>{(s.accuracy * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        type="button"
        className="text-xs text-[#6366f1] hover:underline mt-3"
        onClick={() => setShowRows((v) => !v)}
      >
        {showRows ? "Hide" : "Show"} per-doc rows ({detail.fields.length})
      </button>
      {showRows && (
        <table className="text-xs w-full mt-2">
          <thead>
            <tr className="text-left text-[#94a3b8]">
              <th>filename</th><th>field</th><th>predicted</th><th>expected</th><th>status</th>
            </tr>
          </thead>
          <tbody>
            {detail.fields.map((f) => (
              <tr key={f.id}>
                <td>{f.document_filename}</td>
                <td className="font-mono">{f.field_name}</td>
                <td className="text-[#fca5a5]">{f.predicted_value ?? ""}</td>
                <td className="text-[#86efac]">{f.expected_value ?? ""}</td>
                <td>{f.match_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run (GREEN) — page shell only**

```bash
npm test -- --run EvaluatePage 2>&1 | tail -10
```
Expected: 2 passed.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 230 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EvaluatePage.tsx frontend/src/pages/__tests__/EvaluatePage.test.tsx
git commit -m "S4/Task 7 (TDD): EvaluatePage shell + empty state + 2 tests

Page composition: header w/ back button + Run Evaluation button +
hint + runs list + selected-run detail. Empty state when no runs.
Inline EvaluationDetail subcomponent renders per-field summary table
+ collapsible per-doc rows table.

Frontend: 228 -> 230."
```

---

### Task 8: EvaluatePage run flow + history + 3 tests

**Files:**
- Modify: `frontend/src/pages/__tests__/EvaluatePage.test.tsx` (append 3 tests)

(The page implementation in T7 already covers the run flow + history rendering. T8 just adds the test coverage.)

- [ ] **Step 1: Append 3 tests (RED first; will likely pass GREEN immediately because T7 already implemented the behavior)**

```tsx
  it("renders run history list with accuracy + counts", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, [
      {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "first", num_docs: 2, num_fields_evaluated: 10, num_matches: 8,
        accuracy_avg: 0.8, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
    ]);
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    await screen.findByText(/80\.0%/);
    expect(screen.getByText(/2 docs/i)).toBeInTheDocument();
    expect(screen.getByText(/10 fields/i)).toBeInTheDocument();
  });

  it("clicking Run Evaluation POSTs and refreshes list", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, []);
    mock.onPost("/api/v1/projects/p-1/evaluations").reply(201, {
      id: "r-new", project_id: "p-1", prompt_version_id: null,
      name: "", num_docs: 1, num_fields_evaluated: 3, num_matches: 3,
      accuracy_avg: 1.0, status: "completed", error_message: null,
      created_by: "u-1", created_at: "",
    });
    mock.onGet("/api/v1/evaluations/r-new").reply(200, {
      run: {
        id: "r-new", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 3, num_matches: 3,
        accuracy_avg: 1.0, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
      fields: [],
    });
    // After POST, list endpoint should now return the new run
    let listCall = 0;
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(() => {
      listCall++;
      if (listCall === 1) return [200, []];
      return [200, [{
        id: "r-new", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 3, num_matches: 3,
        accuracy_avg: 1.0, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      }]];
    });

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    await screen.findByRole("button", { name: /Run Evaluation/i });
    await user.click(screen.getByRole("button", { name: /Run Evaluation/i }));
    await waitFor(() => expect(screen.getByText(/100\.0%/)).toBeInTheDocument());
  });

  it("clicking 🗑 deletes the run and refreshes list", async () => {
    let listCall = 0;
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(() => {
      listCall++;
      if (listCall === 1) return [200, [{
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 1, num_matches: 1,
        accuracy_avg: 1, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      }]];
      return [200, []];
    });
    let deleted = false;
    mock.onDelete("/api/v1/evaluations/r-1").reply(() => {
      deleted = true;
      return [204, ""];
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    await screen.findByText(/100\.0%/);
    await user.click(screen.getByTitle(/Delete run/i));
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.queryByText(/100\.0%/)).not.toBeInTheDocument());
  });
```

- [ ] **Step 2: Run (RED then GREEN)**

```bash
npm test -- --run EvaluatePage 2>&1 | tail -10
```

If 3 new tests pass on first run (because T7 implementation covers the behaviors): document "RED skipped — implementation from T7 already satisfies tests; this is intentional". Otherwise capture RED + go fix.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 233 passed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/__tests__/EvaluatePage.test.tsx
git commit -m "S4/Task 8 (TDD): EvaluatePage run flow + history + 3 tests

- run history rendering with accuracy + counts
- Run Evaluation POST → list refresh + auto-select new run
- Delete with confirm → DELETE + list refresh

Frontend: 230 -> 233."
```

---

### Task 9: EvaluatePage detail (summary + per-doc) + 3 tests

**Files:**
- Modify: `frontend/src/pages/__tests__/EvaluatePage.test.tsx` (append 3 tests)

(Detail rendering also implemented in T7. T9 adds test coverage.)

- [ ] **Step 1: Append 3 tests**

```tsx
  it("clicking a run row loads detail and shows per-field summary", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, [
      {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 2, num_matches: 1,
        accuracy_avg: 0.5, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
    ]);
    mock.onGet("/api/v1/evaluations/r-1").reply(200, {
      run: {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 2, num_matches: 1,
        accuracy_avg: 0.5, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
      fields: [
        {
          id: "f-1", run_id: "r-1", document_id: "d-1",
          document_filename: "a.pdf", field_name: "invoice_number",
          predicted_value: "INV-1", expected_value: "INV-1",
          match_status: "exact", created_at: "",
        },
        {
          id: "f-2", run_id: "r-1", document_id: "d-1",
          document_filename: "a.pdf", field_name: "total",
          predicted_value: "100", expected_value: "200",
          match_status: "mismatch", created_at: "",
        },
      ],
    });

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    await screen.findByText(/50\.0%/);
    await user.click(screen.getByText(/50\.0%/));
    await screen.findByText(/Per-field summary/i);
    expect(screen.getByText("invoice_number")).toBeInTheDocument();
    expect(screen.getByText("total")).toBeInTheDocument();
  });

  it("expands per-doc rows when 'Show per-doc rows' clicked", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, [
      {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 1, num_matches: 1,
        accuracy_avg: 1, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
    ]);
    mock.onGet("/api/v1/evaluations/r-1").reply(200, {
      run: {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 1, num_matches: 1,
        accuracy_avg: 1, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
      fields: [{
        id: "f-1", run_id: "r-1", document_id: "d-1",
        document_filename: "alpha.pdf", field_name: "invoice_number",
        predicted_value: "INV-1", expected_value: "INV-1",
        match_status: "exact", created_at: "",
      }],
    });

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    await screen.findByText(/100\.0%/);
    await user.click(screen.getByText(/100\.0%/));
    await user.click(screen.getByText(/Show per-doc rows/i));
    expect(screen.getByText("alpha.pdf")).toBeInTheDocument();
  });

  it("clicking 📥 invokes downloadEvaluationExcel", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, [
      {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 1, num_matches: 1,
        accuracy_avg: 1, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
    ]);
    let excelCalled = false;
    mock.onGet("/api/v1/evaluations/r-1/excel").reply(() => {
      excelCalled = true;
      return [200, new Blob(["xlsx"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })];
    });
    // Stub createObjectURL/revokeObjectURL
    (URL.createObjectURL as unknown as typeof vi.fn) = vi.fn(() => "blob:http://x");
    (URL.revokeObjectURL as unknown as typeof vi.fn) = vi.fn();

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    await screen.findByTitle(/Download Excel/i);
    await user.click(screen.getByTitle(/Download Excel/i));
    await waitFor(() => expect(excelCalled).toBe(true));
  });
```

- [ ] **Step 2: Run (GREEN)**

```bash
npm test -- --run EvaluatePage 2>&1 | tail -10
```
Expected: 8 EvaluatePage tests pass.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 236 passed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/__tests__/EvaluatePage.test.tsx
git commit -m "S4/Task 9 (TDD): EvaluatePage detail + 3 tests

- Click run row loads detail (per-field summary table)
- Show/hide per-doc rows toggle
- 📥 download button invokes Excel blob fetch + ObjectURL anchor click

Frontend: 233 -> 236. Frontend target ≥236 hit (12 net adds)."
```

---

## Phase G — Routing + ProjectDocumentsPage entry (T10)

### Task 10: ProjectDocumentsPage 📊 link + App route + 2 tests

**Files:**
- Modify: `frontend/src/App.tsx` (add /evaluate route)
- Modify: `frontend/src/pages/ProjectDocumentsPage.tsx` (add 📊 button)
- Modify: `frontend/src/pages/__tests__/ProjectDocumentsPage.test.tsx` (1 test)
- Modify: `frontend/src/__tests__/App.test.tsx` (1 test)

- [ ] **Step 1: Append failing tests (RED)**

In `frontend/src/__tests__/App.test.tsx`, append a route test (mirroring existing patterns):

```tsx
vi.mock("../pages/EvaluatePage", () => ({
  default: () => <div data-testid="page-evaluate">evaluate</div>,
}));
```

(Place near other vi.mock page stubs at top.)

Then add a test in the routing describe block:

```tsx
  it("/workspaces/:slug/projects/:pid/evaluate renders EvaluatePage when authed", () => {
    mockState.token = "tok";
    window.history.pushState({}, "", "/workspaces/demo/projects/p-1/evaluate");
    render(<App />);
    expect(screen.getByTestId("page-evaluate")).toBeInTheDocument();
  });
```

In `frontend/src/pages/__tests__/ProjectDocumentsPage.test.tsx`, append:

```tsx
  it("clicking 📊 Evaluate navigates to evaluate page", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1"),
    ]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("d-1.pdf");
    await user.click(screen.getByRole("button", { name: /Evaluate/i }));
    expect(navigateMock).toHaveBeenCalledWith(
      "/workspaces/demo/projects/p-1/evaluate"
    );
  });
```

- [ ] **Step 2: Run (RED)**

```bash
npm test -- --run "App|ProjectDocumentsPage" 2>&1 | tail -15
```
Expected: 2 failures.

- [ ] **Step 3: Modify App.tsx**

Add import:

```tsx
import EvaluatePage from "./pages/EvaluatePage";
```

Add route inside the protected `<ProtectedRoute><AppShell /></ProtectedRoute>` block:

```tsx
<Route path="/workspaces/:slug/projects/:pid/evaluate" element={<EvaluatePage />} />
```

- [ ] **Step 4: Modify ProjectDocumentsPage**

In `frontend/src/pages/ProjectDocumentsPage.tsx`, find the buttons toolbar (the area with `+ Batch Predict (...)` and `▶ Next Unreviewed`). Insert this button alongside (e.g., after Next Unreviewed):

```tsx
<button
  type="button"
  onClick={() => ws && navigate(`/workspaces/${ws.slug}/projects/${pid}/evaluate`)}
  className="text-xs text-[#6366f1] hover:underline"
  title="Evaluate this project"
>
  📊 Evaluate
</button>
```

Reuse whatever variable the existing code uses for the workspace slug (`ws.slug` per S2b1 fix).

- [ ] **Step 5: Run (GREEN)**

```bash
npm test 2>&1 | tail -3
```
Expected: 238 passed.

Production build:
```bash
npm run build 2>&1 | tail -3
```
Expected: built.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx \
        frontend/src/pages/ProjectDocumentsPage.tsx \
        frontend/src/pages/__tests__/ProjectDocumentsPage.test.tsx \
        frontend/src/__tests__/App.test.tsx
git commit -m "S4/Task 10 (TDD): ProjectDocumentsPage 📊 link + App route + 2 tests

- New route /workspaces/:slug/projects/:pid/evaluate under protected AppShell
- ProjectDocumentsPage gets a '📊 Evaluate' button next to Batch + Next Unreviewed

Frontend: 236 -> 238. Production build green."
```

---

## Phase H — Smoke + tag (T11)

### Task 11: end-to-end smoke + s4-complete tag

**Files:** none modified — orchestrator runs Playwright + smoke verification.

- [ ] **Step 1: Reset DB + start servers**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
RESET_DB=1 \
  API_KEY="$API_KEY" \
  OPENAI_API_KEY="$OPENAI_API_KEY" \
  ./scripts/run-dev.sh
```

- [ ] **Step 2: Bootstrap (curl) + click through (Playwright)**

```bash
BASE=http://127.0.0.1:8000/api/v1
TOKEN=$(curl -s --noproxy '*' -X POST $BASE/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"pass1234","display_name":"Alice"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
WSID=$(curl -s --noproxy '*' -X POST $BASE/workspaces \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Demo","slug":"demo"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
PID=$(curl -s --noproxy '*' -X POST $BASE/workspaces/$WSID/projects \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Receipts","slug":"receipts","template_key":"china_vat"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
ALPHA=/Users/qinqiang02/colab/codespace/ai/doc-intel/testing/test1_honor/3744516.pdf
DID=$(curl -s --noproxy '*' -X POST $BASE/projects/$PID/documents \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$ALPHA;filename=alpha.pdf;type=application/pdf" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "PID=$PID DID=$DID"
```

Smoke walk per spec §13:
1. Login → project page
2. Click 📊 Evaluate → blank EvaluatePage
3. Click "Run Evaluation" → wait → run row appears (probably 100% since no edits yet)
4. Click run row → detail expands
5. Click 📥 → file downloads, opens in Excel/Numbers
6. Open workspace, edit `buyer_tax_id` value, return to evaluate
7. Click "Run Evaluation" again → second run with lower accuracy
8. Click 🗑 on older run → confirm → list shrinks

- [ ] **Step 3: Run tests + build**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest --tb=no -q 2>&1 | tail -2
# Expected: 166 passed

cd ../frontend
npm test 2>&1 | tail -3
# Expected: 238 passed
npm run build 2>&1 | tail -5
# Expected: built
```

- [ ] **Step 4: Stop servers + tag**

```bash
lsof -ti :8000 :5173 2>/dev/null | sort -u | xargs -r kill 2>/dev/null
pkill -f vite 2>/dev/null

cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git tag -a s4-complete -m "S4 Evaluate (batch field comparison + Excel) complete

Backend:
- evaluation_runs + evaluation_field_results tables (alembic f2a8d4e6c5b1)
- 5 endpoints: POST/GET list (project-scoped), GET detail/DELETE/Excel (run-scoped)
- engine.scoring.score_field: exact/fuzzy/mismatch/missing per field_type
- evaluation_service: enumerates ProcessingResult vs annotations,
  persists run + per-field rows; fail-safe row insert on exception
- evaluation_excel: 2-sheet workbook (Summary + Detail) with status colors

Frontend:
- predict-store: EvaluationRun/EvaluationFieldResult types + 5 actions
  (run, list, detail, delete, downloadExcel)
- EvaluatePage at /workspaces/:slug/projects/:pid/evaluate
- 📊 Evaluate button on ProjectDocumentsPage

Tests: 404 (166 backend + 238 frontend = +32 over s3-complete; spec target +30
exceeded by 2 due to fuller test coverage on EvaluatePage UI).
Production build green.

Smoke (spec §13) walked end-to-end: real Gemini predict + run evaluation +
download Excel + edit annotation + re-run + delete old run."

git tag --list | grep complete
```

- [ ] **Step 5: Update memory**

Edit
`/Users/qinqiang02/.claude/projects/-Users-qinqiang02-colab-codespace-ai-label-studio/memory/project_doc_intel_redesign.md`
to mark **S4 status: completed**.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Tasks |
|---|---|
| §4 architecture (file map) | T1-T10 each map to listed files |
| §5 data model (2 tables + migration) | T1 |
| §6 score_field algorithm | T2 |
| §7 per-doc enumeration | T3 |
| §8 endpoints (POST/GET list/detail/DELETE/Excel) | T4 + T5 |
| §9 Excel format (2 sheets, color fills) | T5 |
| §10 frontend (store + page + nav) | T6 + T7-T9 + T10 |
| §11 error handling (failed run row, 409 on excel of failed) | T3 (failed-row insert), T5 (409) |
| §12 testing | tests in every task |
| §13 smoke | T11 |

No gaps.

**2. Placeholder scan:** No "TBD" / "implement later" / "add validation as needed". Each step has runnable code or runnable commands.

**3. Type consistency:**

- `EvaluationRun` Python schema in T4 matches frontend type in T6 field-by-field (id, project_id, prompt_version_id, name, num_docs, num_fields_evaluated, num_matches, accuracy_avg, status, error_message, created_by, created_at).
- `EvaluationFieldResult` types match across T1, T4, T6 (id, run_id, document_id, document_filename, field_name, predicted_value, expected_value, match_status, created_at).
- `match_status` enum values consistent: `exact | fuzzy | mismatch | missing_pred | missing_expected` across T2, T3, T4, T6.
- Migration revision id `f2a8d4e6c5b1` consistent in §1 plan header, T1 migration file, and §11 error handling section.

**Total: 11 tasks, ≈19h.** Final acceptance via spec §13 smoke in T11.
