# S5 — API Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **TDD is mandatory** — every code unit must have its failing test written first, observed RED, then GREEN.

**Goal:** Let users publish a project as a public extraction API: stable URL `/extract/{api_code}` accepts a file, runs predict via the project's active prompt, returns `structured_data`. Per-project bcrypt-hashed API keys gate access.

**Architecture:** Project gains 3 nullable columns (`api_code` UNIQUE, `api_published_at`, `api_disabled_at`) — state is derived from those columns, no enum. New `api_keys` table holds bcrypt-hashed keys with a 12-char display prefix. 5 authed endpoints under `/api/v1/projects/{pid}` for publish/unpublish + key CRUD. 1 public endpoint mounted at `/extract/{api_code}` (NOT under /api/v1) authenticates via `X-Api-Key` header, runs predict, persists Document + ProcessingResult attributed to `api_key.created_by`.

**Tech Stack:** FastAPI async + SQLAlchemy 2.x + alembic + bcrypt (already a dep, S0 reuses) + secrets (stdlib) + Vite 8 + React 19 + Zustand + react-router 6.

**Spec:** `docs/superpowers/specs/2026-04-29-S5-api-publish-design.md`
**LS-features cross-spec:** `docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md`
**Repo root:** `/Users/qinqiang02/colab/codespace/ai/doc-intel/`
**Baseline:** tag `s4-complete` (166 backend + 238 frontend = 404 tests).
**Target:** ≥184 backend (+18) + ≥250 frontend (+12) = ≥434 tests.

**Alembic chain:** S0 `d9e2957d1511` → S1 `cc4a010e73f1` → S2a `80840f9d0efa` → S3 `e1b5c0d3f7a4` → S4 `f2a8d4e6c5b1` → **S5 `a3c7d9e2b4f5`** (this plan).

**Key format:** `dik_<43 url-safe base64 chars>` ≈ 47 chars total. Prefix stored: first 12 chars (`dik_<8>`). Hash: bcrypt rounds=10 (matches S0 default via `bcrypt.gensalt()`).

**Public endpoint mount**: NOT under `/api/v1`. Mounted directly on `app` in `app/main.py` after `app.include_router(v1_router)`.

---

## Phase A — Backend models + migration (T1)

### Task 1: Project ALTER + ApiKey model + migration + 4 tests

**Files:**
- Modify: `backend/app/models/project.py` (add 3 columns)
- Create: `backend/app/models/api_key.py`
- Modify: `backend/app/models/__init__.py` (register ApiKey)
- Create: `backend/alembic/versions/a3c7d9e2b4f5_s5_api_publish.py`
- Modify: `backend/tests/conftest.py` (only if it explicitly imports models for `Base.metadata.create_all` — add api_key)
- Create: `backend/tests/test_api_key_model.py` (4 tests)

- [ ] **Step 1: Write failing tests (RED)**

Create `backend/tests/test_api_key_model.py`:

```python
"""S5/T1: ApiKey + Project ALTER tests."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select


@pytest.mark.asyncio
async def test_project_has_api_publish_columns(db_session, seed_project):
    # All three new fields default to None
    assert hasattr(seed_project, "api_code")
    assert seed_project.api_code is None
    assert hasattr(seed_project, "api_published_at")
    assert seed_project.api_published_at is None
    assert hasattr(seed_project, "api_disabled_at")
    assert seed_project.api_disabled_at is None


@pytest.mark.asyncio
async def test_api_key_basic_insert(db_session, seed_project, seed_user):
    from app.models.api_key import ApiKey

    k = ApiKey(
        project_id=seed_project.id,
        name="production",
        key_prefix="dik_AbCdEfGh",
        key_hash="$2b$10$abc123",  # placeholder; real hashes in T2
        is_active=True,
        created_by=seed_user.id,
    )
    db_session.add(k)
    await db_session.commit()
    out = (await db_session.execute(select(ApiKey))).scalar_one()
    assert out.name == "production"
    assert out.key_prefix == "dik_AbCdEfGh"
    assert out.is_active is True
    assert out.deleted_at is None


@pytest.mark.asyncio
async def test_api_key_soft_delete_excluded(db_session, seed_project, seed_user):
    from app.models.api_key import ApiKey

    k = ApiKey(
        project_id=seed_project.id, name="x",
        key_prefix="dik_X", key_hash="$2b$10$y",
        created_by=seed_user.id,
    )
    db_session.add(k)
    await db_session.commit()

    k.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    out = (await db_session.execute(
        select(ApiKey).where(ApiKey.deleted_at.is_(None))
    )).scalars().all()
    assert out == []


@pytest.mark.asyncio
async def test_project_delete_cascades_to_api_keys(db_session, seed_project, seed_user):
    """Deleting a Project hard-removes its api_keys via FK CASCADE."""
    from app.models.api_key import ApiKey
    from app.models.project import Project

    k = ApiKey(
        project_id=seed_project.id, name="x",
        key_prefix="dik_X", key_hash="$2b$10$y",
        created_by=seed_user.id,
    )
    db_session.add(k)
    await db_session.commit()

    # Delete the project
    proj = (await db_session.execute(
        select(Project).where(Project.id == seed_project.id)
    )).scalar_one()
    await db_session.delete(proj)
    await db_session.commit()

    rows = (await db_session.execute(select(ApiKey))).scalars().all()
    assert rows == []
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_api_key_model.py -v 2>&1 | tail -15
```

Expected: ImportError for `app.models.api_key` AND `AttributeError` (or AssertionError) on `seed_project.api_code` — capture verbatim.

- [ ] **Step 3: Create migration**

Create `backend/alembic/versions/a3c7d9e2b4f5_s5_api_publish.py`:

```python
"""S5: Project api_code/published_at/disabled_at + api_keys

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
        batch_op.add_column(sa.Column('api_code', sa.String(60), nullable=True))
        batch_op.add_column(sa.Column('api_published_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('api_disabled_at', sa.DateTime(), nullable=True))
        batch_op.create_index(
            batch_op.f('ix_projects_api_code'), ['api_code'], unique=True,
        )

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
        batch_op.drop_index(batch_op.f('ix_projects_api_code'))
        batch_op.drop_column('api_disabled_at')
        batch_op.drop_column('api_published_at')
        batch_op.drop_column('api_code')
```

- [ ] **Step 4: Add ORM models**

Modify `backend/app/models/project.py`. Find the Project class. ADD these three columns (e.g., after the existing `active_prompt_version_id` column from S3, before `TimestampMixin`-supplied timestamps):

```python
    api_code: Mapped[str | None] = mapped_column(
        String(60), unique=True, index=True, nullable=True,
    )
    api_published_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True,
    )
    api_disabled_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True,
    )
```

Ensure `DateTime` and `datetime` are already imported at top of file (S3 already added `datetime` for `active_prompt_version_id` work). If not, add:
```python
from datetime import datetime
from sqlalchemy import DateTime
```

Create `backend/app/models/api_key.py`:

```python
"""S5: ApiKey ORM model — per-project bcrypt-hashed API keys."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4()),
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True, nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    key_prefix: Mapped[str] = mapped_column(String(12), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

Modify `backend/app/models/__init__.py` — add (alongside existing imports):

```python
from app.models.api_key import ApiKey  # noqa: F401
```

If conftest.py explicitly imports models for `Base.metadata.create_all` (it does — see S3/T1 conftest changes), append `from app.models import api_key` to that import block. Verify:

```bash
grep -n "from app.models import" backend/tests/conftest.py
```

If a multi-import line exists, add `api_key` to it.

- [ ] **Step 5: Apply migration locally**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
rm -f data/doc_intel.db data/doc_intel.db-shm data/doc_intel.db-wal
uv run alembic upgrade head 2>&1 | tail -5
```

Expected: log line `Running upgrade f2a8d4e6c5b1 -> a3c7d9e2b4f5, S5: Project api_code/published_at/disabled_at + api_keys`.

- [ ] **Step 6: Run (GREEN)**

```bash
uv run pytest tests/test_api_key_model.py -v 2>&1 | tail -10
```

Expected: 4 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```

Expected: 170 passed (was 166 → +4).

- [ ] **Step 7: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add backend/alembic/versions/a3c7d9e2b4f5_s5_api_publish.py \
        backend/app/models/project.py \
        backend/app/models/api_key.py \
        backend/app/models/__init__.py \
        backend/tests/test_api_key_model.py \
        backend/tests/conftest.py
# (only include conftest.py if you actually modified it)
git commit -m "S5/Task 1 (TDD): Project ALTER + ApiKey model + migration + 4 tests

- alembic a3c7d9e2b4f5 down_rev f2a8d4e6c5b1
- Project gains api_code (unique index), api_published_at, api_disabled_at
- api_keys table: project (CASCADE) + name + key_prefix (12 char display) +
  key_hash (bcrypt) + is_active + last_used_at + soft-delete

Backend: 166 -> 170."
```

## Hard Requirements (T1)

- Strict TDD. Capture RED.
- Migration revision id MUST be `a3c7d9e2b4f5` and down_rev `f2a8d4e6c5b1`.
- DO NOT modify other backend code.

---

## Phase B — Service: key generation + verification + state transitions (T2)

### Task 2: api_publish_service + 4 tests

**Files:**
- Create: `backend/app/services/api_publish_service.py`
- Create: `backend/tests/test_api_publish_service.py` (4 tests)

