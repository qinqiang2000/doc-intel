"""Tests for Document model."""
from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture
async def session(tmp_path, monkeypatch):
    db_file = tmp_path / "doc_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    from app.models.base import Base
    from app.models import user, workspace, workspace_member, project, document  # noqa: F401

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
    from app.models.project import Project
    from app.models.user import User
    from app.models.workspace import Workspace

    u = User(email="a@x.com", password_hash="h", display_name="A")
    session.add(u)
    await session.flush()
    w = Workspace(name="W", slug="w", owner_id=u.id)
    session.add(w)
    await session.flush()
    p = Project(workspace_id=w.id, name="P", slug="p", template_key="custom", created_by=u.id)
    session.add(p)
    await session.flush()
    return u, p


@pytest.mark.asyncio
async def test_create_document(session):
    from app.models.document import Document, DocumentStatus

    u, p = await _seed(session)
    d = Document(
        project_id=p.id,
        filename="invoice.pdf",
        file_path="abc-uuid.pdf",
        file_size=12345,
        mime_type="application/pdf",
        uploaded_by=u.id,
    )
    session.add(d)
    await session.commit()

    assert d.id and d.created_at
    assert d.status == DocumentStatus.UPLOADING
    assert d.is_ground_truth is False
    assert d.deleted_at is None


@pytest.mark.asyncio
async def test_status_can_be_set_to_ready(session):
    from app.models.document import Document, DocumentStatus

    u, p = await _seed(session)
    d = Document(
        project_id=p.id,
        filename="x.pdf",
        file_path="x-uuid.pdf",
        file_size=1,
        mime_type="application/pdf",
        uploaded_by=u.id,
        status=DocumentStatus.READY,
    )
    session.add(d)
    await session.commit()
    assert d.status == DocumentStatus.READY


@pytest.mark.asyncio
async def test_project_cascade_delete(session):
    from app.models.document import Document
    from app.models.project import Project

    u, p = await _seed(session)
    session.add(Document(
        project_id=p.id, filename="x.pdf", file_path="x.pdf",
        file_size=1, mime_type="application/pdf", uploaded_by=u.id,
    ))
    await session.commit()

    await session.delete(p)
    await session.commit()
    rows = (await session.execute(select(Document))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_ground_truth_flag(session):
    from app.models.document import Document

    u, p = await _seed(session)
    d = Document(
        project_id=p.id, filename="x.pdf", file_path="x.pdf",
        file_size=1, mime_type="application/pdf", uploaded_by=u.id,
        is_ground_truth=True,
    )
    session.add(d)
    await session.commit()
    assert d.is_ground_truth is True
