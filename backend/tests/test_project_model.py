"""Tests for Project model."""
from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture
async def session(tmp_path, monkeypatch):
    db_file = tmp_path / "project_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    from app.models.base import Base
    from app.models import user, workspace, workspace_member, project  # noqa: F401

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}", future=True)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        await s.execute(text("PRAGMA foreign_keys=ON"))
        yield s
    await engine.dispose()


async def _make_user_ws(session):
    from app.models.user import User
    from app.models.workspace import Workspace

    u = User(email="a@x.com", password_hash="h", display_name="A")
    session.add(u)
    await session.flush()
    w = Workspace(name="W", slug="w", owner_id=u.id)
    session.add(w)
    await session.flush()
    return u, w


@pytest.mark.asyncio
async def test_create_project(session):
    from app.models.project import Project

    u, w = await _make_user_ws(session)
    p = Project(
        workspace_id=w.id,
        name="Receipts",
        slug="receipts",
        template_key="japan_receipt",
        created_by=u.id,
    )
    session.add(p)
    await session.commit()

    assert p.id and p.created_at
    assert p.status == "draft"
    assert p.api_code is None
    assert p.deleted_at is None


@pytest.mark.asyncio
async def test_unique_slug_per_workspace(session):
    from app.models.project import Project

    u, w = await _make_user_ws(session)
    session.add(Project(workspace_id=w.id, name="A", slug="dup", template_key="custom", created_by=u.id))
    await session.commit()
    session.add(Project(workspace_id=w.id, name="B", slug="dup", template_key="custom", created_by=u.id))
    with pytest.raises(IntegrityError):
        await session.commit()


@pytest.mark.asyncio
async def test_same_slug_different_workspace_ok(session):
    from app.models.project import Project
    from app.models.workspace import Workspace

    u, w1 = await _make_user_ws(session)
    w2 = Workspace(name="W2", slug="w2", owner_id=u.id)
    session.add(w2)
    await session.flush()

    session.add(Project(workspace_id=w1.id, name="A", slug="same", template_key="custom", created_by=u.id))
    session.add(Project(workspace_id=w2.id, name="B", slug="same", template_key="custom", created_by=u.id))
    await session.commit()  # no error


@pytest.mark.asyncio
async def test_workspace_cascade_deletes_projects(session):
    from app.models.project import Project
    from app.models.workspace import Workspace
    from sqlalchemy import select

    u, w = await _make_user_ws(session)
    session.add(Project(workspace_id=w.id, name="P", slug="p", template_key="custom", created_by=u.id))
    await session.commit()

    await session.delete(w)
    await session.commit()

    rows = (await session.execute(select(Project))).scalars().all()
    assert rows == []