The service:
- Generates new API keys via `secrets.token_urlsafe(32)` + `bcrypt.hashpw`
- Verifies presented keys against active hashes for a project
- Implements `publish` / `unpublish` state transitions on Project columns
- Validates `api_code` regex + immutability rule

- [ ] **Step 1: Write failing tests (RED)**

Create `backend/tests/test_api_publish_service.py`:

```python
"""S5/T2: api_publish_service tests."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_generate_api_key_returns_dik_prefix_and_bcrypt_hash():
    from app.services.api_publish_service import generate_api_key

    full, prefix, hashed = generate_api_key()
    assert full.startswith("dik_")
    assert len(full) >= 40  # dik_ + base64-safe(32) ≈ 47
    assert prefix == full[:12]
    assert hashed.startswith("$2b$")  # bcrypt prefix


@pytest.mark.asyncio
async def test_verify_api_key_matches_only_correct_plaintext():
    from app.services.api_publish_service import generate_api_key, _verify_one
    full, _, hashed = generate_api_key()
    assert _verify_one(full, hashed) is True
    assert _verify_one("dik_wrong", hashed) is False


@pytest.mark.asyncio
async def test_publish_project_transitions_draft_to_published(db_session, seed_project, seed_user):
    from app.services.api_publish_service import publish_project

    proj = await publish_project(
        db_session, project_id=seed_project.id,
        user=seed_user, api_code="receipts",
    )
    assert proj.api_code == "receipts"
    assert proj.api_published_at is not None
    assert proj.api_disabled_at is None


@pytest.mark.asyncio
async def test_publish_rejects_changing_api_code_after_set(db_session, seed_project, seed_user):
    from app.core.exceptions import AppError
    from app.services.api_publish_service import publish_project

    await publish_project(
        db_session, project_id=seed_project.id,
        user=seed_user, api_code="receipts",
    )
    # Now try to change it
    with pytest.raises(AppError) as exc_info:
        await publish_project(
            db_session, project_id=seed_project.id,
            user=seed_user, api_code="something-else",
        )
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "api_code_immutable"
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest tests/test_api_publish_service.py -v 2>&1 | tail -15
```

Expected: ImportError for `app.services.api_publish_service`. Capture verbatim.

- [ ] **Step 3: Implement service**

Create `backend/app/services/api_publish_service.py`:

```python
"""S5: API publish service — key generation, verification, state transitions."""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone

import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.api_key import ApiKey
from app.models.project import Project
from app.models.user import User


_API_CODE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$")


def _validate_api_code(code: str) -> None:
    if not _API_CODE_RE.match(code):
        raise AppError(
            400, "api_code_invalid",
            "api_code must be 3-60 lowercase alphanumeric chars with optional hyphens, "
            "no leading/trailing hyphen.",
        )


def generate_api_key() -> tuple[str, str, str]:
    """Returns (full_plaintext_key, key_prefix_12_chars, bcrypt_hash)."""
    raw = secrets.token_urlsafe(32)            # ≈43 chars, URL-safe
    full = f"dik_{raw}"                         # ≈47 chars
    prefix = full[:12]                          # "dik_AbCdEfGh"
    hashed = bcrypt.hashpw(
        full.encode("utf-8"), bcrypt.gensalt(rounds=10),
    ).decode("utf-8")
    return full, prefix, hashed


def _verify_one(presented: str, hashed: str) -> bool:
    """Constant-time bcrypt verify."""
    try:
        return bcrypt.checkpw(presented.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


async def verify_api_key(
    db: AsyncSession, *, project_id: str, presented_key: str,
) -> ApiKey | None:
    """Linear-scan project's active keys; return matching ApiKey or None."""
    stmt = select(ApiKey).where(
        ApiKey.project_id == project_id,
        ApiKey.is_active.is_(True),
        ApiKey.deleted_at.is_(None),
    )
    keys = (await db.execute(stmt)).scalars().all()
    for k in keys:
        if _verify_one(presented_key, k.key_hash):
            return k
    return None


async def publish_project(
    db: AsyncSession, *, project_id: str, user: User, api_code: str,
) -> Project:
    """Publish or re-publish a project under the given api_code."""
    _validate_api_code(api_code)
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None),
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")

    if project.api_code is not None and project.api_code != api_code:
        raise AppError(
            400, "api_code_immutable",
            f"api_code '{project.api_code}' cannot be changed; use the existing value.",
        )

    # Check uniqueness across other projects (DB index will also enforce)
    if project.api_code is None:
        dup_stmt = select(Project).where(Project.api_code == api_code)
        dup = (await db.execute(dup_stmt)).scalar_one_or_none()
        if dup is not None and dup.id != project.id:
            raise AppError(409, "api_code_taken", "api_code already taken.")

    if project.api_code is None:
        project.api_code = api_code
        project.api_published_at = datetime.now(timezone.utc)
    project.api_disabled_at = None  # Re-publish from disabled clears this

    await db.commit()
    await db.refresh(project)
    return project


async def unpublish_project(
    db: AsyncSession, *, project_id: str, user: User,
) -> Project:
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None),
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")
    if project.api_code is None:
        raise AppError(400, "api_not_published", "Project is not published.")
    if project.api_disabled_at is None:
        project.api_disabled_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(project)
    return project


async def create_api_key(
    db: AsyncSession, *, project_id: str, user: User, name: str = "",
) -> tuple[ApiKey, str]:
    """Create a new key. Returns (ApiKey row, full plaintext key)."""
    full, prefix, hashed = generate_api_key()
    k = ApiKey(
        project_id=project_id,
        name=name,
        key_prefix=prefix,
        key_hash=hashed,
        is_active=True,
        created_by=user.id,
    )
    db.add(k)
    await db.commit()
    await db.refresh(k)
    return k, full


async def list_api_keys(db: AsyncSession, *, project_id: str) -> list[ApiKey]:
    stmt = (
        select(ApiKey)
        .where(
            ApiKey.project_id == project_id,
            ApiKey.deleted_at.is_(None),
        )
        .order_by(ApiKey.created_at.desc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def soft_delete_api_key(
    db: AsyncSession, *, project_id: str, key_id: str,
) -> None:
    stmt = select(ApiKey).where(
        ApiKey.id == key_id,
        ApiKey.project_id == project_id,
        ApiKey.deleted_at.is_(None),
    )
    k = (await db.execute(stmt)).scalar_one_or_none()
    if k is None:
        raise AppError(404, "api_key_not_found", "API key not found.")
    k.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def touch_last_used(db: AsyncSession, key: ApiKey) -> None:
    key.last_used_at = datetime.now(timezone.utc)
    await db.commit()
```

- [ ] **Step 4: Run (GREEN)**

```bash
uv run pytest tests/test_api_publish_service.py -v 2>&1 | tail -10
```

Expected: 4 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```

Expected: 174 passed (was 170 → +4).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/api_publish_service.py backend/tests/test_api_publish_service.py
git commit -m "S5/Task 2 (TDD): api_publish_service + 4 tests

- generate_api_key: secrets.token_urlsafe(32) -> dik_<43 chars> + bcrypt(rounds=10)
- verify_api_key: linear scan over active project keys, constant-time bcrypt
- publish_project: state transitions (draft -> published / disabled -> published)
  with api_code regex + immutability + uniqueness checks
- unpublish_project, create/list/soft_delete_api_key, touch_last_used

Backend: 170 -> 174."
```

---

## Phase C — Authed router (T3)

### Task 3: 5 authed endpoints + 5 tests

**Files:**
- Create: `backend/app/api/v1/api_publish.py`
- Create: `backend/app/schemas/api_key.py`
- Modify: `backend/app/schemas/project.py` (extend ProjectRead with api fields)
- Modify: `backend/app/api/v1/router.py` (register)
- Create: `backend/tests/test_api_publish_api.py` (5 tests)

- [ ] **Step 1: Failing tests (RED)**

Create `backend/tests/test_api_publish_api.py`:

```python
"""S5/T3: authed api_publish router tests."""
from __future__ import annotations

import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_project(client, token: str, slug: str = "ws-pub"):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": slug},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-pub", "template_key": "custom"},
    )
    return r2.json()["id"]


@pytest.mark.asyncio
async def test_post_publish_returns_200_with_api_code(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/publish", headers=_auth(token),
        json={"api_code": "receipts"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["api_code"] == "receipts"
    assert body["api_published_at"] is not None
    assert body["api_disabled_at"] is None


@pytest.mark.asyncio
async def test_post_publish_409_on_taken_api_code(client, registered_user):
    _, token = registered_user
    p1 = await _setup_project(client, token, slug="ws-pub-a")
    p2 = await _setup_project(client, token, slug="ws-pub-b")
    await client.post(
        f"/api/v1/projects/{p1}/publish", headers=_auth(token),
        json={"api_code": "shared"},
    )
    r = await client.post(
        f"/api/v1/projects/{p2}/publish", headers=_auth(token),
        json={"api_code": "shared"},
    )
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "api_code_taken"


@pytest.mark.asyncio
async def test_post_unpublish_sets_disabled_at(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    await client.post(
        f"/api/v1/projects/{pid}/publish", headers=_auth(token),
        json={"api_code": "myapi"},
    )
    r = await client.post(
        f"/api/v1/projects/{pid}/unpublish", headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["api_disabled_at"] is not None


@pytest.mark.asyncio
async def test_create_api_key_returns_full_key_once(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/api-keys", headers=_auth(token),
        json={"name": "production"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "production"
    assert body["key_prefix"].startswith("dik_")
    # Full plaintext key returned once in this response only
    assert "key" in body
    assert body["key"].startswith("dik_")
    assert body["key"].startswith(body["key_prefix"])

    # GET list does NOT include 'key' field
    r2 = await client.get(
        f"/api/v1/projects/{pid}/api-keys", headers=_auth(token),
    )
    assert r2.status_code == 200, r2.text
    items = r2.json()
    assert len(items) == 1
    assert "key" not in items[0]
    assert items[0]["key_prefix"] == body["key_prefix"]


@pytest.mark.asyncio
async def test_delete_api_key_204_and_excluded_from_list(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/api-keys", headers=_auth(token),
        json={"name": "tmp"},
    )
    kid = r.json()["id"]
    r2 = await client.delete(
        f"/api/v1/projects/{pid}/api-keys/{kid}", headers=_auth(token),
    )
    assert r2.status_code == 204, r2.text
    r3 = await client.get(
        f"/api/v1/projects/{pid}/api-keys", headers=_auth(token),
    )
    assert r3.json() == []
```

