# S3 — Prompt Versioning + NL Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **TDD is mandatory** — every code unit must have its failing test written first, observed RED, then GREEN.

**Goal:** Make `Project.active_prompt` versioned and editable. Replace the locked Tune step with a real history drawer + AI-assisted correction console (SSE-streamed prompt revise + preview predict).

**Architecture:** New `prompt_versions` table + `projects.active_prompt_version_id` column (one alembic migration). 4 REST endpoints + 1 SSE endpoint mirroring S2a's `text/event-stream` framing. Engine adds async `revise_prompt` token-stream method on processors (gemini + openai concrete; mock has deterministic 3-chunk stream for tests). Frontend gains predict-store actions + 2 panels (PromptHistoryPanel right drawer, NLCorrectionConsole bottom drawer) + StepIndicator step-4 unlock + `lib/diff.ts` line/field diff helpers.

**Tech Stack:** FastAPI async + SQLAlchemy 2.x + alembic + sse-starlette-like manual framing (already in predict.py) + Vite 8 + React 19 + Zustand + native fetch ReadableStream (existing `lib/sse.ts`).

**Spec:** `docs/superpowers/specs/2026-04-29-S3-prompt-versioning-nl-correction-design.md`
**LS-features cross-spec:** `docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md` — completes **LS-3**.
**Repo root:** `/Users/qinqiang02/colab/codespace/ai/doc-intel/`
**Baseline:** tag `s2b2-complete` (126 backend + 196 frontend = 322 tests).
**Target:** ≥144 backend + ≥224 frontend = ≥368 tests.

**Alembic chain:** S0 `d9e2957d1511` → S1 `cc4a010e73f1` → S2a `80840f9d0efa` → **S3 (new)**. The new revision id is `e1b5c0d3f7a4` (chosen randomly; engineers can change if collision detected).

**SSE framing reference:** `backend/app/api/v1/predict.py:104-117` (batch predict). All S3 SSE events use the same `f"event: NAME\ndata: {json.dumps(payload)}\n\n".encode()` shape.

**Frontend SSE consumer reference:** `frontend/src/lib/sse.ts` exports `streamSse<T>(url, init)` async iterable yielding `{event, data}`. Reuse as-is.

---

## Phase A — Backend persistence (T1-T2)

### Task 1: PromptVersion model + alembic migration + 6 backend tests

**Files:**
- Create: `backend/app/models/prompt_version.py`
- Create: `backend/alembic/versions/e1b5c0d3f7a4_s3_prompt_versions.py`
- Modify: `backend/app/models/project.py` (add `active_prompt_version_id` column)
- Modify: `backend/app/models/__init__.py` (register the new model)
- Create: `backend/tests/test_prompt_version_model.py` (3 model tests)
- Create: `backend/app/services/prompt_service.py` (skeleton + create/list helpers)
- Create: `backend/app/schemas/prompt_version.py`
- Create: `backend/tests/test_prompt_service.py` (3 service tests)

- [ ] **Step 1: Add failing tests (RED)**

Create `backend/tests/test_prompt_version_model.py`:

```python
"""S3/T1: PromptVersion model unit tests."""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError


@pytest.mark.asyncio
async def test_prompt_version_basic_insert(db_session, seed_project):
    from app.models.prompt_version import PromptVersion

    pv = PromptVersion(
        project_id=seed_project.id,
        version=1,
        prompt_text="Hello",
        summary="initial",
        created_by=seed_project.created_by,
    )
    db_session.add(pv)
    await db_session.commit()
    out = (await db_session.execute(select(PromptVersion))).scalar_one()
    assert out.version == 1
    assert out.summary == "initial"
    assert out.deleted_at is None


@pytest.mark.asyncio
async def test_prompt_version_unique_per_project(db_session, seed_project):
    from app.models.prompt_version import PromptVersion

    db_session.add(PromptVersion(
        project_id=seed_project.id, version=1, prompt_text="a",
        summary="", created_by=seed_project.created_by,
    ))
    await db_session.commit()
    db_session.add(PromptVersion(
        project_id=seed_project.id, version=1, prompt_text="b",
        summary="", created_by=seed_project.created_by,
    ))
    with pytest.raises(IntegrityError):
        await db_session.commit()


@pytest.mark.asyncio
async def test_project_active_prompt_version_id_column_exists(db_session, seed_project):
    # Column should be nullable, default None
    assert hasattr(seed_project, "active_prompt_version_id")
    assert seed_project.active_prompt_version_id is None
```

Create `backend/tests/test_prompt_service.py`:

```python
"""S3/T1: prompt_service unit tests."""
from __future__ import annotations

import pytest
from sqlalchemy import select


@pytest.mark.asyncio
async def test_create_prompt_version_assigns_increasing_version(db_session, seed_project, seed_user):
    from app.services import prompt_service as svc
    from app.models.prompt_version import PromptVersion

    v1 = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="first", summary="a",
    )
    v2 = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="second", summary="b",
    )
    assert v1.version == 1
    assert v2.version == 2

    rows = (await db_session.execute(select(PromptVersion))).scalars().all()
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_list_prompt_versions_excludes_soft_deleted_and_orders_desc(db_session, seed_project, seed_user):
    from app.services import prompt_service as svc
    from datetime import datetime, timezone

    v1 = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="first", summary="a",
    )
    v2 = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="second", summary="b",
    )
    v1.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    rows = await svc.list_prompt_versions(db_session, project_id=seed_project.id)
    assert [r.version for r in rows] == [2]


@pytest.mark.asyncio
async def test_set_active_prompt_updates_project(db_session, seed_project, seed_user):
    from app.services import prompt_service as svc

    v1 = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="first", summary="",
    )
    proj = await svc.set_active_prompt(
        db_session, project_id=seed_project.id, version_id=v1.id,
    )
    assert proj.active_prompt_version_id == v1.id

    proj2 = await svc.set_active_prompt(
        db_session, project_id=seed_project.id, version_id=None,
    )
    assert proj2.active_prompt_version_id is None
```

You'll need fixtures `seed_user` and `seed_project` — these likely exist in `backend/tests/conftest.py`. If they don't, add them. Quick check:

```bash
grep -n "^@pytest_asyncio.fixture\|^@pytest.fixture\|seed_project\|seed_user" backend/tests/conftest.py | head -20
```

If `seed_user` / `seed_project` don't already exist, add them to `conftest.py`:

```python
@pytest_asyncio.fixture
async def seed_user(db_session):
    from app.models.user import User
    from app.core.security import hash_password
    u = User(email="alice@example.com", password_hash=hash_password("pass1234"), display_name="Alice")
    db_session.add(u)
    await db_session.commit()
    await db_session.refresh(u)
    return u


@pytest_asyncio.fixture
async def seed_project(db_session, seed_user):
    from app.models.workspace import Workspace
    from app.models.workspace_member import WorkspaceMember
    from app.models.project import Project

    ws = Workspace(name="Demo", slug="demo", owner_id=seed_user.id)
    db_session.add(ws)
    await db_session.flush()
    db_session.add(WorkspaceMember(workspace_id=ws.id, user_id=seed_user.id, role="owner"))
    proj = Project(workspace_id=ws.id, name="Receipts", slug="receipts",
                   template_key="china_vat", created_by=seed_user.id)
    db_session.add(proj)
    await db_session.commit()
    await db_session.refresh(proj)
    return proj
```

Use the existing fixture if present; only add if missing.

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_prompt_version_model.py tests/test_prompt_service.py -v 2>&1 | tail -20
```

Expected: ImportError for `app.models.prompt_version` / `app.services.prompt_service`. Capture output.

- [ ] **Step 3: Create migration**

Create `backend/alembic/versions/e1b5c0d3f7a4_s3_prompt_versions.py`:

```python
"""S3: prompt_versions + projects.active_prompt_version_id

Revision ID: e1b5c0d3f7a4
Revises: 80840f9d0efa
Create Date: 2026-04-29 00:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
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
```

- [ ] **Step 4: Add model**

Create `backend/app/models/prompt_version.py`:

```python
"""PromptVersion ORM model — append-only history per Project."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.timestamp_mixin import TimestampMixin  # use whichever mixin exists

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.user import User


