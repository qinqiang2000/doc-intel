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