- [ ] **Step 2: Run (RED)**

```bash
uv run pytest tests/test_api_publish_api.py -v 2>&1 | tail -15
```

Expected: 404 because routes don't exist. Capture verbatim.

- [ ] **Step 3: Implement schemas**

Create `backend/app/schemas/api_key.py`:

```python
"""S5: ApiKey request/response schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(default="", max_length=120)


class ApiKeyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    name: str
    key_prefix: str
    is_active: bool
    last_used_at: datetime | None
    created_by: str
    created_at: datetime


class ApiKeyCreateResponse(ApiKeyRead):
    """Response for POST /api-keys — includes the full plaintext key (only here)."""
    key: str
```

Modify `backend/app/schemas/project.py` — extend `ProjectRead` to expose new columns. Find:

```python
class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workspace_id: str
    name: str
    slug: str
    description: str | None
    template_key: str | None
    created_by: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
```

Add (after `deleted_at`):

```python
    api_code: str | None = None
    api_published_at: datetime | None = None
    api_disabled_at: datetime | None = None
```

Also export schema for the publish request body. Add at the bottom of project.py:

```python
class PublishRequest(BaseModel):
    api_code: str = Field(min_length=3, max_length=60)
```

- [ ] **Step 4: Implement router**

Create `backend/app/api/v1/api_publish.py`:

```python
"""S5: authed API publish router under /api/v1/projects/{pid}."""
from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.schemas.api_key import ApiKeyCreateRequest, ApiKeyCreateResponse, ApiKeyRead
from app.schemas.project import ProjectRead, PublishRequest
from app.services import api_publish_service as svc

router = APIRouter(prefix="/projects/{project_id}", tags=["api-publish"])


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


@router.post("/publish", response_model=ProjectRead)
async def publish(
    project_id: str, body: PublishRequest,
    db: DbSession, user: CurrentUser,
) -> ProjectRead:
    await _check_project_access(db, project_id, user.id)
    project = await svc.publish_project(
        db, project_id=project_id, user=user, api_code=body.api_code,
    )
    return ProjectRead.model_validate(project)


@router.post("/unpublish", response_model=ProjectRead)
async def unpublish(
    project_id: str, db: DbSession, user: CurrentUser,
) -> ProjectRead:
    await _check_project_access(db, project_id, user.id)
    project = await svc.unpublish_project(db, project_id=project_id, user=user)
    return ProjectRead.model_validate(project)


@router.get("/api-keys", response_model=list[ApiKeyRead])
async def list_api_keys(
    project_id: str, db: DbSession, user: CurrentUser,
) -> list[ApiKeyRead]:
    await _check_project_access(db, project_id, user.id)
    keys = await svc.list_api_keys(db, project_id=project_id)
    return [ApiKeyRead.model_validate(k) for k in keys]


@router.post(
    "/api-keys",
    response_model=ApiKeyCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_key(
    project_id: str, body: ApiKeyCreateRequest,
    db: DbSession, user: CurrentUser,
) -> ApiKeyCreateResponse:
    await _check_project_access(db, project_id, user.id)
    k, full = await svc.create_api_key(
        db, project_id=project_id, user=user, name=body.name,
    )
    return ApiKeyCreateResponse(
        id=k.id, project_id=k.project_id, name=k.name,
        key_prefix=k.key_prefix, is_active=k.is_active,
        last_used_at=k.last_used_at,
        created_by=k.created_by, created_at=k.created_at,
        key=full,
    )


@router.delete(
    "/api-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_api_key(
    project_id: str, key_id: str,
    db: DbSession, user: CurrentUser,
) -> None:
    await _check_project_access(db, project_id, user.id)
    await svc.soft_delete_api_key(
        db, project_id=project_id, key_id=key_id,
    )
```

Modify `backend/app/api/v1/router.py`. Add the import:

```python
from app.api.v1 import api_publish as api_publish_module
```

Register (after existing include_routers):

```python
v1_router.include_router(api_publish_module.router)
```

- [ ] **Step 5: Run (GREEN)**

```bash
uv run pytest tests/test_api_publish_api.py -v 2>&1 | tail -15
```

Expected: 5 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```

Expected: 179 passed (was 174 → +5).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/api_publish.py \
        backend/app/api/v1/router.py \
        backend/app/schemas/api_key.py \
        backend/app/schemas/project.py \
        backend/tests/test_api_publish_api.py
git commit -m "S5/Task 3 (TDD): authed api_publish router (5 endpoints) + 5 tests

- POST   /api/v1/projects/{pid}/publish   → 200 ProjectRead
- POST   /api/v1/projects/{pid}/unpublish → 200 ProjectRead
- GET    /api/v1/projects/{pid}/api-keys  → list (no full key, no hash)
- POST   /api/v1/projects/{pid}/api-keys  → 201 + full key once
- DELETE /api/v1/projects/{pid}/api-keys/{kid} → 204 soft-delete

ProjectRead now exposes api_code/api_published_at/api_disabled_at.
ApiKeyCreateResponse extends ApiKeyRead with full plaintext key.

Backend: 174 -> 179."
```

---

## Phase D — Public extract endpoint (T4)

### Task 4: public /extract/{api_code} + 3 tests

**Files:**
- Create: `backend/app/api/v1/extract_public.py`
- Modify: `backend/app/main.py` (mount the new router on `app` directly)
- Create: `backend/tests/test_extract_public.py` (3 tests)

This endpoint is NOT under `/api/v1`. It mounts directly on `app` so the public URL is `/extract/{api_code}`.

- [ ] **Step 1: Failing tests (RED)**

Create `backend/tests/test_extract_public.py`:

```python
"""S5/T4: public /extract/{api_code} route tests."""
from __future__ import annotations

import io
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_published_project(client, token: str):
    """Create + publish a project; return (api_code, full_api_key)."""
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-extract"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-extract", "template_key": "custom"},
    )
    pid = r2.json()["id"]
    await client.post(
        f"/api/v1/projects/{pid}/publish", headers=_auth(token),
        json={"api_code": "extr-test"},
    )
    r3 = await client.post(
        f"/api/v1/projects/{pid}/api-keys", headers=_auth(token),
        json={"name": "test"},
    )
    return "extr-test", r3.json()["key"], pid


@pytest.mark.asyncio
async def test_extract_happy_path_returns_structured_data(client, registered_user):
    _, token = registered_user
    api_code, api_key, _ = await _setup_published_project(client, token)
    r = await client.post(
        f"/extract/{api_code}",
        headers={"X-Api-Key": api_key},
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        data={},
    )
    # Force mock processor via env or template — for now, test happy path with whatever
    # the project's template_key=custom default produces.
    # If predict fails (no API key set), test should still run with mock template.
    # The template_key 'custom' uses recommended_processor = 'gemini' which requires API_KEY env.
    # Use processor_key_override path? Public endpoint doesn't expose it. So we
    # ensure the test runs in mock-friendly setup by setting USE_MOCK_DATA env.
    # If response is 500 due to missing API key, this test setup is incomplete.
    # Adjust by patching predict_service to use mock. See implementation step 3.
    assert r.status_code == 200, r.text
    body = r.json()
    assert "document_id" in body
    assert "structured_data" in body


@pytest.mark.asyncio
async def test_extract_401_on_invalid_key(client, registered_user):
    _, token = registered_user
    api_code, _, _ = await _setup_published_project(client, token)
    r = await client.post(
        f"/extract/{api_code}",
        headers={"X-Api-Key": "dik_NOTAREALKEY"},
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        data={},
    )
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "invalid_api_key"


@pytest.mark.asyncio
async def test_extract_403_on_disabled(client, registered_user):
    _, token = registered_user
    api_code, api_key, pid = await _setup_published_project(client, token)
    # Disable
    await client.post(f"/api/v1/projects/{pid}/unpublish", headers=_auth(token))
    r = await client.post(
        f"/extract/{api_code}",
        headers={"X-Api-Key": api_key},
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        data={},
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "api_disabled"
```

