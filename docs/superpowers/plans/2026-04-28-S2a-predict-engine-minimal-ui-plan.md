# S2a — Predict Engine + Minimal Result UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **TDD is mandatory** — every code unit must have its failing test written first, observed RED, then GREEN.

**Goal:** End-to-end predict path on top of s1-complete: ProcessingResult + Annotation models with LS-7 audit, POST /predict (sync) for single, SSE /batch-predict for many, next-unreviewed queue (LS-5), Annotation CRUD, and a modal-based result viewer + batch progress drawer wired into ProjectDocumentsPage.

**Architecture:** Backend predict service calls internal `app.engine.processors.factory.create()` (in-process LLM SDK calls); single-doc predict blocks for 10-30s and returns ProcessingResult JSON; batch streams per-doc events as SSE. Annotation rows are seeded by predict (`source=ai_detected`) and editable inline (`source=manual` for user-added rows). AnnotationRevision table records every PATCH/DELETE for audit. Frontend uses native `fetch + ReadableStream` to consume SSE; modal opens on Predict button click and shows latest ProcessingResult + editable Annotation list.

**Tech Stack:** FastAPI async + SQLAlchemy 2 async + aiosqlite + alembic + Vite + React 19 + Zustand + react-router 6 + axios + vitest + RTL + native fetch Streams API.

**Spec:** `docs/superpowers/specs/2026-04-28-S2a-predict-engine-minimal-ui-design.md`
**LS-features cross-spec:** `docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md`
**Repo root:** `/Users/qinqiang02/colab/codespace/ai/doc-intel/`
**Baseline:** tag `s1-complete` (80 backend + 100 frontend = 180 tests)
**Target:** ≥117 backend + ≥129 frontend = ≥246 tests

---

## Phase A — Backend models + migration

### Task 1: ProcessingResult model + 5 tests

**Files:**
- Create: `backend/app/models/processing_result.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/tests/test_processing_result_model.py`

- [ ] **Step 1: Write failing test (RED)**

Create `backend/tests/test_processing_result_model.py`:

```python
"""Tests for ProcessingResult model."""
from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture
async def session(tmp_path, monkeypatch):
    db_file = tmp_path / "pr_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    from app.models.base import Base
    from app.models import (  # noqa: F401
        user, workspace, workspace_member, project, document, processing_result,
    )

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}", future=True)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        await s.execute(text("PRAGMA foreign_keys=ON"))
        yield s
    await engine.dispose()


async def _seed(session):
    from app.models.document import Document
    from app.models.project import Project
    from app.models.user import User
    from app.models.workspace import Workspace

    u = User(email="a@x.com", password_hash="h", display_name="A")
    session.add(u)
    await session.flush()
    w = Workspace(name="W", slug="ws-aa", owner_id=u.id)
    session.add(w)
    await session.flush()
    p = Project(workspace_id=w.id, name="P", slug="proj-aa", template_key="custom", created_by=u.id)
    session.add(p)
    await session.flush()
    d = Document(
        project_id=p.id, filename="x.pdf", file_path="x.pdf",
        file_size=1, mime_type="application/pdf", uploaded_by=u.id,
    )
    session.add(d)
    await session.flush()
    return u, p, d


@pytest.mark.asyncio
async def test_create_processing_result(session):
    from app.models.processing_result import ProcessingResult, ProcessingResultSource

    u, _, d = await _seed(session)
    pr = ProcessingResult(
        document_id=d.id,
        version=1,
        structured_data={"invoice_number": "INV-001"},
        prompt_used="Extract invoice fields.",
        processor_key="mock|mock-v1.0",
        source=ProcessingResultSource.PREDICT,
        created_by=u.id,
    )
    session.add(pr)
    await session.commit()
    assert pr.id and pr.created_at
    assert pr.source == ProcessingResultSource.PREDICT
    assert pr.deleted_at is None


@pytest.mark.asyncio
async def test_pr_cascade_on_document_delete(session):
    from app.models.processing_result import ProcessingResult, ProcessingResultSource

    u, _, d = await _seed(session)
    session.add(ProcessingResult(
        document_id=d.id, version=1,
        structured_data={}, prompt_used="x",
        processor_key="mock|m", source=ProcessingResultSource.PREDICT,
        created_by=u.id,
    ))
    await session.commit()

    await session.delete(d)
    await session.commit()
    rows = (await session.execute(select(ProcessingResult))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_pr_source_enum_values(session):
    from app.models.processing_result import ProcessingResultSource

    assert ProcessingResultSource.PREDICT.value == "predict"
    assert ProcessingResultSource.MANUAL_EDIT.value == "manual_edit"


@pytest.mark.asyncio
async def test_pr_inferred_schema_optional(session):
    from app.models.processing_result import ProcessingResult, ProcessingResultSource

    u, _, d = await _seed(session)
    pr = ProcessingResult(
        document_id=d.id, version=1,
        structured_data={"a": 1}, inferred_schema=None,
        prompt_used="p", processor_key="mock|m",
        source=ProcessingResultSource.PREDICT, created_by=u.id,
    )
    session.add(pr)
    await session.commit()
    assert pr.inferred_schema is None


@pytest.mark.asyncio
async def test_pr_multiple_versions_same_document(session):
    from app.models.processing_result import ProcessingResult, ProcessingResultSource

    u, _, d = await _seed(session)
    for v in (1, 2, 3):
        session.add(ProcessingResult(
            document_id=d.id, version=v,
            structured_data={"v": v}, prompt_used="p",
            processor_key="mock|m", source=ProcessingResultSource.PREDICT,
            created_by=u.id,
        ))
    await session.commit()
    rows = (
        await session.execute(
            select(ProcessingResult).where(ProcessingResult.document_id == d.id).order_by(ProcessingResult.version)
        )
    ).scalars().all()
    assert [r.version for r in rows] == [1, 2, 3]
```

