# S0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebase the API_anything repo onto async FastAPI + SQLite-WAL, add User/Workspace/WorkspaceMember models with Email+JWT auth, add ml_client health probe, and a minimal Vite/React frontend with login + workspace switcher. Foundation only — no Project/Document/workspace UI.

**Architecture:** FastAPI (async) + SQLAlchemy 2.x (async, aiosqlite driver) + SQLite WAL. Vite + React 19 + Zustand + axios. JWT (HS256) with bcrypt-hashed passwords stored in localStorage on the client. ML backend reached via httpx AsyncClient at `http://0.0.0.0:9090`.

**Tech Stack:** Python 3.12, FastAPI 0.115+, SQLAlchemy 2.0.30+, aiosqlite 0.20+, alembic 1.13+, passlib[bcrypt], python-jose, httpx 0.27+. Frontend: Vite 8, React 19, react-router-dom 6, zustand 5, axios 1.7, tailwindcss 3.4.

**Spec:** `docs/superpowers/specs/2026-04-27-S0-foundation-design.md`
**LS-features cross-spec notes (S0 does not consume; reference for S1+):** `docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md`

**Repo root after Task 2:** `/Users/qinqiang02/colab/codespace/ai/doc-intel/` (was `API_anything/`). All paths in this plan use `<repo>` as a placeholder for that absolute path. Subagents executing tasks should set `cd <repo>` before running commands.

---

## Phase A — Repo prep

### Task 1: Pre-rebase checkpoint and tag

**Files:** none modified; tag created.

- [ ] **Step 1: Verify clean working tree at API_anything**

Run:
```bash
cd /Users/qinqiang02/colab/codespace/ai/API_anything
git status --short
```
Expected: empty output (nothing to commit). If output is non-empty, run:
```bash
git add -A && git commit -m "checkpoint: state before S0 rebase"
```

- [ ] **Step 2: Verify tag does not already exist**

Run:
```bash
git tag --list pre-rebase
```
Expected: empty output. If `pre-rebase` already exists, abort and notify the orchestrator — overwriting an existing tag silently is destructive.

- [ ] **Step 3: Create `pre-rebase` tag**

Run:
```bash
git tag -a pre-rebase -m "Snapshot before S0 foundation rebase (doc-intel)"
git tag --list pre-rebase
```
Expected: `pre-rebase`

- [ ] **Step 4: Verify HEAD is reachable from tag**

Run:
```bash
git rev-parse HEAD
git rev-parse pre-rebase
```
Expected: both commands print the same SHA.

- [ ] **Step 5: Done — no commit needed**

The tag is the artifact. No commit because no files changed. Proceed to Task 2.

---

### Task 2: Rename directory and delete legacy code

**Files:**
- Rename: `/Users/qinqiang02/colab/codespace/ai/API_anything` → `/Users/qinqiang02/colab/codespace/ai/doc-intel`
- Modify: `<repo>/backend/pyproject.toml` (project name)
- Delete: backend abstractions/, services (most), api/v1 (most), models (most); frontend pages, components (most), stores (most)

- [ ] **Step 1: Rename the directory**

Run:
```bash
cd /Users/qinqiang02/colab/codespace/ai
mv API_anything doc-intel
cd doc-intel
git status --short
```
Expected: empty (git tracks files by content, not path; the rename of the parent dir is invisible to git).

- [ ] **Step 2: Update pyproject project name**

Modify `<repo>/backend/pyproject.toml` line by line: change

```toml
name = "apianything-backend"
description = "ApiAnything — 通用文档结构化数据提取 API 平台"
```

to

```toml
name = "doc-intel-backend"
description = "doc-intel — 文档智能提取自助平台"
```

- [ ] **Step 3: Delete legacy backend code**

Run:
```bash
cd <repo>
rm -rf backend/app/abstractions
rm -f backend/app/services/{document_service,annotation_service,api_definition_service,api_key_service,extract_service,prompt_optimizer,schema_generator,template_service}.py
rm -f backend/app/api/v1/{documents,annotations,api_defs,api_keys,extract,conversations,prompts,templates,usage}.py
rm -f backend/app/models/{document,annotation,api_definition,api_key,conversation,prompt_version,usage_record}.py
```

- [ ] **Step 4: Delete legacy frontend code**

Run:
```bash
cd <repo>
rm -rf frontend/src/components/workspace
rm -rf frontend/src/components/workspace-v2
rm -rf frontend/src/components/document
rm -rf frontend/src/components/fields
rm -rf frontend/src/components/api
rm -rf frontend/src/components/templates
rm -f frontend/src/components/MainLayout.tsx
rm -f frontend/src/components/SettingsLayout.tsx
rm -f frontend/src/pages/{ApiList,Workspace}.tsx
rm -rf frontend/src/pages/settings
rm -f frontend/src/stores/{workspace-store,document-store,api-store}.ts
```

- [ ] **Step 5: Delete legacy alembic migrations (start fresh)**

Run:
```bash
cd <repo>
rm -f backend/alembic/versions/*.py
ls backend/alembic/versions/  # verify empty
```
Expected: no output beyond `__pycache__` (if present, also `rm -rf backend/alembic/versions/__pycache__`).

- [ ] **Step 6: Verify backend imports break (expected)**

Run:
```bash
cd <repo>/backend
python -c "import app.main" 2>&1 | head -3
```
Expected: ImportError pointing at one of the deleted modules. This confirms deletion was effective. Don't try to fix — Tasks 3-15 will rebuild.

- [ ] **Step 7: Commit**

Run:
```bash
cd <repo>
git add -A
git commit -m "S0/Task 2: rename to doc-intel and delete legacy code

- Rename API_anything/ → doc-intel/ (parent dir, git-invisible)
- Update pyproject name to doc-intel-backend
- Delete legacy abstractions, document/annotation/api/extract services
  and their routers, models, frontend pages/components/stores
- Empty alembic/versions/ for greenfield migration in Task 7
- Backend will not import until Tasks 3-15 rebuild it (expected)"
```

---

## Phase B — Backend skeleton

### Task 3: Update pyproject deps and sync

**Files:**
- Modify: `<repo>/backend/pyproject.toml`

- [ ] **Step 1: Replace the `[project] dependencies` block**

Open `<repo>/backend/pyproject.toml`. Replace the entire `dependencies = [...]` block with:

```toml
dependencies = [
    # Web framework
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "python-multipart>=0.0.12",

    # Async DB
    "sqlalchemy[asyncio]>=2.0.30",
    "aiosqlite>=0.20.0",
    "alembic>=1.13.0",

    # Config & validation
    "pydantic[email]>=2.7.0",
    "pydantic-settings>=2.3.0",

    # Auth
    "passlib[bcrypt]>=1.7.4",
    "python-jose[cryptography]>=3.3.0",

    # ML backend HTTP
    "httpx>=0.27.0",
]
```

Also remove the `[project.optional-dependencies] postgres` section entirely. Keep `[project.optional-dependencies] dev`. Inside `dev`, ensure these are present:

```toml
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.23.0",
    "httpx>=0.27.0",
    "ruff>=0.6.0",
]
```

- [ ] **Step 2: Sync deps**

Run:
```bash
cd <repo>/backend
uv sync --extra dev
```
Expected: `Resolved N packages` and `Installed N packages` — no errors. May take 30-90s on first run.

- [ ] **Step 3: Verify async stack imports**

Run:
```bash
cd <repo>/backend
uv run python -c "import sqlalchemy.ext.asyncio; import aiosqlite; import jose; import passlib.context; import httpx; print('ok')"
```
Expected: `ok`

- [ ] **Step 4: Commit**

Run:
```bash
cd <repo>
git add backend/pyproject.toml backend/uv.lock
git commit -m "S0/Task 3: switch backend deps to async stack

- sqlalchemy[asyncio] + aiosqlite for async DB
- passlib[bcrypt] + python-jose for auth
- httpx for ML backend client
- pydantic[email] for EmailStr
- Remove psycopg2 extra (SQLite only for now)"
```

---

### Task 4: Settings + .env scaffolding

**Files:**
- Create: `<repo>/backend/app/core/config.py`
- Create: `<repo>/backend/.env.example`
- Modify: `<repo>/backend/.gitignore` (ensure `.env` and `data/` are ignored)
- Test: `<repo>/backend/tests/test_settings.py`

- [ ] **Step 1: Write the failing test**

Create `<repo>/backend/tests/test_settings.py`:

```python
"""Tests for app.core.config Settings."""
from __future__ import annotations

import pytest


def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///./data/test.db")
    monkeypatch.setenv("ML_BACKEND_URL", "http://localhost:9090")

    from app.core.config import Settings
    s = Settings()
    assert s.JWT_SECRET_KEY == "x" * 32
    assert s.DATABASE_URL == "sqlite+aiosqlite:///./data/test.db"
    assert s.ML_BACKEND_URL == "http://localhost:9090"
    assert s.JWT_ACCESS_TOKEN_EXPIRE_DAYS == 7  # default


def test_settings_rejects_short_jwt_secret(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "tooshort")
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///./data/test.db")

    from pydantic import ValidationError
    from app.core.config import Settings
    with pytest.raises(ValidationError):
        Settings()


def test_settings_rejects_unsupported_db_url(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    monkeypatch.setenv("DATABASE_URL", "mysql://localhost/db")

    from pydantic import ValidationError
    from app.core.config import Settings
    with pytest.raises(ValidationError):
        Settings()
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd <repo>/backend
uv run pytest tests/test_settings.py -v
```
Expected: All three tests FAIL with `ModuleNotFoundError: No module named 'app.core.config'`.

- [ ] **Step 3: Write Settings**

Create `<repo>/backend/app/core/__init__.py` (empty file).

Create `<repo>/backend/app/core/config.py`:

```python
"""Application settings loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    APP_NAME: str = "doc-intel"
    APP_VERSION: str = "0.1.0"
    APP_ENV: Literal["development", "production", "test"] = "development"
    LOG_LEVEL: str = "INFO"

    DATABASE_URL: str = Field(default="sqlite+aiosqlite:///./data/doc_intel.db")
    SQL_ECHO: bool = False

    JWT_SECRET_KEY: str = Field(min_length=32)
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_DAYS: int = 7

    ML_BACKEND_URL: str = "http://0.0.0.0:9090"

    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    UPLOAD_DIR: str = "./data/uploads"

    @field_validator("DATABASE_URL")
    @classmethod
    def _check_db_url(cls, v: str) -> str:
        if not (v.startswith("sqlite+aiosqlite://") or v.startswith("postgresql+asyncpg://")):
            raise ValueError(
                "DATABASE_URL must use sqlite+aiosqlite:// or postgresql+asyncpg:// driver"
            )
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd <repo>/backend
uv run pytest tests/test_settings.py -v
```
Expected: 3 passed.

- [ ] **Step 5: Create .env.example and ensure .env is gitignored**

Create `<repo>/backend/.env.example`:

```bash
# Database
DATABASE_URL=sqlite+aiosqlite:///./data/doc_intel.db
SQL_ECHO=false

# Auth — generate with: openssl rand -hex 32
JWT_SECRET_KEY=replace-with-32-byte-hex-string-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
JWT_ACCESS_TOKEN_EXPIRE_DAYS=7

# ML Backend
ML_BACKEND_URL=http://0.0.0.0:9090

# CORS
CORS_ORIGINS=["http://localhost:5173"]

# Misc
LOG_LEVEL=INFO
APP_ENV=development
```

Verify `<repo>/backend/.gitignore` contains:
```
.env
data/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
```
If any line is missing, append it.

- [ ] **Step 6: Create local .env for development**

Run:
```bash
cd <repo>/backend
SECRET=$(openssl rand -hex 32)
cp .env.example .env
# Replace the placeholder with a real secret
sed -i.bak "s|replace-with-32-byte-hex-string-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|$SECRET|" .env
rm .env.bak
mkdir -p data
```
Expected: `<repo>/backend/.env` exists with a real JWT secret; `data/` dir exists.

- [ ] **Step 7: Commit**

Run:
```bash
cd <repo>
git add backend/app/core/__init__.py backend/app/core/config.py backend/.env.example backend/.gitignore backend/tests/test_settings.py
git commit -m "S0/Task 4: add Settings with env validation

- pydantic-settings BaseSettings reading .env
- JWT_SECRET_KEY required (≥32 chars)
- DATABASE_URL constrained to sqlite+aiosqlite or postgresql+asyncpg
- Test coverage for valid load + 2 validation failures"
```

---

### Task 5: Async DB engine with SQLite pragmas

**Files:**
- Create: `<repo>/backend/app/core/database.py`
- Test: `<repo>/backend/tests/test_database.py`

- [ ] **Step 1: Write the failing test**

Create `<repo>/backend/tests/test_database.py`:

```python
"""Tests for app.core.database — engine, pragmas, session."""
from __future__ import annotations

import os
import pytest


@pytest.mark.asyncio
async def test_sqlite_pragmas_applied(tmp_path, monkeypatch):
    db_file = tmp_path / "pragma_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)

    # Force re-read of cached settings
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    from app.core.database import engine
    from sqlalchemy import text

    async with engine.connect() as conn:
        journal = (await conn.execute(text("PRAGMA journal_mode"))).scalar()
        sync = (await conn.execute(text("PRAGMA synchronous"))).scalar()
        fk = (await conn.execute(text("PRAGMA foreign_keys"))).scalar()

    assert journal.lower() == "wal"
    assert int(sync) == 1  # NORMAL
    assert int(fk) == 1


@pytest.mark.asyncio
async def test_get_db_yields_async_session(tmp_path, monkeypatch):
    db_file = tmp_path / "session_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)

    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    from app.core.database import get_db
    from sqlalchemy.ext.asyncio import AsyncSession

    gen = get_db()
    session = await gen.__anext__()
    try:
        assert isinstance(session, AsyncSession)
    finally:
        await gen.aclose()
```

Add `<repo>/backend/tests/__init__.py` (empty) if it does not exist.
Add `<repo>/backend/tests/conftest.py` if it does not exist with this minimal content:

```python
"""Shared pytest config — async mode and module discovery."""
from __future__ import annotations

import sys
from pathlib import Path

# Add backend root so `import app.*` works in tests
_BACKEND_ROOT = Path(__file__).parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd <repo>/backend
uv run pytest tests/test_database.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.database'`.

- [ ] **Step 3: Write database.py**

Create `<repo>/backend/app/core/database.py`:

```python
"""Async SQLAlchemy engine + session factory + SQLite safety pragmas."""
from __future__ import annotations

import logging
from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.SQL_ECHO,
    pool_pre_ping=True,
    future=True,
)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragma(dbapi_conn, _connection_record) -> None:  # type: ignore[no-untyped-def]
    """Apply SQLite safety pragmas on every new connection.

    WAL gives concurrent readers + single writer with crash-safe checkpoints.
    NORMAL synchronous + WAL is the community-recommended durable+fast combo.
    foreign_keys must be explicitly enabled in SQLite (off by default).
    busy_timeout makes occasional concurrent writes queue rather than fail.
    """
    if not settings.DATABASE_URL.startswith("sqlite"):
        return
    cursor = dbapi_conn.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
    finally:
        cursor.close()


AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields an AsyncSession and rolls back on error."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd <repo>/backend
uv run pytest tests/test_database.py -v
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

Run:
```bash
cd <repo>
git add backend/app/core/database.py backend/tests/test_database.py backend/tests/conftest.py backend/tests/__init__.py
git commit -m "S0/Task 5: async SQLAlchemy engine with SQLite WAL pragmas

- create_async_engine + async_sessionmaker
- PRAGMA journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000
- get_db() FastAPI dependency with rollback-on-error
- Tests verify pragmas applied + AsyncSession yielded"
```

---

### Task 6: Models — base, User, Workspace, WorkspaceMember

**Files:**
- Create: `<repo>/backend/app/models/__init__.py`
- Create: `<repo>/backend/app/models/base.py`
- Create: `<repo>/backend/app/models/user.py`
- Create: `<repo>/backend/app/models/workspace.py`
- Create: `<repo>/backend/app/models/workspace_member.py`
- Test: `<repo>/backend/tests/test_models.py`

- [ ] **Step 1: Write the failing test**

Create `<repo>/backend/tests/test_models.py`:

```python
"""Tests for SQLAlchemy models — relationships, FK constraints, defaults."""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture
async def session(tmp_path, monkeypatch):
    db_file = tmp_path / "models_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    from app.models.base import Base
    from app.models import user as _u, workspace as _w, workspace_member as _wm  # noqa

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}", future=True)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        # Re-enable FK on this connection (each new conn needs it)
        await s.execute(__import__("sqlalchemy").text("PRAGMA foreign_keys=ON"))
        yield s
    await engine.dispose()


@pytest.mark.asyncio
async def test_create_user_and_workspace(session):
    from app.models.user import User
    from app.models.workspace import Workspace
    from app.models.workspace_member import WorkspaceMember, WorkspaceRole

    user = User(email="alice@example.com", password_hash="hashed", display_name="Alice")
    session.add(user)
    await session.flush()

    ws = Workspace(name="Demo", slug="demo", owner_id=user.id)
    session.add(ws)
    await session.flush()

    member = WorkspaceMember(workspace_id=ws.id, user_id=user.id, role=WorkspaceRole.OWNER)
    session.add(member)
    await session.commit()

    assert user.id and ws.id and member.id
    assert ws.owner_id == user.id


@pytest.mark.asyncio
async def test_unique_email(session):
    from app.models.user import User

    session.add(User(email="dup@x.com", password_hash="h", display_name="A"))
    await session.commit()
    session.add(User(email="dup@x.com", password_hash="h", display_name="B"))
    with pytest.raises(IntegrityError):
        await session.commit()


@pytest.mark.asyncio
async def test_unique_workspace_member_pair(session):
    from app.models.user import User
    from app.models.workspace import Workspace
    from app.models.workspace_member import WorkspaceMember, WorkspaceRole

    u = User(email="u@x.com", password_hash="h", display_name="U")
    session.add(u)
    await session.flush()
    w = Workspace(name="W", slug="w", owner_id=u.id)
    session.add(w)
    await session.flush()
    session.add(WorkspaceMember(workspace_id=w.id, user_id=u.id, role=WorkspaceRole.OWNER))
    await session.commit()
    session.add(WorkspaceMember(workspace_id=w.id, user_id=u.id, role=WorkspaceRole.MEMBER))
    with pytest.raises(IntegrityError):
        await session.commit()


@pytest.mark.asyncio
async def test_fk_restrict_on_owner_delete(session):
    """Deleting a user who owns a workspace must fail (RESTRICT)."""
    from app.models.user import User
    from app.models.workspace import Workspace

    u = User(email="o@x.com", password_hash="h", display_name="O")
    session.add(u)
    await session.flush()
    session.add(Workspace(name="OwnedWS", slug="owned", owner_id=u.id))
    await session.commit()

    await session.delete(u)
    with pytest.raises(IntegrityError):
        await session.commit()
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd <repo>/backend
uv run pytest tests/test_models.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models.base'`.

- [ ] **Step 3: Write base.py**

Create `<repo>/backend/app/models/base.py`:

```python
"""Declarative base + shared mixins."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


def gen_uuid() -> str:
    return str(uuid.uuid4())
```

- [ ] **Step 4: Write user.py**

Create `<repo>/backend/app/models/user.py`:

```python
"""User model."""
from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.workspace_member import WorkspaceMember


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    memberships: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
```

- [ ] **Step 5: Write workspace.py**

Create `<repo>/backend/app/models/workspace.py`:

```python
"""Workspace model — top-level tenant boundary."""
from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.workspace_member import WorkspaceMember


class Workspace(Base, TimestampMixin):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(60), unique=True, index=True, nullable=False)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)

    members: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )
```

- [ ] **Step 6: Write workspace_member.py**

Create `<repo>/backend/app/models/workspace_member.py`:

```python
"""WorkspaceMember model — N:M between User and Workspace with role."""
from __future__ import annotations

import enum
from typing import TYPE_CHECKING

from sqlalchemy import Enum as SAEnum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.workspace import Workspace


class WorkspaceRole(str, enum.Enum):
    OWNER = "owner"
    MEMBER = "member"


class WorkspaceMember(Base, TimestampMixin):
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_workspace_member"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[WorkspaceRole] = mapped_column(
        SAEnum(WorkspaceRole, name="workspace_role"), nullable=False
    )

    workspace: Mapped["Workspace"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="memberships")
```

- [ ] **Step 7: Write models/__init__.py**

Create `<repo>/backend/app/models/__init__.py`:

```python
"""Models package — import all models so Base.metadata sees them."""
from app.models.base import Base, TimestampMixin, gen_uuid
from app.models.user import User
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember, WorkspaceRole

__all__ = [
    "Base",
    "TimestampMixin",
    "gen_uuid",
    "User",
    "Workspace",
    "WorkspaceMember",
    "WorkspaceRole",
]
```

- [ ] **Step 8: Run tests to verify they pass**

Run:
```bash
cd <repo>/backend
uv run pytest tests/test_models.py -v
```
Expected: 4 passed.

- [ ] **Step 9: Commit**

Run:
```bash
cd <repo>
git add backend/app/models/ backend/tests/test_models.py
git commit -m "S0/Task 6: User, Workspace, WorkspaceMember models

- Base + TimestampMixin + gen_uuid helper
- User: unique email, password_hash, display_name, is_active
- Workspace: unique slug, owner_id RESTRICT (can't delete owner)
- WorkspaceMember: UniqueConstraint(workspace_id, user_id) + Enum role
- Cascades verified by test (delete-restrict on owner, unique on member pair)"
```

---

### Task 7: Alembic init + first migration

**Files:**
- Modify: `<repo>/backend/alembic/env.py` (rewrite for async)
- Create: `<repo>/backend/alembic/versions/<auto-generated>.py` (via autogenerate)
- Verify: `<repo>/backend/alembic.ini`

- [ ] **Step 1: Update alembic.ini sqlalchemy.url placeholder**