For the happy-path test to pass without a real LLM key, the implementation MUST allow mock processor in some form. Two approaches:
- (a) Force-use mock when `USE_MOCK_DATA=1` env or settings flag is set, regardless of template
- (b) Default to mock when API_KEY env is absent (already partially the case in `engine/utils.py`)

The simpler test-safe path: have the public extract endpoint accept a hidden `?processor_key=mock` query param OR detect mock mode via env. Let's pick the cleanest: **If `USE_MOCK_DATA=1` env is set, predict_single uses mock processor regardless of template's `recommended_processor`**.

Update the test to use this env. Modify the test file's `_env` fixture path (look at conftest — there's already `_env` autouse fixture that sets test env vars). Add `USE_MOCK_DATA=1` to the test `_env` for these tests. Or set it inside each test before the request via `monkeypatch.setenv("USE_MOCK_DATA", "1")`.

Actually simpler: the conftest's `_env` autouse fixture should set `USE_MOCK_DATA=1` for all tests already (since tests like `test_predict_endpoint.py` use mock). Verify by grepping — if not set, add it.

```bash
grep -n "USE_MOCK_DATA" backend/tests/conftest.py backend/app/engine/utils.py | head
```

If mock isn't always-on in tests, **the simpler fix** is to make `predict_single` consult env var directly. The plan in T4 implementation step adds a 1-line change to `predict_service.predict_single` that respects `USE_MOCK_DATA=1` — pivot the processor key to `mock` regardless of template. This is the path of least churn.

Add to the test file's top:
```python
import os
os.environ["USE_MOCK_DATA"] = "1"  # noqa: E402
```

Or use pytest monkeypatch fixture in each test. Either way, ensure mock processor is used. The implementation step below will add the env flag check.

- [ ] **Step 2: Run (RED)**

```bash
uv run pytest tests/test_extract_public.py -v 2>&1 | tail -15
```

Expected: 404 (route doesn't exist). Capture verbatim.

- [ ] **Step 3: Implement public router**

Create `backend/app/api/v1/extract_public.py`:

```python
"""S5: public /extract/{api_code} route — single endpoint, no /api/v1 prefix."""
from __future__ import annotations

from fastapi import APIRouter, File, Header, UploadFile
from sqlalchemy import select

from app.core.config import get_settings
from app.core.deps import DbSession
from app.core.exceptions import AppError
from app.models.api_key import ApiKey
from app.models.document import Document
from app.models.project import Project
from app.models.user import User
from app.services import api_publish_service as pub_svc
from app.services import predict as predict_svc
from app.services import storage

router = APIRouter(prefix="/extract", tags=["public-extract"])


@router.post("/{api_code}")
async def extract(
    api_code: str,
    db: DbSession,
    file: UploadFile = File(...),
    x_api_key: str | None = Header(default=None, alias="X-Api-Key"),
):
    # 1. Find project
    proj_stmt = select(Project).where(
        Project.api_code == api_code, Project.deleted_at.is_(None),
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "api_code_not_found", "API endpoint not found.")

    # 2. Check disabled
    if project.api_disabled_at is not None:
        raise AppError(403, "api_disabled", "API endpoint is disabled.")

    # 3. API key required
    if not x_api_key:
        raise AppError(401, "missing_api_key", "X-Api-Key header is required.")
    matched = await pub_svc.verify_api_key(
        db, project_id=project.id, presented_key=x_api_key,
    )
    if matched is None:
        raise AppError(401, "invalid_api_key", "Invalid API key.")

    # 4. Mark last_used_at
    await pub_svc.touch_last_used(db, matched)

    # 5. Save uploaded file
    settings = get_settings()
    data = await file.read()
    if len(data) > settings.MAX_UPLOAD_SIZE:
        raise AppError(
            413, "file_too_large",
            f"File exceeds {settings.MAX_UPLOAD_SIZE} bytes.",
        )

    # Need a User for predict_service (key.created_by is the responsible user)
    user_stmt = select(User).where(User.id == matched.created_by)
    creator = (await db.execute(user_stmt)).scalar_one_or_none()
    if creator is None:
        raise AppError(500, "key_owner_missing", "API key owner not found.")

    mime = file.content_type or "application/octet-stream"
    doc = await storage.save_upload(
        db, project=project, uploader=creator,
        filename=file.filename or "upload",
        mime_type=mime, content=data,
    )

    # 6. Predict (uses S3 resolve_prompt → active prompt version if any)
    try:
        pr = await predict_svc.predict_single(
            db, document=doc, project=project, user=creator,
            prompt_override=None, processor_key_override=None,
        )
    except predict_svc.PredictError as e:
        raise AppError(500, e.code, e.message)

    return {
        "document_id": doc.id,
        "structured_data": pr.structured_data,
    }
```

**Required: predict_service mock-mode flag.** Modify `backend/app/services/predict.py:predict_single` early in the function (before processor selection):

```python
    # Honor test/dev mock override via env
    import os as _os
    if _os.environ.get("USE_MOCK_DATA", "").lower() in ("1", "true", "yes"):
        processor_key_override = "mock"
```

Insert this snippet at the top of `predict_single` body (before the existing `processor_key` resolution at line ~162). This honors the existing legacy `engine/utils.py:USE_MOCK_DATA` convention.

**Required: storage.save_upload helper.** Check if it exists:

```bash
grep -n "save_upload\|def upload_document" backend/app/services/storage.py backend/app/services/document_service.py 2>/dev/null | head
```

If `storage.save_upload(db, project, uploader, filename, mime_type, content)` doesn't exist, find the existing upload service (likely `app.services.document` with `upload_document`) and call that signature instead. Adapt the route's call site to whatever the existing helper looks like. Goal: persist a Document row + write file to disk; return the Document.

If the existing helper has a different signature, update the route to match. The behavior is: write file via `storage.absolute_path` + `f.write(content)`, then `db.add(Document(...))` with appropriate fields.

A safe inline implementation if `storage.save_upload` doesn't exist:

```python
import uuid
from pathlib import Path
from app.services import storage as _storage

async def _save_upload_inline(db, *, project, uploader, filename, mime_type, content):
    file_id = str(uuid.uuid4())
    ext = Path(filename).suffix
    file_path = f"{file_id}{ext}"
    abs_path = _storage.absolute_path(file_path)
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(content)
    doc = Document(
        project_id=project.id, filename=filename, file_path=file_path,
        file_size=len(content), mime_type=mime_type,
        uploaded_by=uploader.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc
```

Use this helper inline in extract_public.py if `storage.save_upload` is absent.

Modify `backend/app/main.py`. Find:
```python
from app.api.v1.router import v1_router
app.include_router(v1_router)
```

Add (after the v1 line):

```python
from app.api.v1.extract_public import router as extract_router
app.include_router(extract_router)
```

- [ ] **Step 4: Run (GREEN)**

```bash
uv run pytest tests/test_extract_public.py -v 2>&1 | tail -15
```

Expected: 3 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```

Expected: 182 passed (was 179 → +3).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/extract_public.py \
        backend/app/main.py \
        backend/app/services/predict.py \
        backend/tests/test_extract_public.py
git commit -m "S5/Task 4 (TDD): public /extract/{api_code} route + 3 tests

- POST /extract/{api_code} (NOT under /api/v1) auths via X-Api-Key header
- 401 missing/invalid key, 403 disabled, 404 unknown api_code, 413 too large
- Persists Document + ProcessingResult attributed to api_key.created_by
- Reuses predict_service.predict_single (resolve_prompt honors active prompt version)
- predict_single now respects USE_MOCK_DATA=1 env for test/dev mock mode

Backend: 179 -> 182."
```

---

## Phase E — Predict service smoke for api-key flow (T5)

### Task 5: predict_service smoke + 2 backend tests

**Files:**
- Create: `backend/tests/test_extract_predict_attribution.py` (2 tests)

These are integration tests that exercise the public endpoint + verify attribution to api_key.created_by.

- [ ] **Step 1: Failing tests (RED)**

Create `backend/tests/test_extract_predict_attribution.py`:

```python
"""S5/T5: extract endpoint persistence + attribution tests."""
from __future__ import annotations

import io
import pytest
from sqlalchemy import select


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_published_project(client, token: str):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-attr"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-attr", "template_key": "custom"},
    )
    pid = r2.json()["id"]
    await client.post(
        f"/api/v1/projects/{pid}/publish", headers=_auth(token),
        json={"api_code": "attr-test"},
    )
    r3 = await client.post(
        f"/api/v1/projects/{pid}/api-keys", headers=_auth(token),
        json={"name": "test"},
    )
    return "attr-test", r3.json()["key"], pid, r3.json()["created_by"]


@pytest.mark.asyncio
async def test_extract_persists_document_with_correct_uploader(
    client, registered_user, db_engine,
):
    """Document.uploaded_by should be api_key.created_by."""
    user, token = registered_user
    api_code, api_key, pid, key_creator_id = await _setup_published_project(client, token)
    r = await client.post(
        f"/extract/{api_code}",
        headers={"X-Api-Key": api_key},
        files={"file": ("attr.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        data={},
    )
    assert r.status_code == 200, r.text
    doc_id = r.json()["document_id"]

    # Verify in DB
    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
    from app.models.document import Document
    Session = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        doc = (await s.execute(
            select(Document).where(Document.id == doc_id)
        )).scalar_one()
        assert doc.uploaded_by == key_creator_id
        assert doc.uploaded_by == user["id"]  # In test, registered_user owns the key


@pytest.mark.asyncio
async def test_extract_persists_processing_result(
    client, registered_user, db_engine,
):
    """ProcessingResult should be created for the public-extract document."""
    _, token = registered_user
    api_code, api_key, _, _ = await _setup_published_project(client, token)
    r = await client.post(
        f"/extract/{api_code}",
        headers={"X-Api-Key": api_key},
        files={"file": ("pr.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        data={},
    )
    assert r.status_code == 200
    doc_id = r.json()["document_id"]

    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
    from app.models.processing_result import ProcessingResult
    Session = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        pr = (await s.execute(
            select(ProcessingResult).where(ProcessingResult.document_id == doc_id)
        )).scalar_one()
        assert pr.version == 1
        assert pr.source == "predict"
```

If `db_engine` fixture isn't directly available (depends on conftest naming), use `db_session` instead. Adjust queries to fit existing fixture conventions — the goal is "after extract returns, query DB for Document.uploaded_by + ProcessingResult".

- [ ] **Step 2: Run (RED)**

```bash
uv run pytest tests/test_extract_predict_attribution.py -v 2>&1 | tail -15
```

Expected: depends on T4 — if tests fail, check error. May pass immediately if T4 implementation is correct (this is a tests-only task). If passing immediately, document "RED skipped — T4 implementation already covers" in report.

- [ ] **Step 3: Run (GREEN)**

```bash
uv run pytest tests/test_extract_predict_attribution.py -v 2>&1 | tail -10
```

Expected: 2 passed.

Full suite:
```bash
uv run pytest --tb=no -q 2>&1 | tail -2
```

Expected: 184 passed (was 182 → +2). **Backend target ≥184 hit.**

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_extract_predict_attribution.py
git commit -m "S5/Task 5 (TDD): extract attribution tests + 2 tests

- Document.uploaded_by attributed to api_key.created_by (no ghost user)
- ProcessingResult persists with version=1, source='predict'

Backend: 182 -> 184. Backend target ≥184 hit (18 net adds)."
```

---

## Phase F — Frontend store (T6)

### Task 6: predict-store 5 actions + 5 tests

**Files:**
- Modify: `frontend/src/stores/predict-store.ts`
- Modify: `frontend/src/stores/__tests__/predict-store.test.ts` (append 5 tests)

- [ ] **Step 1: Append failing tests (RED)**

In `frontend/src/stores/__tests__/predict-store.test.ts`, append at the bottom of the existing outer `describe("predict-store", ...)` block (BEFORE its closing `})`):

```ts
  describe("S5 api publish state", () => {
    it("publishApi POSTs and returns project with api_code", async () => {
      mock.onPost("/api/v1/projects/p-1/publish").reply(200, {
        id: "p-1", workspace_id: "ws-1", name: "P", slug: "p", description: null,
        template_key: "custom", created_by: "u-1",
        created_at: "", updated_at: "", deleted_at: null,
        api_code: "receipts",
        api_published_at: "2026-04-29T12:00:00",
        api_disabled_at: null,
      });
      const out = await usePredictStore.getState().publishApi("p-1", "receipts");
      expect(out.api_code).toBe("receipts");
      expect(out.api_disabled_at).toBeNull();
    });

    it("unpublishApi POSTs and returns project with api_disabled_at", async () => {
      mock.onPost("/api/v1/projects/p-1/unpublish").reply(200, {
        id: "p-1", workspace_id: "ws-1", name: "P", slug: "p", description: null,
        template_key: "custom", created_by: "u-1",
        created_at: "", updated_at: "", deleted_at: null,
        api_code: "receipts",
        api_published_at: "2026-04-29T12:00:00",
        api_disabled_at: "2026-04-29T13:00:00",
      });
      const out = await usePredictStore.getState().unpublishApi("p-1");
      expect(out.api_disabled_at).not.toBeNull();
    });

    it("listApiKeys GETs and returns array", async () => {
      mock.onGet("/api/v1/projects/p-1/api-keys").reply(200, [{
        id: "k-1", project_id: "p-1", name: "production",
        key_prefix: "dik_AbCdEfGh", is_active: true,
        last_used_at: null, created_by: "u-1", created_at: "",
      }]);
      const out = await usePredictStore.getState().listApiKeys("p-1");
      expect(out.length).toBe(1);
      expect(out[0].key_prefix).toBe("dik_AbCdEfGh");
    });

    it("createApiKey POSTs and returns response with full key once", async () => {
      mock.onPost("/api/v1/projects/p-1/api-keys").reply(201, {
        id: "k-1", project_id: "p-1", name: "production",
        key_prefix: "dik_AbCdEfGh", is_active: true,
        last_used_at: null, created_by: "u-1", created_at: "",
        key: "dik_AbCdEfGh_LongFullKeyHereXYZ123",
      });
      const out = await usePredictStore.getState().createApiKey("p-1", "production");
      expect(out.key).toMatch(/^dik_/);
      expect(out.key.startsWith(out.key_prefix)).toBe(true);
    });

    it("deleteApiKey DELETEs", async () => {
      let deleted = false;
      mock.onDelete("/api/v1/projects/p-1/api-keys/k-1").reply(() => {
        deleted = true;
        return [204, ""];
      });
      await usePredictStore.getState().deleteApiKey("p-1", "k-1");
      expect(deleted).toBe(true);
    });
  });
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run predict-store 2>&1 | tail -15
```

Expected: 5 failures (actions don't exist).

- [ ] **Step 3: Extend predict-store**

In `frontend/src/stores/predict-store.ts`:

**A. Add types** (near other type exports):

```ts
export interface ApiKey {
  id: string;
  project_id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_by: string;
  created_at: string;
}

