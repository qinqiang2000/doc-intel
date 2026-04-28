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