Open `<repo>/backend/alembic.ini`. Find the line beginning with `sqlalchemy.url`. Replace with:

```
sqlalchemy.url = sqlite+aiosqlite:///./data/doc_intel.db
```

(Real URL is read from settings; this is a fallback for `alembic` invocations without env loaded.)

- [ ] **Step 2: Rewrite alembic/env.py for async**

Replace the entire content of `<repo>/backend/alembic/env.py` with:

```python
"""Async Alembic env for SQLAlchemy 2.x.

Adapted from the official async cookbook:
https://alembic.sqlalchemy.org/en/latest/cookbook.html#using-asyncio-with-alembic
"""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# Make `app` package importable when running alembic from backend/
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND_ROOT = os.path.dirname(_HERE)
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

from app.core.config import get_settings  # noqa: E402
from app.models import Base  # noqa: E402  -- triggers all model imports

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Inject DATABASE_URL from settings (overrides alembic.ini)
config.set_main_option("sqlalchemy.url", get_settings().DATABASE_URL)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # SQLite-friendly ALTER TABLE
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

- [ ] **Step 3: Generate the initial migration**

Run:
```bash
cd <repo>/backend
mkdir -p data
uv run alembic revision --autogenerate -m "S0: users, workspaces, workspace_members"
```
Expected: a new file at `alembic/versions/<hash>_s0_users_workspaces_workspace_members.py`. Inspect it: `op.create_table("users", ...)`, `op.create_table("workspaces", ...)`, `op.create_table("workspace_members", ...)` should all be present.

- [ ] **Step 4: Apply the migration**

Run:
```bash
cd <repo>/backend
uv run alembic upgrade head
```
Expected: `INFO [alembic.runtime.migration] Running upgrade  -> <hash>, S0: users, workspaces, workspace_members`. The file `<repo>/backend/data/doc_intel.db` is created.

- [ ] **Step 5: Verify schema**

Run:
```bash
cd <repo>/backend
sqlite3 data/doc_intel.db ".schema"
```
Expected output includes `CREATE TABLE users`, `CREATE TABLE workspaces`, `CREATE TABLE workspace_members`, and `CREATE TABLE alembic_version`.

- [ ] **Step 6: Verify downgrade then re-upgrade**

Run:
```bash
cd <repo>/backend
uv run alembic downgrade base
uv run alembic upgrade head
```
Expected: both succeed. Schema verified again with `.schema` if desired.

- [ ] **Step 7: Commit**

Run:
```bash
cd <repo>
git add backend/alembic/env.py backend/alembic/versions/*.py backend/alembic.ini
git commit -m "S0/Task 7: alembic async env + initial migration

- Rewrite env.py for async engine + render_as_batch (SQLite ALTER)
- Generate first migration: users, workspaces, workspace_members
- Verified upgrade/downgrade roundtrip on local sqlite db"
```

---

## Phase C — Auth

### Task 8: security.py — password hashing + JWT

**Files:**
- Create: `<repo>/backend/app/core/security.py`
- Test: `<repo>/backend/tests/test_security.py`

- [ ] **Step 1: Write the failing test**

Create `<repo>/backend/tests/test_security.py`:

```python
"""Tests for app.core.security — bcrypt + JWT."""
from __future__ import annotations

import time

import pytest


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///./data/doc_intel.db")
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()


def test_password_hash_verify_roundtrip():
    from app.core.security import hash_password, verify_password

    h = hash_password("s3cret!")
    assert h != "s3cret!"
    assert verify_password("s3cret!", h) is True
    assert verify_password("wrong", h) is False


def test_jwt_encode_decode_roundtrip():
    from app.core.security import create_access_token, decode_access_token

    token = create_access_token(user_id="u-1", email="a@x.com")
    payload = decode_access_token(token)
    assert payload is not None
    assert payload["sub"] == "u-1"
    assert payload["email"] == "a@x.com"


def test_jwt_invalid_token_returns_none():
    from app.core.security import decode_access_token

    assert decode_access_token("not.a.real.jwt") is None
    assert decode_access_token("") is None


def test_jwt_expired_token_returns_none(monkeypatch):
    monkeypatch.setenv("JWT_ACCESS_TOKEN_EXPIRE_DAYS", "0")  # already expired
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    from app.core.security import create_access_token, decode_access_token

    token = create_access_token(user_id="u-1", email="a@x.com")
    time.sleep(1)
    assert decode_access_token(token) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd <repo>/backend
uv run pytest tests/test_security.py -v
```
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write security.py**

Create `<repo>/backend/app/core/security.py`:

```python
"""Password hashing (bcrypt) + JWT encode/decode (HS256)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd.verify(plain, hashed)


def create_access_token(*, user_id: str, email: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": user_id,
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int(
            (now + timedelta(days=settings.JWT_ACCESS_TOKEN_EXPIRE_DAYS)).timestamp()
        ),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Return payload dict on success; None on any decode/expiry error."""
    if not token:
        return None
    settings = get_settings()
    try:
        return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd <repo>/backend
uv run pytest tests/test_security.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

Run:
```bash
cd <repo>
git add backend/app/core/security.py backend/tests/test_security.py
git commit -m "S0/Task 8: bcrypt password hashing + HS256 JWT

- hash_password / verify_password via passlib bcrypt
- create_access_token / decode_access_token with iat/exp
- decode_access_token returns None on any error (callers don't catch)
- Tests cover roundtrip, invalid, expired"
```

---

### Task 9: Auth deps + exceptions + main.py wiring

**Files:**
- Create: `<repo>/backend/app/core/exceptions.py`
- Create: `<repo>/backend/app/core/deps.py`
- Modify: `<repo>/backend/app/main.py`

- [ ] **Step 1: Write exceptions.py**

Create `<repo>/backend/app/core/exceptions.py`:

```python
"""Unified error response format and exception handlers."""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.requests import Request


class AppError(HTTPException):
    """Domain error with stable error code for client handling."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(status_code=status_code, detail={"code": code, "message": message})
        self.code = code
        self.message = message


def _error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


async def _app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return _error_response(exc.status_code, exc.code, exc.message)


async def _http_error_handler(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail:
        return _error_response(exc.status_code, detail["code"], detail.get("message", ""))
    return _error_response(exc.status_code, "http_error", str(detail))


async def _validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return _error_response(422, "validation_error", str(exc.errors()))


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(HTTPException, _http_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
```

- [ ] **Step 2: Write deps.py**

Create `<repo>/backend/app/core/deps.py`:

```python
"""FastAPI dependencies: auth + DB + ML client + workspace membership."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import AppError
from app.core.security import decode_access_token
from app.ml_client import MLClient
from app.models.user import User
from app.models.workspace_member import WorkspaceMember, WorkspaceRole

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise AppError(401, "unauthorized", "Missing or malformed Authorization header.")
    token = authorization.removeprefix("Bearer ").strip()
    payload = decode_access_token(token)
    if payload is None:
        raise AppError(401, "unauthorized", "Invalid or expired token.")
    user_id = payload.get("sub")
    if not user_id:
        raise AppError(401, "unauthorized", "Token payload missing subject.")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise AppError(401, "unauthorized", "User not found or inactive.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_workspace_membership(
    workspace_id: str,
    db: DbSession,
    user: CurrentUser,
) -> WorkspaceMember:
    """Return the user's membership in the workspace; 403 if not a member."""
    stmt = select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user.id,
    )
    member = (await db.execute(stmt)).scalar_one_or_none()
    if member is None:
        raise AppError(403, "forbidden", "You are not a member of this workspace.")
    return member


async def require_workspace_owner(
    membership: Annotated[WorkspaceMember, Depends(get_workspace_membership)],
) -> WorkspaceMember:
    if membership.role != WorkspaceRole.OWNER:
        raise AppError(403, "forbidden", "Workspace owner role required.")
    return membership


_ml_singleton: MLClient | None = None


def get_ml_client() -> MLClient:
    global _ml_singleton
    if _ml_singleton is None:
        _ml_singleton = MLClient()
    return _ml_singleton
```

- [ ] **Step 3: Rewrite main.py**

Replace the entire `<repo>/backend/app/main.py` with:

```python
"""doc-intel FastAPI entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="doc-intel — 文档智能提取自助平台",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

# Routes — wired in Tasks 10-13
from app.api.v1.router import v1_router  # noqa: E402

app.include_router(v1_router)

# Serve uploaded files
_upload_dir = Path(settings.UPLOAD_DIR)
_upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static/uploads", StaticFiles(directory=str(_upload_dir)), name="uploads")


@app.get("/health", tags=["Health"])
def health_check() -> dict:
    return {"status": "ok", "version": settings.APP_VERSION}
```

- [ ] **Step 4: Stub the v1 router**

Create `<repo>/backend/app/api/__init__.py` (empty).
Create `<repo>/backend/app/api/v1/__init__.py` (empty).
Create `<repo>/backend/app/api/v1/router.py`:

```python
"""Aggregate v1 router. Sub-routers added by Tasks 10-13."""
from __future__ import annotations

from fastapi import APIRouter

v1_router = APIRouter(prefix="/api/v1")
```

- [ ] **Step 5: Verify backend boots**

Run:
```bash
cd <repo>/backend
uv run python -c "from app.main import app; print(app.title)"
```
Expected: `doc-intel`

- [ ] **Step 6: Smoke run uvicorn**

Run:
```bash
cd <repo>/backend
uv run uvicorn app.main:app --port 8765 &
sleep 2
curl -s http://localhost:8765/health
kill %1
```
Expected: `{"status":"ok","version":"0.1.0"}`. Background uvicorn is killed.

- [ ] **Step 7: Commit**

Run:
```bash
cd <repo>
git add backend/app/core/exceptions.py backend/app/core/deps.py backend/app/main.py backend/app/api/__init__.py backend/app/api/v1/__init__.py backend/app/api/v1/router.py
git commit -m "S0/Task 9: exceptions, deps, main.py wiring

- AppError + handlers (uniform {error: {code, message}})
- get_current_user, get_workspace_membership, require_workspace_owner
- get_ml_client singleton (placeholder until Task 13)
- main.py: lifespan + CORS + v1_router mount + /health"
```

---

### Task 10: Auth schemas + service + router

**Files:**
- Create: `<repo>/backend/app/schemas/__init__.py`
- Create: `<repo>/backend/app/schemas/auth.py`
- Create: `<repo>/backend/app/services/__init__.py`
- Create: `<repo>/backend/app/services/auth_service.py`
- Create: `<repo>/backend/app/api/v1/auth.py`
- Modify: `<repo>/backend/app/api/v1/router.py` (mount auth)
- Test: `<repo>/backend/tests/test_auth.py`

- [ ] **Step 1: Write schemas/auth.py**

Create `<repo>/backend/app/schemas/__init__.py` (empty).

Create `<repo>/backend/app/schemas/auth.py`:

```python
"""Auth request/response schemas."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    display_name: str
    is_active: bool


class TokenResponse(BaseModel):
    token: str
    user: UserRead


class WorkspaceWithRole(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    role: str  # "owner" | "member"


class MeResponse(BaseModel):
    user: UserRead
    workspaces: list[WorkspaceWithRole]
```

- [ ] **Step 2: Write services/auth_service.py**

Create `<repo>/backend/app/services/__init__.py` (empty).

Create `<repo>/backend/app/services/auth_service.py`:

```python
"""Auth service: register / authenticate / list_user_workspaces."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember


async def register_user(
    db: AsyncSession, *, email: str, password: str, display_name: str
) -> tuple[User, str]:
    existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing:
        raise AppError(409, "email_already_registered", "Email already registered.")
    user = User(email=email, password_hash=hash_password(password), display_name=display_name)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token(user_id=user.id, email=user.email)
    return user, token


async def authenticate_user(
    db: AsyncSession, *, email: str, password: str
) -> tuple[User, str]:
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        raise AppError(401, "invalid_credentials", "Email or password incorrect.")
    if not user.is_active:
        raise AppError(401, "invalid_credentials", "Account inactive.")
    token = create_access_token(user_id=user.id, email=user.email)
    return user, token


async def list_user_workspaces(db: AsyncSession, user_id: str) -> list[dict]:
    """Return [{id, name, slug, role}] for all workspaces the user belongs to."""
    stmt = (
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user_id)
        .order_by(Workspace.created_at)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {"id": ws.id, "name": ws.name, "slug": ws.slug, "role": role.value}
        for ws, role in rows
    ]
```

- [ ] **Step 3: Write api/v1/auth.py**

Create `<repo>/backend/app/api/v1/auth.py`:

```python
"""Auth router: /register, /login, /me."""
from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import CurrentUser, DbSession
from app.schemas.auth import (
    LoginRequest,
    MeResponse,
    RegisterRequest,
    TokenResponse,
    UserRead,
    WorkspaceWithRole,
)
from app.services.auth_service import (
    authenticate_user,
    list_user_workspaces,
    register_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(req: RegisterRequest, db: DbSession) -> TokenResponse:
    user, token = await register_user(
        db, email=req.email, password=req.password, display_name=req.display_name
    )
    return TokenResponse(token=token, user=UserRead.model_validate(user))


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: DbSession) -> TokenResponse:
    user, token = await authenticate_user(db, email=req.email, password=req.password)
    return TokenResponse(token=token, user=UserRead.model_validate(user))


@router.get("/me", response_model=MeResponse)
async def me(user: CurrentUser, db: DbSession) -> MeResponse:
    rows = await list_user_workspaces(db, user.id)
    return MeResponse(
        user=UserRead.model_validate(user),
        workspaces=[WorkspaceWithRole(**r) for r in rows],
    )
```

- [ ] **Step 4: Mount auth router**

Modify `<repo>/backend/app/api/v1/router.py`:

```python
"""Aggregate v1 router."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import auth as auth_module

v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(auth_module.router)
```

- [ ] **Step 5: Write tests**

Create `<repo>/backend/tests/test_auth.py`:

```python
"""Auth endpoint tests."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_register_creates_user_returns_token(client):
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "alice@x.com", "password": "secret123", "display_name": "Alice"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["token"]
    assert data["user"]["email"] == "alice@x.com"
    assert data["user"]["display_name"] == "Alice"


@pytest.mark.asyncio
async def test_register_duplicate_email_409(client):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "dup@x.com", "password": "secret123", "display_name": "A"},
    )
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "dup@x.com", "password": "secret123", "display_name": "B"},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "email_already_registered"


@pytest.mark.asyncio
async def test_login_correct_credentials(client):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "bob@x.com", "password": "secret123", "display_name": "Bob"},
    )
    resp = await client.post(
        "/api/v1/auth/login", json={"email": "bob@x.com", "password": "secret123"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["token"]


@pytest.mark.asyncio
async def test_login_wrong_password_401(client):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "carol@x.com", "password": "secret123", "display_name": "C"},
    )
    resp = await client.post(
        "/api/v1/auth/login", json={"email": "carol@x.com", "password": "WRONG"}
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "invalid_credentials"


@pytest.mark.asyncio
async def test_me_requires_token(client):
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_user_and_empty_workspaces(client, registered_user):
    user, token = registered_user
    resp = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["user"]["email"] == user["email"]
    assert data["workspaces"] == []
```

Append to `<repo>/backend/tests/conftest.py` (full new content):

```python
"""Shared pytest config — async mode, in-memory SQLite per test, HTTP client."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import event, text

# Add backend root so `import app.*` works in tests
_BACKEND_ROOT = Path(__file__).parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path}/test.db")
    monkeypatch.setenv("CORS_ORIGINS", '["http://localhost:5173"]')
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()


@pytest_asyncio.fixture
async def db_engine(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path}/test.db"
    engine = create_async_engine(url, future=True)

    @event.listens_for(engine.sync_engine, "connect")
    def _pragma(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    from app.models.base import Base
    from app.models import user, workspace, workspace_member  # noqa

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine):
    SessionLocal = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        await s.execute(text("PRAGMA foreign_keys=ON"))
        yield s


@pytest_asyncio.fixture
async def client(db_engine):
    """ASGI client with overridden get_db pointing at the test engine."""
    from app.main import app
    from app.core.database import get_db
    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

    SessionLocal = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db():
        async with SessionLocal() as s:
            await s.execute(text("PRAGMA foreign_keys=ON"))
            yield s

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def registered_user(client):
    """Register a fresh user; return ({email, password, display_name, id}, token)."""
    payload = {"email": "test-user@x.com", "password": "secret123", "display_name": "Test"}
    resp = await client.post("/api/v1/auth/register", json=payload)
    data = resp.json()
    user = {**payload, "id": data["user"]["id"]}
    return user, data["token"]
```

- [ ] **Step 6: Run auth tests**

Run:
```bash
cd <repo>/backend
uv run pytest tests/test_auth.py -v
```
Expected: 6 passed.

- [ ] **Step 7: Commit**

Run:
```bash
cd <repo>
git add backend/app/schemas/ backend/app/services/ backend/app/api/v1/auth.py backend/app/api/v1/router.py backend/tests/test_auth.py backend/tests/conftest.py
git commit -m "S0/Task 10: auth router, service, schemas + 6 passing tests

- POST /api/v1/auth/register (201) returns {token, user}
- POST /api/v1/auth/login (200) on valid; 401 invalid_credentials
- GET /api/v1/auth/me requires Bearer; returns user + workspace list
- conftest: in-memory SQLite per test, ASGI httpx client, registered_user fixture"
```

---

## Phase D — Workspace API

### Task 11: Workspace CRUD (schemas + service + router)

**Files:**
- Create: `<repo>/backend/app/schemas/workspace.py`
- Create: `<repo>/backend/app/services/workspace_service.py`
- Create: `<repo>/backend/app/api/v1/workspaces.py`
- Modify: `<repo>/backend/app/api/v1/router.py`
- Test: `<repo>/backend/tests/test_workspace.py`

- [ ] **Step 1: Write schemas/workspace.py**

Create `<repo>/backend/app/schemas/workspace.py`:

```python
"""Workspace request/response schemas."""
from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$")


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=3, max_length=60)
    description: str | None = Field(default=None, max_length=500)

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        v = v.strip().lower()
        if not _SLUG_RE.match(v):
            raise ValueError(
                "slug must be lowercase alphanumeric with optional hyphens, "
                "3-60 chars, no leading/trailing hyphen"
            )
        return v


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    description: str | None
    owner_id: str


class MemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    email: EmailStr
    display_name: str
    role: str


class WorkspaceDetail(WorkspaceRead):
    members: list[MemberRead]


class MemberInvite(BaseModel):
    email: EmailStr
    role: str = Field(default="member")

    @field_validator("role")
    @classmethod
    def _role_check(cls, v: str) -> str:
        if v not in ("owner", "member"):
            raise ValueError("role must be 'owner' or 'member'")
        return v
```

- [ ] **Step 2: Write services/workspace_service.py**

Create `<repo>/backend/app/services/workspace_service.py`:

```python
"""Workspace service: create, list, get, update, delete, members."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.user import User
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember, WorkspaceRole


async def create_workspace(
    db: AsyncSession,
    *,
    owner: User,
    name: str,
    slug: str,
    description: str | None,
) -> Workspace:
    ws = Workspace(name=name, slug=slug, owner_id=owner.id, description=description)
    db.add(ws)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise AppError(409, "workspace_slug_taken", f"Slug '{slug}' already exists.")
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role=WorkspaceRole.OWNER))
    await db.commit()
    await db.refresh(ws)
    return ws


async def get_workspace_or_404(db: AsyncSession, workspace_id: str) -> Workspace:
    ws = (
        await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    ).scalar_one_or_none()
    if ws is None:
        raise AppError(404, "workspace_not_found", "Workspace not found.")
    return ws


async def update_workspace(
    db: AsyncSession,
    workspace: Workspace,
    *,
    name: str | None,
    description: str | None,
) -> Workspace:
    if name is not None:
        workspace.name = name
    if description is not None:
        workspace.description = description
    await db.commit()
    await db.refresh(workspace)
    return workspace


async def delete_workspace(db: AsyncSession, workspace: Workspace) -> None:
    await db.delete(workspace)
    await db.commit()


async def list_members(db: AsyncSession, workspace_id: str) -> list[dict]:
    stmt = (
        select(User, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.created_at)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "user_id": u.id,
            "email": u.email,
            "display_name": u.display_name,
            "role": role.value,
        }
        for u, role in rows
    ]


async def invite_member(
    db: AsyncSession,
    *,
    workspace_id: str,
    email: str,
    role: str,
) -> dict:
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        raise AppError(404, "user_not_found", f"No registered user with email '{email}'.")
    existing = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise AppError(409, "member_already_exists", "User is already a member.")
    db.add(
        WorkspaceMember(
            workspace_id=workspace_id, user_id=user.id, role=WorkspaceRole(role)
        )
    )
    await db.commit()
    return {
        "user_id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "role": role,
    }


async def remove_member(db: AsyncSession, *, workspace_id: str, user_id: str) -> None:
    member = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise AppError(404, "user_not_found", "Member not found in this workspace.")
    if member.role == WorkspaceRole.OWNER:
        raise AppError(
            400,
            "cannot_remove_owner",
            "Cannot remove the workspace owner. Transfer ownership first.",
        )
    await db.delete(member)
    await db.commit()
```

- [ ] **Step 3: Write api/v1/workspaces.py**

Create `<repo>/backend/app/api/v1/workspaces.py`:

```python
"""Workspace router: CRUD + members."""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.core.deps import (
    CurrentUser,
    DbSession,
    get_workspace_membership,
    require_workspace_owner,
)
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember
from app.schemas.workspace import (
    MemberInvite,
    MemberRead,
    WorkspaceCreate,
    WorkspaceDetail,
    WorkspaceRead,
    WorkspaceUpdate,
)
from app.services import workspace_service as svc
from app.services.auth_service import list_user_workspaces

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("", response_model=list[dict])
async def list_my_workspaces(user: CurrentUser, db: DbSession) -> list[dict]:
    return await list_user_workspaces(db, user.id)


@router.post("", response_model=WorkspaceRead, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    body: WorkspaceCreate, user: CurrentUser, db: DbSession
) -> WorkspaceRead:
    ws = await svc.create_workspace(
        db, owner=user, name=body.name, slug=body.slug, description=body.description
    )
    return WorkspaceRead.model_validate(ws)


@router.get("/{workspace_id}", response_model=WorkspaceDetail)
async def get_workspace(
    workspace_id: str,
    db: DbSession,
    _: WorkspaceMember = Depends(get_workspace_membership),
) -> WorkspaceDetail:
    ws = await svc.get_workspace_or_404(db, workspace_id)
    members = await svc.list_members(db, workspace_id)
    return WorkspaceDetail(
        **WorkspaceRead.model_validate(ws).model_dump(),
        members=[MemberRead(**m) for m in members],
    )


@router.patch("/{workspace_id}", response_model=WorkspaceRead)
async def patch_workspace(
    workspace_id: str,
    body: WorkspaceUpdate,
    db: DbSession,
    _: WorkspaceMember = Depends(require_workspace_owner),
) -> WorkspaceRead:
    ws = await svc.get_workspace_or_404(db, workspace_id)
    ws = await svc.update_workspace(db, ws, name=body.name, description=body.description)
    return WorkspaceRead.model_validate(ws)


@router.delete("/{workspace_id}", status_code=204)
async def delete_workspace(
    workspace_id: str,
    db: DbSession,
    _: WorkspaceMember = Depends(require_workspace_owner),
) -> None:
    ws = await svc.get_workspace_or_404(db, workspace_id)
    await svc.delete_workspace(db, ws)


@router.post(
    "/{workspace_id}/members",
    response_model=MemberRead,
    status_code=status.HTTP_201_CREATED,
)
async def invite_member(
    workspace_id: str,
    body: MemberInvite,
    db: DbSession,
    _: WorkspaceMember = Depends(require_workspace_owner),
) -> MemberRead:
    m = await svc.invite_member(
        db, workspace_id=workspace_id, email=body.email, role=body.role
    )
    return MemberRead(**m)


@router.delete("/{workspace_id}/members/{user_id}", status_code=204)
async def remove_member(
    workspace_id: str,
    user_id: str,
    db: DbSession,
    _: WorkspaceMember = Depends(require_workspace_owner),
) -> None:
    await svc.remove_member(db, workspace_id=workspace_id, user_id=user_id)
```

- [ ] **Step 4: Mount workspaces router**

Modify `<repo>/backend/app/api/v1/router.py` to:

```python
"""Aggregate v1 router."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import auth as auth_module
from app.api.v1 import workspaces as workspaces_module

v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(auth_module.router)
v1_router.include_router(workspaces_module.router)
```

- [ ] **Step 5: Write tests**

Create `<repo>/backend/tests/test_workspace.py`:

```python
"""Workspace endpoint tests."""
from __future__ import annotations

import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_create_workspace_and_appears_in_list(client, registered_user):
    user, token = registered_user
    resp = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "Demo", "slug": "demo", "description": "First"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["slug"] == "demo"
    assert data["owner_id"] == user["id"]

    listed = await client.get("/api/v1/workspaces", headers=_auth(token))
    assert listed.status_code == 200
    arr = listed.json()
    assert len(arr) == 1 and arr[0]["slug"] == "demo" and arr[0]["role"] == "owner"


@pytest.mark.asyncio
async def test_workspace_slug_unique(client, registered_user):
    _, token = registered_user
    await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "A", "slug": "samesame"},
    )
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "B", "slug": "samesame"},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "workspace_slug_taken"


@pytest.mark.asyncio
async def test_workspace_slug_validation(client, registered_user):
    _, token = registered_user
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "Bad", "slug": "Has Spaces"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_non_member_cannot_get_workspace(client, registered_user):
    _, token = registered_user
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token), json={"name": "X", "slug": "xws"}
    )
    ws_id = r.json()["id"]

    other = await client.post(
        "/api/v1/auth/register",
        json={"email": "other@x.com", "password": "secret123", "display_name": "Other"},
    )
    other_token = other.json()["token"]

    r2 = await client.get(f"/api/v1/workspaces/{ws_id}", headers=_auth(other_token))
    assert r2.status_code == 403
    assert r2.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_owner_can_invite_member(client, registered_user):
    _, owner_token = registered_user
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(owner_token),
        json={"name": "Inv", "slug": "invws"},
    )
    ws_id = r.json()["id"]

    await client.post(
        "/api/v1/auth/register",
        json={"email": "guest@x.com", "password": "secret123", "display_name": "G"},
    )

    r2 = await client.post(
        f"/api/v1/workspaces/{ws_id}/members",
        headers=_auth(owner_token),
        json={"email": "guest@x.com", "role": "member"},
    )
    assert r2.status_code == 201, r2.text
    assert r2.json()["email"] == "guest@x.com"


@pytest.mark.asyncio
async def test_member_cannot_invite(client, registered_user):
    _, owner_token = registered_user
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(owner_token),
        json={"name": "M", "slug": "mws"},
    )
    ws_id = r.json()["id"]

    other = await client.post(
        "/api/v1/auth/register",
        json={"email": "m@x.com", "password": "secret123", "display_name": "M"},
    )
    other_token = other.json()["token"]

    await client.post(
        f"/api/v1/workspaces/{ws_id}/members",
        headers=_auth(owner_token),
        json={"email": "m@x.com", "role": "member"},
    )

    r2 = await client.post(
        f"/api/v1/workspaces/{ws_id}/members",
        headers=_auth(other_token),
        json={"email": "anybody@x.com", "role": "member"},
    )
    assert r2.status_code == 403


@pytest.mark.asyncio
async def test_invite_unknown_email_404(client, registered_user):
    _, token = registered_user
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "U", "slug": "uws"},
    )
    ws_id = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{ws_id}/members",
        headers=_auth(token),
        json={"email": "nobody@x.com", "role": "member"},
    )
    assert r2.status_code == 404
    assert r2.json()["error"]["code"] == "user_not_found"


@pytest.mark.asyncio
async def test_owner_can_delete_workspace(client, registered_user):
    _, token = registered_user
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "Del", "slug": "delws"},
    )
    ws_id = r.json()["id"]
    r2 = await client.delete(f"/api/v1/workspaces/{ws_id}", headers=_auth(token))
    assert r2.status_code == 204
    r3 = await client.get(f"/api/v1/workspaces/{ws_id}", headers=_auth(token))
    assert r3.status_code == 403  # not a member after delete


@pytest.mark.asyncio
async def test_cannot_remove_owner(client, registered_user):
    user, token = registered_user
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "RO", "slug": "rows"},
    )
    ws_id = r.json()["id"]
    r2 = await client.delete(
        f"/api/v1/workspaces/{ws_id}/members/{user['id']}", headers=_auth(token)
    )
    assert r2.status_code == 400
    assert r2.json()["error"]["code"] == "cannot_remove_owner"
```

- [ ] **Step 6: Run tests**

Run:
```bash
cd <repo>/backend
uv run pytest tests/test_workspace.py -v
```
Expected: 9 passed.

- [ ] **Step 7: Commit**

Run:
```bash
cd <repo>
git add backend/app/schemas/workspace.py backend/app/services/workspace_service.py backend/app/api/v1/workspaces.py backend/app/api/v1/router.py backend/tests/test_workspace.py
git commit -m "S0/Task 11: workspace CRUD + members + 9 tests

- POST/GET/PATCH/DELETE /api/v1/workspaces and /:id
- POST /api/v1/workspaces/:id/members invite by email (owner only)
- DELETE /api/v1/workspaces/:id/members/:uid (cannot remove owner)
- Slug regex validation, unique constraint mapped to 409"
```

---

## Phase E — ML client

### Task 12: Port ml_client async + /ml/health

**Files:**
- Create: `<repo>/backend/app/ml_client.py`
- Create: `<repo>/backend/app/api/v1/ml.py`
- Modify: `<repo>/backend/app/api/v1/router.py`
- Test: `<repo>/backend/tests/test_ml_health.py`

- [ ] **Step 1: Write ml_client.py**

Create `<repo>/backend/app/ml_client.py`:

```python
"""Async HTTP client for the external ML backend (sole outbound integration).

Adapted from doc-intel legacy `backend/app/ml_client.py` with:
  - httpx.Client → httpx.AsyncClient
  - all methods async
  - settings module renamed: `app.config` → `app.core.config.get_settings()`
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=5.0)
HEALTH_TIMEOUT = httpx.Timeout(5.0)


class MLClientError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


class MLClient:
    def __init__(
        self,
        base_url: str | None = None,
        *,
        timeout: httpx.Timeout | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.ML_BACKEND_URL).rstrip("/")
        self._timeout = timeout or DEFAULT_TIMEOUT
        self._transport = transport

    def _client(self, timeout: httpx.Timeout | None = None) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=timeout or self._timeout, transport=self._transport)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict | None = None,
        timeout: httpx.Timeout | None = None,
    ) -> dict:
        url = f"{self.base_url}/{path.lstrip('/')}"
        try:
            async with self._client(timeout) as client:
                resp = await client.request(method, url, json=json_body)
        except httpx.HTTPError as e:
            logger.warning("ML %s %s failed: %s", method, url, e)
            raise MLClientError(f"ML request failed: {e}") from e

        if resp.status_code >= 400:
            try:
                payload: Any = resp.json()
            except ValueError:
                payload = resp.text
            logger.warning("ML %s %s -> %s %s", method, url, resp.status_code, payload)
            raise MLClientError(
                f"ML backend {resp.status_code} for {url}",
                status_code=resp.status_code,
                payload=payload,
            )

        try:
            return resp.json()
        except ValueError as e:
            raise MLClientError(
                f"ML backend returned non-JSON: {e}", status_code=resp.status_code
            ) from e

    # ─── public API ──────────────────────────────────────────────────────────

    async def health(self) -> dict:
        return await self._request("GET", "health", timeout=HEALTH_TIMEOUT)

    async def predict(
        self,
        *,
        tasks: list[dict],
        project_uid: str,
        label_config: str | None,
        prompt: str | None = None,
        prompt_name: str | None = None,
        runtime_config: dict | None = None,
        model_version: str | None = None,
        context: Any = None,
        login: str | None = None,
        password: str | None = None,
    ) -> dict:
        """Reserved for S2. Kept here to lock the request shape."""
        params: dict[str, Any] = {"login": login, "password": password, "context": context}
        if prompt is not None:
            params["prompt"] = prompt
        if prompt_name is not None:
            params["prompt_name"] = prompt_name
        if runtime_config:
            rc = dict(runtime_config)
            if model_version and "model_version" not in rc:
                rc["model_version"] = model_version
            params["runtime_config"] = rc
        if model_version is not None:
            params["model_version"] = model_version
        body = {
            "tasks": tasks,
            "project": project_uid,
            "label_config": label_config,
            "params": params,
        }
        return await self._request("POST", "predict", json_body=body)
```

- [ ] **Step 2: Write api/v1/ml.py**

Create `<repo>/backend/app/api/v1/ml.py`:

```python
"""ML backend probe routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.deps import CurrentUser, get_ml_client
from app.core.exceptions import AppError
from app.ml_client import MLClient, MLClientError

router = APIRouter(prefix="/ml", tags=["ml"])


@router.get("/health")
async def ml_health(
    _: CurrentUser,
    ml: MLClient = Depends(get_ml_client),
) -> dict:
    try:
        h = await ml.health()
    except MLClientError as e:
        raise AppError(503, "ml_backend_unavailable", str(e))
    return {"ml_status": "ok", "ml_version": h.get("version"), "ml_url": ml.base_url}
```

- [ ] **Step 3: Mount ml router**

Modify `<repo>/backend/app/api/v1/router.py` to:

```python
"""Aggregate v1 router."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import auth as auth_module
from app.api.v1 import ml as ml_module
from app.api.v1 import workspaces as workspaces_module

v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(auth_module.router)
v1_router.include_router(workspaces_module.router)
v1_router.include_router(ml_module.router)
```

- [ ] **Step 4: Write tests**

Create `<repo>/backend/tests/test_ml_health.py`:

```python
"""ML health endpoint tests using mocked httpx transport."""
from __future__ import annotations

import httpx
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def mock_ml_ok():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health":
            return httpx.Response(200, json={"version": "ml-1.2.3"})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


@pytest.fixture
def mock_ml_down():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "down"})

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_ml_health_requires_auth(client):
    r = await client.get("/api/v1/ml/health")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_ml_health_ok(client, registered_user, mock_ml_ok):
    from app.main import app
    from app.core.deps import get_ml_client
    from app.ml_client import MLClient

    app.dependency_overrides[get_ml_client] = lambda: MLClient(transport=mock_ml_ok)
    try:
        _, token = registered_user
        r = await client.get("/api/v1/ml/health", headers=_auth(token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ml_status"] == "ok"
        assert data["ml_version"] == "ml-1.2.3"
    finally:
        app.dependency_overrides.pop(get_ml_client, None)


@pytest.mark.asyncio
async def test_ml_health_503_when_backend_down(client, registered_user, mock_ml_down):
    from app.main import app
    from app.core.deps import get_ml_client
    from app.ml_client import MLClient

    app.dependency_overrides[get_ml_client] = lambda: MLClient(transport=mock_ml_down)
    try:
        _, token = registered_user
        r = await client.get("/api/v1/ml/health", headers=_auth(token))
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "ml_backend_unavailable"
    finally:
        app.dependency_overrides.pop(get_ml_client, None)
```

- [ ] **Step 5: Run tests**

Run:
```bash
cd <repo>/backend
uv run pytest tests/test_ml_health.py -v
```
Expected: 3 passed.

- [ ] **Step 6: Run full backend test suite**

Run:
```bash
cd <repo>/backend
uv run pytest -v
```
Expected: ≥ 25 tests pass (Tasks 4, 5, 6, 8, 10, 11, 12 totals).

- [ ] **Step 7: Commit**

Run:
```bash
cd <repo>
git add backend/app/ml_client.py backend/app/api/v1/ml.py backend/app/api/v1/router.py backend/tests/test_ml_health.py
git commit -m "S0/Task 12: async ml_client + /api/v1/ml/health + 3 tests

- Port ml_client.py from legacy doc-intel; sync→async (httpx.AsyncClient)
- Reserve predict() signature for S2
- /api/v1/ml/health: 401 unauth; 200 with {ml_status, ml_version, ml_url}; 503
  ml_backend_unavailable on backend error"
```

---

## Phase F — Frontend foundation

### Task 13: Clean frontend, set up routing skeleton

**Files:**
- Modify: `<repo>/frontend/src/App.tsx`
- Modify: `<repo>/frontend/src/main.tsx` (only if needed)
- Modify: `<repo>/frontend/src/index.css` (verify intact)
- Create: `<repo>/frontend/src/lib/auth-storage.ts`
- Modify: `<repo>/frontend/src/lib/api-client.ts`
- Verify: `<repo>/frontend/package.json` deps

- [ ] **Step 1: Verify frontend builds before changes**

Run:
```bash
cd <repo>/frontend
export PATH="$HOME/.local/nodeenv/bin:$PATH"  # only if user uses nodeenv
npm install
```
Expected: install succeeds. Failure here means we need to fix dep issues before continuing.

- [ ] **Step 2: Write auth-storage.ts**

Create `<repo>/frontend/src/lib/auth-storage.ts`:

```typescript
const TOKEN_KEY = "doc-intel.token";
const WS_KEY = "doc-intel.currentWorkspaceId";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(WS_KEY);
}

export function getCurrentWorkspaceId(): string | null {
  return localStorage.getItem(WS_KEY);
}

export function setCurrentWorkspaceId(id: string | null): void {
  if (id === null) {
    localStorage.removeItem(WS_KEY);
  } else {
    localStorage.setItem(WS_KEY, id);
  }
}
```

- [ ] **Step 3: Update api-client.ts**

Replace `<repo>/frontend/src/lib/api-client.ts` with:

```typescript
import axios, { AxiosError, AxiosInstance } from "axios";
import { clearToken, getToken } from "./auth-storage";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (resp) => resp,
  (error: AxiosError) => {
    const url = error.config?.url ?? "";
    // Avoid redirect loop on the login/register endpoints themselves
    const isAuthCall = url.includes("/auth/login") || url.includes("/auth/register");
    if (error.response?.status === 401 && !isAuthCall) {
      clearToken();
      // soft redirect; let React Router pick up the change on next nav
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }
    return Promise.reject(error);
  }
);

export interface ApiError {
  code: string;
  message: string;
}

export function extractApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: ApiError } | undefined;
    if (data?.error) return data.error;
    return { code: "network_error", message: error.message };
  }
  return { code: "unknown", message: String(error) };
}
```

- [ ] **Step 4: Stub App.tsx with routes**

Replace `<repo>/frontend/src/App.tsx` with:

```typescript
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { useAuthStore } from "./stores/auth-store";

import LoginPage from "./pages/auth/LoginPage";
import RegisterPage from "./pages/auth/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import WorkspaceCreatePage from "./pages/WorkspaceCreatePage";
import WorkspaceSettingsPage from "./pages/WorkspaceSettingsPage";
import AppShell from "./components/layout/AppShell";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RootRedirect() {
  const token = useAuthStore((s) => s.token);
  return <Navigate to={token ? "/dashboard" : "/login"} replace />;
}

export default function App() {
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (token) {
      void refreshMe();
    }
  }, [token, refreshMe]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/workspaces/new" element={<WorkspaceCreatePage />} />
          <Route path="/workspaces/:slug" element={<DashboardPage />} />
          <Route path="/workspaces/:slug/settings" element={<WorkspaceSettingsPage />} />
        </Route>

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 5: Verify frontend type-checks (build will fail later because pages don't exist yet — intentional)**

Run:
```bash
cd <repo>/frontend
npx tsc --noEmit -p tsconfig.json 2>&1 | head -30
```
Expected: errors complaining about missing imports of the pages and stores. This is OK; Tasks 14-19 add them.

- [ ] **Step 6: Commit**

Run:
```bash
cd <repo>
git add frontend/src/App.tsx frontend/src/lib/auth-storage.ts frontend/src/lib/api-client.ts
git commit -m "S0/Task 13: frontend routing skeleton + axios + token storage

- App.tsx: routes for /login, /register, /dashboard, /workspaces/*
- ProtectedRoute + RootRedirect based on auth-store token
- api-client.ts: axios instance + Bearer interceptor + 401 redirect (excludes auth endpoints)
- auth-storage.ts: localStorage wrappers for token + currentWorkspaceId

Note: imports of stores/pages will resolve in Tasks 14-19."
```

---

### Task 14: Auth store (Zustand)

**Files:**
- Create: `<repo>/frontend/src/stores/auth-store.ts`

- [ ] **Step 1: Write auth-store.ts**

Create `<repo>/frontend/src/stores/auth-store.ts`:

```typescript
import { create } from "zustand";
import { api, extractApiError } from "../lib/api-client";
import {
  clearToken,
  getCurrentWorkspaceId,
  getToken,
  setCurrentWorkspaceId,
  setToken,
} from "../lib/auth-storage";

export interface User {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
}

export interface WorkspaceWithRole {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "member";
}

export interface WorkspaceCreateInput {
  name: string;
  slug: string;
  description?: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  workspaces: WorkspaceWithRole[];
  currentWorkspaceId: string | null;
  loading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
  switchWorkspaceById: (workspaceId: string) => void;
  switchWorkspaceBySlug: (slug: string) => void;
  createWorkspace: (input: WorkspaceCreateInput) => Promise<WorkspaceWithRole>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: getToken(),
  user: null,
  workspaces: [],
  currentWorkspaceId: getCurrentWorkspaceId(),
  loading: false,
  error: null,

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const resp = await api.post("/api/v1/auth/login", { email, password });
      setToken(resp.data.token);
      set({ token: resp.data.token, user: resp.data.user, loading: false });
      await get().refreshMe();
    } catch (e) {
      const err = extractApiError(e);
      set({ loading: false, error: err.message });
      throw err;
    }
  },

  register: async (email, password, displayName) => {
    set({ loading: true, error: null });
    try {
      const resp = await api.post("/api/v1/auth/register", {
        email,
        password,
        display_name: displayName,
      });
      setToken(resp.data.token);
      set({ token: resp.data.token, user: resp.data.user, loading: false });
      await get().refreshMe();
    } catch (e) {
      const err = extractApiError(e);
      set({ loading: false, error: err.message });
      throw err;
    }
  },

  logout: () => {
    clearToken();
    set({ token: null, user: null, workspaces: [], currentWorkspaceId: null });
  },

  refreshMe: async () => {
    if (!get().token) return;
    try {
      const resp = await api.get("/api/v1/auth/me");
      const workspaces: WorkspaceWithRole[] = resp.data.workspaces;
      let current = get().currentWorkspaceId;
      if (current && !workspaces.find((w) => w.id === current)) {
        current = null;
      }
      if (!current && workspaces.length > 0) {
        current = workspaces[0].id;
      }
      setCurrentWorkspaceId(current);
      set({
        user: resp.data.user,
        workspaces,
        currentWorkspaceId: current,
      });
    } catch (e) {
      // 401 interceptor handles redirect; just clear
      const err = extractApiError(e);
      if (err.code !== "network_error") {
        get().logout();
      }
    }
  },

  switchWorkspaceById: (workspaceId) => {
    setCurrentWorkspaceId(workspaceId);
    set({ currentWorkspaceId: workspaceId });
  },

  switchWorkspaceBySlug: (slug) => {
    const ws = get().workspaces.find((w) => w.slug === slug);
    if (ws) {
      setCurrentWorkspaceId(ws.id);
      set({ currentWorkspaceId: ws.id });
    }
  },

  createWorkspace: async (input) => {
    const resp = await api.post("/api/v1/workspaces", input);
    const ws: WorkspaceWithRole = {
      id: resp.data.id,
      name: resp.data.name,
      slug: resp.data.slug,
      role: "owner",
    };
    setCurrentWorkspaceId(ws.id);
    set((s) => ({
      workspaces: [...s.workspaces, ws],
      currentWorkspaceId: ws.id,
    }));
    return ws;
  },
}));
```

- [ ] **Step 2: Type-check**

Run:
```bash
cd <repo>/frontend
npx tsc --noEmit -p tsconfig.json 2>&1 | head -20
```
Expected: errors are only about missing pages/components (not about auth-store).

- [ ] **Step 3: Commit**

Run:
```bash
cd <repo>
git add frontend/src/stores/auth-store.ts
git commit -m "S0/Task 14: Zustand auth-store

- token, user, workspaces, currentWorkspaceId state
- login/register/logout/refreshMe/switchWorkspace/createWorkspace actions
- Auto-pick first workspace as current on refreshMe if none set
- Persist token + currentWorkspaceId via localStorage helpers"
```

---

### Task 15: Login + Register pages

**Files:**
- Create: `<repo>/frontend/src/pages/auth/LoginPage.tsx`
- Create: `<repo>/frontend/src/pages/auth/RegisterPage.tsx`

- [ ] **Step 1: Write LoginPage.tsx**

Create `<repo>/frontend/src/pages/auth/LoginPage.tsx`:

```typescript
import { useState, FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store";

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "Login failed";
      setError(msg);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f1117] text-[#e2e8f0]">
      <form onSubmit={onSubmit} className="bg-[#1a1d27] border border-[#2a2e3d] rounded-lg p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold mb-6">登录 doc-intel</h1>

        <label className="block text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-1">
          Email
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-4 focus:border-[#6366f1] outline-none text-sm"
        />

        <label className="block text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-1">
          密码
        </label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-6 focus:border-[#6366f1] outline-none text-sm"
        />

        {error && (
          <div className="text-[#ef4444] text-xs mb-4">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#6366f1] hover:bg-[#818cf8] text-white font-semibold py-2 rounded text-sm disabled:opacity-50"
        >
          {loading ? "登录中..." : "登录"}
        </button>

        <div className="text-xs text-[#64748b] mt-4 text-center">
          还没有账号？<Link to="/register" className="text-[#6366f1] hover:underline">注册</Link>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Write RegisterPage.tsx**

Create `<repo>/frontend/src/pages/auth/RegisterPage.tsx`:

```typescript
import { useState, FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store";

export default function RegisterPage() {
  const navigate = useNavigate();
  const register = useAuthStore((s) => s.register);
  const loading = useAuthStore((s) => s.loading);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("密码至少 8 位");
      return;
    }
    try {
      await register(email, password, displayName);
      navigate("/workspaces/new");
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "Registration failed";
      setError(msg);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f1117] text-[#e2e8f0]">
      <form onSubmit={onSubmit} className="bg-[#1a1d27] border border-[#2a2e3d] rounded-lg p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold mb-6">注册 doc-intel</h1>

        <label className="block text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-1">
          Email
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-4 focus:border-[#6366f1] outline-none text-sm"
        />

        <label className="block text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-1">
          显示名
        </label>
        <input
          type="text"
          required
          maxLength={120}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-4 focus:border-[#6366f1] outline-none text-sm"
        />

        <label className="block text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-1">
          密码（≥8 位）
        </label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-6 focus:border-[#6366f1] outline-none text-sm"
        />

        {error && <div className="text-[#ef4444] text-xs mb-4">{error}</div>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#6366f1] hover:bg-[#818cf8] text-white font-semibold py-2 rounded text-sm disabled:opacity-50"
        >
          {loading ? "注册中..." : "注册并登录"}
        </button>

        <div className="text-xs text-[#64748b] mt-4 text-center">
          已有账号？<Link to="/login" className="text-[#6366f1] hover:underline">登录</Link>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

Run:
```bash
cd <repo>
git add frontend/src/pages/auth/
git commit -m "S0/Task 15: Login and Register pages

- /login and /register routes with form + error display
- After register, redirect to /workspaces/new
- Use design-v2 §7.1 dark palette (placeholder until proper Tailwind tokens)"
```

---

### Task 16: AppShell + WorkspaceSwitcher

**Files:**
- Create: `<repo>/frontend/src/components/layout/AppShell.tsx`
- Create: `<repo>/frontend/src/components/layout/WorkspaceSwitcher.tsx`

- [ ] **Step 1: Write WorkspaceSwitcher.tsx**

Create `<repo>/frontend/src/components/layout/WorkspaceSwitcher.tsx`:

```typescript
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store";

export default function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const workspaces = useAuthStore((s) => s.workspaces);
  const currentId = useAuthStore((s) => s.currentWorkspaceId);
  const switchById = useAuthStore((s) => s.switchWorkspaceById);
  const [open, setOpen] = useState(false);

  const current = workspaces.find((w) => w.id === currentId) ?? null;

  function pickWorkspace(id: string, slug: string) {
    switchById(id);
    setOpen(false);
    navigate(`/workspaces/${slug}`);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="bg-[#1a1d27] border border-[#2a2e3d] rounded px-3 py-1.5 text-sm hover:bg-[#232736] flex items-center gap-2"
      >
        <span className="font-semibold">{current ? current.name : "选择 Workspace"}</span>
        <span className="text-[#64748b]">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-[#1a1d27] border border-[#2a2e3d] rounded shadow-lg z-50">
          {workspaces.length === 0 && (
            <div className="px-3 py-2 text-xs text-[#64748b]">还没有 workspace</div>
          )}
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => pickWorkspace(w.id, w.slug)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-[#232736] ${
                w.id === currentId ? "text-[#818cf8]" : "text-[#e2e8f0]"
              }`}
            >
              <div className="font-medium">{w.name}</div>
              <div className="text-xs text-[#64748b]">{w.slug} · {w.role}</div>
            </button>
          ))}
          <div className="border-t border-[#2a2e3d]">
            <button
              onClick={() => {
                setOpen(false);
                navigate("/workspaces/new");
              }}
              className="w-full text-left px-3 py-2 text-sm text-[#6366f1] hover:bg-[#232736]"
            >
              + 新建 Workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write AppShell.tsx**

Create `<repo>/frontend/src/components/layout/AppShell.tsx`:

```typescript
import { useEffect } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store";
import WorkspaceSwitcher from "./WorkspaceSwitcher";

export default function AppShell() {
  const navigate = useNavigate();
  const params = useParams();
  const user = useAuthStore((s) => s.user);
  const workspaces = useAuthStore((s) => s.workspaces);
  const currentWorkspaceId = useAuthStore((s) => s.currentWorkspaceId);
  const switchBySlug = useAuthStore((s) => s.switchWorkspaceBySlug);
  const logout = useAuthStore((s) => s.logout);

  // Sync currentWorkspaceId with URL slug if route has one
  useEffect(() => {
    if (params.slug) {
      switchBySlug(params.slug);
    }
  }, [params.slug, switchBySlug]);

  // If no workspaces and on /dashboard, push to /workspaces/new
  useEffect(() => {
    if (user && workspaces.length === 0) {
      navigate("/workspaces/new", { replace: true });
    }
  }, [user, workspaces, navigate]);

  function onLogout() {
    logout();
    navigate("/login");
  }

  const current = workspaces.find((w) => w.id === currentWorkspaceId);

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e2e8f0]">
      <header className="bg-[#1a1d27] border-b border-[#2a2e3d] px-5 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">⚡</span>
          <span className="font-bold tracking-tight">doc-intel</span>
          <span className="bg-[rgba(99,102,241,0.12)] text-[#94a3b8] text-[10px] px-2 py-0.5 rounded">
            S0
          </span>
        </div>

        <div className="flex items-center gap-3">
          <WorkspaceSwitcher />
          {current && current.role === "owner" && (
            <button
              onClick={() => navigate(`/workspaces/${current.slug}/settings`)}
              className="text-sm text-[#94a3b8] hover:text-[#e2e8f0]"
            >
              设置
            </button>
          )}
          <div className="text-sm text-[#94a3b8]">{user?.display_name}</div>
          <button
            onClick={onLogout}
            className="text-sm text-[#94a3b8] hover:text-[#e2e8f0]"
          >
            退出
          </button>
        </div>
      </header>

      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

Run:
```bash
cd <repo>
git add frontend/src/components/layout/
git commit -m "S0/Task 16: AppShell + WorkspaceSwitcher

- AppShell: top bar with logo, switcher, settings link (owner-only),
  display name, logout. Outlet for nested routes.
- WorkspaceSwitcher: dropdown listing my workspaces + 'new workspace'.
- Auto-redirect to /workspaces/new if user has no workspace.
- Sync URL slug with currentWorkspaceId."
```

---

### Task 17: Dashboard + WorkspaceCreate + WorkspaceSettings pages

**Files:**
- Create: `<repo>/frontend/src/pages/DashboardPage.tsx`
- Create: `<repo>/frontend/src/pages/WorkspaceCreatePage.tsx`
- Create: `<repo>/frontend/src/pages/WorkspaceSettingsPage.tsx`

- [ ] **Step 1: Write DashboardPage.tsx**

Create `<repo>/frontend/src/pages/DashboardPage.tsx`:

```typescript
import { useEffect, useState } from "react";
import { api, extractApiError } from "../lib/api-client";
import { useAuthStore } from "../stores/auth-store";

interface MlHealth {
  ml_status: string;
  ml_version?: string;
  ml_url: string;
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const workspaces = useAuthStore((s) => s.workspaces);
  const currentId = useAuthStore((s) => s.currentWorkspaceId);
  const current = workspaces.find((w) => w.id === currentId);

  const [mlHealth, setMlHealth] = useState<MlHealth | null>(null);
  const [mlError, setMlError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/api/v1/ml/health")
      .then((r) => setMlHealth(r.data))
      .catch((e) => setMlError(extractApiError(e).message));
  }, []);

  if (!current) {
    return <div className="text-[#94a3b8]">加载中...</div>;
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">{current.name}</h1>
      <div className="text-sm text-[#94a3b8] mb-6">
        slug: <code className="text-[#a5f3fc]">{current.slug}</code> · 你的角色: {current.role}
      </div>

      <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-4 mb-4">
        <div className="text-xs uppercase tracking-wider text-[#94a3b8] mb-2 font-semibold">
          ML Backend
        </div>
        {mlHealth ? (
          <div className="text-sm">
            <span className="text-[#22c55e]">●</span> {mlHealth.ml_status} ·{" "}
            <span className="text-[#94a3b8]">{mlHealth.ml_url}</span>
            {mlHealth.ml_version && (
              <span className="text-[#94a3b8]"> · v{mlHealth.ml_version}</span>
            )}
          </div>
        ) : mlError ? (
          <div className="text-sm text-[#ef4444]">● {mlError}</div>
        ) : (
          <div className="text-sm text-[#64748b]">检查中...</div>
        )}
      </div>

      <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-6 text-center">
        <div className="text-[#94a3b8] text-sm mb-2">📋 项目即将上线</div>
        <div className="text-xs text-[#64748b]">
          S1 阶段会在这里加上 Project 列表和文档上传。当前是 S0 Foundation 完成态。
        </div>
      </div>

      <div className="text-xs text-[#64748b] mt-4">
        登录身份: {user?.email}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write WorkspaceCreatePage.tsx**

Create `<repo>/frontend/src/pages/WorkspaceCreatePage.tsx`:

```typescript
import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";
import { extractApiError } from "../lib/api-client";

export default function WorkspaceCreatePage() {
  const navigate = useNavigate();
  const createWorkspace = useAuthStore((s) => s.createWorkspace);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function autoFillSlug(value: string) {
    setName(value);
    if (!slug) {
      const auto = value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      setSlug(auto.slice(0, 60));
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const ws = await createWorkspace({
        name,
        slug,
        description: description || undefined,
      });
      navigate(`/workspaces/${ws.slug}`);
    } catch (e) {
      setError(extractApiError(e).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-bold mb-6">新建 Workspace</h1>
      <form onSubmit={onSubmit} className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-6">
        <label className="block text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-1">
          名称
        </label>
        <input
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(e) => autoFillSlug(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-4 focus:border-[#6366f1] outline-none text-sm"
        />

        <label className="block text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-1">
          Slug（URL 用，小写字母/数字/连字符）
        </label>
        <input
          type="text"
          required
          minLength={3}
          maxLength={60}
          pattern="[a-z0-9][a-z0-9-]{1,58}[a-z0-9]"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-4 focus:border-[#6366f1] outline-none text-sm font-mono"
        />

        <label className="block text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-1">
          描述（可选）
        </label>
        <textarea
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-6 focus:border-[#6366f1] outline-none text-sm h-20"
        />

        {error && <div className="text-[#ef4444] text-xs mb-4">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="bg-[#6366f1] hover:bg-[#818cf8] text-white font-semibold px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {submitting ? "创建中..." : "创建 Workspace"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Write WorkspaceSettingsPage.tsx**

Create `<repo>/frontend/src/pages/WorkspaceSettingsPage.tsx`:

```typescript
import { useEffect, useState, FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, extractApiError } from "../lib/api-client";
import { useAuthStore } from "../stores/auth-store";

interface Member {
  user_id: string;
  email: string;
  display_name: string;
  role: "owner" | "member";
}

export default function WorkspaceSettingsPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const workspaces = useAuthStore((s) => s.workspaces);
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const ws = workspaces.find((w) => w.slug === slug);

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function load() {
    if (!ws) return;
    setLoading(true);
    try {
      const r = await api.get(`/api/v1/workspaces/${ws.id}`);
      setMembers(r.data.members ?? []);
    } catch (e) {
      setError(extractApiError(e).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [ws?.id]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!ws) return;
    try {
      await api.post(`/api/v1/workspaces/${ws.id}/members`, {
        email: inviteEmail,
        role: "member",
      });
      setInviteEmail("");
      setInfo(`已邀请 ${inviteEmail}`);
      await load();
    } catch (e) {
      setError(extractApiError(e).message);
    }
  }

  async function onRemove(userId: string) {
    if (!ws) return;
    if (!confirm("移除该成员？")) return;
    try {
      await api.delete(`/api/v1/workspaces/${ws.id}/members/${userId}`);
      await load();
    } catch (e) {
      setError(extractApiError(e).message);
    }
  }

  async function onDeleteWorkspace() {
    if (!ws) return;
    if (!confirm(`删除 workspace "${ws.name}"？此操作不可恢复。`)) return;
    try {
      await api.delete(`/api/v1/workspaces/${ws.id}`);
      await refreshMe();
      navigate("/dashboard");
    } catch (e) {
      setError(extractApiError(e).message);
    }
  }

  if (!ws) return <div className="text-[#94a3b8]">未找到 workspace</div>;
  if (ws.role !== "owner") {
    return <div className="text-[#ef4444]">只有 owner 可以访问设置页</div>;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-6">{ws.name} · 设置</h1>

      <section className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3">邀请成员</h2>
        <form onSubmit={onInvite} className="flex gap-2">
          <input
            type="email"
            placeholder="email@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            className="flex-1 bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 text-sm focus:border-[#6366f1] outline-none"
          />
          <button
            type="submit"
            className="bg-[#6366f1] hover:bg-[#818cf8] text-white font-semibold px-4 rounded text-sm"
          >
            邀请
          </button>
        </form>
        {info && <div className="text-[#22c55e] text-xs mt-2">{info}</div>}
      </section>

      <section className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3">成员 ({members.length})</h2>
        {loading ? (
          <div className="text-[#64748b] text-sm">加载中...</div>
        ) : (
          <ul className="divide-y divide-[#2a2e3d]">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm">{m.display_name}</div>
                  <div className="text-xs text-[#64748b]">{m.email} · {m.role}</div>
                </div>
                {m.role !== "owner" && (
                  <button
                    onClick={() => onRemove(m.user_id)}
                    className="text-xs text-[#ef4444] hover:underline"
                  >
                    移除
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-[#1a1d27] border border-[#ef4444] rounded p-4">
        <h2 className="text-sm font-semibold mb-2 text-[#ef4444]">危险区</h2>
        <button
          onClick={onDeleteWorkspace}
          className="bg-[#ef4444] hover:bg-[#dc2626] text-white font-semibold px-4 py-2 rounded text-sm"
        >
          删除 Workspace
        </button>
      </section>

      {error && <div className="text-[#ef4444] text-xs mt-4">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Type-check the whole frontend**

Run:
```bash
cd <repo>/frontend
npx tsc --noEmit -p tsconfig.json
```
Expected: zero errors.

- [ ] **Step 5: Build frontend**

Run:
```bash
cd <repo>/frontend
npm run build
```
Expected: build succeeds and writes `dist/`.

- [ ] **Step 6: Commit**

Run:
```bash
cd <repo>
git add frontend/src/pages/
git commit -m "S0/Task 17: Dashboard, WorkspaceCreate, WorkspaceSettings pages

- DashboardPage: workspace summary + ML backend health probe + S0 placeholder
- WorkspaceCreatePage: form with auto-slug-from-name + slug regex validation
- WorkspaceSettingsPage: invite by email, list/remove members,
  delete workspace (owner-only access enforced client-side and server-side)
- Type-check passes; npm run build succeeds"
```

---

## Phase G — Smoke acceptance

### Task 18: End-to-end smoke flow + final tag

**Files:** none modified — execution and verification.

- [ ] **Step 1: Boot backend**

Run in terminal A:
```bash
cd <repo>/backend
uv run uvicorn app.main:app --reload --port 8000
```
Expected: `Uvicorn running on http://0.0.0.0:8000`. Leave running.

- [ ] **Step 2: Boot frontend**

Run in terminal B:
```bash
cd <repo>/frontend
npm run dev
```
Expected: `Local: http://localhost:5173/`. Leave running.

- [ ] **Step 3: Backend self health**

Run:
```bash
curl -s http://localhost:8000/health
```
Expected: `{"status":"ok","version":"0.1.0"}`

- [ ] **Step 4: Spec §10 smoke flow — manual**

Open http://localhost:5173 in a browser. Walk through these steps. Each must succeed before marking the next.

  - [ ] 4.1 Auto-redirected to `/login`
  - [ ] 4.2 Click "注册"; register with `alice@example.com` / `secret123` / `Alice`. After submit, lands on `/workspaces/new`.
  - [ ] 4.3 Create workspace `name=Demo, slug=demo`. Lands on `/workspaces/demo`.
  - [ ] 4.4 Top bar shows workspace switcher with "Demo"; ML Backend section shows status (ok if ML backend is running on 9090, otherwise red error — both acceptable for this smoke).
  - [ ] 4.5 Switcher dropdown shows "+ 新建 Workspace". Click and create `name=Test2, slug=test2`. URL becomes `/workspaces/test2`.
  - [ ] 4.6 Switcher now lists Demo and Test2; switching between them updates the URL.
  - [ ] 4.7 Open `/workspaces/demo/settings`. Open another browser/private window, register `bob@example.com` / `secret123` / `Bob`. Back in alice's window, invite `bob@example.com`. Members list now has Bob.
  - [ ] 4.8 In bob's window, refresh; switcher shows Demo with role=member. Visit `/workspaces/demo/settings` — should see `只有 owner 可以访问设置页`.
  - [ ] 4.9 In alice's window, click logout. Page redirects to `/login`. Refresh — still on `/login`. Token cleared.
  - [ ] 4.10 Log in again as alice. All workspaces still visible (data persisted in SQLite).

- [ ] **Step 5: ML health curl roundtrip**

In terminal C, register a new user via curl and call ml/health:
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@example.com","password":"secret123","display_name":"Smoke"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/ml/health
```
Expected (when ML backend is up): `{"ml_status":"ok","ml_version":"...","ml_url":"http://0.0.0.0:9090"}`. If ML backend is down: `{"error":{"code":"ml_backend_unavailable","message":"..."}}` (HTTP 503).

- [ ] **Step 6: Run full backend test suite**

Run:
```bash
cd <repo>/backend
uv run pytest -v
```
Expected: ≥ 25 tests pass, 0 failed.

- [ ] **Step 7: Stop dev servers**

Stop terminal A and B with Ctrl-C.

- [ ] **Step 8: Verify alembic state clean**

Run:
```bash
cd <repo>/backend
uv run alembic current
```
Expected: shows the S0 migration ID with `(head)`.

- [ ] **Step 9: Commit nothing-new but tag**

Run:
```bash
cd <repo>
git tag -a s0-complete -m "S0 Foundation complete: auth + workspaces + ml/health smoke pass"
git tag --list
```
Expected: `pre-rebase` and `s0-complete` both listed.

- [ ] **Step 10: Update memory pointer (off-tree)**

This is a manual / orchestrator step (not a file in this repo). After tag created, the orchestrator should update `/Users/qinqiang02/.claude/projects/-Users-qinqiang02-colab-codespace-ai-label-studio/memory/project_doc_intel_redesign.md` to mark **S0 status: completed**, and prepare to invoke writing-plans for S1.

---

## Self-Review (post-write checklist for plan author)

Done. Confirmed inline:

1. **Spec coverage** — §3 repo prep (Tasks 1-2), §4.1-4.7 backend (Tasks 3-12), §5 frontend (Tasks 13-17), §6 ml_client (Task 12), §7 alembic (Task 7), §8 testing (Tasks 4-12), §9 env (Task 4), §10 smoke (Task 18). All sections mapped.
2. **Placeholders** — searched for TBD/TODO/implement-later; none.
3. **Type consistency** — `WorkspaceWithRole` shape used identically across backend schemas, auth-store, dashboard, switcher. `MemberRead.user_id`/`email`/`display_name`/`role` matches between server response and frontend `Member` interface. `gen_uuid` used consistently as `String(36)` UUID v4.
4. **Tests cover** — settings, database pragmas, security (4), models (4), auth endpoints (6), workspace endpoints (9), ml health (3) → 26 tests minimum.

**Total: 18 tasks. Estimated 20.5 hours.** Acceptance criteria from spec §10 are exhausted in Task 18 Step 4.