export interface ApiKeyCreateResponse extends ApiKey {
  key: string;
}

export interface ProjectApiState {
  id: string;
  api_code: string | null;
  api_published_at: string | null;
  api_disabled_at: string | null;
}
```

**B. Extend `PredictState` interface** by appending these signatures:

```ts
  publishApi: (projectId: string, apiCode: string) => Promise<ProjectApiState>;
  unpublishApi: (projectId: string) => Promise<ProjectApiState>;
  listApiKeys: (projectId: string) => Promise<ApiKey[]>;
  createApiKey: (projectId: string, name: string) => Promise<ApiKeyCreateResponse>;
  deleteApiKey: (projectId: string, keyId: string) => Promise<void>;
```

**C. Add the actions** in the create body (after existing actions):

```ts
  publishApi: async (projectId, apiCode) => {
    const r = await api.post<ProjectApiState>(
      `/api/v1/projects/${projectId}/publish`,
      { api_code: apiCode },
    );
    return r.data;
  },

  unpublishApi: async (projectId) => {
    const r = await api.post<ProjectApiState>(
      `/api/v1/projects/${projectId}/unpublish`,
    );
    return r.data;
  },

  listApiKeys: async (projectId) => {
    const r = await api.get<ApiKey[]>(
      `/api/v1/projects/${projectId}/api-keys`,
    );
    return r.data;
  },

  createApiKey: async (projectId, name) => {
    const r = await api.post<ApiKeyCreateResponse>(
      `/api/v1/projects/${projectId}/api-keys`,
      { name },
    );
    return r.data;
  },

  deleteApiKey: async (projectId, keyId) => {
    await api.delete(`/api/v1/projects/${projectId}/api-keys/${keyId}`);
  },
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run predict-store 2>&1 | tail -10
```

Expected: 5 new tests pass.

Full suite:
```bash
npm test 2>&1 | tail -3
```

Expected: 243 passed (was 238 → +5).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/stores/predict-store.ts frontend/src/stores/__tests__/predict-store.test.ts
git commit -m "S5/Task 6 (TDD): predict-store api publish actions + 5 tests

ApiKey + ApiKeyCreateResponse + ProjectApiState types exported.
Actions:
- publishApi / unpublishApi return ProjectApiState
- listApiKeys / deleteApiKey
- createApiKey returns ApiKeyCreateResponse with full key once

Frontend: 238 -> 243."
```

---

## Phase G — PublishPage (T7-T8)

### Task 7: PublishPage shell + state badge + 2 tests

**Files:**
- Create: `frontend/src/pages/PublishPage.tsx`
- Create: `frontend/src/pages/__tests__/PublishPage.test.tsx`

- [ ] **Step 1: Failing tests (RED)**

Create `frontend/src/pages/__tests__/PublishPage.test.tsx`:

