"""Tests for SQLAlchemy models — relationships, FK constraints, defaults."""
from __future__ import annotations

import pytest
from sqlalchemy import text
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
    from app.models import user as _u, workspace as _w, workspace_member as _wm  # noqa: F401

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}", future=True)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        await s.execute(text("PRAGMA foreign_keys=ON"))
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