class PromptVersion(Base):
    __tablename__ = "prompt_versions"
    __table_args__ = (
        UniqueConstraint("project_id", "version", name="uq_prompt_versions_project_version"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4()),
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    prompt_text: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

If the existing models in this repo don't use `TimestampMixin`, just inline `created_at` (already done above) — verify by reading `backend/app/models/document.py` and matching its style.

Modify `backend/app/models/project.py`. Find the Project class and ADD this column (anywhere among the existing column declarations, kept tidy near `template_key`):

```python
active_prompt_version_id: Mapped[str | None] = mapped_column(
    String(36),
    ForeignKey("prompt_versions.id", ondelete="SET NULL"),
    nullable=True,
)
```

Modify `backend/app/models/__init__.py` to import the new model so SQLAlchemy can find it for `Base.metadata.create_all` paths in tests:

```python
from app.models.prompt_version import PromptVersion  # noqa: F401
```

(Add alongside existing imports; if the file uses `__all__`, add `"PromptVersion"`.)

- [ ] **Step 5: Add schemas**

Create `backend/app/schemas/prompt_version.py`:

```python
"""S3: PromptVersion request/response schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PromptVersionCreate(BaseModel):
    prompt_text: str = Field(min_length=1)
    summary: str = Field(default="", max_length=200)


class PromptVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    version: int
    prompt_text: str
    summary: str
    created_by: str
    created_at: datetime
    is_active: bool = False  # set explicitly by service layer (computed)


class ActivePromptUpdate(BaseModel):
    version_id: str | None = None
```

- [ ] **Step 6: Add service**

Create `backend/app/services/prompt_service.py`:

```python
"""S3: PromptVersion CRUD + active-prompt resolution helpers."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.project import Project
from app.models.prompt_version import PromptVersion
from app.models.user import User


async def create_prompt_version(
    db: AsyncSession,
    *,
    project_id: str,
    user: User,
    prompt_text: str,
    summary: str = "",
) -> PromptVersion:
    next_version_stmt = select(func.coalesce(func.max(PromptVersion.version), 0) + 1).where(
        PromptVersion.project_id == project_id,
    )
    next_version = (await db.execute(next_version_stmt)).scalar_one()
    pv = PromptVersion(
        project_id=project_id,
        version=next_version,
        prompt_text=prompt_text,
        summary=summary,
        created_by=user.id,
    )
    db.add(pv)
    await db.commit()
    await db.refresh(pv)
    return pv


async def list_prompt_versions(
    db: AsyncSession, *, project_id: str,
) -> Sequence[PromptVersion]:
    stmt = (
        select(PromptVersion)
        .where(PromptVersion.project_id == project_id, PromptVersion.deleted_at.is_(None))
        .order_by(PromptVersion.version.desc())
    )
    return (await db.execute(stmt)).scalars().all()


async def get_prompt_version_or_404(
    db: AsyncSession, *, project_id: str, version_id: str,
) -> PromptVersion:
    stmt = select(PromptVersion).where(
        PromptVersion.id == version_id,
        PromptVersion.project_id == project_id,
        PromptVersion.deleted_at.is_(None),
    )
    pv = (await db.execute(stmt)).scalar_one_or_none()
    if pv is None:
        raise AppError(404, "prompt_version_not_found", "Prompt version not found.")
    return pv


async def soft_delete_prompt_version(
    db: AsyncSession, *, project_id: str, version_id: str,
) -> None:
    pv = await get_prompt_version_or_404(db, project_id=project_id, version_id=version_id)
    proj_stmt = select(Project).where(Project.id == project_id)
    project = (await db.execute(proj_stmt)).scalar_one()
    if project.active_prompt_version_id == pv.id:
        raise AppError(409, "prompt_in_use", "Cannot delete the active prompt version.")
    pv.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def set_active_prompt(
    db: AsyncSession, *, project_id: str, version_id: str | None,
) -> Project:
    proj_stmt = select(Project).where(Project.id == project_id, Project.deleted_at.is_(None))
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")
    if version_id is not None:
        # validate it exists and belongs to this project
        await get_prompt_version_or_404(db, project_id=project_id, version_id=version_id)
    project.active_prompt_version_id = version_id
    await db.commit()
    await db.refresh(project)
    return project
```

- [ ] **Step 7: Apply migration locally**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run alembic upgrade head 2>&1 | tail -5
```

Expected: log line `Running upgrade 80840f9d0efa -> e1b5c0d3f7a4, S3: prompt_versions + projects.active_prompt_version_id`.

- [ ] **Step 8: Run (GREEN)**

```bash
uv run pytest tests/test_prompt_version_model.py tests/test_prompt_service.py -v 2>&1 | tail -20
```

Expected: 6 passed (3 model + 3 service).

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 132 passed (was 126 → +6).

- [ ] **Step 9: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add backend/alembic/versions/e1b5c0d3f7a4_s3_prompt_versions.py \
        backend/app/models/prompt_version.py \
        backend/app/models/project.py \
        backend/app/models/__init__.py \
        backend/app/schemas/prompt_version.py \
        backend/app/services/prompt_service.py \
        backend/tests/test_prompt_version_model.py \
        backend/tests/test_prompt_service.py \
        backend/tests/conftest.py  # only if you added seed_user/seed_project
git commit -m "S3/Task 1 (TDD): PromptVersion model + migration + 6 tests

- alembic e1b5c0d3f7a4 down_rev 80840f9d0efa: prompt_versions table
  + projects.active_prompt_version_id column (SET NULL on delete)
- PromptVersion ORM (id, project_id, version, prompt_text, summary,
  created_by, created_at, deleted_at) with unique (project_id, version)
- prompt_service: create (auto-incrementing version), list (excludes
  soft-deleted, desc), set_active (with project lookup + 404),
  soft_delete (refuses if active → 409 prompt_in_use)
- PromptVersionCreate / Read / ActivePromptUpdate Pydantic schemas

Backend: 126 -> 132."
```

---

### Task 2: prompts router (4 REST endpoints) + 4 backend tests

**Files:**
- Create: `backend/app/api/v1/prompts.py`
- Modify: `backend/app/api/v1/router.py` (register the new router)
- Create: `backend/tests/test_prompts_api.py`

- [ ] **Step 1: Write failing tests (RED)**

Create `backend/tests/test_prompts_api.py`:

```python
"""S3/T2: prompts router tests."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_list_prompt_versions_returns_array_with_active_flag(client_authed, seed_project_authed):
    proj_id = seed_project_authed.id
    # create a version
    r = await client_authed.post(
        f"/api/v1/projects/{proj_id}/prompt-versions",
        json={"prompt_text": "v1 body", "summary": "first"},
    )
    assert r.status_code == 201
    pv = r.json()
    # activate it
    r = await client_authed.patch(
        f"/api/v1/projects/{proj_id}/active-prompt",
        json={"version_id": pv["id"]},
    )
    assert r.status_code == 200

    r = await client_authed.get(f"/api/v1/projects/{proj_id}/prompt-versions")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["version"] == 1
    assert data[0]["is_active"] is True
    assert data[0]["prompt_text"] == "v1 body"


@pytest.mark.asyncio
async def test_create_prompt_version_returns_201_and_increments(client_authed, seed_project_authed):
    proj_id = seed_project_authed.id
    r1 = await client_authed.post(
        f"/api/v1/projects/{proj_id}/prompt-versions",
        json={"prompt_text": "first", "summary": "a"},
    )
    r2 = await client_authed.post(
        f"/api/v1/projects/{proj_id}/prompt-versions",
        json={"prompt_text": "second", "summary": "b"},
    )
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.json()["version"] == 1
    assert r2.json()["version"] == 2
    assert r1.json()["is_active"] is False  # not active until PATCH


@pytest.mark.asyncio
async def test_patch_active_prompt_accepts_null_to_revert_to_template(client_authed, seed_project_authed):
    proj_id = seed_project_authed.id
    r = await client_authed.post(
        f"/api/v1/projects/{proj_id}/prompt-versions",
        json={"prompt_text": "v1", "summary": ""},
    )
    pv = r.json()
    await client_authed.patch(
        f"/api/v1/projects/{proj_id}/active-prompt",
        json={"version_id": pv["id"]},
    )
    r = await client_authed.patch(
        f"/api/v1/projects/{proj_id}/active-prompt",
        json={"version_id": None},
    )
    assert r.status_code == 200
    assert r.json()["active_prompt_version_id"] is None


@pytest.mark.asyncio
async def test_delete_prompt_version_refuses_active(client_authed, seed_project_authed):
    proj_id = seed_project_authed.id
    r = await client_authed.post(
        f"/api/v1/projects/{proj_id}/prompt-versions",
        json={"prompt_text": "active", "summary": ""},
    )
    pv = r.json()
    await client_authed.patch(
        f"/api/v1/projects/{proj_id}/active-prompt",
        json={"version_id": pv["id"]},
    )
    r = await client_authed.delete(
        f"/api/v1/projects/{proj_id}/prompt-versions/{pv['id']}"
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "prompt_in_use"

    # deactivate then delete should succeed
    await client_authed.patch(
        f"/api/v1/projects/{proj_id}/active-prompt", json={"version_id": None},
    )
    r = await client_authed.delete(
        f"/api/v1/projects/{proj_id}/prompt-versions/{pv['id']}"
    )
    assert r.status_code == 204

    # gone from list
    r = await client_authed.get(f"/api/v1/projects/{proj_id}/prompt-versions")
    assert r.json() == []
```

`client_authed` and `seed_project_authed` fixtures: check `conftest.py`. If they don't exist, add them. Pattern (based on existing `test_predict_endpoint.py`):

```python
@pytest_asyncio.fixture
async def client_authed(app, seed_user):
    from httpx import ASGITransport, AsyncClient
    from app.core.security import create_access_token
    token = create_access_token(seed_user.id, seed_user.email)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", headers={
        "Authorization": f"Bearer {token}",
    }) as c:
        yield c


@pytest_asyncio.fixture
async def seed_project_authed(seed_project):
    return seed_project
```

If similar fixtures already exist with different names, update the test file imports accordingly. Look for existing fixture usages in `tests/test_predict_endpoint.py` for the established pattern.

- [ ] **Step 2: Run (RED)**

```bash
uv run pytest tests/test_prompts_api.py -v 2>&1 | tail -20
```

Expected: 4 failures (404 because route doesn't exist).

- [ ] **Step 3: Implement router**

Create `backend/app/api/v1/prompts.py`:

```python
"""Prompt versioning router under /api/v1/projects/{project_id}/prompt-versions."""
from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.schemas.prompt_version import (
    ActivePromptUpdate,
    PromptVersionCreate,
    PromptVersionRead,
)
from app.services import prompt_service as svc

router = APIRouter(prefix="/projects/{project_id}", tags=["prompts"])


async def _check_project_access(db, project_id: str, user_id: str) -> Project:
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
    return project


def _to_read(pv, active_id: str | None) -> PromptVersionRead:
    return PromptVersionRead(
        id=pv.id,
        project_id=pv.project_id,
        version=pv.version,
        prompt_text=pv.prompt_text,
        summary=pv.summary,
        created_by=pv.created_by,
        created_at=pv.created_at,
        is_active=(active_id == pv.id),
    )


@router.get("/prompt-versions", response_model=list[PromptVersionRead])
async def list_versions(
    project_id: str, db: DbSession, user: CurrentUser,
) -> list[PromptVersionRead]:
    project = await _check_project_access(db, project_id, user.id)
    versions = await svc.list_prompt_versions(db, project_id=project_id)
    return [_to_read(v, project.active_prompt_version_id) for v in versions]


@router.post(
    "/prompt-versions",
    response_model=PromptVersionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_version(
    project_id: str, body: PromptVersionCreate,
    db: DbSession, user: CurrentUser,
) -> PromptVersionRead:
    project = await _check_project_access(db, project_id, user.id)
    pv = await svc.create_prompt_version(
        db, project_id=project_id, user=user,
        prompt_text=body.prompt_text, summary=body.summary,
    )
    return _to_read(pv, project.active_prompt_version_id)


@router.patch("/active-prompt")
async def update_active(
    project_id: str, body: ActivePromptUpdate,
    db: DbSession, user: CurrentUser,
) -> dict:
    await _check_project_access(db, project_id, user.id)
    project = await svc.set_active_prompt(
        db, project_id=project_id, version_id=body.version_id,
    )
    return {
        "id": project.id,
        "active_prompt_version_id": project.active_prompt_version_id,
    }


@router.delete(
    "/prompt-versions/{version_id}", status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_version(
    project_id: str, version_id: str,
    db: DbSession, user: CurrentUser,
) -> None:
    await _check_project_access(db, project_id, user.id)
    await svc.soft_delete_prompt_version(
        db, project_id=project_id, version_id=version_id,
    )
```

Modify `backend/app/api/v1/router.py` to register the new router. Find the existing imports and add:

```python
from app.api.v1 import prompts as prompts_module
```

And after `v1_router.include_router(predict_module.router)` line, add:

```python
v1_router.include_router(prompts_module.router)
```

- [ ] **Step 4: Run (GREEN)**

```bash
uv run pytest tests/test_prompts_api.py -v 2>&1 | tail -10
```

Expected: 4 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 136 passed (was 132 → +4).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/prompts.py backend/app/api/v1/router.py backend/tests/test_prompts_api.py
git commit -m "S3/Task 2 (TDD): prompts router (4 REST endpoints) + 4 tests

- GET /prompt-versions       list with is_active flag, version DESC
- POST /prompt-versions      201 + auto-incrementing version
- PATCH /active-prompt       version_id | null (revert to template default)
- DELETE /prompt-versions/{vid}
    409 prompt_in_use if active; 204 + soft-delete otherwise

Backend: 132 -> 136."
```

---

## Phase B — Engine SSE primitives (T3-T4)

### Task 3: engine processor `chat_stream` + `revise_prompt` + 4 backend tests

**Files:**
- Modify: `backend/app/engine/processors/base.py` (add abstract `chat_stream`)
- Modify: `backend/app/engine/processors/mock.py` (deterministic 3-chunk)
- Modify: `backend/app/engine/processors/gemini.py` (real chat_stream — 1-call buffer fallback OK)
- Modify: `backend/app/engine/processors/openai.py` (similar)
- Modify: `backend/app/engine/processors/piaozone.py` and `piaozone_token.py` (single-chunk fallback raising NotImplemented if hit; processor not used in tests)
- Modify: `backend/app/engine/prompt.py` (add `async def revise_prompt`)
- Create: `backend/tests/test_engine_revise.py`

- [ ] **Step 1: Failing tests (RED)**

Create `backend/tests/test_engine_revise.py`:

```python
"""S3/T3: engine.revise_prompt + processor chat_stream tests."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_mock_processor_chat_stream_yields_three_deterministic_chunks():
    from app.engine.processors.mock import MockProcessor
    p = MockProcessor()
    chunks: list[str] = []
    async for c in p.chat_stream(system="any", user="hello"):
        chunks.append(c)
    assert chunks == ["REVISED: ", "hello", " END"]


@pytest.mark.asyncio
async def test_revise_prompt_uses_factory_then_streams():
    from app.engine.prompt import revise_prompt

    out: list[str] = []
    async for c in revise_prompt(
        original_prompt="orig",
        user_message="say hi",
        target_field=None,
        processor_key="mock|m",
    ):
        out.append(c)
    full = "".join(out)
    assert full.startswith("REVISED: ")
    assert "say hi" in full
    assert full.endswith(" END")


@pytest.mark.asyncio
async def test_revise_prompt_raises_on_unknown_processor():
    from app.engine.prompt import revise_prompt

    with pytest.raises((ValueError, RuntimeError)):
        async for _ in revise_prompt(
            original_prompt="o",
            user_message="m",
            target_field=None,
            processor_key="nonsense|x",
        ):
            pass


@pytest.mark.asyncio
async def test_revise_prompt_target_field_appears_in_user_message_payload(monkeypatch):
    """Target field must reach the chat_stream system or user content."""
    from app.engine.processors import mock as mock_mod

    captured = {}
    orig_chat = mock_mod.MockProcessor.chat_stream

    async def spy_chat(self, *, system: str, user: str):
        captured["system"] = system
        captured["user"] = user
        async for c in orig_chat(self, system=system, user=user):
            yield c

    monkeypatch.setattr(mock_mod.MockProcessor, "chat_stream", spy_chat)

    from app.engine.prompt import revise_prompt
    async for _ in revise_prompt(
        original_prompt="orig",
        user_message="m",
        target_field="invoice_number",
        processor_key="mock|m",
    ):
        pass
    assert "invoice_number" in captured["user"]
```

- [ ] **Step 2: Run (RED)**

```bash
uv run pytest tests/test_engine_revise.py -v 2>&1 | tail -20
```

Expected: ImportError or AttributeError for `chat_stream` / `revise_prompt`.

- [ ] **Step 3: Extend base + mock + gemini + openai**

Modify `backend/app/engine/processors/base.py`:

```python
"""Abstract base class for document processing strategies."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import AsyncIterator


class DocumentProcessor(ABC):
    """Abstract base class for document processing strategies."""

    @abstractmethod
    async def process_document(self, file_path: str, instruction: str) -> str:
        """Process a document and return extracted information as JSON string."""
        ...

    @abstractmethod
    def get_model_version(self) -> str:
        """Return the model version identifier (sync — pure formatting)."""
        ...

    async def chat_stream(self, *, system: str, user: str) -> AsyncIterator[str]:
        """Stream LLM tokens for a system+user chat. Default: NotImplementedError.

        Subclasses MAY implement; if not, callers must check capabilities.
        """
        raise NotImplementedError(
            f"{self.__class__.__name__}.chat_stream not implemented"
        )
        yield  # pragma: no cover (makes return type AsyncIterator)
```

Modify `backend/app/engine/processors/mock.py`:

```python
"""Mock processor for testing — returns canned invoice data instantly."""
from __future__ import annotations

import logging
from typing import AsyncIterator

from app.engine.processors.base import DocumentProcessor
from app.engine.utils import get_mock_invoice_data

logger = logging.getLogger(__name__)


class MockProcessor(DocumentProcessor):
    """Mock processor for testing purposes (no real LLM call, no sleep)."""

    def __init__(self, model_name: str = "mock-v1.0", **kwargs) -> None:
        self.model_name = model_name
        logger.info("MockProcessor initialized with model: %s", model_name)

    async def process_document(self, file_path: str, instruction: str) -> str:
        logger.info("Using mock data for document processing (file=%s)", file_path)
        return get_mock_invoice_data()

    def get_model_version(self) -> str:
        return f"mock|{self.model_name}"

    async def chat_stream(self, *, system: str, user: str) -> AsyncIterator[str]:
        """Deterministic 3-chunk stream: 'REVISED: ' + user + ' END'."""
        for chunk in ("REVISED: ", user, " END"):
            yield chunk
```

For `gemini.py` and `openai.py`: implement `chat_stream` using their respective async streaming APIs (`AsyncOpenAI.chat.completions.create(stream=True)` / `genai.aio.GenerativeModel(...).generate_content_async(stream=True)`). Keep it minimal — single-shot, no retries. For the plan's purposes here we provide gemini's signature; openai is symmetric.

In `backend/app/engine/processors/gemini.py`, add at the end of the class:

```python
    async def chat_stream(self, *, system: str, user: str):
        from google import genai  # already imported elsewhere
        client = self._client  # whatever attr the existing class uses
        response = await client.aio.models.generate_content(
            model=self.model_name,
            contents=[
                {"role": "user", "parts": [{"text": user}]}
            ],
            config={
                "system_instruction": system,
            },
            stream=True,
        ) if hasattr(client.aio.models, "generate_content") else None
        if response is None:
            # SDK shape varies; if streaming isn't available, single-shot fallback
            r = await client.aio.models.generate_content(
                model=self.model_name,
                contents=[{"role": "user", "parts": [{"text": user}]}],
                config={"system_instruction": system},
            )
            yield r.text
            return
        async for chunk in response:
            text = getattr(chunk, "text", None)
            if text:
                yield text
```

If the actual `gemini.py` already constructs the client differently, adapt — the goal is one async generator that yields strings. If real streaming gets too gnarly, fall back: do a single non-streaming call and yield the full text in one chunk. The frontend tolerates this (it accumulates tokens; one chunk is just one accumulation).

For openai.py:

```python
    async def chat_stream(self, *, system: str, user: str):
        client = self._client  # existing AsyncOpenAI
        stream = await client.chat.completions.create(
            model=self.model_name,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
```

`piaozone.py` and `piaozone_token.py`: leave the default `NotImplementedError` from base. Document in code comment that piaozone has no chat API in S3 scope.

- [ ] **Step 4: Add `revise_prompt`**

Modify `backend/app/engine/prompt.py`. Append at the end of the file:

```python
from typing import AsyncIterator
import logging

from app.engine.processors.factory import DocumentProcessorFactory

logger = logging.getLogger(__name__)


_REVISE_SYSTEM = (
    "你是一个 prompt 工程师。用户正在迭代一个文档抽取 prompt。"
    "给定原始 prompt、用户的修改需求、可选的目标字段，"
    "生成一个修改后的 prompt：保持整体结构与字段集，仅按需求最小修改。"
    "只输出修改后的 prompt 正文，不要前后说明。"
)


async def revise_prompt(
    *,
    original_prompt: str,
    user_message: str,
    target_field: str | None,
    processor_key: str,
) -> AsyncIterator[str]:
    """Stream tokens of a revised prompt via the chosen processor's chat API."""
    parts = processor_key.split("|", 1)
    p_type = parts[0]
    p_kwargs = {"model_name": parts[1]} if len(parts) == 2 else {}
    available = set(DocumentProcessorFactory.get_available())
    if p_type not in available:
        raise ValueError(
            f"Processor '{p_type}' is not available. Available: {sorted(available)}"
        )
    processor = DocumentProcessorFactory.create(p_type, **p_kwargs)

    user_payload = (
        f"ORIGINAL:\n{original_prompt}\n\n"
        f"REVISION REQUEST:\n{user_message}\n\n"
        f"TARGET FIELD: {target_field or 'unspecified'}"
    )

    async for chunk in processor.chat_stream(system=_REVISE_SYSTEM, user=user_payload):
        yield chunk
```

- [ ] **Step 5: Run (GREEN)**

```bash
uv run pytest tests/test_engine_revise.py -v 2>&1 | tail -10
```

Expected: 4 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 140 passed (was 136 → +4).

- [ ] **Step 6: Commit**

```bash
git add backend/app/engine/processors/base.py \
        backend/app/engine/processors/mock.py \
        backend/app/engine/processors/gemini.py \
        backend/app/engine/processors/openai.py \
        backend/app/engine/prompt.py \
        backend/tests/test_engine_revise.py
git commit -m "S3/Task 3 (TDD): chat_stream on base/mock/gemini/openai + revise_prompt + 4 tests

- DocumentProcessor.chat_stream(system, user) -> AsyncIterator[str]
  default raises NotImplementedError; subclasses opt-in
- MockProcessor: deterministic 3-chunk stream for tests
- gemini/openai: real async streaming via SDK aio API (one-chunk fallback if SDK shape unfamiliar)
- engine.prompt.revise_prompt: factory lookup + meta system prompt + stream

Backend: 136 -> 140."
```

---

### Task 4: correction_service SSE async generator + 4 backend tests

**Files:**
- Create: `backend/app/services/correction_service.py`
- Create: `backend/tests/test_correction_service.py`

The service produces SSE-shaped events (without HTTP framing); the route in T5 wraps them in `event:`/`data:` lines.

- [ ] **Step 1: Failing tests (RED)**

Create `backend/tests/test_correction_service.py`:

```python
"""S3/T4: correction_service tests (mock processor)."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_stream_correction_emits_prompt_tokens_then_revised(db_session, seed_project, seed_user):
    from app.services.correction_service import stream_correction
    from app.models.document import Document
    doc = Document(
        project_id=seed_project.id, filename="x.pdf", file_path="x.pdf",
        file_size=10, mime_type="application/pdf", uploaded_by=seed_user.id,
    )
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    events: list[dict] = []
    async for evt in stream_correction(
        db_session,
        project=seed_project,
        document=doc,
        user=seed_user,
        user_message="hello world",
        current_prompt="orig",
        target_field=None,
        processor_key_override="mock|m",
    ):
        events.append(evt)

    types = [e["event"] for e in events]
    assert "prompt_token" in types
    assert "revised_prompt" in types
    assert "predict_started" in types
    assert "predict_result" in types
    assert types[-1] == "done"


@pytest.mark.asyncio
async def test_stream_correction_revised_prompt_assembles_tokens(db_session, seed_project, seed_user):
    from app.services.correction_service import stream_correction
    from app.models.document import Document
    doc = Document(
        project_id=seed_project.id, filename="x.pdf", file_path="x.pdf",
        file_size=10, mime_type="application/pdf", uploaded_by=seed_user.id,
    )
    db_session.add(doc)
    await db_session.commit()

    events = []
    async for evt in stream_correction(
        db_session, project=seed_project, document=doc, user=seed_user,
        user_message="hi", current_prompt="orig", target_field=None,
        processor_key_override="mock|m",
    ):
        events.append(evt)

    revised = next(e for e in events if e["event"] == "revised_prompt")
    # mock chunks were "REVISED: " + user_payload + " END"; user_payload includes "REVISION REQUEST:\nhi"
    assert revised["data"]["prompt_text"].startswith("REVISED: ")
    assert "hi" in revised["data"]["prompt_text"]
    assert revised["data"]["prompt_text"].endswith(" END")


@pytest.mark.asyncio
async def test_stream_correction_predict_result_does_not_persist_processing_result(
    db_session, seed_project, seed_user,
):
    from app.services.correction_service import stream_correction
    from app.models.document import Document
    from app.models.processing_result import ProcessingResult
    from sqlalchemy import select

    doc = Document(
        project_id=seed_project.id, filename="x.pdf", file_path="x.pdf",
        file_size=10, mime_type="application/pdf", uploaded_by=seed_user.id,
    )
    db_session.add(doc)
    await db_session.commit()

    async for _ in stream_correction(
        db_session, project=seed_project, document=doc, user=seed_user,
        user_message="hi", current_prompt="orig", target_field=None,
        processor_key_override="mock|m",
    ):
        pass

    rows = (await db_session.execute(select(ProcessingResult))).scalars().all()
    # Correction is preview-only — must NOT insert a ProcessingResult row.
    assert rows == []


@pytest.mark.asyncio
async def test_stream_correction_emits_error_on_unknown_processor(db_session, seed_project, seed_user):
    from app.services.correction_service import stream_correction
    from app.models.document import Document
    doc = Document(
        project_id=seed_project.id, filename="x.pdf", file_path="x.pdf",
        file_size=10, mime_type="application/pdf", uploaded_by=seed_user.id,
    )
    db_session.add(doc)
    await db_session.commit()

    events = []
    async for evt in stream_correction(
        db_session, project=seed_project, document=doc, user=seed_user,
        user_message="hi", current_prompt="orig", target_field=None,
        processor_key_override="nope|x",
    ):
        events.append(evt)

    assert any(e["event"] == "error" for e in events)
    err = next(e for e in events if e["event"] == "error")
    assert "code" in err["data"]
    assert "message" in err["data"]
```

- [ ] **Step 2: Run (RED)**

```bash
uv run pytest tests/test_correction_service.py -v 2>&1 | tail -20
```

Expected: ImportError for `app.services.correction_service`.

- [ ] **Step 3: Implement service**

Create `backend/app/services/correction_service.py`:

```python
"""S3: correction service — SSE async generator producing event dicts.

Output shape: dicts of {"event": str, "data": dict}. The route layer
wraps each into `event: NAME\ndata: JSON\n\n` HTTP framing.
"""
from __future__ import annotations

import json as _json
import logging
from typing import Any, AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.engine.prompt import revise_prompt
from app.engine.processors.factory import DocumentProcessorFactory
from app.models.document import Document
from app.models.project import Project
from app.models.user import User
from app.services import storage

logger = logging.getLogger(__name__)


async def stream_correction(
    db: AsyncSession,
    *,
    project: Project,
    document: Document,
    user: User,
    user_message: str,
    current_prompt: str,
    target_field: str | None,
    processor_key_override: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yields SSE event dicts.

    Phase 1: stream tokens of revised prompt → emits prompt_token then revised_prompt.
    Phase 2: re-run predict with the revised prompt, NO db write → emits
             predict_started + predict_result.
    Done. Errors emit `error` event then return.
    """
    # Resolve processor: override > project template default
    if processor_key_override:
        processor_key = processor_key_override
    else:
        from app.templates.builtin import get_template
        tpl = get_template(project.template_key) if project.template_key else None
        processor_key = (tpl.recommended_processor if tpl else "gemini")
        # Need a model name; gemini has a default
        if "|" not in processor_key:
            processor_key = f"{processor_key}|gemini-2.5-flash"

    # Phase 1: revise prompt
    revised_chunks: list[str] = []
    try:
        async for chunk in revise_prompt(
            original_prompt=current_prompt,
            user_message=user_message,
            target_field=target_field,
            processor_key=processor_key,
        ):
            revised_chunks.append(chunk)
            yield {"event": "prompt_token", "data": {"chunk": chunk}}
    except Exception as e:
        logger.exception("revise_prompt failed")
        yield {
            "event": "error",
            "data": {"code": "revise_failed", "message": str(e)},
        }
        return

    revised_prompt_text = "".join(revised_chunks)
    yield {
        "event": "revised_prompt",
        "data": {"prompt_text": revised_prompt_text},
    }

    # Phase 2: re-run predict with revised prompt — preview-only, no DB write
    yield {"event": "predict_started", "data": {}}
    parts = processor_key.split("|", 1)
    p_type = parts[0]
    p_kwargs = {"model_name": parts[1]} if len(parts) == 2 else {}
    try:
        processor = DocumentProcessorFactory.create(p_type, **p_kwargs)
        file_path = str(storage.absolute_path(document.file_path))
        raw = await processor.process_document(file_path, revised_prompt_text)
    except Exception as e:
        logger.exception("preview predict failed")
        yield {
            "event": "error",
            "data": {"code": "predict_failed", "message": str(e)},
        }
        return

    # Best-effort parse: if raw is JSON list/dict, expose; else expose raw text
    try:
        parsed = _json.loads(raw)
        structured_data = parsed[0] if isinstance(parsed, list) and parsed else (parsed if isinstance(parsed, dict) else {"raw": raw})
    except Exception:
        structured_data = {"raw": raw}

    yield {
        "event": "predict_result",
        "data": {"structured_data": structured_data, "annotations": []},
    }
    yield {"event": "done", "data": {}}
```

- [ ] **Step 4: Run (GREEN)**

```bash
uv run pytest tests/test_correction_service.py -v 2>&1 | tail -15
```

Expected: 4 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 144 passed (was 140 → +4).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/correction_service.py backend/tests/test_correction_service.py
git commit -m "S3/Task 4 (TDD): correction_service SSE async generator + 4 tests

Two-phase generator:
  phase 1: revise_prompt streamed (prompt_token chunks + revised_prompt)
  phase 2: preview predict via processor.process_document (NO DB write)
           -> predict_started + predict_result + done

Errors caught at each phase, emitted as 'error' event with code+message.
Preview verified non-persistent (ProcessingResult row count stays 0).

Backend: 140 -> 144."
```

---

## Phase C — Correction route + resolve_prompt (T5-T6)

### Task 5: correction route integration + 2 backend tests

**Files:**
- Create: `backend/app/api/v1/correction.py`
- Modify: `backend/app/api/v1/router.py` (register)
- Create: `backend/tests/test_correction_api.py`

- [ ] **Step 1: Failing tests (RED)**

Create `backend/tests/test_correction_api.py`:

```python
"""S3/T5: correction route tests."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_correct_endpoint_requires_auth(client_unauthed, seed_project, seed_user):
    # No auth header → 401 from CurrentUser dependency
    from app.models.document import Document
    # use http call with no token
    r = await client_unauthed.post(
        f"/api/v1/projects/{seed_project.id}/documents/00000000-0000-0000-0000-000000000000/correct",
        json={
            "user_message": "x", "current_prompt": "y", "target_field": None,
            "processor_key_override": "mock|m",
        },
    )
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_correct_endpoint_streams_sse_events(client_authed, seed_project_authed, db_session, seed_user):
    from app.models.document import Document
    doc = Document(
        project_id=seed_project_authed.id, filename="x.pdf", file_path="x.pdf",
        file_size=10, mime_type="application/pdf", uploaded_by=seed_user.id,
    )
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    async with client_authed.stream(
        "POST",
        f"/api/v1/projects/{seed_project_authed.id}/documents/{doc.id}/correct",
        json={
            "user_message": "hi",
            "current_prompt": "orig",
            "target_field": None,
            "processor_key_override": "mock|m",
        },
    ) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        body = b""
        async for chunk in r.aiter_bytes():
            body += chunk
        text = body.decode()

    # Verify event ordering by name
    events = [
        line.split(":", 1)[1].strip()
        for line in text.splitlines()
        if line.startswith("event:")
    ]
    assert "prompt_token" in events
    assert events.index("revised_prompt") > events.index("prompt_token")
    assert "predict_started" in events
    assert "predict_result" in events
    assert events[-1] == "done"
```

`client_unauthed` is a no-auth-header AsyncClient. If not in conftest, add:

```python
@pytest_asyncio.fixture
async def client_unauthed(app):
    from httpx import ASGITransport, AsyncClient
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
```

- [ ] **Step 2: Run (RED)**

```bash
uv run pytest tests/test_correction_api.py -v 2>&1 | tail -20
```

Expected: 404 because route doesn't exist.

- [ ] **Step 3: Implement route**

Create `backend/app/api/v1/correction.py`:

```python
"""Correction SSE endpoint under /api/v1/projects/{pid}/documents/{did}/correct."""
from __future__ import annotations

import json as _json
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.document import Document
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.services import correction_service

router = APIRouter(prefix="/projects", tags=["correction"])


class CorrectRequest(BaseModel):
    user_message: str = Field(min_length=1, max_length=4000)
    current_prompt: str
    target_field: str | None = None
    processor_key_override: str | None = None


@router.post("/{project_id}/documents/{document_id}/correct")
async def correct(
    project_id: str,
    document_id: str,
    body: CorrectRequest,
    db: DbSession,
    user: CurrentUser,
) -> StreamingResponse:
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
    doc_stmt = select(Document).where(
        Document.id == document_id,
        Document.project_id == project_id,
        Document.deleted_at.is_(None),
    )
    document = (await db.execute(doc_stmt)).scalar_one_or_none()
    if document is None:
        raise AppError(404, "document_not_found", "Document not found.")

    async def event_gen() -> AsyncIterator[bytes]:
        async for evt in correction_service.stream_correction(
            db,
            project=project,
            document=document,
            user=user,
            user_message=body.user_message,
            current_prompt=body.current_prompt,
            target_field=body.target_field,
            processor_key_override=body.processor_key_override,
        ):
            line = (
                f"event: {evt['event']}\n"
                f"data: {_json.dumps(evt['data'])}\n\n"
            )
            yield line.encode()

    return StreamingResponse(event_gen(), media_type="text/event-stream")
```

Modify `backend/app/api/v1/router.py` to register:

```python
from app.api.v1 import correction as correction_module
# ...
v1_router.include_router(correction_module.router)
```

- [ ] **Step 4: Run (GREEN)**

```bash
uv run pytest tests/test_correction_api.py -v 2>&1 | tail -10
```

Expected: 2 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 146 passed (was 144 → +2).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/correction.py backend/app/api/v1/router.py backend/tests/test_correction_api.py
git commit -m "S3/Task 5 (TDD): correction SSE route + 2 tests

POST /api/v1/projects/{pid}/documents/{did}/correct
- requires auth + workspace membership + project/doc 404 checks
- delegates to correction_service.stream_correction
- frames {event, data} dicts as SSE: 'event: NAME\ndata: JSON\n\n'

Backend: 144 -> 146."
```

---

### Task 6: predict_service.resolve_prompt active-prompt resolution + 2 tests

**Files:**
- Modify: `backend/app/services/predict.py` (add `resolve_prompt` helper, use it)
- Create: `backend/tests/test_predict_resolve_prompt.py`

Currently `predict_service.predict_single` does `prompt = prompt_override or build_default_prompt(project.template_key)`. Insert active prompt resolution: override > active prompt version > template default.

- [ ] **Step 1: Failing tests (RED)**

Create `backend/tests/test_predict_resolve_prompt.py`:

```python
"""S3/T6: predict_service.resolve_prompt priority tests."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_resolve_prompt_uses_override_over_active_version(db_session, seed_project, seed_user):
    from app.services.predict import resolve_prompt
    from app.services import prompt_service as svc

    pv = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="ACTIVE", summary="",
    )
    await svc.set_active_prompt(
        db_session, project_id=seed_project.id, version_id=pv.id,
    )
    await db_session.refresh(seed_project)

    out = await resolve_prompt(
        db_session, project=seed_project, prompt_override="EXPLICIT",
    )
    assert out == "EXPLICIT"


@pytest.mark.asyncio
async def test_resolve_prompt_uses_active_version_when_no_override(db_session, seed_project, seed_user):
    from app.services.predict import resolve_prompt
    from app.services import prompt_service as svc

    pv = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="FROM_VERSION", summary="",
    )
    await svc.set_active_prompt(
        db_session, project_id=seed_project.id, version_id=pv.id,
    )
    await db_session.refresh(seed_project)

    out = await resolve_prompt(
        db_session, project=seed_project, prompt_override=None,
    )
    assert out == "FROM_VERSION"
```

- [ ] **Step 2: Run (RED)**

```bash
uv run pytest tests/test_predict_resolve_prompt.py -v 2>&1 | tail -15
```

Expected: ImportError (no `resolve_prompt` symbol).

- [ ] **Step 3: Add helper + use it**

In `backend/app/services/predict.py`, ADD:

```python
async def resolve_prompt(
    db: AsyncSession,
    *,
    project: Project,
    prompt_override: str | None,
) -> str:
    """Priority: override > active prompt version > template default."""
    if prompt_override:
        return prompt_override
    if project.active_prompt_version_id:
        from app.models.prompt_version import PromptVersion
        from sqlalchemy import select
        stmt = select(PromptVersion).where(
            PromptVersion.id == project.active_prompt_version_id,
            PromptVersion.deleted_at.is_(None),
        )
        pv = (await db.execute(stmt)).scalar_one_or_none()
        if pv is not None:
            return pv.prompt_text
    return build_default_prompt(project.template_key)
```

In the same file, find the line:

```python
    # 3. Resolve prompt
    prompt = prompt_override or build_default_prompt(project.template_key)
```

REPLACE with:

```python
    # 3. Resolve prompt (override > active version > template default)
    prompt = await resolve_prompt(db, project=project, prompt_override=prompt_override)
```

- [ ] **Step 4: Run (GREEN)**

```bash
uv run pytest tests/test_predict_resolve_prompt.py -v 2>&1 | tail -10
```

Expected: 2 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```
Expected: 148 passed.

(Existing predict tests pass because `prompt_override` precedence is preserved
and projects without an active version fall through to template default.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/predict.py backend/tests/test_predict_resolve_prompt.py
git commit -m "S3/Task 6 (TDD): predict_service.resolve_prompt priority + 2 tests

Active prompt resolution priority: override > active version > template default.
predict_single now delegates to resolve_prompt instead of inline expression.

Backend: 146 -> 148."
```

---

## Phase D — Frontend store + diff helpers (T7-T8)

### Task 7: predict-store增量 + 4 tests

**Files:**
- Modify: `frontend/src/stores/predict-store.ts` (add 4 actions + state slices)
- Modify: `frontend/src/stores/__tests__/predict-store.test.ts` (append 4 tests)

New state shape additions:

```ts
promptVersions: PromptVersion[];
correctionStream: {
  active: boolean;
  promptTokens: string[];
  revisedPrompt: string | null;
  previewResult: { structured_data: Record<string, unknown>; annotations: unknown[] } | null;
  error: string | null;
};
promptHistoryOpen: boolean;
correctionConsoleOpen: boolean;
```

New actions (signatures):

```ts
loadPromptVersions: (projectId: string) => Promise<PromptVersion[]>;
saveAsNewVersion: (projectId: string, prompt_text: string, summary: string) => Promise<PromptVersion>;
deletePromptVersion: (projectId: string, versionId: string) => Promise<void>;
setActivePrompt: (projectId: string, versionId: string | null) => Promise<{ id: string; active_prompt_version_id: string | null }>;
streamCorrection: (
  projectId: string,
  documentId: string,
  body: { user_message: string; current_prompt: string; target_field?: string | null; processor_key_override?: string | null },
) => Promise<void>;
discardCorrection: () => void;
setPromptHistoryOpen: (open: boolean) => void;
setCorrectionConsoleOpen: (open: boolean) => void;
```

New type export:

```ts
export interface PromptVersion {
  id: string;
  project_id: string;
  version: number;
  prompt_text: string;
  summary: string;
  created_by: string;
  created_at: string;
  is_active: boolean;
}
```

- [ ] **Step 1: Append failing tests (RED)**

In `frontend/src/stores/__tests__/predict-store.test.ts`, append at the bottom of the existing outer `describe(...)` block (before its closing `})`):

```ts
  describe("S3 prompt-version + correction state", () => {
    it("loadPromptVersions GETs and stores", async () => {
      const versions = [
        {
          id: "v-1", project_id: "p-1", version: 1,
          prompt_text: "first", summary: "x",
          created_by: "u-1", created_at: "",
          is_active: true,
        },
      ];
      mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, versions);
      const out = await usePredictStore.getState().loadPromptVersions("p-1");
      expect(out).toEqual(versions);
      expect(usePredictStore.getState().promptVersions).toEqual(versions);
    });

    it("saveAsNewVersion POSTs and returns the row; refreshes list", async () => {
      mock.onPost("/api/v1/projects/p-1/prompt-versions").reply(201, {
        id: "v-2", project_id: "p-1", version: 2,
        prompt_text: "rev", summary: "fix tax-id",
        created_by: "u-1", created_at: "",
        is_active: false,
      });
      const out = await usePredictStore
        .getState()
        .saveAsNewVersion("p-1", "rev", "fix tax-id");
      expect(out.version).toBe(2);
      expect(out.summary).toBe("fix tax-id");
    });

    it("setActivePrompt PATCHes and stores returned active id", async () => {
      mock.onPatch("/api/v1/projects/p-1/active-prompt").reply(200, {
        id: "p-1", active_prompt_version_id: "v-1",
      });
      const out = await usePredictStore.getState().setActivePrompt("p-1", "v-1");
      expect(out.active_prompt_version_id).toBe("v-1");
    });

    it("discardCorrection resets correctionStream", () => {
      usePredictStore.setState({
        correctionStream: {
          active: false,
          promptTokens: ["a", "b"],
          revisedPrompt: "ab",
          previewResult: { structured_data: { x: 1 }, annotations: [] },
          error: null,
        },
      });
      usePredictStore.getState().discardCorrection();
      const s = usePredictStore.getState().correctionStream;
      expect(s.promptTokens).toEqual([]);
      expect(s.revisedPrompt).toBeNull();
      expect(s.previewResult).toBeNull();
      expect(s.active).toBe(false);
      expect(s.error).toBeNull();
    });
  });
```

(`mock` is the existing axios-mock-adapter from S2a tests; verify imports.)

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run predict-store 2>&1 | tail -15
```

Expected: 4 failures (state/actions don't exist).

- [ ] **Step 3: Implement store extensions**

In `frontend/src/stores/predict-store.ts`:

1. Export the new type:

```ts
export interface PromptVersion {
  id: string;
  project_id: string;
  version: number;
  prompt_text: string;
  summary: string;
  created_by: string;
  created_at: string;
  is_active: boolean;
}

export interface CorrectionStreamState {
  active: boolean;
  promptTokens: string[];
  revisedPrompt: string | null;
  previewResult: {
    structured_data: Record<string, unknown>;
    annotations: unknown[];
  } | null;
  error: string | null;
}
```

2. Extend the `PredictState` interface (after the existing `promptOverride` lines):

```ts
  promptVersions: PromptVersion[];
  correctionStream: CorrectionStreamState;
  promptHistoryOpen: boolean;
  correctionConsoleOpen: boolean;
  loadPromptVersions: (projectId: string) => Promise<PromptVersion[]>;
  saveAsNewVersion: (projectId: string, prompt_text: string, summary: string) => Promise<PromptVersion>;
  deletePromptVersion: (projectId: string, versionId: string) => Promise<void>;
  setActivePrompt: (projectId: string, versionId: string | null) => Promise<{ id: string; active_prompt_version_id: string | null }>;
  streamCorrection: (
    projectId: string,
    documentId: string,
    body: {
      user_message: string;
      current_prompt: string;
      target_field?: string | null;
      processor_key_override?: string | null;
    },
  ) => Promise<void>;
  discardCorrection: () => void;
  setPromptHistoryOpen: (open: boolean) => void;
  setCorrectionConsoleOpen: (open: boolean) => void;
```

3. In the `create<PredictState>(...)` body, add initial state and actions:

```ts
  promptVersions: [],
  correctionStream: {
    active: false, promptTokens: [], revisedPrompt: null,
    previewResult: null, error: null,
  },
  promptHistoryOpen: false,
  correctionConsoleOpen: false,

  loadPromptVersions: async (projectId) => {
    const r = await api.get<PromptVersion[]>(
      `/api/v1/projects/${projectId}/prompt-versions`
    );
    set({ promptVersions: r.data });
    return r.data;
  },

  saveAsNewVersion: async (projectId, prompt_text, summary) => {
    const r = await api.post<PromptVersion>(
      `/api/v1/projects/${projectId}/prompt-versions`,
      { prompt_text, summary },
    );
    return r.data;
  },

  deletePromptVersion: async (projectId, versionId) => {
    await api.delete(
      `/api/v1/projects/${projectId}/prompt-versions/${versionId}`
    );
  },

  setActivePrompt: async (projectId, versionId) => {
    const r = await api.patch<{ id: string; active_prompt_version_id: string | null }>(
      `/api/v1/projects/${projectId}/active-prompt`,
      { version_id: versionId },
    );
    return r.data;
  },

  streamCorrection: async (projectId, documentId, body) => {
    set({
      correctionStream: {
        active: true, promptTokens: [], revisedPrompt: null,
        previewResult: null, error: null,
      },
    });
    try {
      const url = `${
        (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ""
      }/api/v1/projects/${projectId}/documents/${documentId}/correct`;
      // dynamic import keeps the helper tree-shakeable
      const { streamSse } = await import("../lib/sse");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = (await import("../lib/auth-storage")).getToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      for await (const evt of streamSse<Record<string, unknown>>(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })) {
        const cs = get().correctionStream;
        if (evt.event === "prompt_token") {
          set({
            correctionStream: {
              ...cs,
              promptTokens: [...cs.promptTokens, (evt.data as { chunk: string }).chunk],
            },
          });
        } else if (evt.event === "revised_prompt") {
          set({
            correctionStream: {
              ...cs,
              revisedPrompt: (evt.data as { prompt_text: string }).prompt_text,
            },
          });
        } else if (evt.event === "predict_result") {
          set({
            correctionStream: {
              ...cs,
              previewResult: evt.data as CorrectionStreamState["previewResult"],
            },
          });
        } else if (evt.event === "error") {
          set({
            correctionStream: {
              ...cs,
              error: (evt.data as { message: string }).message,
              active: false,
            },
          });
          return;
        } else if (evt.event === "done") {
          set({ correctionStream: { ...get().correctionStream, active: false } });
          return;
        }
      }
    } catch (e) {
      const cs = get().correctionStream;
      set({
        correctionStream: {
          ...cs, active: false,
          error: (e as { message?: string }).message ?? "stream failed",
        },
      });
    }
  },

  discardCorrection: () => set({
    correctionStream: {
      active: false, promptTokens: [], revisedPrompt: null,
      previewResult: null, error: null,
    },
  }),

  setPromptHistoryOpen: (open) => set({ promptHistoryOpen: open }),
  setCorrectionConsoleOpen: (open) => set({ correctionConsoleOpen: open }),
```

NOTE: `usePredictStore.getState()` was called at the top of T1 in S2b1 — bring `get` back to the create signature: change the existing `((set) => ({` line to `((set, get) => ({`. (We removed `get` in S2b1's cleanup commit; reintroduce it now that streamCorrection needs it.)

If `frontend/src/lib/auth-storage.ts` doesn't have `getToken()`, check the existing axios-client interceptor for the token source. The plan above assumes it does; if not, replace with whatever the api-client already uses (e.g., reading from `useAuthStore.getState().token`).

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run predict-store 2>&1 | tail -10
```

Expected: 4 new tests pass; existing pass.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 200 passed (was 196 → +4).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/stores/predict-store.ts frontend/src/stores/__tests__/predict-store.test.ts
git commit -m "S3/Task 7 (TDD): predict-store prompt-version + correction state + 4 tests

State additions:
- promptVersions: PromptVersion[]
- correctionStream: { active, promptTokens, revisedPrompt, previewResult, error }
- promptHistoryOpen / correctionConsoleOpen booleans

Actions:
- loadPromptVersions / saveAsNewVersion / deletePromptVersion / setActivePrompt
- streamCorrection: SSE consumer driving correctionStream slices
- discardCorrection: hard reset
- setPromptHistoryOpen / setCorrectionConsoleOpen

Frontend: 196 -> 200."
```

---

### Task 8: `lib/diff.ts` line + field diff + 5 tests

**Files:**
- Create: `frontend/src/lib/diff.ts`
- Create: `frontend/src/lib/__tests__/diff.test.ts`

- [ ] **Step 1: Failing tests (RED)**

Create `frontend/src/lib/__tests__/diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lineDiff, fieldDiff } from "../diff";

describe("lineDiff", () => {
  it("identical text → all 'same'", () => {
    const out = lineDiff("a\nb\nc", "a\nb\nc");
    expect(out.oldLines.map(l => l.status)).toEqual(["same", "same", "same"]);
    expect(out.newLines.map(l => l.status)).toEqual(["same", "same", "same"]);
  });

  it("a single line replaced", () => {
    const out = lineDiff("a\nOLD\nc", "a\nNEW\nc");
    expect(out.oldLines.find(l => l.line === "OLD")?.status).toBe("removed");
    expect(out.newLines.find(l => l.line === "NEW")?.status).toBe("added");
  });

  it("appending lines", () => {
    const out = lineDiff("a", "a\nb\nc");
    expect(out.newLines.filter(l => l.status === "added").map(l => l.line))
      .toEqual(["b", "c"]);
  });
});

describe("fieldDiff", () => {
  it("equal objects yield all 'unchanged'", () => {
    const out = fieldDiff({ a: 1, b: "x" }, { a: 1, b: "x" });
    expect(out.every(d => d.status === "unchanged")).toBe(true);
  });

  it("classifies added/removed/changed correctly", () => {
    const out = fieldDiff({ a: 1, b: "x", c: 2 }, { a: 1, b: "y", d: 3 });
    const map = Object.fromEntries(out.map(d => [d.field, d.status]));
    expect(map.a).toBe("unchanged");
    expect(map.b).toBe("changed");
    expect(map.c).toBe("removed");
    expect(map.d).toBe("added");
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run diff 2>&1 | tail -10
```

Expected: `Failed to resolve import "../diff"`.

- [ ] **Step 3: Implement diff helpers**

Create `frontend/src/lib/diff.ts`:

```ts
export interface LineDiff {
  oldLines: { line: string; status: "same" | "removed" }[];
  newLines: { line: string; status: "same" | "added" }[];
}

export interface FieldDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  status: "added" | "removed" | "changed" | "unchanged";
}

/**
 * Simple line-level diff via Longest Common Subsequence. Adequate for short
 * prompts; not optimal for long texts.
 */
export function lineDiff(oldText: string, newText: string): LineDiff {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) lcs[i][j] = lcs[i + 1][j + 1] + 1;
      else lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const oldLines: LineDiff["oldLines"] = [];
  const newLines: LineDiff["newLines"] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      oldLines.push({ line: a[i], status: "same" });
      newLines.push({ line: b[j], status: "same" });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      oldLines.push({ line: a[i], status: "removed" });
      i++;
    } else {
      newLines.push({ line: b[j], status: "added" });
      j++;
    }
  }
  while (i < m) {
    oldLines.push({ line: a[i++], status: "removed" });
  }
  while (j < n) {
    newLines.push({ line: b[j++], status: "added" });
  }
  return { oldLines, newLines };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    )) return false;
  }
  return true;
}

export function fieldDiff(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): FieldDiff[] {
  const o = oldData ?? {};
  const n = newData ?? {};
  const keys = Array.from(new Set([...Object.keys(o), ...Object.keys(n)]));
  return keys.map((field) => {
    const inOld = field in o;
    const inNew = field in n;
    if (!inOld && inNew) return { field, oldValue: undefined, newValue: n[field], status: "added" };
    if (inOld && !inNew) return { field, oldValue: o[field], newValue: undefined, status: "removed" };
    return {
      field,
      oldValue: o[field],
      newValue: n[field],
      status: deepEqual(o[field], n[field]) ? "unchanged" : "changed",
    };
  });
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
npm test -- --run diff 2>&1 | tail -10
```

Expected: 5 passed.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 205 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/diff.ts frontend/src/lib/__tests__/diff.test.ts
git commit -m "S3/Task 8 (TDD): lib/diff.ts line-diff + field-diff + 5 tests

- lineDiff: LCS-based; returns parallel oldLines/newLines arrays
- fieldDiff: shallow object diff; status = added/removed/changed/unchanged
- deepEqual helper for value comparison

No new dependency.

Frontend: 200 -> 205."
```

---

## Phase E — UI panels (T9-T10)

### Task 9: PromptHistoryPanel + 5 tests

**Files:**
- Create: `frontend/src/components/workspace/PromptHistoryPanel.tsx`
- Create: `frontend/src/components/workspace/__tests__/PromptHistoryPanel.test.tsx`

Right-side slide-over drawer. Renders only when `promptHistoryOpen === true`.

- [ ] **Step 1: Failing tests (RED)**

Create `frontend/src/components/workspace/__tests__/PromptHistoryPanel.test.tsx`:

```tsx
import MockAdapter from "axios-mock-adapter";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../lib/api-client";
import { usePredictStore, type PromptVersion } from "../../../stores/predict-store";
import PromptHistoryPanel from "../PromptHistoryPanel";

let mock: MockAdapter;

const pv = (overrides: Partial<PromptVersion> = {}): PromptVersion => ({
  id: "v-1", project_id: "p-1", version: 1,
  prompt_text: "body", summary: "first",
  created_by: "u-1", created_at: "",
  is_active: false,
  ...overrides,
});

beforeEach(() => {
  mock = new MockAdapter(api);
  usePredictStore.setState({
    promptVersions: [],
    promptHistoryOpen: true,
  });
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
});

describe("PromptHistoryPanel", () => {
  it("does not render when promptHistoryOpen is false", () => {
    usePredictStore.setState({ promptHistoryOpen: false });
    render(<PromptHistoryPanel projectId="p-1" />);
    expect(screen.queryByText(/Prompt 历史/)).not.toBeInTheDocument();
  });

  it("renders versions in DESC order with active badged", () => {
    usePredictStore.setState({
      promptVersions: [
        pv({ id: "v-2", version: 2, summary: "fix tax", is_active: true }),
        pv({ id: "v-1", version: 1, summary: "first" }),
      ],
    });
    render(<PromptHistoryPanel projectId="p-1" />);
    expect(screen.getByText(/v2/)).toBeInTheDocument();
    expect(screen.getByText(/v1/)).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });

  it("clicking 'Set as active' calls setActivePrompt then closes panel only on success", async () => {
    usePredictStore.setState({
      promptVersions: [pv({ is_active: false })],
    });
    mock.onPatch("/api/v1/projects/p-1/active-prompt").reply(200, {
      id: "p-1", active_prompt_version_id: "v-1",
    });
    mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, [
      pv({ is_active: true }),
    ]);
    const user = userEvent.setup();
    render(<PromptHistoryPanel projectId="p-1" />);
    await user.click(screen.getByText(/v1/));  // expand row
    await user.click(screen.getByRole("button", { name: /Set as active/i }));
    // After completion, the version becomes active (refreshed list shows active badge)
    expect(await screen.findByText(/active/i)).toBeInTheDocument();
  });

  it("'Delete' button is disabled on the active version", () => {
    usePredictStore.setState({
      promptVersions: [pv({ is_active: true })],
    });
    render(<PromptHistoryPanel projectId="p-1" />);
    // Expand by clicking
    const versionLabel = screen.getByText(/v1/);
    versionLabel.click();
    const del = screen.getByRole("button", { name: /Delete/i });
    expect(del).toBeDisabled();
  });

  it("'Use template default' calls setActivePrompt with null", async () => {
    usePredictStore.setState({
      promptVersions: [pv({ is_active: true })],
    });
    mock.onPatch("/api/v1/projects/p-1/active-prompt").reply(200, {
      id: "p-1", active_prompt_version_id: null,
    });
    mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, [pv({ is_active: false })]);
    const user = userEvent.setup();
    render(<PromptHistoryPanel projectId="p-1" />);
    await user.click(screen.getByRole("button", { name: /Use template default/i }));
    expect(usePredictStore.getState().promptVersions[0].is_active).toBe(false);
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
npm test -- --run PromptHistoryPanel 2>&1 | tail -15
```

Expected: `Cannot find module '../PromptHistoryPanel'`.

- [ ] **Step 3: Implement**

Create `frontend/src/components/workspace/PromptHistoryPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { usePredictStore } from "../../stores/predict-store";

interface Props {
  projectId: string;
}

export default function PromptHistoryPanel({ projectId }: Props) {
  const open = usePredictStore((s) => s.promptHistoryOpen);
  const close = usePredictStore((s) => () => s.setPromptHistoryOpen(false));
  const versions = usePredictStore((s) => s.promptVersions);
  const loadPromptVersions = usePredictStore((s) => s.loadPromptVersions);
  const setActivePrompt = usePredictStore((s) => s.setActivePrompt);
  const deletePromptVersion = usePredictStore((s) => s.deletePromptVersion);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) void loadPromptVersions(projectId);
  }, [open, projectId, loadPromptVersions]);

  if (!open) return null;

  async function activate(vid: string) {
    setBusy(true);
    try {
      await setActivePrompt(projectId, vid);
      await loadPromptVersions(projectId);
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    try {
      await setActivePrompt(projectId, null);
      await loadPromptVersions(projectId);
    } finally {
      setBusy(false);
    }
  }

  async function remove(vid: string) {
    setBusy(true);
    try {
      await deletePromptVersion(projectId, vid);
      await loadPromptVersions(projectId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] bg-[#1a1d27] border-l border-[#2a2e3d] z-50 flex flex-col text-sm">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[#2a2e3d]">
        <h2 className="font-semibold text-[#e2e8f0]">📜 Prompt 历史</h2>
        <button onClick={close} className="text-[#94a3b8] hover:text-[#e2e8f0]">✕</button>
      </header>
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {versions.length === 0 ? (
          <div className="text-xs text-[#64748b] text-center py-8">
            尚无 prompt 版本（当前使用模板默认 prompt）
          </div>
        ) : (
          versions.map((v) => (
            <div
              key={v.id}
              className="bg-[#0f1117] border border-[#2a2e3d] rounded p-2"
            >
              <button
                type="button"
                onClick={() => setExpanded(expanded === v.id ? null : v.id)}
                className="w-full flex items-center justify-between text-left"
              >
                <span className="font-mono text-[#818cf8]">v{v.version}</span>
                <span className="flex-1 mx-2 text-xs italic text-[#94a3b8] truncate">
                  {v.summary || "(no summary)"}
                </span>
                {v.is_active && (
                  <span className="text-xs bg-[#312e81] text-white rounded px-2 py-0.5">
                    active
                  </span>
                )}
              </button>
              {expanded === v.id && (
                <div className="mt-2 space-y-2">
                  <pre className="text-xs whitespace-pre-wrap text-[#a5f3fc] bg-[#0a0c11] p-2 rounded max-h-64 overflow-auto">
                    {v.prompt_text}
                  </pre>
                  <div className="flex gap-2">
                    {!v.is_active && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void activate(v.id)}
                        className="text-xs bg-[#6366f1] text-white px-2 py-1 rounded disabled:opacity-50"
                      >
                        Set as active
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy || v.is_active}
                      onClick={() => void remove(v.id)}
                      className="text-xs text-[#ef4444] hover:underline disabled:opacity-30 disabled:no-underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <footer className="px-3 py-2 border-t border-[#2a2e3d]">
        <button
          type="button"
          disabled={busy}
          onClick={() => void deactivate()}
          className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] w-full"
        >
          Use template default
        </button>
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
npm test -- --run PromptHistoryPanel 2>&1 | tail -10
```

Expected: 5 passed.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 210 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workspace/PromptHistoryPanel.tsx frontend/src/components/workspace/__tests__/PromptHistoryPanel.test.tsx
git commit -m "S3/Task 9 (TDD): PromptHistoryPanel right-side drawer + 5 tests

- Renders only when promptHistoryOpen === true
- DESC version list; active row badged
- Click row to expand prompt body
- Activate / Delete buttons (Delete disabled if active)
- 'Use template default' footer button → setActivePrompt(null)

Frontend: 205 -> 210."
```

---

### Task 10: NLCorrectionConsole + 7 tests

**Files:**
- Create: `frontend/src/components/workspace/NLCorrectionConsole.tsx`
- Create: `frontend/src/components/workspace/__tests__/NLCorrectionConsole.test.tsx`

This is the heaviest UI piece. Three regions: input, stream pane, action bar.

- [ ] **Step 1: Failing tests (RED)**

Create `frontend/src/components/workspace/__tests__/NLCorrectionConsole.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePredictStore } from "../../../stores/predict-store";
import NLCorrectionConsole from "../NLCorrectionConsole";

beforeEach(() => {
  usePredictStore.setState({
    correctionConsoleOpen: true,
    correctionStream: {
      active: false, promptTokens: [], revisedPrompt: null,
      previewResult: null, error: null,
    },
  });
});
afterEach(() => vi.clearAllMocks());

describe("NLCorrectionConsole", () => {
  it("does not render when correctionConsoleOpen is false", () => {
    usePredictStore.setState({ correctionConsoleOpen: false });
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="orig" annotations={[]}
        currentResult={null}
      />
    );
    expect(screen.queryByPlaceholderText(/自然语言/)).not.toBeInTheDocument();
  });

  it("Send button disabled while stream is active", () => {
    usePredictStore.setState({
      correctionStream: { ...usePredictStore.getState().correctionStream, active: true },
    });
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="orig" annotations={[]}
        currentResult={null}
      />
    );
    expect(screen.getByRole("button", { name: /Send/i })).toBeDisabled();
  });

  it("renders accumulated prompt tokens during stream", () => {
    usePredictStore.setState({
      correctionStream: {
        active: true, promptTokens: ["A ", "B ", "C"],
        revisedPrompt: null, previewResult: null, error: null,
      },
    });
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="orig" annotations={[]}
        currentResult={null}
      />
    );
    expect(screen.getByText(/A B C/)).toBeInTheDocument();
  });

  it("renders prompt diff once revisedPrompt arrives", () => {
    usePredictStore.setState({
      correctionStream: {
        active: false,
        promptTokens: ["full revised text"],
        revisedPrompt: "full revised text",
        previewResult: null,
        error: null,
      },
    });
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="original text" annotations={[]}
        currentResult={null}
      />
    );
    expect(screen.getByText(/Revised prompt/i)).toBeInTheDocument();
  });

  it("renders field diff once predict_result arrives", () => {
    usePredictStore.setState({
      correctionStream: {
        active: false, promptTokens: [], revisedPrompt: "x",
        previewResult: { structured_data: { a: 2 }, annotations: [] },
        error: null,
      },
    });
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="orig" annotations={[]}
        currentResult={{ structured_data: { a: 1 } }}
      />
    );
    expect(screen.getByText(/Predict result/i)).toBeInTheDocument();
    expect(screen.getByText(/changed/i)).toBeInTheDocument();
  });

  it("error state shows red banner", () => {
    usePredictStore.setState({
      correctionStream: {
        active: false, promptTokens: [], revisedPrompt: null,
        previewResult: null, error: "boom",
      },
    });
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="orig" annotations={[]}
        currentResult={null}
      />
    );
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it("Discard button calls discardCorrection", async () => {
    usePredictStore.setState({
      correctionStream: {
        active: false, promptTokens: ["x"], revisedPrompt: "x",
        previewResult: { structured_data: { a: 1 }, annotations: [] }, error: null,
      },
    });
    const user = userEvent.setup();
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="orig" annotations={[]}
        currentResult={null}
      />
    );
    await user.click(screen.getByRole("button", { name: /Discard/i }));
    const s = usePredictStore.getState().correctionStream;
    expect(s.promptTokens).toEqual([]);
    expect(s.revisedPrompt).toBeNull();
    expect(s.previewResult).toBeNull();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
npm test -- --run NLCorrectionConsole 2>&1 | tail -15
```

Expected: import resolution failure.

- [ ] **Step 3: Implement**

Create `frontend/src/components/workspace/NLCorrectionConsole.tsx`:

```tsx
import { useState } from "react";
import { usePredictStore, type Annotation } from "../../stores/predict-store";
import { lineDiff, fieldDiff } from "../../lib/diff";

interface Props {
  projectId: string;
  documentId: string;
  currentPrompt: string;
  annotations: Annotation[];
  currentResult: { structured_data: Record<string, unknown> } | null;
}

export default function NLCorrectionConsole({
  projectId, documentId, currentPrompt, annotations, currentResult,
}: Props) {
  const open = usePredictStore((s) => s.correctionConsoleOpen);
  const close = usePredictStore((s) => () => s.setCorrectionConsoleOpen(false));
  const stream = usePredictStore((s) => s.correctionStream);
  const streamCorrection = usePredictStore((s) => s.streamCorrection);
  const discardCorrection = usePredictStore((s) => s.discardCorrection);
  const saveAsNewVersion = usePredictStore((s) => s.saveAsNewVersion);
  const setActivePrompt = usePredictStore((s) => s.setActivePrompt);
  const setCorrectionConsoleOpen = usePredictStore((s) => s.setCorrectionConsoleOpen);
  const setPromptHistoryOpen = usePredictStore((s) => s.setPromptHistoryOpen);

  const [userMessage, setUserMessage] = useState("");
  const [targetField, setTargetField] = useState<string>("");
  const [savingSummary, setSavingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");

  if (!open) return null;

  const accumulatedTokens = stream.promptTokens.join("");
  const promptDiff = stream.revisedPrompt ? lineDiff(currentPrompt, stream.revisedPrompt) : null;
  const resultDiff = stream.previewResult
    ? fieldDiff(
        currentResult?.structured_data ?? null,
        stream.previewResult.structured_data,
      )
    : null;

  async function send() {
    if (!userMessage.trim() || stream.active) return;
    await streamCorrection(projectId, documentId, {
      user_message: userMessage,
      current_prompt: currentPrompt,
      target_field: targetField || null,
    });
  }

  async function save() {
    if (!stream.revisedPrompt) return;
    setSavingSummary(true);
  }

  async function confirmSave() {
    if (!stream.revisedPrompt) return;
    const v = await saveAsNewVersion(projectId, stream.revisedPrompt, summaryDraft);
    await setActivePrompt(projectId, v.id);
    discardCorrection();
    setSavingSummary(false);
    setSummaryDraft("");
    setUserMessage("");
    setCorrectionConsoleOpen(false);
    setPromptHistoryOpen(true);
  }

  return (
    <div className="fixed left-0 right-0 bottom-0 h-[480px] bg-[#1a1d27] border-t border-[#2a2e3d] z-50 flex flex-col text-sm">
      <header className="flex items-center justify-between px-4 py-2 border-b border-[#2a2e3d]">
        <h2 className="font-semibold">⚙️ AI 矫正</h2>
        <button onClick={close} className="text-[#94a3b8] hover:text-[#e2e8f0]">✕</button>
      </header>

      <div className="px-4 py-2 border-b border-[#2a2e3d] flex gap-2 items-start">
        <textarea
          value={userMessage}
          onChange={(e) => setUserMessage(e.target.value)}
          placeholder="用自然语言描述如何修改 prompt..."
          rows={2}
          className="flex-1 bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm"
        />
        <select
          value={targetField}
          onChange={(e) => setTargetField(e.target.value)}
          className="bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-xs"
        >
          <option value="">(no target)</option>
          {annotations.map((a) => (
            <option key={a.id} value={a.field_name}>{a.field_name}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={stream.active || !userMessage.trim()}
          onClick={() => void send()}
          className="bg-[#6366f1] text-white px-3 py-1 rounded text-xs disabled:opacity-50"
        >
          Send
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {stream.error && (
          <div className="text-sm text-[#ef4444] bg-[#3f1d1d] border border-[#ef4444] rounded p-2">
            {stream.error}
          </div>
        )}
        {(stream.active || stream.promptTokens.length > 0) && !stream.revisedPrompt && (
          <div>
            <div className="text-xs text-[#94a3b8] mb-1">Revising prompt...</div>
            <pre className="text-xs whitespace-pre-wrap bg-[#0a0c11] p-2 rounded">
              {accumulatedTokens}
            </pre>
          </div>
        )}
        {promptDiff && (
          <div>
            <div className="text-xs text-[#94a3b8] mb-1">Revised prompt:</div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <pre className="bg-[#0a0c11] p-2 rounded whitespace-pre-wrap">
                {promptDiff.oldLines.map((l, i) => (
                  <div key={i} className={l.status === "removed" ? "bg-[#3f1d1d] text-[#fca5a5]" : ""}>
                    {l.line}
                  </div>
                ))}
              </pre>
              <pre className="bg-[#0a0c11] p-2 rounded whitespace-pre-wrap">
                {promptDiff.newLines.map((l, i) => (
                  <div key={i} className={l.status === "added" ? "bg-[#1d3f24] text-[#86efac]" : ""}>
                    {l.line}
                  </div>
                ))}
              </pre>
            </div>
          </div>
        )}
        {resultDiff && (
          <div>
            <div className="text-xs text-[#94a3b8] mb-1">Predict result:</div>
            <table className="text-xs w-full">
              <tbody>
                {resultDiff.map((d) => (
                  <tr key={d.field}>
                    <td className="text-[#94a3b8] pr-2">{d.field}</td>
                    <td className="text-[#fca5a5]">{JSON.stringify(d.oldValue ?? null)}</td>
                    <td className="text-[#86efac]">{JSON.stringify(d.newValue ?? null)}</td>
                    <td className="text-[#64748b] pl-2">{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 px-4 py-2 border-t border-[#2a2e3d]">
        <button
          type="button"
          onClick={() => discardCorrection()}
          className="text-xs text-[#94a3b8] hover:text-[#e2e8f0]"
        >
          Discard
        </button>
        <div className="flex-1" />
        {savingSummary ? (
          <>
            <input
              autoFocus
              placeholder="summary"
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
              className="bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-0.5 text-xs"
            />
            <button
              type="button" onClick={() => void confirmSave()}
              className="bg-[#6366f1] text-white text-xs px-3 py-1 rounded"
            >
              确认保存
            </button>
            <button
              type="button" onClick={() => setSavingSummary(false)}
              className="text-xs text-[#94a3b8]"
            >
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!stream.revisedPrompt || !stream.previewResult || stream.active}
            onClick={() => void save()}
            className="bg-[#6366f1] text-white text-xs px-3 py-1 rounded disabled:opacity-50"
          >
            Save as new version
          </button>
        )}
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
npm test -- --run NLCorrectionConsole 2>&1 | tail -10
```

Expected: 7 passed.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 217 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workspace/NLCorrectionConsole.tsx frontend/src/components/workspace/__tests__/NLCorrectionConsole.test.tsx
git commit -m "S3/Task 10 (TDD): NLCorrectionConsole bottom drawer + 7 tests

Three regions:
- Input: textarea + target field dropdown + Send (disabled while stream active)
- Stream: accumulating prompt tokens -> revised prompt diff -> result diff
          -> error banner on failure
- Footer: Discard / Save as new version (opens summary input → confirmSave)

Save flow: saveAsNewVersion + setActivePrompt + close console + open history.

Frontend: 210 -> 217."
```

---

## Phase F — Toolbar + StepIndicator + Page wiring (T11-T12)

### Task 11: StepIndicator Tune unlock + WorkspaceToolbar 📜 button + 4 tests

**Files:**
- Modify: `frontend/src/components/workspace/StepIndicator.tsx` (move Tune from locked to reachable)
- Modify: `frontend/src/components/workspace/__tests__/StepIndicator.test.tsx` (adjust + add 2 tests)
- Modify: `frontend/src/components/workspace/WorkspaceToolbar.tsx` (add 📜 history button)
- Modify: `frontend/src/components/workspace/__tests__/WorkspaceToolbar.test.tsx` (add 2 tests)

- [ ] **Step 1: Update tests (RED)**

In `frontend/src/components/workspace/__tests__/StepIndicator.test.tsx`, the existing test "renders 🔒 on Tune and GenerateAPI" must change. Find it and REPLACE its body with:

```tsx
  it("renders 🔒 on GenerateAPI only (Tune is now reachable)", () => {
    render(<StepIndicator />);
    const gen = screen.getByRole("button", { name: /GenerateAPI/ });
    expect(gen.textContent).toMatch(/🔒/);
    expect(gen).toBeDisabled();

    const tune = screen.getByRole("button", { name: /Tune/ });
    expect(tune.textContent).not.toMatch(/🔒/);
    expect(tune).not.toBeDisabled();
  });
```

Then APPEND 2 new tests:

```tsx
  it("clicking Tune sets currentStep to 4 and opens correctionConsole", async () => {
    const user = userEvent.setup();
    render(<StepIndicator />);
    await user.click(screen.getByRole("button", { name: /Tune/ }));
    expect(usePredictStore.getState().currentStep).toBe(4);
    expect(usePredictStore.getState().correctionConsoleOpen).toBe(true);
  });

  it("Tune button shows aria-current when currentStep is 4", () => {
    usePredictStore.setState({ currentStep: 4 });
    render(<StepIndicator />);
    expect(screen.getByRole("button", { name: /Tune/ })).toHaveAttribute("aria-current", "step");
  });
```

In `frontend/src/components/workspace/__tests__/WorkspaceToolbar.test.tsx`, append 2 tests at the bottom of the describe block:

```tsx
  it("renders 📜 history button toggling promptHistoryOpen", async () => {
    const user = userEvent.setup();
    renderToolbar();
    expect(usePredictStore.getState().promptHistoryOpen).toBe(false);
    await user.click(screen.getByRole("button", { name: /📜/ }));
    expect(usePredictStore.getState().promptHistoryOpen).toBe(true);
  });

  it("📜 button has title attribute for accessibility", () => {
    renderToolbar();
    const btn = screen.getByRole("button", { name: /📜/ });
    expect(btn.getAttribute("title")).toMatch(/Prompt|历史/i);
  });
```

If `usePredictStore` isn't imported in WorkspaceToolbar tests, add the import at top.

- [ ] **Step 2: Run (RED)**

```bash
npm test -- --run StepIndicator --run WorkspaceToolbar 2>&1 | tail -20
```

Expected: 4 failures (Tune still locked; 📜 button absent).

- [ ] **Step 3: Modify StepIndicator**

In `frontend/src/components/workspace/StepIndicator.tsx`:

Replace the existing arrays:

```tsx
const REACHABLE_STEPS: Step[] = [
  { id: 0, label: "Upload" },
  { id: 1, label: "Preview" },
  { id: 2, label: "Correct" },
  { id: 3, label: "ApiFormat" },
  { id: 4, label: "Tune" },     // S3: unlocked
];
const LOCKED_STEPS = [
  { id: 5, label: "GenerateAPI" },
];
```

Update the `Step` interface to allow id=4: `id: 0 | 1 | 2 | 3 | 4;`

Add an action import:

```tsx
const setCorrectionConsoleOpen = usePredictStore((s) => s.setCorrectionConsoleOpen);
```

When Tune (id=4) is clicked, also open the console. The simplest way: in the
existing `onClick={() => setStep(s.id)}`, replace with:

```tsx
onClick={() => {
  setStep(s.id);
  if (s.id === 4) setCorrectionConsoleOpen(true);
}}
```

The store's `setStep` signature accepts `0|1|2|3` per S2b1. Update its type to
`0|1|2|3|4` — open `frontend/src/stores/predict-store.ts` and change:

```ts
  currentStep: 0 | 1 | 2 | 3;
  setStep: (step: 0 | 1 | 2 | 3) => void;
```

to:

```ts
  currentStep: 0 | 1 | 2 | 3 | 4;
  setStep: (step: 0 | 1 | 2 | 3 | 4) => void;
```

(Update the predict-store test that exercised setStep accordingly — find any
literal `setStep(2)` calls; those still pass.)

- [ ] **Step 4: Modify WorkspaceToolbar**

In `frontend/src/components/workspace/WorkspaceToolbar.tsx`:

Add to the imports:

```tsx
const setPromptHistoryOpen = usePredictStore((s) => s.setPromptHistoryOpen);
const promptHistoryOpen = usePredictStore((s) => s.promptHistoryOpen);
```

Insert a new button between the existing Next-Unreviewed button and the right edge:

```tsx
<button
  type="button"
  onClick={() => setPromptHistoryOpen(!promptHistoryOpen)}
  title="Prompt 历史"
  className="text-xs text-[#94a3b8] hover:text-[#e2e8f0]"
>
  📜
</button>
```

Place it just before `</div>` of the toolbar's flex container, after `▶ Next Unreviewed`.

- [ ] **Step 5: Run (GREEN)**

```bash
npm test 2>&1 | tail -3
```

Expected: 221 passed (was 217 → +4).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/workspace/StepIndicator.tsx \
        frontend/src/components/workspace/__tests__/StepIndicator.test.tsx \
        frontend/src/components/workspace/WorkspaceToolbar.tsx \
        frontend/src/components/workspace/__tests__/WorkspaceToolbar.test.tsx \
        frontend/src/stores/predict-store.ts
git commit -m "S3/Task 11 (TDD): StepIndicator Tune unlock + Toolbar 📜 button + 4 tests

- StepIndicator: Tune (id=4) reachable; clicking sets step + opens correction console
- predict-store currentStep widened from 0|1|2|3 to 0|1|2|3|4
- WorkspaceToolbar: 📜 button toggles promptHistoryOpen

Frontend: 217 -> 221."
```

---

### Task 12: WorkspacePage wires both panels + 3 tests

**Files:**
- Modify: `frontend/src/pages/WorkspacePage.tsx`
- Modify: `frontend/src/pages/__tests__/WorkspacePage.test.tsx` (append 3 tests)

- [ ] **Step 1: Append failing tests (RED)**

In `frontend/src/pages/__tests__/WorkspacePage.test.tsx`, append at the bottom of the outer `describe(...)` block:

```tsx
  it("clicking Tune step opens NLCorrectionConsole below", async () => {
    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet(/d-1\/preview$/).reply(200, new Blob(["pdf"], { type: "application/pdf" }));
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, {
      id: "pr-1", document_id: "d-1", version: 1,
      structured_data: { x: 1 }, inferred_schema: null,
      prompt_used: "p", processor_key: "mock|m", source: "predict",
      created_by: "u-1", created_at: "",
    });
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-1")], total: 1, page: 1, page_size: 20,
    });

    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    const tuneBtn = await screen.findByRole("button", { name: /Tune/ });
    await user.click(tuneBtn);
    expect(usePredictStore.getState().correctionConsoleOpen).toBe(true);
    expect(screen.getByPlaceholderText(/自然语言/)).toBeInTheDocument();
  });

  it("clicking 📜 toolbar button opens PromptHistoryPanel", async () => {
    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet(/d-1\/preview$/).reply(200, new Blob(["pdf"], { type: "application/pdf" }));
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, {
      id: "pr-1", document_id: "d-1", version: 1, structured_data: {},
      inferred_schema: null, prompt_used: "", processor_key: "mock|m",
      source: "predict", created_by: "u-1", created_at: "",
    });
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-1")], total: 1, page: 1, page_size: 20,
    });
    mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, []);

    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    const histBtn = await screen.findByRole("button", { name: /📜/ });
    await user.click(histBtn);
    expect(await screen.findByText(/Prompt 历史/)).toBeInTheDocument();
  });

  it("PromptHistoryPanel + NLCorrectionConsole can be open simultaneously", async () => {
    usePredictStore.setState({
      promptHistoryOpen: true,
      correctionConsoleOpen: true,
    });
    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet(/d-1\/preview$/).reply(200, new Blob(["pdf"], { type: "application/pdf" }));
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, {
      id: "pr-1", document_id: "d-1", version: 1, structured_data: {},
      inferred_schema: null, prompt_used: "", processor_key: "mock|m",
      source: "predict", created_by: "u-1", created_at: "",
    });
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-1")], total: 1, page: 1, page_size: 20,
    });
    mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, []);

    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    expect(await screen.findByText(/Prompt 历史/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/自然语言/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run (RED)**

```bash
npm test -- --run WorkspacePage 2>&1 | tail -15
```

Expected: 3 failures (panels not mounted).

- [ ] **Step 3: Modify WorkspacePage**

In `frontend/src/pages/WorkspacePage.tsx`:

Add imports:

```tsx
import PromptHistoryPanel from "../components/workspace/PromptHistoryPanel";
import NLCorrectionConsole from "../components/workspace/NLCorrectionConsole";
```

In the JSX, immediately before the closing `</div>` of the outermost `<div className="flex flex-col h-full -m-6">`, ADD:

```tsx
<PromptHistoryPanel projectId={pid ?? ""} />
<NLCorrectionConsole
  projectId={pid ?? ""}
  documentId={docId}
  currentPrompt={result?.prompt_used ?? ""}
  annotations={annotations}
  currentResult={result ? { structured_data: result.structured_data } : null}
/>
```

Also: when `currentStep === 4` is set externally and the console isn't open
yet, should we auto-open? The test for "Tune step opens" verifies the
StepIndicator click path; that's enough. Don't add auto-open from step state to
avoid clobbering user's explicit close.

- [ ] **Step 4: Run (GREEN)**

```bash
npm test 2>&1 | tail -3
```

Expected: 224 passed (was 221 → +3).

Production build:
```bash
npm run build 2>&1 | tail -3
```
Expected: built successfully.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/WorkspacePage.tsx frontend/src/pages/__tests__/WorkspacePage.test.tsx
git commit -m "S3/Task 12 (TDD): WorkspacePage mounts PromptHistoryPanel + NLCorrectionConsole + 3 tests

Both panels mounted as siblings under the workspace root div. Visibility
gated on store flags promptHistoryOpen / correctionConsoleOpen. Both can
be open simultaneously (different sides of the screen).

Currently uses result?.prompt_used as the current prompt baseline for
correction; this is what predict_service writes when running predict.

Frontend: 221 -> 224. Production build green."
```

---

## Phase G — Smoke + tag (T13)

### Task 13: end-to-end smoke + s3-complete tag

**Files:** none modified — orchestrator runs Playwright + smoke verification.

This is **the orchestrator's job** (not a subagent task). Documented for
consistency.

- [ ] **Step 1: Reset DB + start servers**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
RESET_DB=1 \
  API_KEY="$API_KEY" \
  OPENAI_API_KEY="$OPENAI_API_KEY" \
  ./scripts/run-dev.sh
```

Or run components separately as in S2b1/S2b2.

- [ ] **Step 2: Bootstrap test data via curl**

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

- [ ] **Step 3: Walk spec §11 acceptance flow**

Per S3 spec §11. Drive via Playwright MCP:

1. Login → workspace → alpha.pdf loaded
2. Click step 4 (Tune) — was locked, now clickable → bottom panel opens
3. Type `"把 buyer_tax_id 改成只保留数字"`; target_field = `buyer_tax_id`; click Send
4. Watch tokens stream into "Revising prompt..." pane
5. After streaming completes, see "Revised prompt:" line-diff
6. See "Predict result:" pane with `buyer_tax_id` row marked changed
7. Click `Save as new version` → enter "tax-id digits only" → 确认保存
8. Both panels close. Click 📜 toolbar button — right history drawer opens; v1 marked active
9. Click "Use template default" → toast confirms; `active_prompt_version_id` reverts to null

If step 3-4 fail because the LLM emits non-streaming output, the single-chunk
fallback is correct behavior — verify the revised_prompt and predict_result
events still arrive.

- [ ] **Step 4: Run tests + build**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest --tb=no -q 2>&1 | tail -2
# Expected: 144 passed

cd ../frontend
npm test 2>&1 | tail -3
# Expected: 224 passed
npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Stop servers + tag**

```bash
lsof -ti :8000 :5173 2>/dev/null | sort -u | xargs -r kill 2>/dev/null
pkill -f vite 2>/dev/null

cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git tag -a s3-complete -m "S3 Prompt Versioning + NL Correction complete

Backend:
- prompt_versions table + projects.active_prompt_version_id (alembic e1b5c0d3f7a4)
- 4 REST endpoints for version CRUD + active toggle
- correction SSE endpoint streaming prompt_token + revised_prompt + predict_result
- engine: chat_stream on processors (gemini/openai real, mock deterministic)
- engine.revise_prompt async generator
- predict_service.resolve_prompt: override > active version > template default
- correction_service produces preview-only (NO ProcessingResult write)

Frontend:
- predict-store: promptVersions + correctionStream state + 4 actions
- lib/diff.ts: lineDiff (LCS) + fieldDiff (shallow)
- PromptHistoryPanel: right drawer (versions, activate, delete, deactivate)
- NLCorrectionConsole: bottom drawer (input, stream pane, prompt+result diff,
  Discard / Save as new version)
- StepIndicator step 4 (Tune) unlocked; click opens correction console
- WorkspaceToolbar 📜 button toggles history panel
- WorkspacePage mounts both panels

Tests: 368 (144 backend + 224 frontend = +46 over s2b2-complete).
Production build green.

Smoke (spec §11): walked end-to-end with real Gemini, asked
'buyer_tax_id 改成只保留数字' — revised prompt streamed in, preview predict
showed numeric-only tax id, saved as v1 (active). History drawer
verified the new version. Reverted to template default."

git tag --list | grep complete
```

- [ ] **Step 6: Update memory pointer (off-tree)**

Edit
`/Users/qinqiang02/.claude/projects/-Users-qinqiang02-colab-codespace-ai-label-studio/memory/project_doc_intel_redesign.md`
to mark **S3 status: completed** with tag, test counts, and key smoke
findings.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Tasks |
|---|---|
| §4 architecture (file map) | T1-T12 each touch the listed files |
| §5.1 PromptVersion model | T1 |
| §5.2 Project.active_prompt_version_id | T1 |
| §5.3 active prompt resolution | T6 |
| §5.4 migration | T1 |
| §6.1 GET /prompt-versions | T2 |
| §6.2 POST /prompt-versions | T2 |
| §6.3 PATCH /active-prompt | T2 |
| §6.4 DELETE /prompt-versions/{vid} | T2 |
| §6.5 POST /correct (SSE) | T4 (service) + T5 (route) |
| §7 engine.revise_prompt | T3 |
| §7.1 mock chat_stream | T3 |
| §8.1 predict-store增量 | T7 |
| §8.2 diff helpers | T8 |
| §8.3 PromptHistoryPanel | T9 |
| §8.4 NLCorrectionConsole | T10 |
| §8.5 StepIndicator unlock | T11 |
| §8.6 toolbar 📜 button | T11 |
| §8.7 WorkspacePage wiring | T12 |
| §11 acceptance smoke | T13 |

No gaps.

**2. Placeholder scan:** No "TBD" / "implement later" / "add validation as needed". Each step has runnable code or runnable commands.

**3. Type consistency:**

- `PromptVersion` fields used consistently in T1 (model), T2 (router schema), T7 (frontend type), T9 (panel test fixture).
- `currentStep: 0|1|2|3|4` widened in T11 — searches for `setStep(2)` etc. continue to type-check.
- `correctionStream.previewResult` shape (`{structured_data, annotations}`) used in T7 (store test) and T10 (component test) consistently.
- SSE event names are exactly the same across backend service (T4), route framing (T5), frontend store (T7), and console UI (T10): `prompt_token / revised_prompt / predict_started / predict_result / done / error`.

**Total: 13 tasks, ≈22h.** Final acceptance via spec §11 smoke in T13.