```tsx
import MockAdapter from "axios-mock-adapter";
import { render, screen } from "@testing-library/react";
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

import PublishPage from "../PublishPage";

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
          path="/workspaces/:slug/projects/:pid/api"
          element={<PublishPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("PublishPage", () => {
  it("draft state shows DRAFT badge + Publish button + api_code input", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(200, {
      id: "p-1", workspace_id: "ws-1", name: "Receipts", slug: "receipts",
      description: null, template_key: "custom",
      created_by: "u-1", created_at: "", updated_at: "", deleted_at: null,
      api_code: null, api_published_at: null, api_disabled_at: null,
    });
    mock.onGet("/api/v1/projects/p-1/api-keys").reply(200, []);

    renderPage("/workspaces/demo/projects/p-1/api");
    expect(await screen.findByText(/DRAFT/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/api_code|receipts/i)).toBeInTheDocument();
  });

  it("published state shows PUBLISHED badge + api_code (immutable) + Unpublish", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(200, {
      id: "p-1", workspace_id: "ws-1", name: "Receipts", slug: "receipts",
      description: null, template_key: "custom",
      created_by: "u-1", created_at: "", updated_at: "", deleted_at: null,
      api_code: "receipts",
      api_published_at: "2026-04-29T12:00:00",
      api_disabled_at: null,
    });
    mock.onGet("/api/v1/projects/p-1/api-keys").reply(200, []);

    renderPage("/workspaces/demo/projects/p-1/api");
    expect(await screen.findByText(/PUBLISHED/i)).toBeInTheDocument();
    expect(screen.getByText(/receipts/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unpublish/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run PublishPage 2>&1 | tail -10
```

Expected: `Cannot find module '../PublishPage'`. Capture verbatim.

- [ ] **Step 3: Implement PublishPage shell + state**

Create `frontend/src/pages/PublishPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, extractApiError } from "../lib/api-client";
import { useAuthStore } from "../stores/auth-store";
import {
  usePredictStore,
  type ApiKey,
  type ApiKeyCreateResponse,
  type ProjectApiState,
} from "../stores/predict-store";

interface ProjectFull extends ProjectApiState {
  workspace_id: string;
  name: string;
  slug: string;
}

type Status = "draft" | "published" | "disabled";

function deriveStatus(p: ProjectApiState | null): Status {
  if (!p || !p.api_code) return "draft";
  if (p.api_disabled_at) return "disabled";
  return "published";
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)
  ?? "http://localhost:9000";

export default function PublishPage() {
  const { slug, pid } = useParams();
  const navigate = useNavigate();
  const workspaces = useAuthStore((s) => s.workspaces);
  const ws = workspaces.find((w) => w.slug === slug);

  const publishApi = usePredictStore((s) => s.publishApi);
  const unpublishApi = usePredictStore((s) => s.unpublishApi);
  const listApiKeys = usePredictStore((s) => s.listApiKeys);
  const createApiKey = usePredictStore((s) => s.createApiKey);
  const deleteApiKey = usePredictStore((s) => s.deleteApiKey);

  const [project, setProject] = useState<ProjectFull | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [apiCodeInput, setApiCodeInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Modal state for new-key flow
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState<ApiKeyCreateResponse | null>(null);

  useEffect(() => {
    if (!ws || !pid) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.get<ProjectFull>(
          `/api/v1/workspaces/${ws.id}/projects/${pid}`,
        );
        if (cancelled) return;
        setProject(r.data);
        setApiCodeInput(r.data.slug || "");
        const ks = await listApiKeys(pid);
        if (!cancelled) setKeys(ks);
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message);
      }
    })();
    return () => { cancelled = true; };
  }, [ws, pid, listApiKeys]);

  const status: Status = deriveStatus(project);

  async function handlePublish() {
    if (!pid) return;
    const code = project?.api_code ?? apiCodeInput.trim();
    if (!code) return;
    setBusy(true);
    try {
      const updated = await publishApi(pid, code);
      setProject(p => p ? { ...p, ...updated } : p);
      setError(null);
    } catch (e) {
      setError(extractApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUnpublish() {
    if (!pid) return;
    setBusy(true);
    try {
      const updated = await unpublishApi(pid);
      setProject(p => p ? { ...p, ...updated } : p);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateKey() {
    if (!pid) return;
    setBusy(true);
    try {
      const r = await createApiKey(pid, newKeyName);
      setRevealedKey(r);
      const ks = await listApiKeys(pid);
      setKeys(ks);
      setNewKeyName("");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteKey(kid: string) {
    if (!pid) return;
    if (!confirm("Delete this API key?")) return;
    await deleteApiKey(pid, kid);
    const ks = await listApiKeys(pid);
    setKeys(ks);
  }

  const publicUrl = project?.api_code
    ? `${API_BASE}/extract/${project.api_code}`
    : "";

  return (
    <div className="text-sm space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => slug && pid && navigate(`/workspaces/${slug}/projects/${pid}`)}
          className="text-xs text-[#94a3b8] hover:text-[#e2e8f0]"
        >
          ◀ Back to Project
        </button>
        <h1 className="text-lg font-semibold">🔌 API for "{project?.name ?? "..."}"</h1>
        <div />
      </div>

      {error && (
        <div className="text-xs text-[#ef4444] bg-[#3f1d1d] border border-[#ef4444] rounded p-2">
          {error}
        </div>
      )}

      {/* Status section */}
      <section className="bg-[#0f1117] border border-[#2a2e3d] rounded p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8]">Status:</span>
          <StatusBadge status={status} />
        </div>

        {status === "draft" && (
          <div className="flex items-center gap-2">
            <input
              value={apiCodeInput}
              onChange={(e) => setApiCodeInput(e.target.value)}
              placeholder="api_code (e.g. receipts)"
              className="bg-[#1a1d27] border border-[#2a2e3d] rounded px-2 py-1 text-sm flex-1 max-w-md"
            />
            <button
              type="button"
              disabled={busy || !apiCodeInput.trim()}
              onClick={() => void handlePublish()}
              className="bg-[#6366f1] text-white px-3 py-1 rounded text-xs disabled:opacity-50"
            >
              Publish
            </button>
          </div>
        )}

        {status === "published" && project?.api_code && (
          <div>
            <div className="text-xs text-[#94a3b8] mb-1">Public URL:</div>
            <pre className="bg-[#0a0c11] p-2 rounded text-xs text-[#a5f3fc] mb-2">{publicUrl}</pre>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleUnpublish()}
              className="text-xs text-[#ef4444] hover:underline"
            >
              Unpublish
            </button>
          </div>
        )}

        {status === "disabled" && project?.api_code && (
          <div>
            <div className="text-xs text-[#94a3b8] mb-1">api_code: {project.api_code} (currently disabled)</div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handlePublish()}
              className="bg-[#6366f1] text-white px-3 py-1 rounded text-xs disabled:opacity-50"
            >
              Re-Publish
            </button>
          </div>
        )}
      </section>

      {/* API Keys section */}
      <section className="bg-[#0f1117] border border-[#2a2e3d] rounded p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8]">API Keys</span>
          <button
            type="button"
            onClick={() => setNewKeyOpen(true)}
            className="text-xs text-[#6366f1] hover:underline"
          >
            + New Key
          </button>
        </div>
        {keys.length === 0 ? (
          <div className="text-xs text-[#64748b] text-center py-4">
            No keys. Create one to start using the API.
          </div>
        ) : (
          <div className="space-y-1">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between bg-[#1a1d27] rounded p-2">
                <div>
                  <span className="font-mono text-[#a5f3fc]">{k.key_prefix}···</span>
                  {k.name && <span className="ml-2 italic text-[#94a3b8]">"{k.name}"</span>}
                  <span className="ml-2 text-xs text-[#64748b]">
                    last: {k.last_used_at ?? "never"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteKey(k.id)}
                  className="text-xs text-[#ef4444] hover:underline"
                  title="Delete key"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* cURL hint section */}
      {project?.api_code && status === "published" && (
        <section className="bg-[#0f1117] border border-[#2a2e3d] rounded p-4">
          <div className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-2">
            Try it (cURL)
          </div>
          <pre className="text-xs whitespace-pre-wrap bg-[#0a0c11] p-2 rounded text-[#a5f3fc]">
{`curl -X POST "${publicUrl}" \\
  -H "X-Api-Key: dik_..." \\
  -F "file=@invoice.pdf"`}
          </pre>
        </section>
      )}

      {/* New key modal */}
      {newKeyOpen && (
        <NewKeyModal
          name={newKeyName}
          onNameChange={setNewKeyName}
          revealedKey={revealedKey}
          onSubmit={() => void handleCreateKey()}
          onClose={() => {
            setNewKeyOpen(false);
            setRevealedKey(null);
          }}
          busy={busy}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const styles = {
    draft: "bg-[#64748b] text-white",
    published: "bg-[#22c55e] text-white",
    disabled: "bg-[#ef4444] text-white",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${styles[status]}`}>
      {status.toUpperCase()}
    </span>
  );
}

