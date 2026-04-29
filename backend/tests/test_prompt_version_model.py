"""S3/T1: PromptVersion model unit tests."""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError


@pytest.mark.asyncio
async def test_prompt_version_basic_insert(db_session, seed_project):
    from app.models.prompt_version import PromptVersion

    pv = PromptVersion(
        project_id=seed_project.id,
        version=1,
        prompt_text="Hello",
        summary="initial",
        created_by=seed_project.created_by,
    )
    db_session.add(pv)
    await db_session.commit()
    out = (await db_session.execute(select(PromptVersion))).scalar_one()
    assert out.version == 1
    assert out.summary == "initial"
    assert out.deleted_at is None


@pytest.mark.asyncio
async def test_prompt_version_unique_per_project(db_session, seed_project):
    from app.models.prompt_version import PromptVersion

    db_session.add(PromptVersion(
        project_id=seed_project.id, version=1, prompt_text="a",
        summary="", created_by=seed_project.created_by,
    ))
    await db_session.commit()
    db_session.add(PromptVersion(
        project_id=seed_project.id, version=1, prompt_text="b",
        summary="", created_by=seed_project.created_by,
    ))
    with pytest.raises(IntegrityError):
        await db_session.commit()


@pytest.mark.asyncio
async def test_project_active_prompt_version_id_column_exists(db_session, seed_project):
    assert hasattr(seed_project, "active_prompt_version_id")
    assert seed_project.active_prompt_version_id is None
