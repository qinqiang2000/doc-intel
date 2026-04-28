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