function NewKeyModal({
  name, onNameChange, revealedKey, onSubmit, onClose, busy,
}: {
  name: string;
  onNameChange: (v: string) => void;
  revealedKey: ApiKeyCreateResponse | null;
  onSubmit: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-4 w-[480px] space-y-3">
        {!revealedKey ? (
          <>
            <h2 className="font-semibold">+ New API Key</h2>
            <input
              autoFocus
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Key name (e.g. production)"
              className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-xs text-[#94a3b8] px-3 py-1">Cancel</button>
              <button
                disabled={busy}
                onClick={onSubmit}
                className="bg-[#6366f1] text-white text-xs px-3 py-1 rounded disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-semibold">Your new API key</h2>
            <div className="text-xs text-[#fca5a5] bg-[#3f1d1d] border border-[#ef4444] rounded p-2">
              ⚠️ This is the only time you'll see this key. Store it safely; we cannot show it again.
            </div>
            <pre className="text-xs whitespace-pre-wrap bg-[#0a0c11] p-2 rounded text-[#a5f3fc] font-mono break-all">
              {revealedKey.key}
            </pre>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="bg-[#6366f1] text-white text-xs px-3 py-1 rounded"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run PublishPage 2>&1 | tail -10
```

Expected: 2 passed.

Full suite:
```bash
npm test 2>&1 | tail -3
```

Expected: 245 passed (was 243 → +2).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/pages/PublishPage.tsx frontend/src/pages/__tests__/PublishPage.test.tsx
git commit -m "S5/Task 7 (TDD): PublishPage shell + state badge + 2 tests

3 sections: status (draft/published/disabled with Publish/Unpublish/Re-Publish
buttons), API keys list (with + New Key), cURL hint when published.
Inline NewKeyModal handles 'create' → reveal full key once → 'Done'
(implementation complete; T8 adds tests for modal + delete flow).

Frontend: 243 -> 245."
```

---

### Task 8: PublishPage new-key modal + delete flow + 2 tests

**Files:**
- Modify: `frontend/src/pages/__tests__/PublishPage.test.tsx` (append 2 tests)

The implementation is already in T7. T8 adds test coverage.

- [ ] **Step 1: Append 2 tests**

```tsx
  it("opens new-key modal, creates key, reveals full key, then closes", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(200, {
      id: "p-1", workspace_id: "ws-1", name: "Receipts", slug: "receipts",
      description: null, template_key: "custom",
      created_by: "u-1", created_at: "", updated_at: "", deleted_at: null,
      api_code: "receipts",
      api_published_at: "2026-04-29T12:00:00",
      api_disabled_at: null,
    });
    let listCall = 0;
    mock.onGet("/api/v1/projects/p-1/api-keys").reply(() => {
      listCall++;
      if (listCall === 1) return [200, []];
      return [200, [{
        id: "k-1", project_id: "p-1", name: "production",
        key_prefix: "dik_AbCdEfGh", is_active: true,
        last_used_at: null, created_by: "u-1", created_at: "",
      }]];
    });
    mock.onPost("/api/v1/projects/p-1/api-keys").reply(201, {
      id: "k-1", project_id: "p-1", name: "production",
      key_prefix: "dik_AbCdEfGh", is_active: true,
      last_used_at: null, created_by: "u-1", created_at: "",
      key: "dik_AbCdEfGh_FullSecretKeyXYZ123",
    });

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/api");
    await screen.findByText(/PUBLISHED/i);
    await user.click(screen.getByText(/\+ New Key/i));
    const nameInput = await screen.findByPlaceholderText(/Key name/i);
    await user.type(nameInput, "production");
    await user.click(screen.getByRole("button", { name: /^Create$/i }));
    // Modal switches to revealed view
    expect(await screen.findByText(/dik_AbCdEfGh_FullSecretKeyXYZ123/)).toBeInTheDocument();
    expect(screen.getByText(/only time you'll see this key/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Done$/i }));
    // List refreshed with prefix
    expect(await screen.findByText(/dik_AbCdEfGh/)).toBeInTheDocument();
  });

  it("clicking 🗑 confirms then DELETEs the key", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(200, {
      id: "p-1", workspace_id: "ws-1", name: "Receipts", slug: "receipts",
      description: null, template_key: "custom",
      created_by: "u-1", created_at: "", updated_at: "", deleted_at: null,
      api_code: "receipts",
      api_published_at: "2026-04-29T12:00:00",
      api_disabled_at: null,
    });
    let listCall = 0;
    mock.onGet("/api/v1/projects/p-1/api-keys").reply(() => {
      listCall++;
      if (listCall === 1) return [200, [{
        id: "k-1", project_id: "p-1", name: "production",
        key_prefix: "dik_AbCdEfGh", is_active: true,
        last_used_at: null, created_by: "u-1", created_at: "",
      }]];
      return [200, []];
    });
    let deleted = false;
    mock.onDelete("/api/v1/projects/p-1/api-keys/k-1").reply(() => {
      deleted = true;
      return [204, ""];
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/api");
    await screen.findByText(/dik_AbCdEfGh/);
    await user.click(screen.getByTitle(/Delete key/i));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.queryByText(/dik_AbCdEfGh/)).not.toBeInTheDocument());
  });
```

- [ ] **Step 2: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run PublishPage 2>&1 | tail -10
```

Expected: 4 passed (2 prior + 2 new).

Full suite:
```bash
npm test 2>&1 | tail -3
```

Expected: 247 passed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/__tests__/PublishPage.test.tsx
git commit -m "S5/Task 8 (TDD): PublishPage new-key modal + delete + 2 tests

- Open modal -> type name -> Create -> reveal full key once with warning
  -> Done -> list refreshes showing prefix only
- 🗑 with confirm -> DELETE -> list refreshes minus the key

T7 implementation already covers; T8 adds test coverage.

Frontend: 245 -> 247."
```

---

## Phase H — StepIndicator unlock + nav + tests (T9-T10)

### Task 9: StepIndicator GenerateAPI unlock + 1 test

**Files:**
- Modify: `frontend/src/components/workspace/StepIndicator.tsx`
- Modify: `frontend/src/components/workspace/__tests__/StepIndicator.test.tsx`
- Modify: `frontend/src/stores/predict-store.ts` (widen currentStep type)

- [ ] **Step 1: Replace existing test + add 1 new (RED)**

In `frontend/src/components/workspace/__tests__/StepIndicator.test.tsx`, find the existing test that asserts GenerateAPI is locked. Replace its body with:

```tsx
  it("renders GenerateAPI as reachable (no 🔒)", () => {
    render(<StepIndicator />);
    const gen = screen.getByRole("button", { name: /GenerateAPI/ });
    expect(gen.textContent).not.toMatch(/🔒/);
    expect(gen).not.toBeDisabled();
  });
```

If the existing test was named `"renders 🔒 on GenerateAPI only"` (from S2b2), replace it. If it was already changed in S3 to assert other locked states, find and update.

Add a new test at the bottom of the describe:

```tsx
  it("clicking GenerateAPI sets currentStep to 5", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    render(<StepIndicator />);
    await user.click(screen.getByRole("button", { name: /GenerateAPI/ }));
    expect(usePredictStore.getState().currentStep).toBe(5);
  });
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run StepIndicator 2>&1 | tail -15
```

Expected: 2 failures (locked-asserting test now wrong; setStep(5) not allowed). Capture verbatim.

- [ ] **Step 3: Update predict-store currentStep type**

In `frontend/src/stores/predict-store.ts`, find:

```ts
  currentStep: 0 | 1 | 2 | 3 | 4;
  setStep: (step: 0 | 1 | 2 | 3 | 4) => void;
```

Replace BOTH with `0 | 1 | 2 | 3 | 4 | 5`. (Two occurrences.)

- [ ] **Step 4: Modify StepIndicator**

In `frontend/src/components/workspace/StepIndicator.tsx`:

Move GenerateAPI from `LOCKED_STEPS` to `REACHABLE_STEPS`. Update the `Step.id` union type to include `5`:

```tsx
interface Step {
  id: 0 | 1 | 2 | 3 | 4 | 5;
  label: string;
}
const REACHABLE_STEPS: Step[] = [
  { id: 0, label: "Upload" },
  { id: 1, label: "Preview" },
  { id: 2, label: "Correct" },
  { id: 3, label: "ApiFormat" },
  { id: 4, label: "Tune" },
  { id: 5, label: "GenerateAPI" },
];
const LOCKED_STEPS: Step[] = [];  // Empty — all steps now reachable
```

The existing JSX rendering both arrays continues to work; the `LOCKED_STEPS.map(...)` iteration on an empty array renders nothing.

- [ ] **Step 5: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run StepIndicator 2>&1 | tail -10
```

Expected: All StepIndicator tests pass.

Full suite:
```bash
npm test 2>&1 | tail -3
```

Expected: 248 passed (was 247 → +1; the replaced test still counts; just changed assertions).

- [ ] **Step 6: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/StepIndicator.tsx \
        frontend/src/components/workspace/__tests__/StepIndicator.test.tsx \
        frontend/src/stores/predict-store.ts
git commit -m "S5/Task 9 (TDD): StepIndicator GenerateAPI unlock + 1 test

- All 6 steps now reachable; LOCKED_STEPS is empty
- predict-store currentStep widened to 0|1|2|3|4|5
- click GenerateAPI sets currentStep=5

Frontend: 247 -> 248."
```

---

### Task 10: ProjectDocumentsPage 🔌 button + App route + 2 tests

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/ProjectDocumentsPage.tsx`
- Modify: `frontend/src/pages/__tests__/ProjectDocumentsPage.test.tsx`
- Modify: `frontend/src/__tests__/App.test.tsx`

- [ ] **Step 1: Append failing tests (RED)**

In `frontend/src/__tests__/App.test.tsx`:

1. Add a stub mock at top:

```tsx
vi.mock("../pages/PublishPage", () => ({
  default: () => <div data-testid="page-publish">publish</div>,
}));
```

2. Add a routing test:

```tsx
  it("/workspaces/:slug/projects/:pid/api renders PublishPage when authed", () => {
    mockState.token = "tok";
    window.history.pushState({}, "", "/workspaces/demo/projects/p-1/api");
    render(<App />);
    expect(screen.getByTestId("page-publish")).toBeInTheDocument();
  });
```

In `frontend/src/pages/__tests__/ProjectDocumentsPage.test.tsx`, append:

```tsx
  it("clicking 🔌 API navigates to publish page", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1"),
    ]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("d-1.pdf");
    await user.click(screen.getByRole("button", { name: /API/i }));
    expect(navigateMock).toHaveBeenCalledWith(
      "/workspaces/demo/projects/p-1/api"
    );
  });
```

- [ ] **Step 2: Run (RED)**

```bash
npm test -- --run "App|ProjectDocumentsPage" 2>&1 | tail -15
```

Expected: 2 failures. Capture verbatim.

- [ ] **Step 3: Modify App.tsx**

Add import:

```tsx
import PublishPage from "./pages/PublishPage";
```

Add route inside `<ProtectedRoute><AppShell /></ProtectedRoute>`:

```tsx
<Route path="/workspaces/:slug/projects/:pid/api" element={<PublishPage />} />
```

- [ ] **Step 4: Modify ProjectDocumentsPage**

Find the toolbar with `📊 Evaluate` button (added in S4/T10). Insert a new button next to it:

```tsx
<button
  type="button"
  onClick={() => ws && navigate(`/workspaces/${ws.slug}/projects/${pid}/api`)}
  className="text-xs text-[#6366f1] hover:underline"
  title="API publish"
>
  🔌 API
</button>
```

- [ ] **Step 5: Run (GREEN)**

```bash
npm test 2>&1 | tail -3
```

Expected: 250 passed (was 248 → +2). **Frontend target ≥250 hit.**

Production build:
```bash
npm run build 2>&1 | tail -3
```

Expected: built.

- [ ] **Step 6: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/App.tsx \
        frontend/src/pages/ProjectDocumentsPage.tsx \
        frontend/src/pages/__tests__/ProjectDocumentsPage.test.tsx \
        frontend/src/__tests__/App.test.tsx
git commit -m "S5/Task 10 (TDD): ProjectDocumentsPage 🔌 link + App route + 2 tests

- New route /workspaces/:slug/projects/:pid/api under protected AppShell
- ProjectDocumentsPage gets a '🔌 API' button next to 📊 Evaluate

Frontend: 248 -> 250. Production build green."
```

---

## Phase I — Smoke + tag (T11)

### Task 11: end-to-end smoke + s5-complete tag

**Files:** none modified — orchestrator runs Playwright + smoke verification.

- [ ] **Step 1: Reset DB + start servers**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
rm -f backend/data/doc_intel.db backend/data/doc_intel.db-shm backend/data/doc_intel.db-wal
cd backend && uv run alembic upgrade head 2>&1 | tail -5
# Verify final migration is a3c7d9e2b4f5
cd ..
RESET_DB=0 \
  API_KEY="$API_KEY" \
  OPENAI_API_KEY="$OPENAI_API_KEY" \
  ./scripts/run-dev.sh
```

- [ ] **Step 2: Bootstrap (curl) + smoke walk**

```bash
BASE=http://127.0.0.1:9000/api/v1
PUBLIC=http://127.0.0.1:9000/extract
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
echo "PID=$PID"

# Publish
curl -s --noproxy '*' -X POST $BASE/projects/$PID/publish \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"api_code":"receipts"}' | python3 -m json.tool | head -15

# Create key
KEY=$(curl -s --noproxy '*' -X POST $BASE/projects/$PID/api-keys \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"production"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['key'])")
echo "KEY=$KEY"

# Public extract (real Gemini)
ALPHA=/Users/qinqiang02/colab/codespace/ai/doc-intel/testing/test1_honor/3744516.pdf
curl -s --noproxy '*' -X POST $PUBLIC/receipts \
  -H "X-Api-Key: $KEY" \
  -F "file=@$ALPHA" | python3 -m json.tool | head -20

# Unpublish
curl -s --noproxy '*' -X POST $BASE/projects/$PID/unpublish \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -5

# Public extract again → 403
curl -s --noproxy '*' -X POST $PUBLIC/receipts \
  -H "X-Api-Key: $KEY" \
  -F "file=@$ALPHA" -o /dev/null -w "after unpublish: %{http_code}\n"

# Re-publish
curl -s --noproxy '*' -X POST $BASE/projects/$PID/publish \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"api_code":"receipts"}' > /dev/null

# Public extract → 200 again
curl -s --noproxy '*' -X POST $PUBLIC/receipts \
  -H "X-Api-Key: $KEY" \
  -F "file=@$ALPHA" -o /dev/null -w "after re-publish: %{http_code}\n"

# List keys, get id
KID=$(curl -s --noproxy '*' -H "Authorization: Bearer $TOKEN" \
  $BASE/projects/$PID/api-keys | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")

# Delete key
curl -s --noproxy '*' -X DELETE -H "Authorization: Bearer $TOKEN" \
  $BASE/projects/$PID/api-keys/$KID -o /dev/null -w "delete key: %{http_code}\n"

# Public extract → 401 (key deleted)
curl -s --noproxy '*' -X POST $PUBLIC/receipts \
  -H "X-Api-Key: $KEY" \
  -F "file=@$ALPHA" -o /dev/null -w "after delete: %{http_code}\n"
```

- [ ] **Step 3: Frontend Playwright walk**

Login → click 🔌 API on project page → PublishPage shows "PUBLISHED" (since
backend smoke just re-published) → click + New Key → enter "production2" →
Create → reveal full key → Done → list shows new prefix → click 🗑 →
list shrinks → Click step 5 (GenerateAPI) in workspace's StepIndicator
(if visiting workspace) — it's now reachable.

- [ ] **Step 4: Run tests + build**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest --tb=no -q 2>&1 | tail -2
# Expected: 184 passed

cd ../frontend
npm test 2>&1 | tail -3
# Expected: 250 passed
npm run build 2>&1 | tail -5
# Expected: built
```

- [ ] **Step 5: Stop servers + tag**

```bash
lsof -ti :9000 :5173 2>/dev/null | sort -u | xargs -r kill 2>/dev/null
pkill -f vite 2>/dev/null

cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git tag -a s5-complete -m "S5 API Publish complete (final sub-spec)

Backend:
- Project ALTER: api_code (UNIQUE INDEX), api_published_at, api_disabled_at
- api_keys table (alembic a3c7d9e2b4f5): bcrypt-hashed keys, soft-delete,
  CASCADE on project delete
- 5 authed endpoints: publish/unpublish/list+create+delete keys
- 1 public endpoint: POST /extract/{api_code} (X-Api-Key header) — persists
  Document + ProcessingResult attributed to api_key.created_by
- predict_service.predict_single honors USE_MOCK_DATA=1 env for tests

Frontend:
- predict-store: ApiKey/ApiKeyCreateResponse/ProjectApiState types + 5 actions
- PublishPage at /workspaces/:slug/projects/:pid/api
- StepIndicator: step 5 (GenerateAPI) unlocked; LOCKED_STEPS now empty
- 🔌 API button on ProjectDocumentsPage

Tests: 434 (184 backend + 250 frontend = +30 over s4-complete).
Production build green.

Smoke (spec §11) walked end-to-end:
- curl: publish + create key + extract (real Gemini) + unpublish (403) +
  re-publish (200) + delete key (401)
- Playwright: 🔌 button navigates, status badge transitions, new-key modal
  reveals full key once, delete refreshes list

doc-intel platform now feature-complete: upload → predict → correct → tune
(NL correction) → format (3 modes) → evaluate → generate API."

git tag --list | grep complete
```

- [ ] **Step 6: Update memory**

Edit
`/Users/qinqiang02/.claude/projects/-Users-qinqiang02-colab-codespace-ai-label-studio/memory/project_doc_intel_redesign.md`
to mark **S5 status: completed** and add a "Project complete" capstone note.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Tasks |
|---|---|
| §4 architecture (file map) | T1-T10 each map to listed files |
| §5 data model (Project ALTER + ApiKey + migration) | T1 |
| §6 key generation + verification | T2 |
| §7.1 authed routes (5) | T3 |
| §7.2 public route | T4 |
| §7.3 attribution to api_key.created_by | T4 + T5 |
| §8 frontend (store + PublishPage + StepIndicator + nav) | T6 + T7 + T8 + T9 + T10 |
| §9 error handling (409/400/401/403/404/413) | T3 (validates 409); T4 (401/403/404) |
| §10 testing | tests in every task |
| §11 smoke | T11 |

No gaps.

**2. Placeholder scan:** No "TBD" / "implement later" / "add validation as needed". Each step has runnable code or runnable commands.

**3. Type consistency:**

- `ApiKey` Python schema in T3 matches frontend type in T6 (id, project_id, name, key_prefix, is_active, last_used_at, created_by, created_at).
- `ApiKeyCreateResponse` adds `key` (full plaintext) — consistent across T3 (backend), T6 (frontend), T7-T8 (modal display).
- `ProjectApiState` in T6 matches the subset of `ProjectRead` extension fields (id, api_code, api_published_at, api_disabled_at) returned by `publishApi`/`unpublishApi`.
- Migration revision id `a3c7d9e2b4f5` consistent in plan header, T1 migration file.
- `currentStep` type widened from `0|1|2|3|4` to `0|1|2|3|4|5` in T9 — matches T9 store change.

**Total: 11 tasks, ≈20h.** Final acceptance via spec §11 smoke in T11.