- [ ] **Step 2: Run test (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_processing_result_model.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.models.processing_result'`. Capture.

- [ ] **Step 3: Write processing_result.py**

Create `backend/app/models/processing_result.py`:

```python
"""ProcessingResult model — versioned snapshot of LLM extraction output."""
from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.document import Document


class ProcessingResultSource(str, enum.Enum):
    PREDICT = "predict"
    MANUAL_EDIT = "manual_edit"


class ProcessingResult(Base, TimestampMixin):
    __tablename__ = "processing_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    structured_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    inferred_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    prompt_used: Mapped[str] = mapped_column(Text, nullable=False)
    processor_key: Mapped[str] = mapped_column(String(120), nullable=False)
    source: Mapped[ProcessingResultSource] = mapped_column(
        SAEnum(ProcessingResultSource, name="processing_result_source"), nullable=False
    )
    created_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    document: Mapped["Document"] = relationship()
```

- [ ] **Step 4: Update models/__init__.py**

REPLACE `backend/app/models/__init__.py`:

```python
"""Models package — import all models so Base.metadata sees them."""
from app.models.base import Base, TimestampMixin, gen_uuid
from app.models.document import Document, DocumentStatus
from app.models.processing_result import ProcessingResult, ProcessingResultSource
from app.models.project import Project
from app.models.user import User
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember, WorkspaceRole

__all__ = [
    "Base", "TimestampMixin", "gen_uuid",
    "Document", "DocumentStatus",
    "ProcessingResult", "ProcessingResultSource",
    "Project",
    "User", "Workspace", "WorkspaceMember", "WorkspaceRole",
]
```

- [ ] **Step 5: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_processing_result_model.py -v
```
Expected: 5 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 85 passed (80 baseline + 5).

- [ ] **Step 6: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add backend/app/models/processing_result.py backend/app/models/__init__.py backend/tests/test_processing_result_model.py
git commit -m "S2a/Task 1: ProcessingResult model + 5 tests

- document_id CASCADE; created_by RESTRICT
- version int (per-document, service-managed)
- structured_data JSON + inferred_schema JSON nullable
- prompt_used Text + processor_key String + source enum
- deleted_at nullable for future rollback (no API in S2a)"
```

---

### Task 2: Annotation model + 6 tests

**Files:**
- Create: `backend/app/models/annotation.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/tests/test_annotation_model.py`

- [ ] **Step 1: Write failing test (RED)**

Create `backend/tests/test_annotation_model.py`:

```python
"""Tests for Annotation model."""
from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture
async def session(tmp_path, monkeypatch):
    db_file = tmp_path / "ann_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    from app.models.base import Base
    from app.models import (  # noqa: F401
        user, workspace, workspace_member, project, document,
        processing_result, annotation,
    )

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}", future=True)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        await s.execute(text("PRAGMA foreign_keys=ON"))
        yield s
    await engine.dispose()


async def _seed(session):
    from app.models.document import Document
    from app.models.project import Project
    from app.models.user import User
    from app.models.workspace import Workspace

    u = User(email="a@x.com", password_hash="h", display_name="A")
    session.add(u)
    await session.flush()
    w = Workspace(name="W", slug="ws-bb", owner_id=u.id)
    session.add(w)
    await session.flush()
    p = Project(workspace_id=w.id, name="P", slug="proj-bb", template_key="custom", created_by=u.id)
    session.add(p)
    await session.flush()
    d = Document(
        project_id=p.id, filename="x.pdf", file_path="x.pdf",
        file_size=1, mime_type="application/pdf", uploaded_by=u.id,
    )
    session.add(d)
    await session.flush()
    return u, p, d


@pytest.mark.asyncio
async def test_create_annotation_default(session):
    from app.models.annotation import Annotation, AnnotationFieldType, AnnotationSource

    u, _, d = await _seed(session)
    a = Annotation(
        document_id=d.id, field_name="invoice_number",
        field_value="INV-001", source=AnnotationSource.AI_DETECTED,
        created_by=u.id,
    )
    session.add(a)
    await session.commit()
    assert a.id and a.created_at
    assert a.field_type == AnnotationFieldType.STRING  # default
    assert a.is_ground_truth is False
    assert a.deleted_at is None
    assert a.confidence is None
    assert a.bounding_box is None
    assert a.updated_by_user_id is None


@pytest.mark.asyncio
async def test_annotation_cascade_on_document_delete(session):
    from app.models.annotation import Annotation, AnnotationSource

    u, _, d = await _seed(session)
    session.add(Annotation(
        document_id=d.id, field_name="x", field_value="y",
        source=AnnotationSource.MANUAL, created_by=u.id,
    ))
    await session.commit()
    await session.delete(d)
    await session.commit()
    rows = (await session.execute(select(Annotation))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_annotation_bounding_box_json(session):
    from app.models.annotation import Annotation, AnnotationSource

    u, _, d = await _seed(session)
    bbox = {"x": 0.5, "y": 0.1, "w": 0.2, "h": 0.05, "page": 0}
    a = Annotation(
        document_id=d.id, field_name="x", field_value="y",
        bounding_box=bbox, source=AnnotationSource.AI_DETECTED,
        confidence=0.95, created_by=u.id,
    )
    session.add(a)
    await session.commit()
    assert a.bounding_box == bbox
    assert a.confidence == 0.95


@pytest.mark.asyncio
async def test_annotation_source_enum(session):
    from app.models.annotation import AnnotationSource
    assert AnnotationSource.AI_DETECTED.value == "ai_detected"
    assert AnnotationSource.MANUAL.value == "manual"


@pytest.mark.asyncio
async def test_annotation_field_type_enum(session):
    from app.models.annotation import AnnotationFieldType
    assert {e.value for e in AnnotationFieldType} == {"string", "number", "date", "array", "object"}


@pytest.mark.asyncio
async def test_annotation_audit_fields(session):
    from app.models.annotation import Annotation, AnnotationSource

    u, _, d = await _seed(session)
    u2 = type(u)(email="b@x.com", password_hash="h", display_name="B")
    session.add(u2)
    await session.flush()
    a = Annotation(
        document_id=d.id, field_name="x", field_value="v1",
        source=AnnotationSource.AI_DETECTED, created_by=u.id,
        updated_by_user_id=u2.id,
    )
    session.add(a)
    await session.commit()
    assert a.created_by == u.id
    assert a.updated_by_user_id == u2.id
```

- [ ] **Step 2: Run test (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_annotation_model.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.models.annotation'`.

- [ ] **Step 3: Write annotation.py**

Create `backend/app/models/annotation.py`:

```python
"""Annotation model — current truth of extracted/edited fields per Document."""
from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, Float, ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.document import Document


class AnnotationSource(str, enum.Enum):
    AI_DETECTED = "ai_detected"
    MANUAL = "manual"


class AnnotationFieldType(str, enum.Enum):
    STRING = "string"
    NUMBER = "number"
    DATE = "date"
    ARRAY = "array"
    OBJECT = "object"


class Annotation(Base, TimestampMixin):
    __tablename__ = "annotations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    field_name: Mapped[str] = mapped_column(String(120), nullable=False)
    field_value: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    field_type: Mapped[AnnotationFieldType] = mapped_column(
        SAEnum(AnnotationFieldType, name="annotation_field_type"),
        default=AnnotationFieldType.STRING, nullable=False,
    )
    bounding_box: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    source: Mapped[AnnotationSource] = mapped_column(
        SAEnum(AnnotationSource, name="annotation_source"), nullable=False
    )
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_ground_truth: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    document: Mapped["Document"] = relationship()
```

- [ ] **Step 4: Update models/__init__.py**

REPLACE `backend/app/models/__init__.py`:

```python
"""Models package — import all models so Base.metadata sees them."""
from app.models.annotation import Annotation, AnnotationFieldType, AnnotationSource
from app.models.base import Base, TimestampMixin, gen_uuid
from app.models.document import Document, DocumentStatus
from app.models.processing_result import ProcessingResult, ProcessingResultSource
from app.models.project import Project
from app.models.user import User
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember, WorkspaceRole

__all__ = [
    "Base", "TimestampMixin", "gen_uuid",
    "Annotation", "AnnotationFieldType", "AnnotationSource",
    "Document", "DocumentStatus",
    "ProcessingResult", "ProcessingResultSource",
    "Project",
    "User", "Workspace", "WorkspaceMember", "WorkspaceRole",
]
```

- [ ] **Step 5: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_annotation_model.py tests/test_processing_result_model.py -v
```
Expected: 11 passed (6 + 5).

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 91 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add backend/app/models/annotation.py backend/app/models/__init__.py backend/tests/test_annotation_model.py
git commit -m "S2a/Task 2: Annotation model + 6 tests

- document_id CASCADE; created_by + updated_by_user_id RESTRICT (LS-7 audit)
- AnnotationSource enum (ai_detected | manual)
- AnnotationFieldType enum (string/number/date/array/object)
- bounding_box JSON {x,y,w,h,page} percent coords (S2b will render)
- is_ground_truth bool (LS-2 placeholder, frontend in S4)
- deleted_at nullable for soft delete"
```

---

### Task 3: AnnotationRevision model + 3 tests

**Files:**
- Create: `backend/app/models/annotation_revision.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/tests/test_annotation_revision_model.py`

- [ ] **Step 1: Write failing test (RED)**

Create `backend/tests/test_annotation_revision_model.py`:

```python
"""Tests for AnnotationRevision model."""
from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture
async def session(tmp_path, monkeypatch):
    db_file = tmp_path / "rev_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    from app.models.base import Base
    from app.models import (  # noqa: F401
        user, workspace, workspace_member, project, document,
        processing_result, annotation, annotation_revision,
    )

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}", future=True)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        await s.execute(text("PRAGMA foreign_keys=ON"))
        yield s
    await engine.dispose()


async def _seed_annotation(session):
    from app.models.annotation import Annotation, AnnotationSource
    from app.models.document import Document
    from app.models.project import Project
    from app.models.user import User
    from app.models.workspace import Workspace

    u = User(email="a@x.com", password_hash="h", display_name="A")
    session.add(u)
    await session.flush()
    w = Workspace(name="W", slug="ws-cc", owner_id=u.id)
    session.add(w)
    await session.flush()
    p = Project(workspace_id=w.id, name="P", slug="proj-cc", template_key="custom", created_by=u.id)
    session.add(p)
    await session.flush()
    d = Document(
        project_id=p.id, filename="x.pdf", file_path="x.pdf",
        file_size=1, mime_type="application/pdf", uploaded_by=u.id,
    )
    session.add(d)
    await session.flush()
    a = Annotation(
        document_id=d.id, field_name="x", field_value="v1",
        source=AnnotationSource.AI_DETECTED, created_by=u.id,
    )
    session.add(a)
    await session.flush()
    return u, a


@pytest.mark.asyncio
async def test_create_revision(session):
    from app.models.annotation_revision import AnnotationRevision, RevisionAction

    u, a = await _seed_annotation(session)
    rev = AnnotationRevision(
        annotation_id=a.id, action=RevisionAction.UPDATE,
        before={"field_value": "v1"}, after={"field_value": "v2"},
        changed_by=u.id,
    )
    session.add(rev)
    await session.commit()
    assert rev.id and rev.created_at
    assert rev.before == {"field_value": "v1"}
    assert rev.after == {"field_value": "v2"}


@pytest.mark.asyncio
async def test_revision_action_enum(session):
    from app.models.annotation_revision import RevisionAction
    assert {e.value for e in RevisionAction} == {"create", "update", "delete"}


@pytest.mark.asyncio
async def test_revision_cascade_on_annotation_delete(session):
    from app.models.annotation_revision import AnnotationRevision, RevisionAction

    u, a = await _seed_annotation(session)
    session.add(AnnotationRevision(
        annotation_id=a.id, action=RevisionAction.CREATE,
        before=None, after={"field_value": "v1"},
        changed_by=u.id,
    ))
    await session.commit()
    await session.delete(a)
    await session.commit()
    rows = (await session.execute(select(AnnotationRevision))).scalars().all()
    assert rows == []
```

- [ ] **Step 2: Run test (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_annotation_revision_model.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.models.annotation_revision'`.

- [ ] **Step 3: Write annotation_revision.py**

Create `backend/app/models/annotation_revision.py`:

```python
"""AnnotationRevision — append-only audit log for Annotation changes (LS-7)."""
from __future__ import annotations

import enum

from sqlalchemy import Enum as SAEnum, ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, gen_uuid


class RevisionAction(str, enum.Enum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"


class AnnotationRevision(Base, TimestampMixin):
    __tablename__ = "annotation_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    annotation_id: Mapped[str] = mapped_column(
        ForeignKey("annotations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    action: Mapped[RevisionAction] = mapped_column(
        SAEnum(RevisionAction, name="annotation_revision_action"), nullable=False
    )
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    changed_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
```

- [ ] **Step 4: Update models/__init__.py**

REPLACE `backend/app/models/__init__.py`:

```python
"""Models package — import all models so Base.metadata sees them."""
from app.models.annotation import Annotation, AnnotationFieldType, AnnotationSource
from app.models.annotation_revision import AnnotationRevision, RevisionAction
from app.models.base import Base, TimestampMixin, gen_uuid
from app.models.document import Document, DocumentStatus
from app.models.processing_result import ProcessingResult, ProcessingResultSource
from app.models.project import Project
from app.models.user import User
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember, WorkspaceRole

__all__ = [
    "Base", "TimestampMixin", "gen_uuid",
    "Annotation", "AnnotationFieldType", "AnnotationSource",
    "AnnotationRevision", "RevisionAction",
    "Document", "DocumentStatus",
    "ProcessingResult", "ProcessingResultSource",
    "Project",
    "User", "Workspace", "WorkspaceMember", "WorkspaceRole",
]
```

- [ ] **Step 5: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_annotation_revision_model.py -v
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 3 passed; full suite 94 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add backend/app/models/annotation_revision.py backend/app/models/__init__.py backend/tests/test_annotation_revision_model.py
git commit -m "S2a/Task 3: AnnotationRevision model + 3 tests

Append-only audit log (LS-7). action enum (create/update/delete) +
before/after JSON snapshots + changed_by FK RESTRICT. CASCADE on
annotation delete (revisions follow their annotation)."
```

---

### Task 4: Alembic migration

**Files:**
- Create: `backend/alembic/versions/<auto>_s2a_pr_annotation_revision.py`

- [ ] **Step 1: Generate migration**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run alembic revision --autogenerate -m "S2a: processing_results, annotations, annotation_revisions"
```

Inspect the generated file. It must contain three `op.create_table(...)` blocks for `processing_results`, `annotations`, `annotation_revisions` with all columns/FKs/enums/indexes. If autogen captured spurious ops on existing tables (e.g., type tweaks), edit to remove them.

- [ ] **Step 2: Apply**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run alembic upgrade head
sqlite3 data/doc_intel.db ".tables"
```
Expected: tables include `processing_results annotations annotation_revisions` plus all S0/S1 tables.

- [ ] **Step 3: Verify schema**

```bash
sqlite3 data/doc_intel.db ".schema processing_results"
sqlite3 data/doc_intel.db ".schema annotations"
sqlite3 data/doc_intel.db ".schema annotation_revisions"
```

Verify each `CREATE TABLE` has FK `ON DELETE CASCADE`/`RESTRICT` correctly.

- [ ] **Step 4: Roundtrip**

```bash
uv run alembic downgrade -1
uv run alembic upgrade head
```
Both succeed.

- [ ] **Step 5: Run all backend tests**

```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 94 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add backend/alembic/versions/*s2a*.py
git commit -m "S2a/Task 4: alembic migration for predict + annotations

- processing_results: CASCADE on document, RESTRICT on user, indexed
- annotations: CASCADE on document, RESTRICT on created_by/updated_by,
  indexed on document_id + deleted_at
- annotation_revisions: CASCADE on annotation, RESTRICT on changed_by"
```

---

## Phase B — Predict service + endpoint

### Task 5: predict service helpers + 8 unit tests

**Files:**
- Create: `backend/app/services/predict.py`
- Create: `backend/tests/test_predict_helpers.py`

This task implements the four pure helpers used by predict_single + predict_batch_stream: `build_default_prompt`, `_parse_llm_output`, `_infer_schema`, `_next_version`, `_replace_ai_annotations`. They are tested in isolation; full predict_single integration is Task 6.

- [ ] **Step 1: Write failing tests (RED)**

Create `backend/tests/test_predict_helpers.py`:

```python
"""Tests for predict service helpers."""
from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture
async def session(tmp_path, monkeypatch):
    db_file = tmp_path / "predict_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    from app.models.base import Base
    from app.models import (  # noqa: F401
        user, workspace, workspace_member, project, document,
        processing_result, annotation, annotation_revision,
    )
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}", future=True)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        await conn.run_sync(Base.metadata.create_all)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        await s.execute(text("PRAGMA foreign_keys=ON"))
        yield s
    await engine.dispose()


async def _seed(session):
    from app.models.document import Document
    from app.models.project import Project
    from app.models.user import User
    from app.models.workspace import Workspace
    u = User(email="a@x.com", password_hash="h", display_name="A")
    session.add(u); await session.flush()
    w = Workspace(name="W", slug="ws-pp", owner_id=u.id)
    session.add(w); await session.flush()
    p = Project(workspace_id=w.id, name="P", slug="proj-pp", template_key="japan_receipt", created_by=u.id)
    session.add(p); await session.flush()
    d = Document(
        project_id=p.id, filename="x.pdf", file_path="x.pdf",
        file_size=1, mime_type="application/pdf", uploaded_by=u.id,
    )
    session.add(d); await session.flush()
    return u, p, d


def test_build_default_prompt_with_template():
    from app.services.predict import build_default_prompt
    out = build_default_prompt("japan_receipt")
    assert "doc_type" in out  # template's expected_fields
    assert "merchant_name" in out
    assert "JSON" in out


def test_build_default_prompt_no_template_or_unknown():
    from app.services.predict import build_default_prompt
    assert "JSON" in build_default_prompt(None)
    assert "JSON" in build_default_prompt("nonexistent_template")


def test_build_default_prompt_custom_template_empty_fields():
    from app.services.predict import build_default_prompt
    # custom template has expected_fields=[]
    out = build_default_prompt("custom")
    assert "JSON" in out


def test_parse_llm_output_json_block():
    from app.services.predict import _parse_llm_output
    raw = '```json\n{"invoice_number":"INV-001","total":1234.5}\n```'
    out = _parse_llm_output(raw)
    assert out == {"invoice_number": "INV-001", "total": 1234.5}


def test_parse_llm_output_plain_json():
    from app.services.predict import _parse_llm_output
    out = _parse_llm_output('{"a":1,"b":[2,3]}')
    assert out == {"a": 1, "b": [2, 3]}


def test_parse_llm_output_array_wrapped_to_items():
    from app.services.predict import _parse_llm_output
    out = _parse_llm_output('[{"docType":"invoice"},{"docType":"receipt"}]')
    assert out == {"items": [{"docType": "invoice"}, {"docType": "receipt"}]}


def test_parse_llm_output_invalid_returns_raw_marker():
    from app.services.predict import _parse_llm_output
    out = _parse_llm_output("not json at all")
    assert "_raw" in out
    assert out["_raw"] == "not json at all"


def test_infer_schema_simple():
    from app.services.predict import _infer_schema
    out = _infer_schema({"name": "alice", "age": 30, "scores": [1, 2]})
    assert out["name"] == "string"
    assert out["age"] == "number"
    assert out["scores"] == "array"


@pytest.mark.asyncio
async def test_next_version_initial(session):
    from app.services.predict import _next_version
    _, _, d = await _seed(session)
    assert await _next_version(session, d.id) == 1


@pytest.mark.asyncio
async def test_next_version_increments(session):
    from app.models.processing_result import ProcessingResult, ProcessingResultSource
    from app.services.predict import _next_version
    u, _, d = await _seed(session)
    session.add(ProcessingResult(
        document_id=d.id, version=1, structured_data={}, prompt_used="p",
        processor_key="mock|m", source=ProcessingResultSource.PREDICT, created_by=u.id,
    ))
    session.add(ProcessingResult(
        document_id=d.id, version=5, structured_data={}, prompt_used="p",
        processor_key="mock|m", source=ProcessingResultSource.PREDICT, created_by=u.id,
    ))
    await session.commit()
    assert await _next_version(session, d.id) == 6


@pytest.mark.asyncio
async def test_replace_ai_annotations_keeps_manual(session):
    from app.models.annotation import Annotation, AnnotationSource
    from app.services.predict import _replace_ai_annotations

    u, _, d = await _seed(session)
    session.add(Annotation(
        document_id=d.id, field_name="manual_kept", field_value="keep me",
        source=AnnotationSource.MANUAL, created_by=u.id,
    ))
    session.add(Annotation(
        document_id=d.id, field_name="ai_old", field_value="old",
        source=AnnotationSource.AI_DETECTED, created_by=u.id,
    ))
    await session.commit()

    new_data = {"new_field_a": "val_a", "new_field_b": 42}
    await _replace_ai_annotations(session, d.id, new_data, u.id)
    await session.commit()

    rows = (await session.execute(select(Annotation).where(Annotation.deleted_at.is_(None)))).scalars().all()
    names = sorted(r.field_name for r in rows)
    # manual_kept preserved + 2 new ai annotations
    assert "manual_kept" in names
    assert "new_field_a" in names
    assert "new_field_b" in names
    assert "ai_old" not in names  # old AI overwritten
    new_a = next(r for r in rows if r.field_name == "new_field_a")
    assert new_a.source == AnnotationSource.AI_DETECTED
    assert new_a.field_value == "val_a"
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_predict_helpers.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.services.predict'`.

- [ ] **Step 3: Write services/predict.py (helpers only — predict_single is Task 6)**

Create `backend/app/services/predict.py`:

```python
"""Predict service: helpers + per-document predict + batch stream.

Layered:
- build_default_prompt: derive prompt text from Project.template_key
- _parse_llm_output: tolerant LLM output → dict
- _infer_schema: rough type per top-level field
- _next_version: per-document version counter
- _replace_ai_annotations: replace AI-detected rows; keep manual rows
- predict_single: orchestrates engine call + writes (Task 6)
- predict_batch_stream: async iterator yielding per-doc events (Task 8)
"""
from __future__ import annotations

import json
import logging
from typing import AsyncIterator, Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.engine.utils import extract_json
from app.models.annotation import Annotation, AnnotationSource
from app.models.processing_result import ProcessingResult
from app.templates.builtin import get_template

logger = logging.getLogger(__name__)


DEFAULT_PROMPT_TEMPLATE = """
你是一个文档信息提取专家。请从这份文档中提取以下字段，输出严格的 JSON：

{fields_section}

如果某个字段在文档里找不到，请省略该字段（不要输出 null/空字符串）。
所有金额相关字段输出为数字（不带货币符号、千分位逗号）。
日期统一用 YYYY-MM-DD 格式。
""".strip()


def build_default_prompt(template_key: str | None) -> str:
    """Derive default prompt from a Project template_key."""
    if template_key:
        tpl = get_template(template_key)
        if tpl and tpl.expected_fields:
            fields = "\n".join(f"  - {f}" for f in tpl.expected_fields)
            return DEFAULT_PROMPT_TEMPLATE.format(fields_section=fields)
    return "请提取这份文档的关键字段并以 JSON 输出。"


def _parse_llm_output(raw: str) -> dict:
    """Best-effort parse of LLM output; falls back to {'_raw': raw}."""
    if not raw:
        return {"_raw": ""}
    blocks = extract_json(raw)
    candidates = blocks if blocks else [raw.strip()]
    for s in candidates:
        try:
            parsed = json.loads(s)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list):
            return {"items": parsed}
    return {"_raw": raw}


_SCALAR_TYPES = {
    str: "string",
    int: "number",
    float: "number",
    bool: "boolean",
}


def _infer_schema(data: dict) -> dict:
    """Rough type per top-level key (S2a — nested types are S3+)."""
    schema: dict[str, str] = {}
    for k, v in data.items():
        if isinstance(v, list):
            schema[k] = "array"
        elif isinstance(v, dict):
            schema[k] = "object"
        else:
            schema[k] = _SCALAR_TYPES.get(type(v), "string")
    return schema


async def _next_version(db: AsyncSession, document_id: str) -> int:
    """Compute next version for a document (max+1, or 1 if none)."""
    stmt = select(func.max(ProcessingResult.version)).where(
        ProcessingResult.document_id == document_id
    )
    cur = (await db.execute(stmt)).scalar()
    return (cur or 0) + 1


async def _replace_ai_annotations(
    db: AsyncSession, document_id: str, structured: dict, user_id: str
) -> None:
    """Replace source=ai_detected annotations for this document with new
    rows derived from `structured`. Manual annotations are preserved."""
    # Soft-delete existing AI annotations
    stmt = select(Annotation).where(
        Annotation.document_id == document_id,
        Annotation.source == AnnotationSource.AI_DETECTED,
        Annotation.deleted_at.is_(None),
    )
    existing = (await db.execute(stmt)).scalars().all()
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    for a in existing:
        a.deleted_at = now
    await db.flush()

    # Insert new AI annotations from top-level fields
    for field_name, field_value in structured.items():
        if field_name == "_raw":
            continue
        if isinstance(field_value, (dict, list)):
            value_str = json.dumps(field_value, ensure_ascii=False)
        elif field_value is None:
            value_str = None
        else:
            value_str = str(field_value)
        a = Annotation(
            document_id=document_id,
            field_name=field_name,
            field_value=value_str,
            source=AnnotationSource.AI_DETECTED,
            created_by=user_id,
        )
        db.add(a)
    await db.flush()
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_predict_helpers.py -v
```
Expected: 11 passed (8 helper + 3 async = actually 11 total per test file).

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 105 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add backend/app/services/predict.py backend/tests/test_predict_helpers.py
git commit -m "S2a/Task 5: predict service helpers + 11 unit tests

- build_default_prompt: derive from Project.template_key.expected_fields
- _parse_llm_output: extract_json fallback to {'_raw': raw}
- _infer_schema: top-level type inference (S2a only — nested in S3)
- _next_version: per-document max+1
- _replace_ai_annotations: soft-delete old ai_detected rows,
  insert new from structured dict; manual preserved"
```

---

### Task 6: predict_single integration + 6 endpoint tests

**Files:**
- Modify: `backend/app/services/predict.py` (add predict_single)
- Create: `backend/app/schemas/predict.py`
- Create: `backend/app/api/v1/predict.py`
- Modify: `backend/app/api/v1/router.py` (mount predict)
- Create: `backend/tests/test_predict_endpoint.py`

- [ ] **Step 1: Write failing tests (RED)**

Create `backend/tests/test_predict_endpoint.py`:

```python
"""Tests for POST /api/v1/projects/{pid}/documents/{did}/predict (single doc)."""
from __future__ import annotations

import io
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_project_with_doc(client, token: str, template_key: str = "custom"):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-aa"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-aa", "template_key": template_key},
    )
    pid = r2.json()["id"]
    r3 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
    )
    return wsid, pid, r3.json()["id"]


@pytest.mark.asyncio
async def test_predict_single_mock_processor(client, registered_user):
    user, token = registered_user
    _, pid, did = await _setup_project_with_doc(client, token, template_key="custom")
    r = await client.post(
        f"/api/v1/projects/{pid}/documents/{did}/predict",
        headers=_auth(token),
        json={"processor_key_override": "mock"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["version"] == 1
    assert data["source"] == "predict"
    assert data["processor_key"].startswith("mock")
    assert data["created_by"] == user["id"]
    assert isinstance(data["structured_data"], (dict, list))


@pytest.mark.asyncio
async def test_predict_increments_version(client, registered_user):
    _, token = registered_user
    _, pid, did = await _setup_project_with_doc(client, token)
    for expected in (1, 2, 3):
        r = await client.post(
            f"/api/v1/projects/{pid}/documents/{did}/predict",
            headers=_auth(token),
            json={"processor_key_override": "mock"},
        )
        assert r.json()["version"] == expected


@pytest.mark.asyncio
async def test_predict_seeds_annotations(client, registered_user):
    _, token = registered_user
    _, pid, did = await _setup_project_with_doc(client, token)
    await client.post(
        f"/api/v1/projects/{pid}/documents/{did}/predict",
        headers=_auth(token),
        json={"processor_key_override": "mock"},
    )
    r = await client.get(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
    )
    assert r.status_code == 200
    items = r.json()
    assert len(items) > 0
    assert all(a["source"] == "ai_detected" for a in items)


@pytest.mark.asyncio
async def test_predict_prompt_override_recorded(client, registered_user):
    _, token = registered_user
    _, pid, did = await _setup_project_with_doc(client, token)
    custom_prompt = "Custom override prompt — extract just one field."
    r = await client.post(
        f"/api/v1/projects/{pid}/documents/{did}/predict",
        headers=_auth(token),
        json={"prompt_override": custom_prompt, "processor_key_override": "mock"},
    )
    assert r.status_code == 200
    assert r.json()["prompt_used"] == custom_prompt


@pytest.mark.asyncio
async def test_predict_unknown_processor_400(client, registered_user):
    _, token = registered_user
    _, pid, did = await _setup_project_with_doc(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/documents/{did}/predict",
        headers=_auth(token),
        json={"processor_key_override": "nonexistent"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "processor_not_available"


@pytest.mark.asyncio
async def test_predict_404_for_missing_document(client, registered_user):
    _, token = registered_user
    _, pid, _ = await _setup_project_with_doc(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/documents/00000000-0000-0000-0000-000000000000/predict",
        headers=_auth(token),
        json={"processor_key_override": "mock"},
    )
    assert r.status_code == 404
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_predict_endpoint.py -v
```
Expected: 6 failures (404 from missing route).

- [ ] **Step 3: Add predict_single to services/predict.py**

Append to `backend/app/services/predict.py` (after the helpers):

```python
from app.engine.processors.factory import DocumentProcessorFactory
from app.models.document import Document
from app.models.processing_result import ProcessingResult, ProcessingResultSource
from app.models.project import Project
from app.models.user import User
from app.services import storage


class PredictError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


async def predict_single(
    db: AsyncSession,
    *,
    document: Document,
    project: Project,
    user: User,
    prompt_override: str | None = None,
    processor_key_override: str | None = None,
) -> ProcessingResult:
    # 1. Resolve processor_key
    if processor_key_override:
        processor_key = processor_key_override
    else:
        from app.templates.builtin import get_template as _get_tpl
        tpl = _get_tpl(project.template_key) if project.template_key else None
        processor_key = tpl.recommended_processor if tpl else "gemini"

    # 2. Create processor
    parts = processor_key.split("|", 1)
    p_type = parts[0]
    p_kwargs: dict[str, Any] = {"model_name": parts[1]} if len(parts) == 2 else {}
    available = set(DocumentProcessorFactory.get_available())
    if p_type not in available:
        raise PredictError(
            "processor_not_available",
            f"Processor '{p_type}' is not available. Available: {sorted(available)}",
        )
    try:
        processor = DocumentProcessorFactory.create(p_type, **p_kwargs)
    except (ValueError, RuntimeError) as e:
        raise PredictError("processor_not_available", str(e))

    # Record final processor_key (with model name resolved by factory if any)
    final_processor_key = processor_key
    if "|" not in processor_key and hasattr(processor, "model_name"):
        final_processor_key = f"{p_type}|{processor.model_name}"

    # 3. Resolve prompt
    prompt = prompt_override or build_default_prompt(project.template_key)

    # 4. Call engine
    file_path = str(storage.absolute_path(document.file_path))
    try:
        raw = await processor.process_document(file_path, prompt)
    except Exception as e:
        logger.exception("predict_single processor failed for doc %s", document.id)
        raise PredictError("predict_failed", f"Engine error: {e}")

    # 5. Parse
    structured = _parse_llm_output(raw)
    schema = _infer_schema(structured)

    # 6. Write ProcessingResult (version recompute inside transaction)
    next_version = await _next_version(db, document.id)
    pr = ProcessingResult(
        document_id=document.id,
        version=next_version,
        structured_data=structured,
        inferred_schema=schema,
        prompt_used=prompt,
        processor_key=final_processor_key,
        source=ProcessingResultSource.PREDICT,
        created_by=user.id,
    )
    db.add(pr)
    await db.flush()

    # 7. Replace AI annotations
    await _replace_ai_annotations(db, document.id, structured, user.id)

    await db.commit()
    await db.refresh(pr)
    return pr
```

- [ ] **Step 4: Write schemas/predict.py**

Create `backend/app/schemas/predict.py`:

```python
"""Predict request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class PredictRequest(BaseModel):
    prompt_override: str | None = Field(default=None, max_length=10000)
    processor_key_override: str | None = Field(default=None, max_length=120)


class ProcessingResultRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    document_id: str
    version: int
    structured_data: dict[str, Any]
    inferred_schema: dict[str, Any] | None
    prompt_used: str
    processor_key: str
    source: str
    created_by: str
    created_at: datetime


class BatchPredictRequest(BaseModel):
    document_ids: list[str] = Field(min_length=1, max_length=500)
    prompt_override: str | None = Field(default=None, max_length=10000)
    processor_key_override: str | None = Field(default=None, max_length=120)
```

- [ ] **Step 5: Write api/v1/predict.py**

Create `backend/app/api/v1/predict.py`:

```python
"""Predict endpoints — single sync POST + batch SSE."""
from __future__ import annotations

from sqlalchemy import select

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.document import Document
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.schemas.predict import PredictRequest, ProcessingResultRead
from app.services import predict as predict_svc

router = APIRouter(tags=["predict"])


async def _check_doc_access(db, project_id: str, document_id: str, user_id: str):
    """Resolve doc + project, verify access. Returns (project, document)."""
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None)
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

    doc_stmt = select(Document).where(
        Document.id == document_id,
        Document.project_id == project_id,
        Document.deleted_at.is_(None),
    )
    document = (await db.execute(doc_stmt)).scalar_one_or_none()
    if document is None:
        raise AppError(404, "document_not_found", "Document not found.")
    return project, document


@router.post(
    "/api/v1/projects/{project_id}/documents/{document_id}/predict",
    response_model=ProcessingResultRead,
)
async def predict_one(
    project_id: str,
    document_id: str,
    body: PredictRequest,
    db: DbSession,
    user: CurrentUser,
) -> ProcessingResultRead:
    project, document = await _check_doc_access(db, project_id, document_id, user.id)
    try:
        pr = await predict_svc.predict_single(
            db,
            document=document,
            project=project,
            user=user,
            prompt_override=body.prompt_override,
            processor_key_override=body.processor_key_override,
        )
    except predict_svc.PredictError as e:
        if e.code == "processor_not_available":
            raise AppError(400, e.code, e.message)
        raise AppError(500, e.code, e.message)
    return ProcessingResultRead.model_validate(pr)
```

- [ ] **Step 6: Mount router**

Modify `backend/app/api/v1/router.py` — add predict module:

```python
from app.api.v1 import predict as predict_module
v1_router.include_router(predict_module.router)
```

> **Note:** the predict router uses **absolute** paths (`/api/v1/projects/...`) because it sits outside the `prefix="/api/v1"` of `v1_router`. We mount it on `v1_router` for consistency but the routes themselves are absolute. Actually — re-do: since `v1_router` has prefix `/api/v1`, the route should be relative `/projects/...`. Let me fix the predict.py route definition.

REWRITE the route in `backend/app/api/v1/predict.py`:

Change `router = APIRouter(tags=["predict"])` and the route decorator to:

```python
router = APIRouter(prefix="/projects", tags=["predict"])

@router.post("/{project_id}/documents/{document_id}/predict", response_model=ProcessingResultRead)
async def predict_one(...):
    ...
```

This way the full path is `v1_router prefix /api/v1 + router prefix /projects + route /{pid}/documents/{did}/predict = /api/v1/projects/{pid}/documents/{did}/predict`.

- [ ] **Step 7: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_predict_endpoint.py -v
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 6 predict tests pass; full suite 111 passed (105 + 6).

If `test_predict_seeds_annotations` fails because `/api/v1/documents/{did}/annotations` route doesn't exist yet — that's expected; the test will pass after Task 9. **Mark this single test xfail for now** (add `@pytest.mark.xfail(reason="Annotation API in Task 9")` decorator) and confirm the other 5 tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add backend/app/services/predict.py backend/app/schemas/predict.py backend/app/api/v1/predict.py backend/app/api/v1/router.py backend/tests/test_predict_endpoint.py
git commit -m "S2a/Task 6: predict_single + POST /predict + 6 tests

- predict_single orchestrates processor + Annotation replacement
- PredictError → AppError mapping (400 processor_not_available,
  500 predict_failed)
- POST /api/v1/projects/{pid}/documents/{did}/predict (sync)
- 1 test xfail until Task 9 adds Annotation API"
```

---

### Task 7: Annotation CRUD router + 6 tests + revisions

**Files:**
- Create: `backend/app/schemas/annotation.py`
- Create: `backend/app/services/annotation_service.py`
- Create: `backend/app/api/v1/annotations.py`
- Modify: `backend/app/api/v1/router.py`
- Create: `backend/tests/test_annotation_api.py`

- [ ] **Step 1: Write failing test (RED)**

Create `backend/tests/test_annotation_api.py`:

```python
"""Tests for /api/v1/documents/{did}/annotations/*."""
from __future__ import annotations

import io
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_doc(client, token: str):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-ann"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-ann", "template_key": "custom"},
    )
    pid = r2.json()["id"]
    r3 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("x.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    return r3.json()["id"]


@pytest.mark.asyncio
async def test_post_manual_annotation(client, registered_user):
    user, token = registered_user
    did = await _setup_doc(client, token)
    r = await client.post(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
        json={"field_name": "buyer_name", "field_value": "Acme"},
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["source"] == "manual"
    assert data["created_by"] == user["id"]
    assert data["field_value"] == "Acme"


@pytest.mark.asyncio
async def test_get_list_filters_deleted(client, registered_user):
    _, token = registered_user
    did = await _setup_doc(client, token)
    r1 = await client.post(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
        json={"field_name": "a", "field_value": "1"},
    )
    aid = r1.json()["id"]
    await client.delete(
        f"/api/v1/documents/{did}/annotations/{aid}",
        headers=_auth(token),
    )
    r = await client.get(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
    )
    assert r.status_code == 200
    assert all(a["id"] != aid for a in r.json())


@pytest.mark.asyncio
async def test_patch_updates_value_and_writes_revision(client, registered_user, db_session):
    _, token = registered_user
    did = await _setup_doc(client, token)
    r1 = await client.post(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
        json={"field_name": "a", "field_value": "v1"},
    )
    aid = r1.json()["id"]
    r2 = await client.patch(
        f"/api/v1/documents/{did}/annotations/{aid}",
        headers=_auth(token),
        json={"field_value": "v2"},
    )
    assert r2.status_code == 200
    assert r2.json()["field_value"] == "v2"

    # Verify revision row exists in DB
    from sqlalchemy import select
    from app.models.annotation_revision import AnnotationRevision, RevisionAction
    revs = (await db_session.execute(
        select(AnnotationRevision).where(AnnotationRevision.annotation_id == aid)
    )).scalars().all()
    actions = [r.action for r in revs]
    assert RevisionAction.UPDATE in actions


@pytest.mark.asyncio
async def test_patch_sets_updated_by(client, registered_user, db_session):
    user, token = registered_user
    did = await _setup_doc(client, token)
    r1 = await client.post(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
        json={"field_name": "a", "field_value": "v1"},
    )
    aid = r1.json()["id"]
    await client.patch(
        f"/api/v1/documents/{did}/annotations/{aid}",
        headers=_auth(token),
        json={"field_value": "v2"},
    )
    from sqlalchemy import select
    from app.models.annotation import Annotation
    a = (await db_session.execute(select(Annotation).where(Annotation.id == aid))).scalar_one()
    assert a.updated_by_user_id == user["id"]


@pytest.mark.asyncio
async def test_delete_writes_revision(client, registered_user, db_session):
    _, token = registered_user
    did = await _setup_doc(client, token)
    r1 = await client.post(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
        json={"field_name": "a", "field_value": "v1"},
    )
    aid = r1.json()["id"]
    r2 = await client.delete(
        f"/api/v1/documents/{did}/annotations/{aid}",
        headers=_auth(token),
    )
    assert r2.status_code == 204
    from sqlalchemy import select
    from app.models.annotation_revision import AnnotationRevision, RevisionAction
    revs = (await db_session.execute(
        select(AnnotationRevision).where(AnnotationRevision.annotation_id == aid)
    )).scalars().all()
    assert any(r.action == RevisionAction.DELETE for r in revs)


@pytest.mark.asyncio
async def test_create_writes_revision(client, registered_user, db_session):
    _, token = registered_user
    did = await _setup_doc(client, token)
    r = await client.post(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
        json={"field_name": "a", "field_value": "v"},
    )
    aid = r.json()["id"]
    from sqlalchemy import select
    from app.models.annotation_revision import AnnotationRevision, RevisionAction
    revs = (await db_session.execute(
        select(AnnotationRevision).where(AnnotationRevision.annotation_id == aid)
    )).scalars().all()
    assert any(r.action == RevisionAction.CREATE for r in revs)
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_annotation_api.py -v
```
Expected: 6 failures (404).

- [ ] **Step 3: Write schemas/annotation.py**

Create `backend/app/schemas/annotation.py`:

```python
"""Annotation request/response schemas."""
from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class AnnotationCreate(BaseModel):
    field_name: str = Field(min_length=1, max_length=120)
    field_value: str | None = Field(default=None, max_length=2000)
    field_type: str = Field(default="string")
    bounding_box: dict | None = None
    is_ground_truth: bool = False


class AnnotationUpdate(BaseModel):
    field_value: str | None = Field(default=None, max_length=2000)
    field_type: str | None = None
    bounding_box: dict | None = None
    is_ground_truth: bool | None = None


class AnnotationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    document_id: str
    field_name: str
    field_value: str | None
    field_type: str
    bounding_box: dict | None
    source: str
    confidence: float | None
    is_ground_truth: bool
    created_by: str
    updated_by_user_id: str | None
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 4: Write services/annotation_service.py**

Create `backend/app/services/annotation_service.py`:

```python
"""Annotation service: CRUD with revision logging."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.annotation import Annotation, AnnotationFieldType, AnnotationSource
from app.models.annotation_revision import AnnotationRevision, RevisionAction


def _snapshot(a: Annotation) -> dict:
    return {
        "field_name": a.field_name,
        "field_value": a.field_value,
        "field_type": a.field_type.value if a.field_type else None,
        "bounding_box": a.bounding_box,
        "is_ground_truth": a.is_ground_truth,
        "source": a.source.value,
    }


async def _add_revision(
    db: AsyncSession, annotation_id: str, action: RevisionAction,
    before: dict | None, after: dict | None, changed_by: str,
) -> None:
    db.add(AnnotationRevision(
        annotation_id=annotation_id, action=action,
        before=before, after=after, changed_by=changed_by,
    ))


async def list_annotations(db: AsyncSession, document_id: str) -> list[Annotation]:
    stmt = (
        select(Annotation)
        .where(
            Annotation.document_id == document_id,
            Annotation.deleted_at.is_(None),
        )
        .order_by(Annotation.created_at)
    )
    return list((await db.execute(stmt)).scalars().all())


async def create_annotation(
    db: AsyncSession,
    *,
    document_id: str,
    user_id: str,
    field_name: str,
    field_value: str | None,
    field_type: str,
    bounding_box: dict | None,
    is_ground_truth: bool,
    source: AnnotationSource = AnnotationSource.MANUAL,
) -> Annotation:
    try:
        ftype = AnnotationFieldType(field_type)
    except ValueError:
        raise AppError(422, "validation_error", f"Unknown field_type: {field_type}")
    a = Annotation(
        document_id=document_id, field_name=field_name,
        field_value=field_value, field_type=ftype,
        bounding_box=bounding_box, source=source,
        is_ground_truth=is_ground_truth, created_by=user_id,
    )
    db.add(a)
    await db.flush()
    await _add_revision(db, a.id, RevisionAction.CREATE, None, _snapshot(a), user_id)
    await db.commit()
    await db.refresh(a)
    return a


async def get_annotation_or_404(
    db: AsyncSession, document_id: str, annotation_id: str
) -> Annotation:
    stmt = select(Annotation).where(
        Annotation.id == annotation_id,
        Annotation.document_id == document_id,
        Annotation.deleted_at.is_(None),
    )
    a = (await db.execute(stmt)).scalar_one_or_none()
    if a is None:
        raise AppError(404, "annotation_not_found", "Annotation not found.")
    return a


async def update_annotation(
    db: AsyncSession,
    a: Annotation,
    *,
    user_id: str,
    field_value: str | None = ...,  # use sentinel: ... means "not provided"
    field_type: str | None = None,
    bounding_box: dict | None = ...,
    is_ground_truth: bool | None = None,
) -> Annotation:
    before = _snapshot(a)
    if field_value is not ...:
        a.field_value = field_value  # type: ignore[assignment]
    if field_type is not None:
        try:
            a.field_type = AnnotationFieldType(field_type)
        except ValueError:
            raise AppError(422, "validation_error", f"Unknown field_type: {field_type}")
    if bounding_box is not ...:
        a.bounding_box = bounding_box  # type: ignore[assignment]
    if is_ground_truth is not None:
        a.is_ground_truth = is_ground_truth
    a.updated_by_user_id = user_id
    await db.flush()
    await _add_revision(db, a.id, RevisionAction.UPDATE, before, _snapshot(a), user_id)
    await db.commit()
    await db.refresh(a)
    return a


async def delete_annotation(db: AsyncSession, a: Annotation, user_id: str) -> None:
    before = _snapshot(a)
    a.deleted_at = datetime.now(timezone.utc)
    await db.flush()
    await _add_revision(db, a.id, RevisionAction.DELETE, before, None, user_id)
    await db.commit()
```

- [ ] **Step 5: Write api/v1/annotations.py**

Create `backend/app/api/v1/annotations.py`:

```python
"""Annotation router — /api/v1/documents/{did}/annotations/*."""
from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.document import Document
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.schemas.annotation import AnnotationCreate, AnnotationRead, AnnotationUpdate
from app.services import annotation_service as svc

router = APIRouter(prefix="/documents", tags=["annotations"])


async def _check_doc_access(db, document_id: str, user_id: str) -> None:
    doc_stmt = select(Document, Project).join(Project, Project.id == Document.project_id).where(
        Document.id == document_id,
        Document.deleted_at.is_(None),
        Project.deleted_at.is_(None),
    )
    row = (await db.execute(doc_stmt)).first()
    if row is None:
        raise AppError(404, "document_not_found", "Document not found.")
    _, project = row
    mem_stmt = select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == project.workspace_id,
        WorkspaceMember.user_id == user_id,
    )
    if (await db.execute(mem_stmt)).scalar_one_or_none() is None:
        raise AppError(403, "forbidden", "You are not a member of this workspace.")


@router.get("/{document_id}/annotations", response_model=list[AnnotationRead])
async def list_(document_id: str, db: DbSession, user: CurrentUser) -> list[AnnotationRead]:
    await _check_doc_access(db, document_id, user.id)
    rows = await svc.list_annotations(db, document_id)
    return [AnnotationRead.model_validate(r) for r in rows]


@router.post(
    "/{document_id}/annotations",
    response_model=AnnotationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create(
    document_id: str, body: AnnotationCreate,
    db: DbSession, user: CurrentUser,
) -> AnnotationRead:
    await _check_doc_access(db, document_id, user.id)
    a = await svc.create_annotation(
        db, document_id=document_id, user_id=user.id,
        field_name=body.field_name, field_value=body.field_value,
        field_type=body.field_type, bounding_box=body.bounding_box,
        is_ground_truth=body.is_ground_truth,
    )
    return AnnotationRead.model_validate(a)


@router.patch("/{document_id}/annotations/{annotation_id}", response_model=AnnotationRead)
async def patch(
    document_id: str, annotation_id: str, body: AnnotationUpdate,
    db: DbSession, user: CurrentUser,
) -> AnnotationRead:
    await _check_doc_access(db, document_id, user.id)
    a = await svc.get_annotation_or_404(db, document_id, annotation_id)
    a = await svc.update_annotation(
        db, a, user_id=user.id,
        field_value=body.field_value if "field_value" in body.model_fields_set else ...,
        field_type=body.field_type,
        bounding_box=body.bounding_box if "bounding_box" in body.model_fields_set else ...,
        is_ground_truth=body.is_ground_truth,
    )
    return AnnotationRead.model_validate(a)


@router.delete("/{document_id}/annotations/{annotation_id}", status_code=204)
async def delete_(
    document_id: str, annotation_id: str,
    db: DbSession, user: CurrentUser,
) -> None:
    await _check_doc_access(db, document_id, user.id)
    a = await svc.get_annotation_or_404(db, document_id, annotation_id)
    await svc.delete_annotation(db, a, user.id)
```

- [ ] **Step 6: Mount router**

Modify `backend/app/api/v1/router.py` — add annotations:

```python
from app.api.v1 import annotations as annotations_module
v1_router.include_router(annotations_module.router)
```

- [ ] **Step 7: Run tests + remove xfail from Task 6**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_annotation_api.py tests/test_predict_endpoint.py -v
```

Now also remove the `@pytest.mark.xfail` from `test_predict_seeds_annotations` in `tests/test_predict_endpoint.py` — that test should now pass.

```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 117 passed (105 + 6 + 6 = 117).

- [ ] **Step 8: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add backend/app/schemas/annotation.py backend/app/services/annotation_service.py backend/app/api/v1/annotations.py backend/app/api/v1/router.py backend/tests/test_annotation_api.py backend/tests/test_predict_endpoint.py
git commit -m "S2a/Task 7: Annotation router + service + schemas + 6 tests + revisions

- GET/POST/PATCH/DELETE /api/v1/documents/{did}/annotations
- AnnotationRevision rows on every CREATE/UPDATE/DELETE (LS-7)
- updated_by_user_id stamped on PATCH
- Soft delete via deleted_at; list filters out
- Removed xfail from predict test (annotation API now exists)"
```

---

### Task 8: SSE batch predict + 6 tests

**Files:**
- Modify: `backend/app/services/predict.py` (add predict_batch_stream)
- Modify: `backend/app/api/v1/predict.py` (add batch route)
- Create: `backend/tests/test_batch_predict.py`

- [ ] **Step 1: Write failing tests (RED)**

Create `backend/tests/test_batch_predict.py`:

```python
"""Tests for POST /api/v1/projects/{pid}/batch-predict (SSE)."""
from __future__ import annotations

import io
import json
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_n_docs(client, token: str, n: int = 2):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-bb"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-bb", "template_key": "custom"},
    )
    pid = r2.json()["id"]
    dids: list[str] = []
    for i in range(n):
        r3 = await client.post(
            f"/api/v1/projects/{pid}/documents", headers=_auth(token),
            files={"file": (f"d{i}.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
        )
        dids.append(r3.json()["id"])
    return pid, dids


def _parse_sse(text: str) -> list[dict]:
    events: list[dict] = []
    for block in text.strip().split("\n\n"):
        event = {"event": "message", "data": ""}
        for line in block.split("\n"):
            if line.startswith("event:"):
                event["event"] = line[6:].strip()
            elif line.startswith("data:"):
                event["data"] += line[5:].strip()
        if event["data"]:
            event["data"] = json.loads(event["data"])
            events.append(event)
    return events


@pytest.mark.asyncio
async def test_batch_predict_emits_started_completed_done(client, registered_user):
    _, token = registered_user
    pid, dids = await _setup_n_docs(client, token, n=2)

    r = await client.post(
        f"/api/v1/projects/{pid}/batch-predict",
        headers=_auth(token),
        json={"document_ids": dids, "processor_key_override": "mock"},
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(r.text)
    statuses = [e["data"].get("status") for e in events if e["event"] == "predict_progress"]
    assert statuses.count("started") == 2
    assert statuses.count("completed") == 2
    done = [e for e in events if e["event"] == "done"]
    assert len(done) == 1
    assert done[0]["data"]["total"] == 2
    assert done[0]["data"]["succeeded"] == 2
    assert done[0]["data"]["failed"] == 0


@pytest.mark.asyncio
async def test_batch_predict_handles_unknown_doc(client, registered_user):
    _, token = registered_user
    pid, dids = await _setup_n_docs(client, token, n=1)
    r = await client.post(
        f"/api/v1/projects/{pid}/batch-predict",
        headers=_auth(token),
        json={"document_ids": dids + ["00000000-0000-0000-0000-000000000000"], "processor_key_override": "mock"},
    )
    assert r.status_code == 200
    events = _parse_sse(r.text)
    failed = [e for e in events if e["event"] == "predict_progress" and e["data"].get("status") == "failed"]
    assert len(failed) == 1
    done = [e for e in events if e["event"] == "done"][0]
    assert done["data"]["failed"] == 1
    assert done["data"]["succeeded"] == 1


@pytest.mark.asyncio
async def test_batch_predict_empty_list_422(client, registered_user):
    _, token = registered_user
    pid, _ = await _setup_n_docs(client, token, n=0)
    r = await client.post(
        f"/api/v1/projects/{pid}/batch-predict",
        headers=_auth(token),
        json={"document_ids": [], "processor_key_override": "mock"},
    )
    assert r.status_code == 422  # min_length=1 violated


@pytest.mark.asyncio
async def test_batch_predict_unknown_processor_returns_failed_per_doc(client, registered_user):
    _, token = registered_user
    pid, dids = await _setup_n_docs(client, token, n=1)
    r = await client.post(
        f"/api/v1/projects/{pid}/batch-predict",
        headers=_auth(token),
        json={"document_ids": dids, "processor_key_override": "nonexistent"},
    )
    assert r.status_code == 200
    events = _parse_sse(r.text)
    failed = [e for e in events if e["event"] == "predict_progress" and e["data"].get("status") == "failed"]
    assert len(failed) == 1


@pytest.mark.asyncio
async def test_batch_predict_writes_processing_results(client, registered_user, db_session):
    _, token = registered_user
    pid, dids = await _setup_n_docs(client, token, n=2)
    r = await client.post(
        f"/api/v1/projects/{pid}/batch-predict",
        headers=_auth(token),
        json={"document_ids": dids, "processor_key_override": "mock"},
    )
    assert r.status_code == 200
    from sqlalchemy import select
    from app.models.processing_result import ProcessingResult
    rows = (await db_session.execute(select(ProcessingResult))).scalars().all()
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_batch_predict_403_for_non_member(client, registered_user):
    _, token = registered_user
    pid, dids = await _setup_n_docs(client, token, n=1)
    other = await client.post(
        "/api/v1/auth/register",
        json={"email": "x@x.com", "password": "secret123", "display_name": "X"},
    )
    other_token = other.json()["token"]
    r = await client.post(
        f"/api/v1/projects/{pid}/batch-predict",
        headers=_auth(other_token),
        json={"document_ids": dids, "processor_key_override": "mock"},
    )
    assert r.status_code == 403
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_batch_predict.py -v
```
Expected: 6 failures (404 / 405 / 422 mismatches).

- [ ] **Step 3: Add predict_batch_stream to services/predict.py**

Append to `backend/app/services/predict.py`:

```python
async def predict_batch_stream(
    db_factory,
    *,
    project: Project,
    document_ids: list[str],
    user_id: str,
    prompt_override: str | None = None,
    processor_key_override: str | None = None,
) -> AsyncIterator[dict]:
    """Yield {document_id, status, processing_result_id?, error?} per doc,
    then a final {_final, total, succeeded, failed}."""
    succeeded = 0
    failed = 0
    for doc_id in document_ids:
        yield {"document_id": doc_id, "status": "started"}
        try:
            async with db_factory() as db:
                doc = await db.get(Document, doc_id)
                user = await db.get(User, user_id)
                if doc is None or doc.project_id != project.id or doc.deleted_at is not None:
                    yield {"document_id": doc_id, "status": "failed", "error": "document_not_found"}
                    failed += 1
                    continue
                # re-fetch project in this session
                proj_in_session = await db.get(Project, project.id)
                if proj_in_session is None:
                    yield {"document_id": doc_id, "status": "failed", "error": "project_not_found"}
                    failed += 1
                    continue
                pr = await predict_single(
                    db, document=doc, project=proj_in_session, user=user,
                    prompt_override=prompt_override,
                    processor_key_override=processor_key_override,
                )
            yield {"document_id": doc_id, "status": "completed", "processing_result_id": pr.id}
            succeeded += 1
        except PredictError as e:
            yield {"document_id": doc_id, "status": "failed", "error": f"{e.code}: {e.message}"}
            failed += 1
        except Exception as e:
            yield {"document_id": doc_id, "status": "failed", "error": str(e)[:200]}
            failed += 1
    yield {"_final": True, "total": len(document_ids), "succeeded": succeeded, "failed": failed}
```

- [ ] **Step 4: Add batch route to api/v1/predict.py**

Append to `backend/app/api/v1/predict.py` (after the existing `predict_one` route):

```python
from typing import AsyncIterator
import json as _json

from fastapi.responses import StreamingResponse

from app.core.database import AsyncSessionLocal
from app.schemas.predict import BatchPredictRequest


@router.post("/{project_id}/batch-predict")
async def batch_predict(
    project_id: str,
    body: BatchPredictRequest,
    db: DbSession,
    user: CurrentUser,
) -> StreamingResponse:
    # Auth + project access (use the existing first-leg of _check_doc_access manually)
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None)
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")
    mem_stmt = select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == project.workspace_id,
        WorkspaceMember.user_id == user.id,
    )
    if (await db.execute(mem_stmt)).scalar_one_or_none() is None:
        raise AppError(403, "forbidden", "You are not a member of this workspace.")

    async def event_gen() -> AsyncIterator[bytes]:
        async for evt in predict_svc.predict_batch_stream(
            AsyncSessionLocal,
            project=project,
            document_ids=body.document_ids,
            user_id=user.id,
            prompt_override=body.prompt_override,
            processor_key_override=body.processor_key_override,
        ):
            if evt.get("_final"):
                payload = {k: v for k, v in evt.items() if k != "_final"}
                yield f"event: done\ndata: {_json.dumps(payload)}\n\n".encode()
            else:
                yield f"event: predict_progress\ndata: {_json.dumps(evt)}\n\n".encode()

    return StreamingResponse(event_gen(), media_type="text/event-stream")
```

- [ ] **Step 5: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_batch_predict.py -v
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 6 batch tests pass; full suite 123 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add backend/app/services/predict.py backend/app/api/v1/predict.py backend/tests/test_batch_predict.py
git commit -m "S2a/Task 8: SSE batch predict + 6 tests

- predict_batch_stream async generator: per-doc started/completed/failed
  events + final done summary
- POST /api/v1/projects/{pid}/batch-predict (text/event-stream)
- Each doc gets its own DB session (independent transaction)
- LS-4 batch re-predict requirement satisfied"
```

---

### Task 9: next-unreviewed endpoint + 3 tests

**Files:**
- Modify: `backend/app/api/v1/predict.py` (add next-unreviewed route)
- Create: `backend/tests/test_next_unreviewed.py`

- [ ] **Step 1: Write failing tests (RED)**

Create `backend/tests/test_next_unreviewed.py`:

```python
"""Tests for GET /api/v1/projects/{pid}/documents/next-unreviewed."""
from __future__ import annotations

import io
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_project(client, token: str):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-nx"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-nx", "template_key": "custom"},
    )
    return r2.json()["id"]


@pytest.mark.asyncio
async def test_next_unreviewed_returns_first_unpredicted(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    # Upload 2 docs
    r1 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("a.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    r2 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("b.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    did1 = r1.json()["id"]
    # Predict on first
    await client.post(
        f"/api/v1/projects/{pid}/documents/{did1}/predict",
        headers=_auth(token),
        json={"processor_key_override": "mock"},
    )
    r = await client.get(
        f"/api/v1/projects/{pid}/documents/next-unreviewed",
        headers=_auth(token),
    )
    assert r.status_code == 200
    # Returned doc should be the second (unpredicted) one
    assert r.json()["id"] == r2.json()["id"]


@pytest.mark.asyncio
async def test_next_unreviewed_404_when_all_predicted(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    r1 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("a.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    did = r1.json()["id"]
    await client.post(
        f"/api/v1/projects/{pid}/documents/{did}/predict",
        headers=_auth(token),
        json={"processor_key_override": "mock"},
    )
    r = await client.get(
        f"/api/v1/projects/{pid}/documents/next-unreviewed",
        headers=_auth(token),
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "no_unreviewed_documents"


@pytest.mark.asyncio
async def test_next_unreviewed_skips_soft_deleted(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    r1 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("a.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    did1 = r1.json()["id"]
    # Soft-delete
    await client.delete(
        f"/api/v1/projects/{pid}/documents/{did1}",
        headers=_auth(token),
    )
    r = await client.get(
        f"/api/v1/projects/{pid}/documents/next-unreviewed",
        headers=_auth(token),
    )
    assert r.status_code == 404  # only doc was deleted; nothing left
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_next_unreviewed.py -v
```
Expected: 3 failures.

- [ ] **Step 3: Add next-unreviewed route**

Append to `backend/app/api/v1/predict.py`:

```python
from app.models.processing_result import ProcessingResult
from app.schemas.document import DocumentRead


@router.get("/{project_id}/documents/next-unreviewed", response_model=DocumentRead)
async def next_unreviewed(
    project_id: str,
    db: DbSession,
    user: CurrentUser,
) -> DocumentRead:
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None)
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")
    mem_stmt = select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == project.workspace_id,
        WorkspaceMember.user_id == user.id,
    )
    if (await db.execute(mem_stmt)).scalar_one_or_none() is None:
        raise AppError(403, "forbidden", "You are not a member of this workspace.")

    # Subquery: document_ids with at least one ProcessingResult
    predicted_ids = select(ProcessingResult.document_id).distinct()
    stmt = (
        select(Document)
        .where(
            Document.project_id == project_id,
            Document.deleted_at.is_(None),
            Document.id.notin_(predicted_ids),
        )
        .order_by(Document.created_at)
        .limit(1)
    )
    doc = (await db.execute(stmt)).scalar_one_or_none()
    if doc is None:
        raise AppError(404, "no_unreviewed_documents", "All documents have been predicted at least once.")
    return DocumentRead.model_validate(doc)
```

- [ ] **Step 4: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_next_unreviewed.py -v
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 3 next-unreviewed tests pass; full suite 126 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add backend/app/api/v1/predict.py backend/tests/test_next_unreviewed.py
git commit -m "S2a/Task 9: GET next-unreviewed endpoint + 3 tests (LS-5)

Returns first non-soft-deleted Document with no ProcessingResult yet,
ordered by created_at. 404 no_unreviewed_documents when all done."
```

---

## Phase D — Frontend SSE + store

### Task 10: lib/sse.ts streamSse helper + 3 tests

**Files:**
- Create: `frontend/src/lib/sse.ts`
- Create: `frontend/src/lib/__tests__/sse.test.ts`

- [ ] **Step 1: Write failing tests (RED)**

Create `frontend/src/lib/__tests__/sse.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { streamSse } from "../sse";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode(chunks[i++]));
    },
  });
}

function fakeFetch(chunks: string[]) {
  return async () => ({ body: makeStream(chunks) }) as Response;
}

describe("streamSse", () => {
  it("parses single event with named event type and JSON data", async () => {
    const chunks = [
      "event: predict_progress\ndata: {\"a\":1}\n\n",
    ];
    const events: { event: string; data: unknown }[] = [];
    for await (const e of streamSse<{ a: number }>("/x", { fetchImpl: fakeFetch(chunks) })) {
      events.push(e);
    }
    expect(events).toEqual([{ event: "predict_progress", data: { a: 1 } }]);
  });

  it("parses multiple events in one stream", async () => {
    const chunks = [
      "event: a\ndata: {\"i\":1}\n\nevent: a\ndata: {\"i\":2}\n\nevent: done\ndata: {\"total\":2}\n\n",
    ];
    const out: unknown[] = [];
    for await (const e of streamSse<unknown>("/x", { fetchImpl: fakeFetch(chunks) })) {
      out.push(e);
    }
    expect(out).toHaveLength(3);
    expect((out[2] as { event: string }).event).toBe("done");
  });

  it("buffers partial chunks across stream reads", async () => {
    const chunks = ["event: a\nda", "ta: {\"k\":\"v\"}\n", "\n"];
    const out: unknown[] = [];
    for await (const e of streamSse<unknown>("/x", { fetchImpl: fakeFetch(chunks) })) {
      out.push(e);
    }
    expect(out).toEqual([{ event: "a", data: { k: "v" } }]);
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run sse 2>&1 | tail -10
```
Expected: `Cannot find module '../sse'`. Capture.

- [ ] **Step 3: Implement sse.ts**

Create `frontend/src/lib/sse.ts`:

```typescript
export interface SseEvent<T> {
  event: string;
  data: T;
}

interface StreamSseOptions {
  fetchImpl?: typeof fetch;
}

export async function* streamSse<T>(
  url: string,
  init: RequestInit & StreamSseOptions = {}
): AsyncIterable<SseEvent<T>> {
  const { fetchImpl, ...fetchInit } = init as RequestInit & StreamSseOptions;
  const f = fetchImpl ?? fetch;
  const resp = await f(url, fetchInit);
  if (!resp.body) return;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let eventName = "message";
      let dataStr = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
      }
      if (dataStr) {
        yield { event: eventName, data: JSON.parse(dataStr) as T };
      }
    }
  }
}
```

- [ ] **Step 4: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run sse 2>&1 | tail -10
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/lib/sse.ts frontend/src/lib/__tests__/sse.test.ts
git commit -m "S2a/Task 10: streamSse helper + 3 tests

Native fetch + ReadableStream parser. Buffers partial chunks correctly.
Yields {event, data} pairs as JSON-parsed events."
```

---

### Task 11: predict-store + 8 tests

**Files:**
- Create: `frontend/src/stores/predict-store.ts`
- Create: `frontend/src/stores/__tests__/predict-store.test.ts`

- [ ] **Step 1: Write failing tests (RED)**

Create `frontend/src/stores/__tests__/predict-store.test.ts`:

```typescript
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api-client";
import { usePredictStore } from "../predict-store";

let mock: MockAdapter;

const PR = {
  id: "pr-1", document_id: "d-1", version: 1,
  structured_data: { invoice_number: "INV-001" },
  inferred_schema: { invoice_number: "string" },
  prompt_used: "p", processor_key: "mock|m", source: "predict",
  created_by: "u-1", created_at: "2026-04-28T00:00:00Z",
};

const ANN = {
  id: "a-1", document_id: "d-1", field_name: "invoice_number",
  field_value: "INV-001", field_type: "string", bounding_box: null,
  source: "ai_detected", confidence: null, is_ground_truth: false,
  created_by: "u-1", updated_by_user_id: null,
  created_at: "2026-04-28T00:00:00Z", updated_at: "2026-04-28T00:00:00Z",
};

beforeEach(() => {
  mock = new MockAdapter(api);
  usePredictStore.setState({ loading: {}, results: {}, batchProgress: null });
});

afterEach(() => mock.restore());

describe("predict-store", () => {
  it("predictSingle calls POST and stores result", async () => {
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, PR);
    const got = await usePredictStore.getState().predictSingle("p-1", "d-1");
    expect(got.id).toBe("pr-1");
    expect(usePredictStore.getState().results["d-1"].id).toBe("pr-1");
  });

  it("predictSingle sets loading flag during call and clears after", async () => {
    let resolved = false;
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(() => {
      resolved = true;
      return [200, PR];
    });
    const promise = usePredictStore.getState().predictSingle("p-1", "d-1");
    expect(usePredictStore.getState().loading["d-1"]).toBe(true);
    await promise;
    expect(resolved).toBe(true);
    expect(usePredictStore.getState().loading["d-1"]).toBe(false);
  });

  it("predictSingle accepts overrides as options", async () => {
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply((cfg) => {
      const body = JSON.parse(cfg.data);
      expect(body.prompt_override).toBe("custom");
      expect(body.processor_key_override).toBe("openai|gpt-4o");
      return [200, PR];
    });
    await usePredictStore.getState().predictSingle("p-1", "d-1", {
      promptOverride: "custom",
      processorKeyOverride: "openai|gpt-4o",
    });
  });

  it("loadAnnotations populates and returns array", async () => {
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, [ANN]);
    const arr = await usePredictStore.getState().loadAnnotations("d-1");
    expect(arr).toHaveLength(1);
  });

  it("patchAnnotation calls PATCH and returns updated row", async () => {
    mock.onPatch("/api/v1/documents/d-1/annotations/a-1").reply(200, {
      ...ANN, field_value: "v2",
    });
    const out = await usePredictStore.getState().patchAnnotation("d-1", "a-1", { field_value: "v2" });
    expect(out.field_value).toBe("v2");
  });

  it("deleteAnnotation calls DELETE", async () => {
    mock.onDelete("/api/v1/documents/d-1/annotations/a-1").reply(204);
    await usePredictStore.getState().deleteAnnotation("d-1", "a-1");
    expect(mock.history.delete.length).toBe(1);
  });

  it("addAnnotation calls POST with body", async () => {
    mock.onPost("/api/v1/documents/d-1/annotations").reply(201, ANN);
    const out = await usePredictStore.getState().addAnnotation("d-1", {
      field_name: "x", field_value: "v",
    });
    expect(out.id).toBe("a-1");
  });

  it("loadNextUnreviewed returns null on 404", async () => {
    mock.onGet("/api/v1/projects/p-1/documents/next-unreviewed").reply(404, {
      error: { code: "no_unreviewed_documents", message: "all done" },
    });
    const r = await usePredictStore.getState().loadNextUnreviewed("p-1");
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run predict-store 2>&1 | tail -10
```
Expected: `Cannot find module '../predict-store'`.

- [ ] **Step 3: Implement predict-store.ts**

Create `frontend/src/stores/predict-store.ts`:

```typescript
import { create } from "zustand";
import { api, extractApiError } from "../lib/api-client";
import { streamSse } from "../lib/sse";
import { getToken } from "../lib/auth-storage";

export interface ProcessingResult {
  id: string;
  document_id: string;
  version: number;
  structured_data: Record<string, unknown>;
  inferred_schema: Record<string, string> | null;
  prompt_used: string;
  processor_key: string;
  source: string;
  created_by: string;
  created_at: string;
}

export interface Annotation {
  id: string;
  document_id: string;
  field_name: string;
  field_value: string | null;
  field_type: string;
  bounding_box: Record<string, number> | null;
  source: "ai_detected" | "manual";
  confidence: number | null;
  is_ground_truth: boolean;
  created_by: string;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PredictOptions {
  promptOverride?: string;
  processorKeyOverride?: string;
}

export interface NewAnnotation {
  field_name: string;
  field_value?: string;
  field_type?: string;
  bounding_box?: Record<string, number>;
  is_ground_truth?: boolean;
}

export interface AnnotationPatch {
  field_value?: string | null;
  field_type?: string;
  bounding_box?: Record<string, number> | null;
  is_ground_truth?: boolean;
}

export interface BatchEvent {
  document_id: string;
  status: "started" | "completed" | "failed";
  processing_result_id?: string;
  error?: string;
}

export interface BatchProgress {
  total: number;
  events: BatchEvent[];
  done: boolean;
  succeeded: number;
  failed: number;
}

interface PredictState {
  loading: Record<string, boolean>;
  results: Record<string, ProcessingResult>;
  batchProgress: BatchProgress | null;

  predictSingle: (
    projectId: string, documentId: string, opts?: PredictOptions
  ) => Promise<ProcessingResult>;
  predictBatch: (
    projectId: string, documentIds: string[], opts?: PredictOptions
  ) => Promise<void>;
  loadAnnotations: (documentId: string) => Promise<Annotation[]>;
  patchAnnotation: (
    documentId: string, annotationId: string, patch: AnnotationPatch
  ) => Promise<Annotation>;
  deleteAnnotation: (documentId: string, annotationId: string) => Promise<void>;
  addAnnotation: (documentId: string, input: NewAnnotation) => Promise<Annotation>;
  loadNextUnreviewed: (projectId: string) => Promise<{ id: string; filename: string } | null>;
}

export const usePredictStore = create<PredictState>((set, get) => ({
  loading: {},
  results: {},
  batchProgress: null,

  predictSingle: async (projectId, documentId, opts) => {
    set((s) => ({ loading: { ...s.loading, [documentId]: true } }));
    try {
      const r = await api.post<ProcessingResult>(
        `/api/v1/projects/${projectId}/documents/${documentId}/predict`,
        {
          prompt_override: opts?.promptOverride,
          processor_key_override: opts?.processorKeyOverride,
        }
      );
      set((s) => ({
        results: { ...s.results, [documentId]: r.data },
        loading: { ...s.loading, [documentId]: false },
      }));
      return r.data;
    } catch (e) {
      set((s) => ({ loading: { ...s.loading, [documentId]: false } }));
      throw extractApiError(e);
    }
  },

  predictBatch: async (projectId, documentIds, opts) => {
    set({
      batchProgress: { total: documentIds.length, events: [], done: false, succeeded: 0, failed: 0 },
    });
    const token = getToken();
    const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";
    const url = `${baseUrl}/api/v1/projects/${projectId}/batch-predict`;
    const body = JSON.stringify({
      document_ids: documentIds,
      prompt_override: opts?.promptOverride,
      processor_key_override: opts?.processorKeyOverride,
    });
    type Evt = BatchEvent | { total: number; succeeded: number; failed: number };
    for await (const e of streamSse<Evt>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    })) {
      if (e.event === "predict_progress") {
        const evt = e.data as BatchEvent;
        set((s) => ({
          batchProgress: s.batchProgress
            ? { ...s.batchProgress, events: [...s.batchProgress.events, evt] }
            : s.batchProgress,
        }));
      } else if (e.event === "done") {
        const final = e.data as { total: number; succeeded: number; failed: number };
        set((s) => ({
          batchProgress: s.batchProgress
            ? { ...s.batchProgress, done: true, succeeded: final.succeeded, failed: final.failed }
            : s.batchProgress,
        }));
      }
    }
  },

  loadAnnotations: async (documentId) => {
    const r = await api.get<Annotation[]>(`/api/v1/documents/${documentId}/annotations`);
    return r.data;
  },

  patchAnnotation: async (documentId, annotationId, patch) => {
    const r = await api.patch<Annotation>(
      `/api/v1/documents/${documentId}/annotations/${annotationId}`,
      patch,
    );
    return r.data;
  },

  deleteAnnotation: async (documentId, annotationId) => {
    await api.delete(`/api/v1/documents/${documentId}/annotations/${annotationId}`);
  },

  addAnnotation: async (documentId, input) => {
    const r = await api.post<Annotation>(`/api/v1/documents/${documentId}/annotations`, input);
    return r.data;
  },

  loadNextUnreviewed: async (projectId) => {
    try {
      const r = await api.get<{ id: string; filename: string }>(
        `/api/v1/projects/${projectId}/documents/next-unreviewed`
      );
      return r.data;
    } catch (e) {
      const err = extractApiError(e);
      if (err.code === "no_unreviewed_documents") return null;
      throw err;
    }
  },
}));
```

- [ ] **Step 4: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run predict-store 2>&1 | tail -10
```
Expected: 8 passed.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 111 passed (100 + 3 sse + 8 store).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/stores/predict-store.ts frontend/src/stores/__tests__/predict-store.test.ts
git commit -m "S2a/Task 11 (TDD): predict-store + 8 tests

State: loading map, results map, batchProgress.
Actions: predictSingle (POST), predictBatch (SSE via streamSse),
loadAnnotations, patch/delete/addAnnotation, loadNextUnreviewed (404→null).
SSE batch uses raw fetch+stream (axios-mock-adapter doesn't help)."
```

---

## Phase E — Frontend pages

### Task 12: PredictModal + AnnotationEditor + 11 tests

**Files:**
- Create: `frontend/src/components/predict/PredictModal.tsx`
- Create: `frontend/src/components/predict/AnnotationEditor.tsx`
- Create: `frontend/src/components/predict/__tests__/PredictModal.test.tsx`
- Create: `frontend/src/components/predict/__tests__/AnnotationEditor.test.tsx`

- [ ] **Step 1: Write AnnotationEditor failing tests (RED)**

Create `frontend/src/components/predict/__tests__/AnnotationEditor.test.tsx`:

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnnotationEditor from "../AnnotationEditor";

const onPatchMock = vi.fn();
const onDeleteMock = vi.fn();
const onAddMock = vi.fn();

const annotations = [
  {
    id: "a-1", document_id: "d-1", field_name: "invoice_number",
    field_value: "INV-001", field_type: "string", bounding_box: null,
    source: "ai_detected", confidence: 0.95, is_ground_truth: false,
    created_by: "u-1", updated_by_user_id: null,
    created_at: "", updated_at: "",
  },
  {
    id: "a-2", document_id: "d-1", field_name: "total_amount",
    field_value: "1234", field_type: "number", bounding_box: null,
    source: "manual", confidence: null, is_ground_truth: false,
    created_by: "u-1", updated_by_user_id: null,
    created_at: "", updated_at: "",
  },
];

beforeEach(() => {
  onPatchMock.mockReset().mockImplementation(async (_id, p) => ({ ...annotations[0], ...p }));
  onDeleteMock.mockReset();
  onAddMock.mockReset().mockResolvedValue({
    ...annotations[0], id: "a-new", field_name: "new_field", field_value: "v",
  });
});

afterEach(() => vi.clearAllMocks());

describe("AnnotationEditor", () => {
  it("renders all annotations with name, value, source chip", () => {
    render(
      <AnnotationEditor
        annotations={annotations as never}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
      />
    );
    expect(screen.getByDisplayValue("INV-001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1234")).toBeInTheDocument();
    expect(screen.getByText("🤖")).toBeInTheDocument();  // ai_detected chip
    expect(screen.getByText("✏️")).toBeInTheDocument();  // manual chip
  });

  it("editing a field on blur calls onPatch", async () => {
    const user = userEvent.setup();
    render(
      <AnnotationEditor
        annotations={annotations as never}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
      />
    );
    const input = screen.getByDisplayValue("INV-001");
    await user.clear(input);
    await user.type(input, "INV-002");
    await user.tab();
    await waitFor(() => expect(onPatchMock).toHaveBeenCalledWith("a-1", { field_value: "INV-002" }));
  });

  it("clicking delete calls onDelete", async () => {
    const user = userEvent.setup();
    render(
      <AnnotationEditor
        annotations={annotations as never}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
      />
    );
    const buttons = screen.getAllByRole("button", { name: /删除/ });
    await user.click(buttons[0]);
    expect(onDeleteMock).toHaveBeenCalledWith("a-1");
  });

  it("'+ 添加字段' opens form and POSTs", async () => {
    const user = userEvent.setup();
    render(
      <AnnotationEditor
        annotations={annotations as never}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
      />
    );
    await user.click(screen.getByRole("button", { name: /添加字段/ }));
    await user.type(screen.getByLabelText(/字段名/), "new_field");
    await user.type(screen.getByLabelText(/^值/), "v");
    await user.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(() =>
      expect(onAddMock).toHaveBeenCalledWith({
        field_name: "new_field",
        field_value: "v",
        field_type: "string",
      })
    );
  });

  it("empty annotations renders only the + button", () => {
    render(
      <AnnotationEditor
        annotations={[]}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
      />
    );
    expect(screen.getByRole("button", { name: /添加字段/ })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("INV-001")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write PredictModal failing tests (RED)**

Create `frontend/src/components/predict/__tests__/PredictModal.test.tsx`:

```typescript
import MockAdapter from "axios-mock-adapter";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../lib/api-client";
import { usePredictStore } from "../../../stores/predict-store";
import PredictModal from "../PredictModal";

const PR = {
  id: "pr-1", document_id: "d-1", version: 2,
  structured_data: { invoice_number: "INV-001" },
  inferred_schema: { invoice_number: "string" },
  prompt_used: "p", processor_key: "mock|m", source: "predict",
  created_by: "u-1", created_at: "2026-04-28T00:00:00Z",
};

const ANN = {
  id: "a-1", document_id: "d-1", field_name: "invoice_number",
  field_value: "INV-001", field_type: "string", bounding_box: null,
  source: "ai_detected", confidence: null, is_ground_truth: false,
  created_by: "u-1", updated_by_user_id: null,
  created_at: "", updated_at: "",
};

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  usePredictStore.setState({ loading: {}, results: {}, batchProgress: null });
});

afterEach(() => mock.restore());

describe("PredictModal", () => {
  it("triggers predict on open when no result cached", async () => {
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, PR);
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, [ANN]);

    render(
      <PredictModal
        projectId="p-1"
        documentId="d-1"
        filename="invoice.pdf"
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText(/INV-001/)).toBeInTheDocument();
    expect(mock.history.post.length).toBe(1);
  });

  it("renders cached result without re-predicting", async () => {
    usePredictStore.setState({
      results: { "d-1": PR as never },
    });
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, [ANN]);

    render(
      <PredictModal
        projectId="p-1"
        documentId="d-1"
        filename="invoice.pdf"
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText(/INV-001/)).toBeInTheDocument();
    expect(mock.history.post.length).toBe(0);  // no predict triggered
  });

  it("Re-predict button creates new version", async () => {
    usePredictStore.setState({ results: { "d-1": PR as never } });
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, [ANN]);
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, {
      ...PR, id: "pr-2", version: 3,
    });
    const user = userEvent.setup();
    render(
      <PredictModal
        projectId="p-1"
        documentId="d-1"
        filename="invoice.pdf"
        onClose={vi.fn()}
      />
    );
    await screen.findByText(/INV-001/);
    await user.click(screen.getByRole("button", { name: /Re-predict/i }));
    await waitFor(() => expect(mock.history.post.length).toBe(1));
  });

  it("shows version + processor info", async () => {
    usePredictStore.setState({ results: { "d-1": PR as never } });
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, [ANN]);

    render(
      <PredictModal
        projectId="p-1"
        documentId="d-1"
        filename="invoice.pdf"
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText(/v2/)).toBeInTheDocument();
    expect(await screen.findByText(/mock\|m/)).toBeInTheDocument();
  });

  it("close button calls onClose", async () => {
    usePredictStore.setState({ results: { "d-1": PR as never } });
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <PredictModal
        projectId="p-1"
        documentId="d-1"
        filename="invoice.pdf"
        onClose={onClose}
      />
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /关闭/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /关闭/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows error when predict fails", async () => {
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(500, {
      error: { code: "predict_failed", message: "Engine boom" },
    });
    render(
      <PredictModal
        projectId="p-1"
        documentId="d-1"
        filename="invoice.pdf"
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText(/Engine boom/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run predict 2>&1 | tail -10
```
Expected: 11 failures.

- [ ] **Step 4: Implement AnnotationEditor.tsx**

Create `frontend/src/components/predict/AnnotationEditor.tsx`:

```typescript
import { useState } from "react";
import type { Annotation, AnnotationPatch, NewAnnotation } from "../../stores/predict-store";

interface Props {
  annotations: Annotation[];
  onPatch: (id: string, patch: AnnotationPatch) => Promise<Annotation>;
  onDelete: (id: string) => Promise<void>;
  onAdd: (input: NewAnnotation) => Promise<Annotation>;
}

export default function AnnotationEditor({
  annotations, onPatch, onDelete, onAdd,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newType, setNewType] = useState("string");
  const [error, setError] = useState<string | null>(null);

  async function handleBlur(a: Annotation, value: string) {
    if (value === a.field_value) return;
    try {
      await onPatch(a.id, { field_value: value });
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? "保存失败");
    }
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    try {
      await onAdd({ field_name: newName, field_value: newValue, field_type: newType });
      setNewName("");
      setNewValue("");
      setNewType("string");
      setAdding(false);
    } catch (e) {
      setError((e as { message?: string })?.message ?? "添加失败");
    }
  }

  return (
    <div className="space-y-2">
      {annotations.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-sm">
          <span className="text-xs text-[#94a3b8] w-32 truncate" title={a.field_name}>
            {a.field_name}
          </span>
          <input
            type="text"
            defaultValue={a.field_value ?? ""}
            onBlur={(e) => void handleBlur(a, e.target.value)}
            className="flex-1 bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm focus:border-[#6366f1] outline-none"
          />
          <span className="text-xs">
            {a.source === "ai_detected" ? "🤖" : "✏️"}
          </span>
          <button
            type="button"
            onClick={() => void onDelete(a.id)}
            className="text-xs text-[#ef4444] hover:underline"
          >
            删除
          </button>
        </div>
      ))}

      {adding ? (
        <div className="bg-[#0f1117] border border-[#2a2e3d] rounded p-2 space-y-2">
          <label className="block text-xs">
            字段名
            <input
              value={newName} onChange={(e) => setNewName(e.target.value)}
              className="ml-2 bg-[#1a1d27] border border-[#2a2e3d] rounded px-2 py-0.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            值
            <input
              value={newValue} onChange={(e) => setNewValue(e.target.value)}
              className="ml-2 bg-[#1a1d27] border border-[#2a2e3d] rounded px-2 py-0.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            类型
            <select
              value={newType} onChange={(e) => setNewType(e.target.value)}
              className="ml-2 bg-[#1a1d27] border border-[#2a2e3d] rounded px-2 py-0.5 text-sm"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="date">date</option>
              <option value="array">array</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button" onClick={() => void handleAdd()}
              className="bg-[#6366f1] text-white text-xs px-3 py-1 rounded"
            >
              保存
            </button>
            <button
              type="button" onClick={() => setAdding(false)}
              className="text-xs text-[#94a3b8]"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button" onClick={() => setAdding(true)}
          className="text-xs text-[#6366f1] hover:underline"
        >
          + 添加字段
        </button>
      )}

      {error && <div className="text-xs text-[#ef4444]">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 5: Implement PredictModal.tsx**

Create `frontend/src/components/predict/PredictModal.tsx`:

```typescript
import { useEffect, useState } from "react";
import { api } from "../../lib/api-client";
import {
  usePredictStore, type Annotation, type ProcessingResult,
} from "../../stores/predict-store";
import AnnotationEditor from "./AnnotationEditor";

interface Props {
  projectId: string;
  documentId: string;
  filename: string;
  onClose: () => void;
}

export default function PredictModal({
  projectId, documentId, filename, onClose,
}: Props) {
  const result = usePredictStore((s) => s.results[documentId]);
  const loading = usePredictStore((s) => s.loading[documentId] ?? false);
  const predictSingle = usePredictStore((s) => s.predictSingle);
  const loadAnnotations = usePredictStore((s) => s.loadAnnotations);
  const patchAnnotation = usePredictStore((s) => s.patchAnnotation);
  const deleteAnnotation = usePredictStore((s) => s.deleteAnnotation);
  const addAnnotation = usePredictStore((s) => s.addAnnotation);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reloadAnnotations() {
    try {
      const arr = await loadAnnotations(documentId);
      setAnnotations(arr);
    } catch (e) {
      // non-fatal — keep empty
    }
  }

  async function runPredict() {
    setError(null);
    try {
      await predictSingle(projectId, documentId);
      await reloadAnnotations();
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Predict failed");
    }
  }

  useEffect(() => {
    if (!result) {
      void runPredict();
    } else {
      void reloadAnnotations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  async function handlePatch(id: string, patch: { field_value?: string | null }) {
    const out = await patchAnnotation(documentId, id, patch);
    setAnnotations((arr) => arr.map((a) => (a.id === id ? out : a)));
    return out;
  }

  async function handleDelete(id: string) {
    await deleteAnnotation(documentId, id);
    setAnnotations((arr) => arr.filter((a) => a.id !== id));
  }

  async function handleAdd(input: Parameters<typeof addAnnotation>[1]) {
    const out = await addAnnotation(documentId, input);
    setAnnotations((arr) => [...arr, out]);
    return out;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        <header className="px-5 py-3 border-b border-[#2a2e3d] flex items-center justify-between">
          <h2 className="font-semibold">Predict — {filename}</h2>
          <button
            type="button" onClick={onClose}
            className="text-[#94a3b8] hover:text-[#e2e8f0]"
          >
            关闭
          </button>
        </header>

        <div className="flex-1 overflow-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="text-center">
            <img
              src={`${(import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000"}/api/v1/projects/${projectId}/documents/${documentId}/preview`}
              alt={filename}
              className="max-w-full mx-auto border border-[#2a2e3d]"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div className="text-xs text-[#94a3b8] mt-2">{filename}</div>
          </div>

          <div>
            {loading && !result && (
              <div className="text-sm text-[#94a3b8]">⏳ Running predict (10-30s)...</div>
            )}
            {error && <div className="text-sm text-[#ef4444] mb-3">{error}</div>}
            {result && (
              <>
                <div className="text-xs text-[#94a3b8] mb-3">
                  v{result.version} · {result.processor_key}
                </div>
                <AnnotationEditor
                  annotations={annotations}
                  onPatch={handlePatch}
                  onDelete={handleDelete}
                  onAdd={handleAdd}
                />
              </>
            )}
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-[#2a2e3d] flex items-center justify-end gap-3">
          <button
            type="button" onClick={() => void runPredict()}
            disabled={loading}
            className="text-sm text-[#6366f1] hover:underline disabled:opacity-50"
          >
            Re-predict
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run predict 2>&1 | tail -10
```
Expected: 11 passed (5 PredictModal + 6 AnnotationEditor — adjust expected counts to match the test files exactly; aim ≥ 11 passing).

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 122 passed.

- [ ] **Step 7: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/predict/
git commit -m "S2a/Task 12 (TDD): PredictModal + AnnotationEditor + 11 tests

PredictModal: auto-trigger predict on open if no cached result;
2-col layout (preview img + AnnotationEditor); Re-predict button;
processor + version footer.

AnnotationEditor: inline-edit each field on blur (PATCH); + 添加字段
inline form; delete + 🤖/✏️ source chip per row."
```

---

### Task 13: BatchPredictDrawer + 4 tests

**Files:**
- Create: `frontend/src/components/predict/BatchPredictDrawer.tsx`
- Create: `frontend/src/components/predict/__tests__/BatchPredictDrawer.test.tsx`

- [ ] **Step 1: Write failing tests (RED)**

Create `frontend/src/components/predict/__tests__/BatchPredictDrawer.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePredictStore } from "../../../stores/predict-store";
import BatchPredictDrawer from "../BatchPredictDrawer";

beforeEach(() => {
  usePredictStore.setState({
    loading: {}, results: {},
    batchProgress: null,
  });
});

afterEach(() => vi.clearAllMocks());

describe("BatchPredictDrawer", () => {
  it("renders nothing when batchProgress is null", () => {
    render(<BatchPredictDrawer onClose={vi.fn()} />);
    expect(screen.queryByText(/Batch/i)).not.toBeInTheDocument();
  });

  it("renders started/completed/failed events", () => {
    usePredictStore.setState({
      batchProgress: {
        total: 3,
        events: [
          { document_id: "d-1", status: "started" },
          { document_id: "d-2", status: "completed", processing_result_id: "pr-1" },
          { document_id: "d-3", status: "failed", error: "engine boom" },
        ],
        done: false, succeeded: 1, failed: 1,
      },
    });
    render(<BatchPredictDrawer onClose={vi.fn()} />);
    expect(screen.getByText(/d-1/)).toBeInTheDocument();
    expect(screen.getByText(/d-2/)).toBeInTheDocument();
    expect(screen.getByText(/engine boom/)).toBeInTheDocument();
  });

  it("close button calls onClose", async () => {
    usePredictStore.setState({
      batchProgress: {
        total: 1, events: [], done: true, succeeded: 0, failed: 0,
      },
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<BatchPredictDrawer onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /完成|关闭/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("done summary shows succeeded/failed counts", () => {
    usePredictStore.setState({
      batchProgress: {
        total: 2,
        events: [
          { document_id: "d-1", status: "completed" },
          { document_id: "d-2", status: "failed", error: "x" },
        ],
        done: true, succeeded: 1, failed: 1,
      },
    });
    render(<BatchPredictDrawer onClose={vi.fn()} />);
    expect(screen.getByText(/1.*成功/)).toBeInTheDocument();
    expect(screen.getByText(/1.*失败/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BatchPredictDrawer 2>&1 | tail -10
```
Expected: `Cannot find module '../BatchPredictDrawer'`.

- [ ] **Step 3: Implement BatchPredictDrawer.tsx**

Create `frontend/src/components/predict/BatchPredictDrawer.tsx`:

```typescript
import { usePredictStore } from "../../stores/predict-store";

interface Props {
  onClose: () => void;
}

export default function BatchPredictDrawer({ onClose }: Props) {
  const progress = usePredictStore((s) => s.batchProgress);
  if (!progress) return null;

  return (
    <aside className="fixed top-0 right-0 h-full w-96 bg-[#1a1d27] border-l border-[#2a2e3d] shadow-xl z-40 flex flex-col">
      <header className="px-4 py-3 border-b border-[#2a2e3d]">
        <h2 className="font-semibold text-sm">
          Batch Predict ({progress.events.length}/{progress.total})
        </h2>
      </header>

      <ul className="flex-1 overflow-auto p-3 space-y-1 text-xs">
        {progress.events.map((e, idx) => (
          <li
            key={`${e.document_id}-${idx}`}
            className={
              e.status === "completed"
                ? "text-[#22c55e]"
                : e.status === "failed"
                ? "text-[#ef4444]"
                : "text-[#94a3b8]"
            }
          >
            {e.status === "completed" ? "✓" : e.status === "failed" ? "✗" : "⋯"}{" "}
            {e.document_id}
            {e.error && ` — ${e.error}`}
          </li>
        ))}
      </ul>

      {progress.done && (
        <div className="px-4 py-2 border-t border-[#2a2e3d] text-xs">
          完成：<span className="text-[#22c55e]">{progress.succeeded} 成功</span> ·{" "}
          <span className="text-[#ef4444]">{progress.failed} 失败</span>
        </div>
      )}

      <footer className="px-4 py-3 border-t border-[#2a2e3d] flex justify-end">
        <button
          type="button" onClick={onClose}
          className="text-sm text-[#94a3b8] hover:text-[#e2e8f0]"
        >
          {progress.done ? "完成" : "关闭"}
        </button>
      </footer>
    </aside>
  );
}
```

- [ ] **Step 4: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BatchPredictDrawer 2>&1 | tail -10
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/predict/BatchPredictDrawer.tsx frontend/src/components/predict/__tests__/BatchPredictDrawer.test.tsx
git commit -m "S2a/Task 13 (TDD): BatchPredictDrawer + 4 tests

Right-side drawer reads batchProgress from predict-store; renders
per-doc rows with ⋯/✓/✗ and error text; final summary; close button."
```

---

### Task 14: ProjectDocumentsPage integration + 3 tests

**Files:**
- Modify: `frontend/src/pages/ProjectDocumentsPage.tsx` (add Predict button per row + checkboxes + Batch Predict + Next Unreviewed buttons + integrate Modal & Drawer)
- Modify: `frontend/src/pages/__tests__/ProjectDocumentsPage.test.tsx` (3 new tests)

- [ ] **Step 1: Add 3 failing tests to existing test file**

Open `frontend/src/pages/__tests__/ProjectDocumentsPage.test.tsx`. At the bottom of the existing describe, add these 3 tests:

```typescript
  it("clicking Predict on a row opens PredictModal", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1", "x.pdf"),
    ]));
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, {
      id: "pr-1", document_id: "d-1", version: 1,
      structured_data: { x: 1 }, inferred_schema: {x: "number"},
      prompt_used: "p", processor_key: "mock|m", source: "predict",
      created_by: "u-1", created_at: "",
    });
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);

    const user = userEvent.setup();
    renderPage();
    await screen.findByText("x.pdf");
    await user.click(screen.getByRole("button", { name: /^Predict$/ }));
    expect(await screen.findByText(/Predict — x.pdf/)).toBeInTheDocument();
  });

  it("Batch Predict button is disabled when no rows selected", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1"),
    ]));
    renderPage();
    await screen.findByText("d-1.pdf");
    const btn = screen.getByRole("button", { name: /Batch Predict/i });
    expect(btn).toBeDisabled();
  });

  it("Next Unreviewed: 404 shows toast and no modal opens", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1"),
    ]));
    mock.onGet("/api/v1/projects/p-1/documents/next-unreviewed").reply(404, {
      error: { code: "no_unreviewed_documents", message: "all done" },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("d-1.pdf");
    await user.click(screen.getByRole("button", { name: /Next Unreviewed/i }));
    // Modal should NOT open
    expect(screen.queryByText(/Predict —/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run ProjectDocumentsPage 2>&1 | tail -10
```
Expected: at least 3 new failures.

- [ ] **Step 3: Modify ProjectDocumentsPage.tsx**

Open `frontend/src/pages/ProjectDocumentsPage.tsx`. At the top, add new imports:

```typescript
import PredictModal from "../components/predict/PredictModal";
import BatchPredictDrawer from "../components/predict/BatchPredictDrawer";
import { usePredictStore } from "../stores/predict-store";
```

Inside the component, add new state and helpers (at the top of the function, after the existing state):

```typescript
  const [predictTarget, setPredictTarget] = useState<{ id: string; filename: string } | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const predictBatch = usePredictStore((s) => s.predictBatch);
  const loadNextUnreviewed = usePredictStore((s) => s.loadNextUnreviewed);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onBatchPredict() {
    if (selected.size === 0) return;
    setBatchOpen(true);
    await predictBatch(pid ?? "", Array.from(selected));
  }

  async function onNextUnreviewed() {
    const doc = await loadNextUnreviewed(pid ?? "");
    if (doc) {
      setPredictTarget(doc);
    } else {
      alert("已全部 predict 过");  // simple toast for S2a
    }
  }
```

In the JSX, between the upload component and the filter bar, add a toolbar with the new buttons:

```typescript
      <div className="flex gap-2 mt-4 mb-4">
        <button
          type="button" onClick={() => void onBatchPredict()}
          disabled={selected.size === 0}
          className="bg-[#6366f1] hover:bg-[#818cf8] text-white text-sm px-3 py-1.5 rounded disabled:opacity-50"
        >
          + Batch Predict ({selected.size} selected)
        </button>
        <button
          type="button" onClick={() => void onNextUnreviewed()}
          className="text-sm text-[#94a3b8] border border-[#2a2e3d] px-3 py-1.5 rounded hover:bg-[#1a1d27]"
        >
          ▶ Next Unreviewed
        </button>
      </div>
```

In the `<thead>` row add a checkbox column at the start:

```typescript
              <th className="text-left py-2 w-8"></th>
```

In the `{docs.items.map((d) => ...)}` row, add a checkbox cell at the start:

```typescript
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(d.id)}
                    onChange={() => toggleSelect(d.id)}
                  />
                </td>
```

In the right-most "操作" cell, prepend a Predict button before "标记为 GT":

```typescript
                  <button
                    type="button"
                    onClick={() => setPredictTarget({ id: d.id, filename: d.filename })}
                    className="text-xs text-[#6366f1] hover:underline mr-3"
                  >
                    Predict
                  </button>
```

At the bottom of the page (before the closing `</div>`), add the modal and drawer:

```typescript
      {predictTarget && (
        <PredictModal
          projectId={pid ?? ""}
          documentId={predictTarget.id}
          filename={predictTarget.filename}
          onClose={() => {
            setPredictTarget(null);
            void loadDocs();
          }}
        />
      )}
      {batchOpen && <BatchPredictDrawer onClose={() => {
        setBatchOpen(false);
        void loadDocs();
      }} />}
```

Also add `useState` import from react and adjust top of file accordingly (probably already imported).

- [ ] **Step 4: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test 2>&1 | tail -3
```
Expected: 129 passed (122 + 4 batch + 3 page = ~129).

If a previously-passing ProjectDocumentsPage test fails because of new checkbox column / new buttons, adjust assertions in that test to match new column count or button presence — but **do NOT change S1 behavior**.

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/pages/ProjectDocumentsPage.tsx frontend/src/pages/__tests__/ProjectDocumentsPage.test.tsx
git commit -m "S2a/Task 14 (TDD): ProjectDocumentsPage integration + 3 tests

- Per-row Predict button → opens PredictModal
- New checkbox column for multi-select; '+ Batch Predict (N selected)'
  button (disabled when 0); opens BatchPredictDrawer
- '▶ Next Unreviewed' button → opens PredictModal for that doc, or
  alerts if all done
- Modal/drawer close triggers list refetch (in case PR side-effects
  affected document state)"
```

---

## Phase F — Smoke + tag

### Task 15: end-to-end smoke + s2a-complete tag

**Files:** none modified — execution + tag.

This task is the orchestrator's job (Playwright + curl + sqlite3). The orchestrator runs the spec §9 acceptance flow against fresh DB, verifies all 14 steps pass, then tags `s2a-complete`.

- [ ] **Step 1: Reset DB + start servers**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
rm -f data/doc_intel.db data/doc_intel.db-shm data/doc_intel.db-wal
uv run alembic upgrade head
uv run uvicorn app.main:app --port 8000 &
cd ../frontend
npm run dev &
```

- [ ] **Step 2: Walk spec §9 14 steps**

Use Playwright + curl to drive:
1. register alice, login
2. create workspace + project (custom template)
3. upload alpha.pdf, beta.pdf
4. UI: click "Predict" on alpha → modal opens, spinner, then result + annotations editable
5. inline-edit one field → blur → PATCH succeeds
6. click "Re-predict" → version 2 created
7. close modal
8. select alpha + beta → click "+ Batch Predict (2)" → drawer opens, 2 events come in, done summary
9. click "▶ Next Unreviewed" on empty project (after batch predict, all docs predicted) → 404 toast
10. sqlite3 verify `processing_results` ≥ 3 rows
11. sqlite3 verify `annotations` exists with `updated_by_user_id` set after PATCH
12. sqlite3 verify `annotation_revisions` has at least 1 update row
13. backend restart → re-login → all data preserved
14. `pytest -q` ≥ 117 backend; `npm test` ≥ 129 frontend

- [ ] **Step 3: Stop servers**

```bash
lsof -ti :8000 | xargs kill 2>/dev/null
pkill -f vite 2>/dev/null
```

- [ ] **Step 4: Tag s2a-complete**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git tag -a s2a-complete -m "S2a Predict Engine + Minimal Result UI complete

End-to-end predict path: ProcessingResult + Annotation + AnnotationRevision
models with LS-7 audit, POST /predict (sync) for single, SSE /batch-predict
for many (LS-4), per-predict overrides (LS-3), next-unreviewed queue (LS-5),
Annotation CRUD with full revision logging.

Frontend: PredictModal opens on per-row 'Predict' button, auto-triggers
predict if no cached result, shows preview + editable Annotation list
with inline blur-PATCH and + 添加字段 form. BatchPredictDrawer streams
SSE per-doc progress with done summary. Multi-select checkboxes on
documents page. 'Next Unreviewed' button.

180 → 246 tests:
- Backend ≥ 117 (was 80, added 5 PR + 6 ann + 3 rev + 11 helper +
  6 predict ep + 6 ann api + 6 batch + 3 next-unreviewed = +37)
- Frontend ≥ 129 (was 100, added 3 sse + 8 store + 11 modal/editor +
  4 drawer + 3 page = +29)

Out of scope (→ S2b): three-column workspace UX (DocumentCanvas + bbox +
FieldEditor + JsonPreview), 6-step state machine, document switcher."

git tag --list | grep complete
```

- [ ] **Step 5: Update memory pointer (off-tree, by orchestrator)**

The orchestrator updates `/Users/qinqiang02/.claude/projects/-Users-qinqiang02-colab-codespace-ai-label-studio/memory/project_doc_intel_redesign.md` to mark **S2a status: completed**.

---

## Self-Review (post-write checklist)

1. **Spec coverage:** §3 (models) → T1-T3, §4 (migration) → T4, §5 (predict service) → T5+T6+T8, §6.1 (predict endpoints) → T6+T8+T9, §6.2 (annotation CRUD) → T7, §7 (frontend) → T10-T14, §9 (acceptance) → T15. LS-3/4/5/7 mapped to specific tasks. ✓
2. **Placeholders:** none. ✓
3. **Type consistency:** `ProcessingResult` shape identical between backend (`processing_result.py`), schema (`schemas/predict.py`), and frontend (`predict-store.ts`). `Annotation` shape consistent across model/schema/store. SSE event names (`predict_progress`, `done`) consistent between service / endpoint / store / drawer. ✓

**Total: 15 tasks, ≈21h.** Acceptance from spec §9 in T15.

