"""Shared pytest config — async mode, in-memory SQLite per test, HTTP client."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

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
    from app.models import user, workspace, workspace_member  # noqa: F401
    # Ensure all models are registered with Base.metadata for tests using db_session.
    from app.models import project, document, prompt_version  # noqa: F401
    from app.models import evaluation_run, evaluation_field_result  # noqa: F401
    from app.models import api_key  # noqa: F401

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
    import importlib

    from app.main import app
    # Re-import after potential reloads in test_database.py so the key we
    # register in dependency_overrides matches the reference held by deps.py.
    import app.core.database as _db_mod
    import app.core.deps as _deps_mod
    importlib.reload(_db_mod)
    importlib.reload(_deps_mod)
    from app.core.database import get_db

    SessionLocal = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db():
        async with SessionLocal() as s:
            await s.execute(text("PRAGMA foreign_keys=ON"))
            yield s

    def _override_session_factory():
        return SessionLocal

    app.dependency_overrides[get_db] = _override_get_db

    # Override the session factory used by batch-predict SSE handler so it
    # writes to the same test DB as the rest of the request session.
    from app.api.v1.predict import get_session_factory
    app.dependency_overrides[get_session_factory] = _override_session_factory

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def seed_user(db_session):
    from app.core.security import hash_password
    from app.models.user import User

    u = User(
        email="alice@example.com",
        password_hash=hash_password("pass1234"),
        display_name="Alice",
    )
    db_session.add(u)
    await db_session.commit()
    await db_session.refresh(u)
    return u


@pytest_asyncio.fixture
async def seed_project(db_session, seed_user):
    from app.models.project import Project
    from app.models.workspace import Workspace
    from app.models.workspace_member import WorkspaceMember, WorkspaceRole

    ws = Workspace(name="Demo", slug="demo", owner_id=seed_user.id)
    db_session.add(ws)
    await db_session.flush()
    db_session.add(
        WorkspaceMember(workspace_id=ws.id, user_id=seed_user.id, role=WorkspaceRole.OWNER)
    )
    proj = Project(
        workspace_id=ws.id,
        name="Receipts",
        slug="receipts",
        template_key="china_vat",
        created_by=seed_user.id,
    )
    db_session.add(proj)
    await db_session.commit()
    await db_session.refresh(proj)
    return proj


@pytest_asyncio.fixture
async def registered_user(client):
    """Register a fresh user; return ({email, password, display_name, id}, token)."""
    payload = {"email": "test-user@x.com", "password": "secret123", "display_name": "Test"}
    resp = await client.post("/api/v1/auth/register", json=payload)
    data = resp.json()
    user = {**payload, "id": data["user"]["id"]}
    return user, data["token"]
