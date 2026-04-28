"""Tests for predict service helpers."""
from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture
async def session(tmp_path, monkeypatch):
    db_file = tmp_path / "predict_test.db"
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


async def _seed(session):
    from app.models.document import Document
    from app.models.project import Project
    from app.models.user import User
    from app.models.workspace import Workspace
    u = User(email="a@x.com", password_hash="h", display_name="A")
    session.add(u); await session.flush()
    w = Workspace(name="W", slug="ws-pp", owner_id=u.id)
    session.add(w); await session.flush()
    p = Project(workspace_id=w.id, name="P", slug="proj-pp", template_key="japan_receipt", created_by=u.id)
    session.add(p); await session.flush()
    d = Document(
        project_id=p.id, filename="x.pdf", file_path="x.pdf",
        file_size=1, mime_type="application/pdf", uploaded_by=u.id,
    )
    session.add(d); await session.flush()
    return u, p, d


def test_build_default_prompt_with_template():
    from app.services.predict import build_default_prompt
    out = build_default_prompt("japan_receipt")
    assert "doc_type" in out  # template's expected_fields
    assert "merchant_name" in out
    assert "JSON" in out


def test_build_default_prompt_no_template_or_unknown():
    from app.services.predict import build_default_prompt
    assert "JSON" in build_default_prompt(None)
    assert "JSON" in build_default_prompt("nonexistent_template")


def test_build_default_prompt_custom_template_empty_fields():
    from app.services.predict import build_default_prompt
    # custom template has expected_fields=[]
    out = build_default_prompt("custom")
    assert "JSON" in out


def test_parse_llm_output_json_block():
    from app.services.predict import _parse_llm_output
    raw = '```json\n{"invoice_number":"INV-001","total":1234.5}\n```'
    out = _parse_llm_output(raw)
    assert out == {"invoice_number": "INV-001", "total": 1234.5}


def test_parse_llm_output_plain_json():
    from app.services.predict import _parse_llm_output
    out = _parse_llm_output('{"a":1,"b":[2,3]}')
    assert out == {"a": 1, "b": [2, 3]}


def test_parse_llm_output_array_wrapped_to_items():
    from app.services.predict import _parse_llm_output
    out = _parse_llm_output('[{"docType":"invoice"},{"docType":"receipt"}]')
    assert out == {"items": [{"docType": "invoice"}, {"docType": "receipt"}]}


def test_parse_llm_output_invalid_returns_raw_marker():
    from app.services.predict import _parse_llm_output
    out = _parse_llm_output("not json at all")
    assert "_raw" in out
    assert out["_raw"] == "not json at all"


def test_infer_schema_simple():
    from app.services.predict import _infer_schema
    out = _infer_schema({"name": "alice", "age": 30, "scores": [1, 2]})
    assert out["name"] == "string"
    assert out["age"] == "number"
    assert out["scores"] == "array"


@pytest.mark.asyncio
async def test_next_version_initial(session):
    from app.services.predict import _next_version
    _, _, d = await _seed(session)
    assert await _next_version(session, d.id) == 1


@pytest.mark.asyncio
async def test_next_version_increments(session):
    from app.models.processing_result import ProcessingResult, ProcessingResultSource
    from app.services.predict import _next_version
    u, _, d = await _seed(session)
    session.add(ProcessingResult(
        document_id=d.id, version=1, structured_data={}, prompt_used="p",
        processor_key="mock|m", source=ProcessingResultSource.PREDICT, created_by=u.id,
    ))
    session.add(ProcessingResult(
        document_id=d.id, version=5, structured_data={}, prompt_used="p",
        processor_key="mock|m", source=ProcessingResultSource.PREDICT, created_by=u.id,
    ))
    await session.commit()
    assert await _next_version(session, d.id) == 6


@pytest.mark.asyncio
async def test_replace_ai_annotations_keeps_manual(session):
    from app.models.annotation import Annotation, AnnotationSource
    from app.services.predict import _replace_ai_annotations

    u, _, d = await _seed(session)
    session.add(Annotation(
        document_id=d.id, field_name="manual_kept", field_value="keep me",
        source=AnnotationSource.MANUAL, created_by=u.id,
    ))
    session.add(Annotation(
        document_id=d.id, field_name="ai_old", field_value="old",
        source=AnnotationSource.AI_DETECTED, created_by=u.id,
    ))
    await session.commit()

    new_data = {"new_field_a": "val_a", "new_field_b": 42}
    await _replace_ai_annotations(session, d.id, new_data, u.id)
    await session.commit()

    rows = (await session.execute(select(Annotation).where(Annotation.deleted_at.is_(None)))).scalars().all()
    names = sorted(r.field_name for r in rows)
    # manual_kept preserved + 2 new ai annotations
    assert "manual_kept" in names
    assert "new_field_a" in names
    assert "new_field_b" in names
    assert "ai_old" not in names  # old AI overwritten
    new_a = next(r for r in rows if r.field_name == "new_field_a")
    assert new_a.source == AnnotationSource.AI_DETECTED
    assert new_a.field_value == "val_a"
